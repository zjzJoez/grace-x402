/**
 * GRACE merchant server — the Track 3 deliverable.
 *
 * A merchant that sells to AI agents over x402, with one twist: the 402
 * challenge carries `coolingOffSeconds`, and the merchant only accepts
 * authorizations whose validAfter honours it. Everything else is stock x402.
 *
 *   node grace/server.mjs                       # mainnet, window from CATALOG
 *   GRACE_NETWORK=fuji node grace/server.mjs
 *   GRACE_WINDOW=90 node grace/server.mjs       # override window for the demo
 *
 * Endpoints
 *   POST /checkout            x402: 402 challenge -> retry with PAYMENT-SIGNATURE
 *   GET  /console             merchant console (queue + SETTLE)
 *   GET  /pay/:id             buyer phone page (countdown + CANCEL)
 *   GET  /api/orders          order book with live chain state
 *   GET  /api/orders/:id      single order (phone page polls this)
 *   POST /api/orders/:id/settle   merchant broadcasts receiveWithAuthorization
 *   POST /api/orders/:id/cancel   buyer signs cancelAuthorization, relayer broadcasts
 */

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { recoverTypedDataAddress } from 'viem'
import { pickNetwork, domainFor, TYPES } from './lib/xsgd.mjs'
import { orderNonce, fromWire, wireFormat, toAtomic, toSgd, signCancellation } from './lib/authorization.mjs'
import { publicClientFor, simulateSettle, settle, broadcastCancel, balanceOf } from './lib/settle.mjs'
import { demoWallets, relayerAccount } from './lib/keys.mjs'
import { consolePage, payPage, storefrontPage } from './pages.mjs'
import { missionPage } from './mission.mjs'
import { terminalPage, phonePage, endPage, problemPage } from './stage.mjs'
import { whyPage } from './why.mjs'

const net = pickNetwork()
const { buyer, merchant } = demoWallets()
const relayer = relayerAccount() ?? merchant // cancel-relayer falls back to merchant's gas
const client = publicClientFor(net)
const PORT = Number(process.env.PORT ?? 4021)
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '')
const ROOT = dirname(fileURLToPath(import.meta.url))
const ORDERS_PATH = join(ROOT, 'orders.json')

const CATALOG = {
  'tee-agentix': { name: 'AgentiX Hackathon Tee', priceSgd: '4.50', coolingOffSeconds: 90, fulfilment: 'ships in 2 days' },
  'coffee-beans': { name: 'Single-origin beans 500g', priceSgd: '9.00', coolingOffSeconds: 120, fulfilment: 'ships in 3 days' },
  'api-credits': { name: '1000 API credits (instant)', priceSgd: '2.00', coolingOffSeconds: 0, fulfilment: 'instant delivery' },
}
const WINDOW_OVERRIDE = process.env.GRACE_WINDOW ? Number(process.env.GRACE_WINDOW) : null
const SETTLE_BY_SECONDS = 3600

// ── order book ───────────────────────────────────────────────────────────────
const orders = new Map(
  existsSync(ORDERS_PATH) ? JSON.parse(readFileSync(ORDERS_PATH, 'utf8')).map((o) => [o.id, o]) : []
)
const persist = () => writeFileSync(ORDERS_PATH, JSON.stringify([...orders.values()], null, 2))

// ── x402 challenge ───────────────────────────────────────────────────────────
/**
 * The tail of the window that is inclusion-and-finality buffer rather than
 * decision time. Kept to a small fraction so the interval a human actually gets
 * stays close to the advertised one — a 90s window whose last 89s are "safety
 * margin" is conformant and dishonest, which is the case the spec now forbids.
 */
const cancellationSafetyFor = (windowSeconds) =>
  // The spec caps this at a quarter of the window. A flat 5s floor breaks that
  // on short windows (5 of 19 is 26.3%), so the cap wins and a window too short
  // to carry any margin gets none.
  windowSeconds > 0 ? Math.min(Math.max(5, Math.round(windowSeconds * 0.15)), Math.floor(windowSeconds / 4)) : 0

/** How far the signed window may differ from the advertised one: clock skew, not policy. */
const SKEW_TOLERANCE = (windowSeconds) => Math.max(2, Math.min(10, Math.round(windowSeconds * 0.1)))

/** How long a quote may sit unsigned. Without this an unsigned 402 is a free price option. */
const QUOTE_TTL_SECONDS = 120

function challengeFor(sku) {
  const item = CATALOG[sku]
  const windowSeconds = WINDOW_OVERRIDE ?? item.coolingOffSeconds
  // Stock `exact`, with the flow named in the protocol-reserved key. The scheme
  // is not ours to invent: what this proposal changes is when settlement happens
  // relative to the response, which §6.1 calls a payment flow.
  return {
    scheme: 'exact',
    network: `eip155:${net.chain.id}`,
    chainId: net.chain.id,
    asset: net.token,
    amount: toAtomic(item.priceSgd).toString(),
    payTo: merchant.address,
    maxTimeoutSeconds: SETTLE_BY_SECONDS,
    extra: {
      assetTransferMethod: 'eip3009',
      paymentFlow: windowSeconds > 0 ? 'cooling-off' : undefined,
      coolingOffSeconds: windowSeconds,
      cancellationSafetySeconds: cancellationSafetyFor(windowSeconds),
      quoteExpiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS,
      name: 'XSGD',
      version: '2',
      settleBySeconds: SETTLE_BY_SECONDS,
      sku,
      description: item.name,
    },
  }
}

/**
 * Accept a cooling-off payment. These checks are the merchant's whole protocol
 * obligation under the flow. This is a demo of the token mechanics, not a
 * conforming coordinator: it has no durable outbox, no restart recovery, and no
 * 202/status contract — see the spec's coordinator requirements for what a
 * production implementation owes.
 */
async function acceptPayment(sku, envelopeB64) {
  const item = CATALOG[sku]
  const envelope = JSON.parse(Buffer.from(envelopeB64, 'base64').toString())
  const accepted = envelope.accepted ?? envelope.accepts?.[0]
  const { signature, authorization: wireAuth } = envelope.payload ?? {}
  if (!accepted || !signature || !wireAuth) throw new Error('malformed envelope')

  const auth = fromWire(wireAuth)
  const now = Math.floor(Date.now() / 1000)
  const windowSeconds = WINDOW_OVERRIDE ?? item.coolingOffSeconds

  // 1. pays us, the right amount
  if (auth.to.toLowerCase() !== merchant.address.toLowerCase()) throw new Error('payTo mismatch')
  if (auth.value !== toAtomic(item.priceSgd)) throw new Error('amount mismatch')

  // 2. the signed window matches the advertised one, within clock skew only.
  //    A generous tolerance here would quietly sell a shorter window than the
  //    402 promised, so it is a small fraction of the window rather than a flat
  //    45 seconds — which on a 90s SKU used to admit half of it.
  const window = Number(auth.validAfter) - now
  const skew = SKEW_TOLERANCE(windowSeconds)
  if (window < windowSeconds - skew) throw new Error(`cooling-off too short: ${window}s < ${windowSeconds}s (skew allowance ${skew}s)`)
  if (window > windowSeconds + skew) throw new Error(`cooling-off implausibly long: ${window}s > ${windowSeconds}s`)
  if (auth.validBefore <= auth.validAfter) throw new Error('validBefore <= validAfter')

  // 2b. the quote the client signed against is still the quote we are offering.
  //     Signing time is the client's to choose, so without an expiry a held 402
  //     is a free option on the price for as long as the client likes.
  const quoteExpiresAt = Number(accepted?.extra?.quoteExpiresAt ?? 0)
  if (!quoteExpiresAt) throw new Error('quote has no expiry — refusing to honour an open-ended price')
  if (now > quoteExpiresAt) throw new Error(`quote expired ${now - quoteExpiresAt}s ago — request a fresh 402`)

  // 2c. the safety margin the client was shown obeys the spec's floor.
  const safety = Number(accepted?.extra?.cancellationSafetySeconds ?? -1)
  if (windowSeconds > 0 && !(safety >= 0 && safety <= Math.floor(windowSeconds / 4))) {
    throw new Error(`cancellation safety margin ${safety}s exceeds a quarter of the ${windowSeconds}s window`)
  }

  // 3. the signature is the payer's
  const signer = await recoverTypedDataAddress({
    domain: domainFor(net),
    types: TYPES.receive,
    primaryType: 'ReceiveWithAuthorization',
    message: auth,
    signature,
  })
  if (signer.toLowerCase() !== auth.from.toLowerCase()) throw new Error('signature does not recover to payer')

  // 4. the nonce commits to the order. The salt travels with the envelope, not
  //    on-chain: the commitment stays private to anyone who was not shown it,
  //    and an unsalted digest over a three-item catalogue would be brute-forced
  //    from the settlement event in milliseconds.
  const order = envelope.order ?? null
  const orderSalt = envelope.orderSalt ?? null
  if (order) {
    if (!orderSalt) throw new Error('order supplied without its salt')
    if (orderNonce(order, orderSalt).nonce !== auth.nonce) throw new Error('nonce does not commit to this order')
  }

  const id = auth.nonce.slice(2, 10)
  const record = {
    id,
    // Cancelling makes this server sign with the payer's key, so the request has
    // to prove it came from whoever holds the payment. The token travels only in
    // the 402 receipt and the payer's own page; orderView strips it before any
    // public read. Settling stays open on purpose — pressing SETTLE and watching
    // the chain refuse is the demo, and after the window it only does what the
    // autopilot would have done anyway.
    cancelToken: randomBytes(16).toString('hex'),
    sku,
    name: item.name,
    amountSgd: toSgd(auth.value),
    status: 'pending', // pending -> settled | voided | expired
    createdAt: now,
    opensAt: Number(auth.validAfter),
    cancelBy: Number(auth.validAfter) - cancellationSafetyFor(windowSeconds),
    closesAt: Number(auth.validBefore),
    windowSeconds,
    order,
    orderSalt, // kept so the commitment can be re-derived for an auditor later
    payer: auth.from,
    authorization: wireFormat(auth),
    signature,
    txs: {},
  }
  orders.set(id, record)
  persist()
  scheduleAutopilot(record) // fire-and-forget; a failed schedule never blocks checkout
  return record
}

/**
 * GRACE Autopilot hack-demo mode: one EventBridge Scheduler one-shot per order,
 * firing after the chain first allows settlement. The schedule
 * deletes itself after firing (ActionAfterCompletion). Runs on the instance
 * role via the preinstalled aws CLI; requires AUTOPILOT_AT=1.
 *
 * If the payer cancels during the window, the schedule still fires and the
 * settle attempt reverts on-chain — which is the token primitive working.
 * This demo path is not the durable coordinator specified by the proposal: a
 * production implementation must commit state + outbox before returning 202,
 * recover after restart, and stop its own settlement job on cancel acceptance.
 */
function scheduleAutopilot(record) {
  if (process.env.AUTOPILOT_AT !== '1') return
  // EventBridge rejects schedules in the past — zero-window (instant) orders get now+10s.
  const fireEpoch = Math.max(record.opensAt + 2, Math.floor(Date.now() / 1000) + 10)
  const fireAt = new Date(fireEpoch * 1000).toISOString().slice(0, 19)
  const args = [
    'scheduler', 'create-schedule',
    '--name', `grace-${record.id}`,
    '--schedule-expression', `at(${fireAt})`,
    '--schedule-expression-timezone', 'UTC',
    '--flexible-time-window', '{"Mode":"OFF"}',
    '--action-after-completion', 'DELETE',
    '--target', JSON.stringify({
      Arn: process.env.AUTOPILOT_LAMBDA_ARN ?? 'arn:aws:lambda:ap-southeast-1:688060218394:function:grace-autopilot',
      RoleArn: process.env.AUTOPILOT_ROLE_ARN ?? 'arn:aws:iam::688060218394:role/grace-scheduler',
      Input: JSON.stringify({ orderId: record.id }),
    }),
    '--region', process.env.AWS_REGION ?? 'ap-southeast-1',
  ]
  execFile('aws', args, { timeout: 20000 }, (err) => {
    if (err) console.error(`autopilot schedule failed for ${record.id}: ${err.message.slice(0, 200)}`)
    else console.log(`autopilot: settlement scheduled at(${fireAt}Z) for order ${record.id}`)
  })
}

/**
 * Watch the two wallets so the UI can say, truthfully and continuously, how long
 * the payer's balance has been untouched. "Nothing moved" is the whole claim, so
 * it should be measured, not asserted.
 */
const balanceWatch = { payer: null, merchant: null, since: Date.now() }
async function walletState() {
  const [p, m] = await Promise.all([balanceOf(net, buyer.address, client), balanceOf(net, merchant.address, client)])
  if (balanceWatch.payer !== p || balanceWatch.merchant !== m) {
    if (balanceWatch.payer !== null) balanceWatch.since = Date.now()
    balanceWatch.payer = p
    balanceWatch.merchant = m
  }
  return {
    payer: buyer.address, merchant: merchant.address,
    payerXsgd: toSgd(p), merchantXsgd: toSgd(m),
    unchangedForMs: Date.now() - balanceWatch.since,
  }
}

// Block height, polled lazily — proof the chain under the demo is a live mainnet.
let blockCache = { at: 0, number: null }
async function blockNumber() {
  if (Date.now() - blockCache.at > 4000) {
    blockCache = { at: Date.now(), number: (await client.getBlockNumber().catch(() => null))?.toString() ?? blockCache.number }
  }
  return blockCache.number
}

// ── live chain state per order ───────────────────────────────────────────────
const simCache = new Map() // id -> { at, result }
async function liveState(o) {
  if (o.status === 'settled' || o.status === 'canceled') {
    return { state: o.status, headline: o.status === 'settled' ? 'Settled on-chain' : 'Cancelled by payer', detail: '', reason: null }
  }
  const cached = simCache.get(o.id)
  if (cached && Date.now() - cached.at < 3000) return cached.result
  const sig = o.signature
  const result = await simulateSettle(net, {
    authorization: fromWire(o.authorization),
    v: parseInt(sig.slice(130, 132), 16),
    r: `0x${sig.slice(2, 66)}`,
    s: `0x${sig.slice(66, 130)}`,
  }, client)
  simCache.set(o.id, { at: Date.now(), result })
  return result
}

/**
 * What a public reader is allowed to see. An allowlist, not a blocklist: the
 * record holds a signed authorization, and that payload is a bearer settlement
 * capability — anyone who copies it can submit the payment. Spreading the record
 * and deleting one field is how `signature`, `authorization`, `order` and
 * `orderSalt` were being served to anonymous callers on three endpoints.
 */
async function orderView(o) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: o.id,
    sku: o.sku,
    name: o.name,
    amountSgd: o.amountSgd,
    status: o.status,
    createdAt: o.createdAt,
    opensAt: o.opensAt,
    cancelBy: o.cancelBy,
    closesAt: o.closesAt,
    windowSeconds: o.windowSeconds,
    payer: o.payer,
    nonce: o.authorization?.nonce,   // public on-chain anyway; the commitment is salted
    txs: o.txs,
    live: await liveState(o),
    secondsLeft: Math.max(0, o.opensAt - now),
    cancelSecondsLeft: Math.max(0, (o.cancelBy ?? o.opensAt) - now),
    explorer: net.explorer,
  }
}

// ── actions ──────────────────────────────────────────────────────────────────
async function doSettle(o) {
  const sig = o.signature
  const res = await settle(net, merchant, {
    authorization: fromWire(o.authorization),
    v: parseInt(sig.slice(130, 132), 16),
    r: `0x${sig.slice(2, 66)}`,
    s: `0x${sig.slice(66, 130)}`,
  })
  o.status = 'settled'
  o.txs.settle = res.hash
  persist()
  return res
}

async function doCancel(o) {
  // cancelAuthorization is only meaningful when signed by the order's payer.
  // Signing with our own buyer key for someone else's order would burn the
  // wrong (authorizer, nonce) pair — a cosmetic void the chain ignores.
  if (o.payer.toLowerCase() !== buyer.address.toLowerCase()) {
    throw new Error(`cancel must be signed by the payer (${o.payer}) — this server only holds keys for ${buyer.address}`)
  }
  // The buyer signs; the relayer pays the gas. The buyer wallet holds zero AVAX
  // and never needs any — that is the point being demonstrated.
  const cancellation = await signCancellation(buyer, net, o.authorization.nonce)
  const res = await broadcastCancel(net, relayer, cancellation)
  o.status = 'canceled'
  o.txs.cancel = res.hash
  persist()
  return res
}

// ── http plumbing ────────────────────────────────────────────────────────────
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}
const html = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}
const readBody = (req) => new Promise((resolve) => {
  let data = ''
  req.on('data', (c) => (data += c))
  req.on('end', () => resolve(data))
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  try {
    // x402 checkout
    if (req.method === 'POST' && path === '/checkout') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const sku = body.sku
      if (!CATALOG[sku]) return json(res, 400, { error: `unknown sku — try ${Object.keys(CATALOG).join(', ')}` })
      const envelopeB64 = req.headers['payment-signature']
      if (!envelopeB64) {
        const challenge = challengeFor(sku)
        res.writeHead(402, {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2, accepts: [challenge] })).toString('base64'),
        })
        return res.end(JSON.stringify({ error: 'payment required', scheme: 'exact', paymentFlow: 'cooling-off' }))
      }
      const record = await acceptPayment(sku, envelopeB64)
      return json(res, 200, {
        order_id: record.id,
        status: 'pending',
        cooling_off_seconds: record.windowSeconds,
        settle_opens_at: record.opensAt,
        confirm_url: `${PUBLIC_URL}/pay/${record.id}?t=${record.cancelToken}`,
        message: `Order accepted. Settlement is chain-blocked until ${new Date(record.opensAt * 1000).toISOString()}. Cancellation near that boundary may race; production clients use an earlier cancelBy safety cutoff.`,
      })
    }

    if (req.method === 'GET' && path === '/api/orders') {
      const list = await Promise.all([...orders.values()].sort((a, b) => b.createdAt - a.createdAt).map(orderView))
      const [merchXsgd, buyerXsgd] = await Promise.all([balanceOf(net, merchant.address, client), balanceOf(net, buyer.address, client)])
      return json(res, 200, {
        network: net.label, token: net.token,
        merchant: merchant.address, merchantXsgd: toSgd(merchXsgd),
        buyer: buyer.address, buyerXsgd: toSgd(buyerXsgd),
        orders: list,
      })
    }

    // Everything the mission-control screen needs, in one round trip.
    if (req.method === 'GET' && path === '/api/state') {
      const all = [...orders.values()].sort((a, b) => b.createdAt - a.createdAt)
      const [wallets, block, views] = await Promise.all([
        walletState(), blockNumber(), Promise.all(all.slice(0, 6).map(orderView)),
      ])
      const events = []
      for (const o of all) {
        if (o.txs.cancel) events.push({ kind: 'AuthorizationCanceled', at: o.opensAt, order: o.id, amountSgd: o.amountSgd, nonce: o.authorization.nonce, tx: o.txs.cancel })
        if (o.txs.settle) events.push({ kind: 'AuthorizationUsed', at: o.opensAt, order: o.id, amountSgd: o.amountSgd, nonce: o.authorization.nonce, tx: o.txs.settle })
      }
      return json(res, 200, {
        chain: { label: net.label, chainId: net.chain.id, token: net.token, explorer: net.explorer, block },
        wallets,
        // The newest order, whatever its state — the screen should keep showing
        // the outcome after it settles or is vetoed, not fall back to an older one.
        active: views[0] ?? null,
        orders: views,
        events: events.slice(0, 6),
        now: Math.floor(Date.now() / 1000),
      })
    }

    // Run a purchase AS THIS MERCHANT'S DEMO BUYER, streaming the agent's real
    // stdout. Exists so a remote demo driver can show the buy in a terminal
    // while the payer is the wallet whose key lives here — which is the only
    // wallet this server can honestly cancel for.
    if (req.method === 'POST' && path === '/api/demo/buy') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const sku = CATALOG[body.sku] ? body.sku : 'tee-agentix'
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' })
      const { spawn } = await import('node:child_process')
      const child = spawn('node', ['grace/agent.mjs', '--sku', sku, '--server', `http://localhost:${PORT}`,
        ...(body.brain ? ['--brain'] : []),
        '--instruction', String(body.instruction ?? `Buy ${sku}`).slice(0, 200)],
        { cwd: join(ROOT, '..'), env: { ...process.env, AWS_REGION: 'ap-southeast-1' } })
      child.stdout.on('data', (d) => res.write(d))
      child.stderr.on('data', (d) => res.write(d))
      child.on('exit', () => res.end())
      return
    }

    const m = path.match(/^\/api\/orders\/([0-9a-f]+)\/(settle|cancel)$/)
    if (req.method === 'POST' && m) {
      const o = orders.get(m[1])
      if (!o) return json(res, 404, { error: 'no such order' })
      if (m[2] === 'cancel' && url.searchParams.get('t') !== o.cancelToken) {
        return json(res, 403, { ok: false, reason: 'cancellation requires the payer token from the confirmation page' })
      }
      try {
        const out = m[2] === 'settle' ? await doSettle(o) : await doCancel(o)
        return json(res, 200, { ok: true, tx: out.hash, explorerUrl: out.explorerUrl, order: await orderView(o) })
      } catch (err) {
        const { revertReason } = await import('./lib/settle.mjs')
        return json(res, 409, { ok: false, reason: revertReason(err), order: await orderView(o) })
      }
    }

    const single = path.match(/^\/api\/orders\/([0-9a-f]+)$/)
    if (req.method === 'GET' && single) {
      const o = orders.get(single[1])
      return o ? json(res, 200, await orderView(o)) : json(res, 404, { error: 'no such order' })
    }

    if (req.method === 'GET' && (path === '/' || path === '/live')) {
      return html(res, missionPage(
        net,
        url.searchParams.get('theme') ?? process.env.GRACE_THEME ?? 'editorial',
        url.searchParams.has('picker'),
      ))
    }
    if (req.method === 'GET' && path === '/why') return html(res, whyPage(net))
    if (req.method === 'GET' && path === '/stage/problem') return html(res, problemPage())
    if (req.method === 'GET' && path === '/stage/terminal') return html(res, terminalPage())
    if (req.method === 'GET' && path === '/stage/end') return html(res, endPage())
    // The recording stage: same credential rule as /pay/:id, since it frames it.
    if (req.method === 'GET' && path === '/phone') {
      const id = url.searchParams.get('id')
      const o = id ? orders.get(id) : null
      if (!o) return json(res, 404, { error: 'no such order' })
      if (url.searchParams.get('t') !== o.cancelToken) {
        return json(res, 403, { error: 'this page needs the payer link from the payment receipt' })
      }
      return html(res, phonePage(id, PUBLIC_URL, o.cancelToken))
    }
    if (req.method === 'GET' && path === '/console') return html(res, consolePage(net))
    // /pay/latest is gone. It resolved the newest order for whoever asked and
    // rendered its page — which embeds the cancellation token — so any anonymous
    // visitor could read the credential that the cancel endpoint checks. A demo
    // convenience that silently reopened the hole the token exists to close.
    const pay = path.match(/^\/pay\/([0-9a-f]+)$/)
    if (req.method === 'GET' && pay) {
      const o = orders.get(pay[1])
      if (!o) return json(res, 404, { error: 'no such order' })
      // The page carries the cancellation credential, so seeing the page requires
      // holding it. The link comes from the 402 receipt, which only the payer got.
      if (url.searchParams.get('t') !== o.cancelToken) {
        return json(res, 403, { error: 'this page needs the payer link from the payment receipt' })
      }
      return html(res, payPage(o, net))
    }
    if (req.method === 'GET' && path === '/store') return html(res, storefrontPage(CATALOG, net, merchant.address))

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 400, { error: err.message })
  }
})

server.listen(PORT, () => {
  console.log(`\nGRACE merchant — ${net.label}`)
  console.log(`  merchant ${merchant.address}`)
  console.log(`  buyer    ${buyer.address}   (demo agent wallet)`)
  console.log(`  relayer  ${relayer.address}${relayer === merchant ? '  (fallback: merchant pays cancel gas — set AGENT_PRIVATE_KEY for the real relayer)' : ''}`)
  console.log(`\n  store    http://localhost:${PORT}/`)
  console.log(`  console  http://localhost:${PORT}/console`)
  console.log(`  checkout POST http://localhost:${PORT}/checkout  {"sku":"tee-agentix"}\n`)
})

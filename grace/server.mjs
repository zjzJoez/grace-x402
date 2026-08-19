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
function challengeFor(sku) {
  const item = CATALOG[sku]
  const windowSeconds = WINDOW_OVERRIDE ?? item.coolingOffSeconds
  return {
    scheme: 'exact-deferred',
    network: net.key === 'mainnet' ? 'avalanche' : 'avalanche-fuji',
    chainId: net.chain.id,
    asset: net.token,
    amount: toAtomic(item.priceSgd).toString(),
    payTo: merchant.address,
    maxTimeoutSeconds: SETTLE_BY_SECONDS,
    extra: {
      name: 'XSGD',
      version: '2',
      coolingOffSeconds: windowSeconds,
      settleBySeconds: SETTLE_BY_SECONDS,
      sku,
      description: item.name,
    },
  }
}

/**
 * Accept an exact-deferred payment. The merchant's whole protocol obligation
 * is these checks — this function IS the reference implementation.
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

  // 2. the cooling-off window is honoured (±45s clock tolerance)
  const window = Number(auth.validAfter) - now
  if (window < windowSeconds - 45) throw new Error(`cooling-off too short: ${window}s < ${windowSeconds}s`)
  if (window > windowSeconds + 300) throw new Error('cooling-off implausibly long')
  if (auth.validBefore <= auth.validAfter) throw new Error('validBefore <= validAfter')

  // 3. the signature is the payer's
  const signer = await recoverTypedDataAddress({
    domain: domainFor(net),
    types: TYPES.receive,
    primaryType: 'ReceiveWithAuthorization',
    message: auth,
    signature,
  })
  if (signer.toLowerCase() !== auth.from.toLowerCase()) throw new Error('signature does not recover to payer')

  // 4. the nonce commits to the order (self-describing settlement)
  const order = envelope.order ?? null
  if (order && orderNonce(order) !== auth.nonce) throw new Error('nonce != keccak256(order)')

  const id = auth.nonce.slice(2, 10)
  const record = {
    id,
    sku,
    name: item.name,
    amountSgd: toSgd(auth.value),
    status: 'pending', // pending -> settled | voided | expired
    createdAt: now,
    opensAt: Number(auth.validAfter),
    closesAt: Number(auth.validBefore),
    windowSeconds,
    order,
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
  if (o.status === 'settled' || o.status === 'voided') {
    return { state: o.status, headline: o.status === 'settled' ? 'Settled on-chain' : 'Voided by payer', detail: '', reason: null }
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

async function orderView(o) {
  const now = Math.floor(Date.now() / 1000)
  return {
    ...o,
    live: await liveState(o),
    secondsLeft: Math.max(0, o.opensAt - now),
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
  o.status = 'voided'
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
          'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 1, accepts: [challenge] })).toString('base64'),
        })
        return res.end(JSON.stringify({ error: 'payment required', scheme: 'exact-deferred' }))
      }
      const record = await acceptPayment(sku, envelopeB64)
      return json(res, 200, {
        order_id: record.id,
        status: 'pending',
        cooling_off_seconds: record.windowSeconds,
        settle_opens_at: record.opensAt,
        confirm_url: `${PUBLIC_URL}/pay/${record.id}`,
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
    if (req.method === 'GET' && path === '/phone') {
      const id = url.searchParams.get('id') ?? [...orders.values()].sort((a, b) => b.createdAt - a.createdAt)[0]?.id
      if (!id) return json(res, 404, { error: 'no orders yet' })
      return html(res, phonePage(id, PUBLIC_URL))
    }
    if (req.method === 'GET' && path === '/console') return html(res, consolePage(net))
    // The stage bookmark: a phone that opens /pay/latest always lands on the
    // newest still-cancellable order — no typing an order id on stage. Renders
    // in place (no redirect) so pull-to-refresh re-resolves to the next order.
    if (req.method === 'GET' && path === '/pay/latest') {
      const all = [...orders.values()].sort((a, b) => b.createdAt - a.createdAt)
      const o = all.find((x) => x.status === 'pending') ?? all[0]
      return o ? html(res, payPage(o, net)) : json(res, 404, { error: 'no orders yet' })
    }
    const pay = path.match(/^\/pay\/([0-9a-f]+)$/)
    if (req.method === 'GET' && pay) {
      const o = orders.get(pay[1])
      return o ? html(res, payPage(o, net)) : json(res, 404, { error: 'no such order' })
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

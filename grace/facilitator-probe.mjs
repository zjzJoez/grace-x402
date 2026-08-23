/**
 * What a real facilitator does with a cooling-off payload.
 *
 *   node grace/facilitator-probe.mjs
 *
 * The `cooling-off` proposal rests on a claim about other people's software:
 * that today's facilitators reject the exact payload the flow requires, which
 * is why the flow needs to exist. This asks them, instead of asserting it.
 *
 * Two payloads go to a live public facilitator's /verify. They are signed by
 * the same wallet, for the same amount, to the same payee, with the same
 * nonce-free structure — one field differs:
 *
 *   control    validAfter = now - 600   (what every SDK sends today)
 *   cooling    validAfter = now + 90    (what this flow needs)
 *
 * Nothing is settled and no funds move: /verify is read-only by specification.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickNetwork, domainFor, TYPES } from './lib/xsgd.mjs'
import { publicClientFor, balanceOf } from './lib/settle.mjs'
import { toAtomic, toSgd } from './lib/authorization.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const Y = (s) => `\x1b[33m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`

// Publicly reachable, no API key, canonical error identifiers, Avalanche C-Chain.
const FACILITATORS = [
  { name: 'PayAI',  url: 'https://facilitator.payai.network/verify' },
  { name: 'Dexter', url: 'https://x402.dexter.cash/verify' },
]

const WINDOW_ERROR = 'invalid_exact_evm_payload_authorization_valid_after'

const net = pickNetwork('mainnet')
const client = publicClientFor(net)
const buyer = privateKeyToAccount(JSON.parse(readFileSync(join(HERE, '.keys.json'), 'utf8')).buyer)
const payTo = '0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d'
const amount = toAtomic('0.10')

/** A stock `exact` / eip3009 payload — the only variable is when it becomes valid. */
async function payload(validAfterOffset) {
  const now = Math.floor(Date.now() / 1000)
  const authorization = {
    from: buyer.address,
    to: payTo,
    value: amount,
    validAfter: BigInt(now + validAfterOffset),
    validBefore: BigInt(now + validAfterOffset + 3600),
    nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
  }
  const signature = await buyer.signTypedData({
    domain: domainFor(net),
    types: TYPES.transfer,          // `exact` settles via transferWithAuthorization
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  })
  const accepted = {
    scheme: 'exact',
    network: `eip155:${net.chain.id}`,
    amount: amount.toString(),
    asset: net.token,
    payTo,
    maxTimeoutSeconds: 3600,
    extra: { name: 'XSGD', version: '2' },
  }
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: { url: 'https://example.invalid/cooling-off-probe', description: 'probe', mimeType: 'application/json' },
      accepted,
      payload: {
        signature,
        authorization: Object.fromEntries(
          Object.entries(authorization).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])),
      },
    },
    paymentRequirements: accepted,
  }
}

async function ask(f, body) {
  const res = await fetch(f.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON body */ }
  return { status: res.status, json, text: text.slice(0, 200) }
}

const bal = await balanceOf(net, buyer.address, client)

console.log(`\n\x1b[1mWhat a live facilitator says about a cooling-off payload\x1b[0m`)
console.log(D(`  chain    ${net.label} (eip155:${net.chain.id})`))
console.log(D(`  asset    XSGD ${net.token}`))
console.log(D(`  payer    ${buyer.address}  (${toSgd(bal)} XSGD — funded, so balance is not the objection)`))
console.log(D(`  amount   0.10 XSGD · /verify only, nothing is settled\n`))

const cases = [
  { label: 'control — validAfter 600s in the PAST (what SDKs send today)', offset: -600 },
  { label: 'cooling  — validAfter 90s in the FUTURE (what this flow needs)', offset: 90 },
]

let proved = 0
for (const f of FACILITATORS) {
  console.log(`\x1b[1m${f.name}\x1b[0m ${D(f.url)}`)
  const seen = {}
  for (const c of cases) {
    const r = await ask(f, await payload(c.offset)).catch((e) => ({ status: 0, text: e.message }))
    const reason = r.json?.invalidReason ?? r.json?.invalidCode ?? r.text
    const valid = r.json?.isValid
    seen[c.offset] = reason
    const verdict = valid ? G('ACCEPTED') : (String(reason).includes(WINDOW_ERROR) ? Y('REJECTED — the window') : R('rejected'))
    console.log(`  ${c.label}`)
    console.log(`    HTTP ${r.status}  ${verdict}  ${D(String(reason).slice(0, 90))}`)
  }
  const control = String(seen[-600] ?? '')
  const cooling = String(seen[90] ?? '')
  if (cooling.includes(WINDOW_ERROR) && !control.includes(WINDOW_ERROR)) {
    console.log(G(`  ⇒ the only difference between the two payloads is validAfter, and it is the`))
    console.log(G(`    single reason this facilitator refuses the second one.\n`))
    proved++
  } else {
    console.log(D(`  ⇒ inconclusive here — control: ${control.slice(0, 60)}\n`))
  }
}

console.log(proved
  ? G(`■ ${proved}/${FACILITATORS.length} facilitators reproduce the gap this flow exists to close.`)
  : R(`■ no facilitator reproduced the expected rejection — re-check the payload shape.`))
console.log(D(`  This is the claim the proposal makes about deployed software, tested rather than asserted.\n`))

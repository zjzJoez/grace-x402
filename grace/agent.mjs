/**
 * GRACE buyer agent — the x402 client side of the exact-deferred scheme.
 *
 *   node grace/agent.mjs --sku tee-agentix
 *   node grace/agent.mjs --sku coffee-beans --server http://localhost:4021
 *
 * Flow: POST /checkout -> 402 challenge -> read extra.coolingOffSeconds ->
 * sign ReceiveWithAuthorization with validAfter = now + window -> retry.
 * The nonce is keccak256 of the order object, so the eventual settlement (or
 * cancellation) event on Avalanche commits to what was bought.
 */

import { pickNetwork } from './lib/xsgd.mjs'
import { signDeferredPayment, wireFormat, toSgd } from './lib/authorization.mjs'
import { demoWallets } from './lib/keys.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const SERVER = arg('server', 'http://localhost:4021')
const SKU = arg('sku', 'tee-agentix')
const BRAIN = process.argv.includes('--brain')
const INSTRUCTION = arg('instruction', `Buy me a "${SKU}" if the price is fair.`)

const net = pickNetwork()
const { buyer } = demoWallets()
const D = (s) => `\x1b[2m${s}\x1b[0m`
console.log(`\nGRACE agent — buying "${SKU}" as ${buyer.address}`)

// 1. hit the paywall
const first = await fetch(`${SERVER}/checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sku: SKU }),
})
if (first.status !== 402) {
  console.error(`expected 402, got ${first.status}: ${await first.text()}`)
  process.exit(1)
}
const header = JSON.parse(Buffer.from(first.headers.get('payment-required'), 'base64').toString())
const challenge = header.accepts[0]
const windowSeconds = challenge.extra.coolingOffSeconds
console.log(D(`  402: ${challenge.scheme} · ${toSgd(BigInt(challenge.amount))} XSGD · cooling-off ${windowSeconds}s`))

if (challenge.chainId !== net.chain.id) {
  console.error(`server is on chain ${challenge.chainId}, agent on ${net.chain.id} — set GRACE_NETWORK to match`)
  process.exit(1)
}

// 2. optional Bedrock brain: a real model decides before any signature exists
if (BRAIN) {
  const { decidePurchase } = await import('./lib/brain.mjs')
  console.log(D(`  brain: asking Claude on Bedrock…`))
  const decision = await decidePurchase({
    instruction: INSTRUCTION,
    challenge,
    walletXsgd: 'unknown (demo wallet)',
  })
  console.log(`  brain [${decision.model.split('.')[1]}]: ${decision.approve ? '\x1b[32mAPPROVE\x1b[0m' : '\x1b[31mREJECT\x1b[0m'} — ${decision.reason}`)
  if (!decision.approve) {
    console.log('  agent stops here. no signature was ever created.\n')
    process.exit(0)
  }
}

// 3. sign the deferred authorization; commit the order into the nonce
const order = {
  sku: SKU,
  description: challenge.extra.description,
  amount: challenge.amount,
  merchant: challenge.payTo,
  agent: 'grace-demo-agent/1.0',
  ts: Math.floor(Date.now() / 1000),
}
const signed = await signDeferredPayment(buyer, net, {
  to: challenge.payTo,
  amountSgd: toSgd(BigInt(challenge.amount)),
  windowSeconds,
  ttlSeconds: challenge.extra.settleBySeconds ?? 3600,
  order,
})
console.log(D(`  signed: validAfter=${signed.authorization.validAfter} nonce=${signed.authorization.nonce.slice(0, 18)}…`))

// 3. retry with the envelope
const envelope = {
  x402Version: 2,
  accepted: challenge,
  payload: { signature: signed.signature, authorization: wireFormat(signed.authorization) },
  order,
}
const second = await fetch(`${SERVER}/checkout`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(envelope)).toString('base64'),
  },
  body: JSON.stringify({ sku: SKU }),
})
const result = await second.json()
if (!second.ok) {
  console.error(`merchant rejected: ${JSON.stringify(result)}`)
  process.exit(1)
}

console.log(`\n\x1b[32m✓ order ${result.order_id} accepted\x1b[0m`)
console.log(`  cooling-off: ${result.cooling_off_seconds}s (settlement chain-blocked until then)`)
console.log(`  human confirm page: ${result.confirm_url}`)
console.log(D(`  ${result.message}\n`))

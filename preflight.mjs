/**
 * Run this the moment the organizers fund your wallet.
 *   node preflight.mjs                 # read-only checks, no key needed
 *   AGENT_PRIVATE_KEY=0x... node preflight.mjs --issue
 *
 * Never hardcode the key. Never commit it.
 */

import { getChallenge, issueCard, xsgdBalance, ENV } from './x402-xsgd.mjs'

const ADDRESS = process.env.AGENT_ADDRESS ?? '0x8Cd7d9C43f18BA2519Ef176143fb3a2EbCF9150e'
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`

console.log('\n— StraitsX AgentiX preflight —\n')

// 1. issuer reachable + challenge well-formed
let challenge
try {
  challenge = await getChallenge(ENV.sandbox.issueCard, { amount_sgd: 10, cardholder_name: 'Preflight' })
  console.log(ok(`issuer alive — wants ${Number(challenge.amount) / 1e6} XSGD on ${challenge.network}`))
  console.log(`  asset ${challenge.asset}`)
  console.log(`  payTo ${challenge.payTo}`)
} catch (e) {
  console.log(bad(`issuer unreachable: ${e.message}`))
  process.exit(1)
}

// 2. funding status
const bal = await xsgdBalance(ADDRESS)
const need = Number(challenge.amount) / 1e6
console.log(
  Number(bal.formatted) >= need
    ? ok(`wallet funded — ${bal.formatted} XSGD (need ${need} per card)`)
    : bad(`wallet has ${bal.formatted} XSGD — ask an organizer to fund ${ADDRESS}`)
)

// 3. optional: burn one real card
if (process.argv.includes('--issue')) {
  const key = process.env.AGENT_PRIVATE_KEY
  if (!key) {
    console.log(bad('set AGENT_PRIVATE_KEY to issue'))
    process.exit(1)
  }
  console.log('\nissuing a S$5 card…')
  const card = await issueCard({ privateKey: key, amountSgd: 5, cardholderName: 'Preflight Test' })
  console.log(ok(`card ${card.card_opaque_id}`))
  console.log(`  settlement ${card.explorerUrl}`)
  console.log(`  nonce      ${card.nonce}`)
}

console.log()

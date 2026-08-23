/**
 * GRACE — adversarial proof of the rail, against live XSGD on Avalanche C-Chain.
 *
 *   node grace/prove.mjs            # mainnet
 *   GRACE_NETWORK=fuji node grace/prove.mjs
 *
 * Costs nothing and changes nothing: every claim is proven with eth_call
 * simulation against real contract state, using a throwaway key generated at
 * runtime. Nothing here needs the hackathon wallet's private key.
 *
 * The point is to show the four states GRACE sells are enforced by the token
 * itself, not by our server:
 *
 *   1. during the cooling-off window, the merchant CANNOT settle
 *   2. after the window, it CAN
 *   3. only the payee can settle at all
 *   4. a cancelled/spent nonce is dead forever
 *
 * plus that a payer's cancellation signature is accepted by the contract.
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { parseAbiItem } from 'viem'
import { pickNetwork, ABI, REVERTS } from './lib/xsgd.mjs'
import { signDeferredPayment, signCancellation, orderNonce } from './lib/authorization.mjs'
import { publicClientFor, simulateSettle, simulateCancel, authorizationState, revertReason } from './lib/settle.mjs'

const net = pickNetwork()
const client = publicClientFor(net)

const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`
let pass = 0, fail = 0, onchain = 0
/**
 * `chain: true` marks an assertion whose outcome is decided by live contract
 * state — an eth_call the deployed token answers. Everything else is a local
 * property of this library. Both are worth asserting; conflating them would
 * inflate what the suite claims to prove, so the summary counts them apart.
 */
const check = (ok, label, detail = '', chain = false) => {
  console.log(`  ${ok ? G('PASS') : R('FAIL')}  ${label}${detail ? D('  — ' + detail) : ''}`)
  ok ? pass++ : fail++
  if (ok && chain) onchain++
}

const payer = privateKeyToAccount(generatePrivateKey())
const merchant = privateKeyToAccount(generatePrivateKey())
const bystander = privateKeyToAccount(generatePrivateKey())

console.log(`\n\x1b[1mGRACE rail proof — ${net.label} (${net.chain.id})\x1b[0m`)
console.log(D(`  XSGD    ${net.token}`))
console.log(D(`  payer   ${payer.address}  (throwaway, unfunded)`))
console.log(D(`  merchant ${merchant.address}\n`))

// ─────────────────────────────────────────────────────────────────────────────
console.log('\x1b[1m1. Cooling-off window is enforced by the token, not by us\x1b[0m')

const order = { sku: 'AGENTIX-DEMO-001', qty: 1, total_sgd: '4.50', buyer_agent: 'demo-agent-v1' }
const pending = await signDeferredPayment(payer, net, {
  to: merchant.address, amountSgd: 4.5, windowSeconds: 120, order,
})

const early = await simulateSettle(net, pending, client)
check(early.reason === REVERTS.tooEarly,
  'merchant settling inside the window reverts', early.reason, true)
check(early.state === 'cooling-off', 'classified as cooling-off for the UI')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m2. After the window the same signature becomes cashable\x1b[0m')

// Identical authorization, window already elapsed. An unfunded payer means the
// only remaining objection the contract can raise is the balance — which proves
// every other gate (time, nonce, signature, payee) has been passed.
const matured = await signDeferredPayment(payer, net, {
  to: merchant.address, amountSgd: 4.5, windowSeconds: -600, order,
})
const late = await simulateSettle(net, matured, client)
check(late.reason === REVERTS.noFunds,
  'time gate opens; only the (empty) balance objects', late.reason, true)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m3. Only the payee can settle — receiveWithAuthorization binds the caller\x1b[0m')

let wrongCaller
try {
  await client.simulateContract({
    address: net.token, abi: ABI, functionName: 'receiveWithAuthorization',
    args: [matured.authorization.from, matured.authorization.to, matured.authorization.value,
           matured.authorization.validAfter, matured.authorization.validBefore,
           matured.authorization.nonce, matured.v, matured.r, matured.s],
    account: bystander.address,
  })
  wrongCaller = null
} catch (e) { wrongCaller = revertReason(e) }
check(wrongCaller === REVERTS.wrongCaller,
  'a third party holding the signature cannot cash it', wrongCaller, true)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m4. The payer\'s cancellation signature is accepted by the contract\x1b[0m')

const cancellation = await signCancellation(payer, net, pending.authorization.nonce)
const cancelSim = await simulateCancel(net, bystander.address, cancellation, client)
check(cancelSim.ok,
  'cancelAuthorization succeeds, broadcast by a wallet that is NOT the payer',
  cancelSim.ok ? 'relayable — payer gaslessness depends on an available funded relayer' : cancelSim.reason, true)

// A cancellation signed by someone else must not work.
const forged = await signCancellation(bystander, net, pending.authorization.nonce)
const forgedSim = await simulateCancel(net, bystander.address,
  { message: { authorizer: payer.address, nonce: pending.authorization.nonce }, v: forged.v, r: forged.r, s: forged.s }, client)
check(!forgedSim.ok, 'a forged cancellation is rejected', forgedSim.reason, true)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m5. A spent or cancelled nonce is dead forever\x1b[0m')

check((await authorizationState(net, payer.address, pending.authorization.nonce, client)) === false,
  'a fresh nonce reads unused')

// Rather than spend gas to create a dead nonce, borrow one the chain already has:
// find a real AuthorizationUsed event and try to settle against it. The contract
// checks nonce reuse BEFORE it checks the signature, so this proves the exact
// revert string the merchant console will show after a cancellation.
const head = await client.getBlockNumber()
let used = null
for (const span of [2000n, 20000n, 100000n]) {
  const logs = await client.getLogs({
    address: net.token,
    event: parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'),
    fromBlock: head - span, toBlock: head,
  }).catch(() => [])
  if (logs.length) { used = logs[logs.length - 1]; break }
}

// A spent nonce is spent forever, so an old one proves the point as well as a
// fresh one — fall back to a settlement this rail actually performed
// (tx 0x2addd508…, block 92858267) so the suite runs the same 13 checks on any
// day, however quiet the recent log window happens to be.
if (!used) {
  used = {
    blockNumber: 92858267n,
    args: {
      authorizer: '0x855A4b2085B16065204c379439773a4F9Ef7F424',
      nonce: '0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde',
    },
  }
}

{
  const { authorizer, nonce } = used.args
  check((await authorizationState(net, authorizer, nonce, client)) === true,
    'a nonce from a real AuthorizationUsed event reads spent', `block ${used.blockNumber}`, true)

  const replay = await signDeferredPayment(payer, net, {
    to: merchant.address, amountSgd: 4.5, windowSeconds: -600,
  })
  replay.authorization.from = authorizer
  replay.authorization.nonce = nonce
  const dead = await simulateSettle(net, replay, client)
  check(dead.reason === REVERTS.spent,
    'settling a burned nonce reverts — this is what CANCEL leaves behind', dead.reason, true)
  check(dead.state === 'void', 'classified as void for the UI')
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m6. The nonce commits to the order' + D(' (local properties of the commitment, not chain state)') + '\x1b[0m')

const salt = pending.orderSalt
const sameOrder = orderNonce(order, salt).nonce
const reordered = orderNonce({ buyer_agent: 'demo-agent-v1', total_sgd: '4.50', qty: 1, sku: 'AGENTIX-DEMO-001' }, salt).nonce
const tampered = orderNonce({ ...order, total_sgd: '45.00' }, salt).nonce
const unsalted = orderNonce(order, 'different-salt').nonce
check(sameOrder === pending.authorization.nonce, 'the signed nonce re-derives from order + salt', sameOrder.slice(0, 18) + '…')
check(sameOrder === reordered, 'key order does not change the commitment')
check(tampered !== sameOrder, 'changing one cent changes the nonce', tampered.slice(0, 18) + '…')
check(unsalted !== sameOrder, 'the salt is load-bearing — without it the digest is brute-forceable')

// Regression: the old canonicaliser passed an array replacer to JSON.stringify,
// which applies at every depth, so nested fields vanished and two different
// orders committed to the same nonce.
const nestedA = orderNonce({ sku: 'x', meta: { secret: 'A', price: 1 } }, salt).nonce
const nestedB = orderNonce({ sku: 'x', meta: { secret: 'B', price: 999 } }, salt).nonce
check(nestedA !== nestedB, 'nested fields are part of the commitment')

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? G('■ all ' + pass + ' checks passed') : R('■ ' + fail + ' of ' + (pass + fail) + ' checks FAILED')}`)
console.log(D(`  ${onchain} of them were decided by live ${net.label} contract state via eth_call;`))
console.log(D(`  the rest are local properties of this library. No contract deployed, no gas spent.\n`))
process.exit(fail === 0 ? 0 : 1)

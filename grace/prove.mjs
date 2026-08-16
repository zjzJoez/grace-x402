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
let pass = 0, fail = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? G('PASS') : R('FAIL')}  ${label}${detail ? D('  — ' + detail) : ''}`)
  ok ? pass++ : fail++
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
  'merchant settling inside the window reverts', early.reason)
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
  'time gate opens; only the (empty) balance objects', late.reason)

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
  'a third party holding the signature cannot cash it', wrongCaller)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m4. The payer\'s cancellation signature is accepted by the contract\x1b[0m')

const cancellation = await signCancellation(payer, net, pending.authorization.nonce)
const cancelSim = await simulateCancel(net, bystander.address, cancellation, client)
check(cancelSim.ok,
  'cancelAuthorization succeeds, broadcast by a wallet that is NOT the payer',
  cancelSim.ok ? 'gasless for the payer — any relayer can submit it' : cancelSim.reason)

// A cancellation signed by someone else must not work.
const forged = await signCancellation(bystander, net, pending.authorization.nonce)
const forgedSim = await simulateCancel(net, bystander.address,
  { message: { authorizer: payer.address, nonce: pending.authorization.nonce }, v: forged.v, r: forged.r, s: forged.s }, client)
check(!forgedSim.ok, 'a forged cancellation is rejected', forgedSim.reason)

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
    'a nonce from a real AuthorizationUsed event reads spent', `block ${used.blockNumber}`)

  const replay = await signDeferredPayment(payer, net, {
    to: merchant.address, amountSgd: 4.5, windowSeconds: -600,
  })
  replay.authorization.from = authorizer
  replay.authorization.nonce = nonce
  const dead = await simulateSettle(net, replay, client)
  check(dead.reason === REVERTS.spent,
    'settling a burned nonce reverts — this is what CANCEL leaves behind', dead.reason)
  check(dead.state === 'void', 'classified as void for the UI')
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m6. The nonce carries the order — settlement is self-describing\x1b[0m')

const sameOrder = orderNonce(order)
const reordered = orderNonce({ buyer_agent: 'demo-agent-v1', total_sgd: '4.50', qty: 1, sku: 'AGENTIX-DEMO-001' })
const tampered = orderNonce({ ...order, total_sgd: '45.00' })
check(sameOrder === pending.authorization.nonce, 'nonce == keccak256(canonical order)', sameOrder.slice(0, 18) + '…')
check(sameOrder === reordered, 'key order does not change the commitment')
check(tampered !== sameOrder, 'changing one cent changes the nonce', tampered.slice(0, 18) + '…')

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? G('■ all ' + pass + ' checks passed') : R('■ ' + fail + ' of ' + (pass + fail) + ' checks FAILED')}`)
console.log(D(`  every assertion above ran against live ${net.label} state — no contract deployed, no gas spent\n`))
process.exit(fail === 0 ? 0 : 1)

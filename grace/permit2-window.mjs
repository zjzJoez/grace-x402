/**
 * Does x402's own deployed contract already enforce a future-dated validAfter?
 *
 *   node grace/permit2-window.mjs
 *
 * Yes, and this proves it in four eth_calls with no key, no funds, no gas, no
 * token approval and no counterparty. That is the point of this file: the
 * cheapest reproducible claim in the whole proposal.
 *
 * x402ExactPermit2Proxy is deployed on Base at
 * 0x402085c248EeA27D92E8b30b2C58ed07f9E20001. Both its settlement entry points
 * commit a `Witness(address to, uint256 validAfter)` into the payer's Permit2
 * signature and refuse to settle before `validAfter`. For each entry point we
 * send the same call twice, differing only in that one field, with a
 * deliberately junk signature:
 *
 *   validAfter in the future -> PaymentTooEarly()   0xa65539fa
 *   validAfter in the past   -> InvalidSignature() 0x8baa579f   (Permit2's)
 *
 * The second call is the control, and it carries the finding: the junk
 * signature is only reached when the window is open, so the window check runs
 * BEFORE signature verification. A garbage payload is enough to observe the
 * refusal, which is why this needs nothing from the operator.
 *
 * Two lessons that cost us something to learn, recorded so they are not
 * re-learned:
 *
 *   1. The spec annex (specs/schemes/exact/scheme_exact_evm.md:443) shows
 *      `require(block.timestamp >= witness.validAfter, "Too early")`. The
 *      deployed contract reverts with the custom error `PaymentTooEarly()`
 *      instead, and the string "Too early" appears nowhere in its runtime
 *      code. Same rule, different encoding: match the 4-byte selector, never
 *      a reason string.
 *
 *   2. Never answer a question like this by grepping runtime bytecode for a
 *      4-byte selector. That fails its own control here: `a65539fa` is absent
 *      from the 2,913 bytes as a substring, yet the contract provably reverts
 *      with it — selectors are never stored as four contiguous bytes at rest.
 *      Substring scanning DOES discriminate 32-byte event topics, which are
 *      PUSH32 immediates, and there it agrees with a full log census. The rule
 *      is not "scanning is useless", it is "scanning answers one question and
 *      not the other". Simulate for behaviour; query logs for events.
 */

import { createPublicClient, http, encodeFunctionData, keccak256, toHex } from 'viem'
import { base } from 'viem/chains'

const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const Y = (s) => `\x1b[33m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`

const PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RPCS = ['https://mainnet.base.org', 'https://base.llamarpc.com', 'https://1rpc.io/base']

const PERMIT_T = {
  name: 'permit', type: 'tuple', components: [
    { name: 'permitted', type: 'tuple', components: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }] },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
const WITNESS_T = { name: 'witness', type: 'tuple', components: [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }] }
const P2612_T = {
  name: 'permit2612', type: 'tuple', components: [
    { name: 'value', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' }, { name: 'v', type: 'uint8' },
  ],
}

/**
 * Both settlement entry points, not just one. `settleWithPermit` runs
 * `_executePermit` before `_settle`, so the guard is not first on that path —
 * the observed refusal is identical, but the ordering claim above is specific
 * to `settle`.
 */
const SETTLE_ABI = [
  { name: 'settle', type: 'function', stateMutability: 'nonpayable', outputs: [], inputs: [PERMIT_T, { name: 'owner', type: 'address' }, WITNESS_T, { name: 'signature', type: 'bytes' }] },
  { name: 'settleWithPermit', type: 'function', stateMutability: 'nonpayable', outputs: [], inputs: [P2612_T, PERMIT_T, { name: 'owner', type: 'address' }, WITNESS_T, { name: 'signature', type: 'bytes' }] },
]

/** The two selectors this probe distinguishes, derived rather than pasted. */
const SEL = {
  tooEarly: keccak256(toHex('PaymentTooEarly()')).slice(0, 10),
  badSig: keccak256(toHex('InvalidSignature()')).slice(0, 10),
}

/** A dropped request is not a contract verdict — the distinction prove.mjs makes. */
const isTransport = (err) => {
  const hay = [err?.shortMessage, err?.details, err?.message].filter(Boolean).join('\n')
  return /HTTP request failed|RPC Request failed|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed out|socket hang up|rate limit|429|503/i.test(hay)
}

/** Pull the raw 4-byte revert data out of whatever shape viem wrapped it in. */
const revertSelector = (err) => {
  const raw = err?.cause?.data ?? err?.data ?? err?.cause?.cause?.data
  return typeof raw === 'string' && raw.startsWith('0x') ? raw.slice(0, 10) : null
}

async function client() {
  for (const url of RPCS) {
    try {
      const c = createPublicClient({ chain: base, transport: http(url) })
      const code = await c.getCode({ address: PROXY })
      if (code && code.length > 10) return { c, url, bytes: (code.length - 2) / 2 }
    } catch { /* try the next endpoint */ }
  }
  return null
}

async function probe(c, validAfter, fn = 'settle') {
  const now = Math.floor(Date.now() / 1000)
  const permit = { permitted: { token: USDC, amount: 1000n }, nonce: 1n, deadline: BigInt(now + 3600) }
  const owner = '0x0000000000000000000000000000000000000001'
  const witness = { to: '0x0000000000000000000000000000000000000002', validAfter: BigInt(validAfter) }
  // deliberately junk: 65 bytes of 0x11 give v = 17, so ecrecover yields the
  // zero address and Permit2 takes its InvalidSignature() branch.
  const sig = `0x${'11'.repeat(65)}`
  const args = fn === 'settle'
    ? [permit, owner, witness, sig]
    : [{ value: 1000n, deadline: BigInt(now + 3600), r: `0x${'22'.repeat(32)}`, s: `0x${'33'.repeat(32)}`, v: 27 }, permit, owner, witness, sig]
  const data = encodeFunctionData({ abi: SETTLE_ABI, functionName: fn, args })
  try {
    await c.call({ to: PROXY, data })
    return { settled: true }
  } catch (err) {
    if (isTransport(err)) return { transport: true, err }
    return { selector: revertSelector(err), err }
  }
}

const conn = await client()
if (!conn) {
  console.log(R('\n✗ No Base RPC answered. That is a transport failure, not a finding.\n'))
  process.exit(1)
}

console.log(`\n\x1b[1mDoes the deployed x402 permit2 proxy hold a future validAfter?\x1b[0m`)
console.log(D(`  ${PROXY} on Base · ${conn.bytes} bytes of runtime code`))
console.log(D(`  via ${conn.url} · two eth_calls · no key, no funds, no gas, junk signature\n`))

const now = Math.floor(Date.now() / 1000)
const runs = []
for (const fn of ['settle', 'settleWithPermit']) {
  runs.push({ fn, future: await probe(conn.c, now + 3600, fn), past: await probe(conn.c, now - 3600, fn) })
}

if (runs.some((r) => r.future.transport || r.past.transport)) {
  console.log(Y('~ RPC dropped a request — no verdict, not a finding. Re-run.\n'))
  process.exit(1)
}

for (const r of runs) {
  const held = r.future.selector === SEL.tooEarly
  const sig = r.past.selector === SEL.badSig
  console.log(`  ${r.fn}`)
  console.log(`    ${held ? G('✓') : R('✗')} validAfter +3600s  reverts ${r.future.selector ?? '(none)'}  ${D(held ? 'PaymentTooEarly() — the window held' : `expected ${SEL.tooEarly}`)}`)
  console.log(`    ${sig ? G('✓') : R('✗')} validAfter -3600s  reverts ${r.past.selector ?? '(none)'}  ${D(sig ? 'InvalidSignature() — control: execution got past the window' : `expected ${SEL.badSig}`)}`)
}

const heldWindow = runs.every((r) => r.future.selector === SEL.tooEarly)
const reachedSig = runs.every((r) => r.past.selector === SEL.badSig)

if (heldWindow && reachedSig) {
  console.log(G(`\n■ Both entry points hold. Within each pair the only difference is one timestamp.`))
  console.log(`  The junk signature is reached only when the window is open, so the window`)
  console.log(`  check runs ${G('before')} signature verification — which is why this reproduces`)
  console.log(`  with no key, no funds and no counterparty.\n`)
  console.log(D(`  The contract is x402's own, already deployed. Nothing here is a new contract,`))
  console.log(D(`  a new opcode, or a proposal — only a field the SDKs currently refuse to set.\n`))
} else if (heldWindow && !reachedSig) {
  console.log(Y(`\n~ The window held, but the control did not land on InvalidSignature().`))
  console.log(Y(`  Partial verdict: report the window finding, not the ordering claim.\n`))
} else {
  console.log(R(`\n■ Not reproduced as described. Report that, not the claim.\n`))
  process.exit(1)
}

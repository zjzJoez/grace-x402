/**
 * Every log x402ExactPermit2Proxy has ever emitted, counted.
 *
 *   node grace/permit2-log-census.mjs
 *
 * This exists because a claim built on it is now public, and the claim is
 * load-bearing for the `settled` row of the capability table: *no log on the
 * exact/permit2 binding binds a settlement to an authorization*. If that is
 * true, a reader resolving settlements from logs alone cannot attribute one
 * here, and absence of a settlement log is NOT evidence of non-settlement.
 *
 * The first version of this measurement was mine and it was wrong. I swept the
 * last 5,000 Base blocks, got nothing, and was about to publish "this proxy
 * emits no logs". 5,000 blocks is 2h46m against a contract deployed on
 * 2026-03-11, and I had happened to land in a quiet stretch. Quiet-for-three-
 * hours reported as never-happened is the exact failure this whole thread is
 * about. So: full deployed life, or no claim.
 *
 * Method, and the parts that make it falsifiable:
 *
 *   - Binary-search `eth_getCode` for the deployment block, rather than
 *     assuming one.
 *   - Sweep `eth_getLogs` from there to a head captured once at the start, in
 *     10k-block chunks, so the range cannot drift under us mid-run.
 *   - A chunk that fails is retried against other endpoints and then backed
 *     off. If ANY chunk is still unresolved at the end, the run reports no
 *     total at all — a census with a hole in it is not a census, and a
 *     transport failure is not a finding.
 *   - Negative control: the neighbouring vanity address, which has no code,
 *     must return zero over the first 200,000 blocks after deployment — the
 *     densest stretch of the sweep, not the whole range. If the control ever returns rows,
 *     the query is not doing what it claims and the run is void.
 */

import { createPublicClient, http, keccak256, toHex } from 'viem'
import { base } from 'viem/chains'

const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const Y = (s) => `\x1b[33m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`

const PROXY = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001'
const CONTROL = '0x402085c248EeA27D92E8b30b2C58ed07f9E20002' // same vanity prefix, no code
const CHUNK = 10_000n

const RPCS = [
  'https://base.llamarpc.com',
  'https://mainnet.base.org',
  'https://base-rpc.publicnode.com',
  'https://1rpc.io/base',
  'https://base.drpc.org',
  'https://base.gateway.tenderly.co',
  'https://base-mainnet.public.blastapi.io',
]

/**
 * Smallest span worth asking for before calling a range genuinely unreachable.
 * The first run of this script gave up on seven consecutive 10k ranges and
 * correctly refused to report a total. Re-asking the same 70k stretch in 1k
 * chunks returned all of it on the first attempt, so the failure was chunk
 * size, not availability — some endpoints cap the result window rather than
 * saying so. Subdivide before concluding anything.
 */
const FLOOR = 250n

const TOPICS = {
  [keccak256(toHex('Settled()'))]: 'Settled()',
  [keccak256(toHex('SettledWithPermit()'))]: 'SettledWithPermit()',
  [keccak256(toHex('x402PermitTransfer(address,address,uint256,address)'))]: 'x402PermitTransfer(…)',
}

const clients = RPCS.map((url) => ({ url, c: createPublicClient({ chain: base, transport: http(url, { retryCount: 0 }) }) }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Try every endpoint, then back off, then try again. Returns null only after exhausting all of it. */
async function resilient(fn, label, rounds = 6) {
  let lastErr
  for (let round = 0; round < rounds; round++) {
    for (const { url, c } of clients) {
      try { return await fn(c) } catch (err) { lastErr = err }
    }
    await sleep(700 * 2 ** round)
  }
  process.stderr.write(D(`\n  (gave up on ${label}: ${String(lastErr?.shortMessage ?? lastErr).slice(0, 70)})\n`))
  return null
}

console.log(`\n\x1b[1mEvery log x402ExactPermit2Proxy has ever emitted\x1b[0m`)
console.log(D(`  ${PROXY} on Base · read-only, keyless\n`))

const head = await resilient((c) => c.getBlockNumber(), 'head')
if (head === null) { console.log(R('✗ could not reach any Base endpoint. Transport, not a finding.\n')); process.exit(1) }

// ── deployment block, by binary search rather than assumption ────────────────
const hasCode = async (b) => {
  const code = await resilient((c) => c.getCode({ address: PROXY, blockNumber: b }), `getCode@${b}`)
  return code === null ? null : (code?.length ?? 0) > 2
}
let lo = 0n, hi = head, calls = 0
if ((await hasCode(lo)) !== false) { console.log(R('✗ control failed: code present at genesis.')); process.exit(1) }
while (lo + 1n < hi) {
  const mid = (lo + hi) / 2n
  const present = await hasCode(mid); calls++
  if (present === null) { console.log(R('✗ deployment search hit an unresolvable endpoint. No claim.')); process.exit(1) }
  if (present) hi = mid; else lo = mid
}
const deployedAt = hi
console.log(`${G('✓')} deployment block ${deployedAt}  ${D(`(binary search, ${calls} eth_getCode calls; empty at ${lo})`)}`)

// ── the sweep ────────────────────────────────────────────────────────────────
let holes = 0
const seenTx = new Set()
const byTopic = new Map()
let total = 0, oddShape = 0, firstBlock = null, lastBlock = null
const ranges = []
for (let from = deployedAt; from <= head; from += CHUNK) ranges.push([from, from + CHUNK - 1n > head ? head : from + CHUNK - 1n])

process.stdout.write(D(`  sweeping ${ranges.length} ranges of ${CHUNK} blocks, ${deployedAt} → ${head}\n`))
let done = 0
/** Ask for a span; on failure halve it and ask again, down to FLOOR. */
async function logsIn(from, to) {
  const got = await resilient((c) => c.getLogs({ address: PROXY, fromBlock: from, toBlock: to }), `${from}-${to}`, 3)
  if (got !== null) return got
  if (to - from + 1n <= FLOOR) return null
  const mid = from + (to - from) / 2n
  const [a, b] = [await logsIn(from, mid), await logsIn(mid + 1n, to)]
  return a === null || b === null ? null : [...a, ...b]
}

/**
 * Ranges that did not resolve on the first pass. They are retried at the end
 * rather than written off: on the run that found this, one range failed every
 * endpoint at every subdivision, and the identical query returned in full
 * (with zero logs) a minute later. All endpoints were briefly unhealthy at
 * once. Concluding "unreachable" from a moment of simultaneous pressure is the
 * same error as concluding "no settlements" from a quiet three hours.
 */
const deferred = []

async function absorb(from, to) {
  const logs = await logsIn(from, to)
  if (logs === null) return false
  for (const l of logs) {
    total++
    seenTx.add(l.transactionHash)
    const name = TOPICS[l.topics[0]] ?? l.topics[0]
    byTopic.set(name, (byTopic.get(name) ?? 0) + 1)
    if (l.topics.length !== 1 || l.data !== '0x') oddShape++
    // min/max rather than first/last seen: deferred ranges are absorbed out of
    // order on the retry passes, so arrival order is not block order.
    if (firstBlock === null || l.blockNumber < firstBlock) firstBlock = l.blockNumber
    if (lastBlock === null || l.blockNumber > lastBlock) lastBlock = l.blockNumber
  }
  return true
}

for (const [from, to] of ranges) {
  if (!(await absorb(from, to))) deferred.push([from, to])
  if (++done % 50 === 0 || done === ranges.length) {
    process.stdout.write(D(`\r  ${done}/${ranges.length} ranges · ${total} logs · ${deferred.length} deferred`))
  }
}
process.stdout.write('\n')

// Second and third passes over whatever did not resolve, with a pause between,
// because the failures observed here were simultaneous endpoint pressure and
// cleared on their own within a minute.
for (let pass = 1; deferred.length && pass <= 3; pass++) {
  const retry = deferred.splice(0, deferred.length)
  console.log(D(`  retry pass ${pass}: ${retry.length} range(s)`))
  await sleep(5000 * pass)
  for (const [from, to] of retry) if (!(await absorb(from, to))) deferred.push([from, to])
}
holes = deferred.length

// ── negative control over the same range ─────────────────────────────────────
const ctl = await resilient((c) => c.getLogs({ address: CONTROL, fromBlock: deployedAt, toBlock: deployedAt + 200_000n }), 'control')

console.log()
if (holes > 0) {
  console.log(R(`■ ${holes} of ${ranges.length} ranges never resolved. No total is reported —`))
  console.log(R(`  a census with a hole in it is not a census.\n`))
  process.exit(1)
}
if (ctl === null) { console.log(Y('~ negative control unresolved — the run proves nothing without it.\n')); process.exit(1) }
if (ctl.length !== 0) { console.log(R(`■ negative control returned ${ctl.length} rows. The query is void.\n`)); process.exit(1) }
console.log(`${G('✓')} negative control: ${CONTROL} (no code) returns 0 logs over the first 200k blocks after deployment`)

console.log(`\n${G(`■ ${total} logs in ${seenTx.size} distinct transactions`)}, blocks ${firstBlock} → ${lastBlock}`)
for (const [name, n] of [...byTopic].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${name}`)
console.log(`\n  ${oddShape === 0 ? G('every log carries exactly one topic and empty data') : R(`${oddShape} logs carry parameters`)}`)
if (oddShape === 0) {
  console.log(D(`  — so no log on this binding binds a settlement to an authorization.`))
  console.log(D(`    Attribution lives only in the settle() calldata. A reader resolving`))
  console.log(D(`    settlements from logs cannot attribute one here, and absence of a`))
  console.log(D(`    settlement log is NOT evidence of non-settlement.\n`))
}

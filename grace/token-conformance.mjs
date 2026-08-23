/**
 * Which deployed tokens actually carry the cooling-off primitives?
 *
 *   node grace/token-conformance.mjs
 *
 * The binding says an implementation MUST probe the deployed contract rather
 * than trust a token's name. This is that probe, and it exists because the rule
 * has teeth: USDT0 enforces the window and answers cancellations exactly like
 * USDC, but says `TetherToken: auth early` where Circle says `FiatTokenV2:
 * authorization is not yet valid` — so anything hardcoded to Circle's wording
 * misreads a held window as an unknown error. Meanwhile classic USDT, the
 * largest stablecoin there is, has no EIP-3009 at all and needs the Permit2
 * binding instead.
 *
 * Two checks per token, both eth_call against mainnet from a throwaway key:
 *
 *   1. an authorization dated 120s in the future cannot be settled now
 *   2. the payer's cancellation is accepted when broadcast by a stranger
 *
 * No funds, no gas, nothing written. Selector-scanning the bytecode does NOT
 * work here — these are proxies, and the implementation is behind a
 * delegatecall, which reports even USDC as unsupported.
 */

import { createPublicClient, http } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { avalanche, base, mainnet } from 'viem/chains'
import { ABI, TYPES } from './lib/xsgd.mjs'

const G = (s) => `\x1b[32m${s}\x1b[0m`
const R = (s) => `\x1b[31m${s}\x1b[0m`
const Y = (s) => `\x1b[33m${s}\x1b[0m`
const D = (s) => `\x1b[2m${s}\x1b[0m`

const TOKENS = [
  { label: 'USDC',   net: 'Base',      chain: base,      rpc: 'https://base-rpc.publicnode.com',              addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  { label: 'USDC',   net: 'Avalanche', chain: avalanche, rpc: 'https://api.avax.network/ext/bc/C/rpc', addr: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
  { label: 'EURC',   net: 'Base',      chain: base,      rpc: 'https://base-rpc.publicnode.com',              addr: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' },
  // XSGD's proxy exposes no version(); its EIP-712 domain version is "2".
  { label: 'XSGD',   net: 'Avalanche', chain: avalanche, rpc: 'https://api.avax.network/ext/bc/C/rpc', addr: '0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E', version: '2' },
  { label: 'USD₮0',  net: 'Base',      chain: base,      rpc: 'https://base-rpc.publicnode.com',              addr: '0x102d758f688a4C1C5a80b116bD945d4455460282' },
  { label: 'USDT',   net: 'Ethereum',  chain: mainnet,   rpc: 'https://ethereum-rpc.publicnode.com',   addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { label: 'USDT',   net: 'Avalanche', chain: avalanche, rpc: 'https://api.avax.network/ext/bc/C/rpc', addr: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' },
  { label: 'USDT.e', net: 'Avalanche', chain: avalanche, rpc: 'https://api.avax.network/ext/bc/C/rpc', addr: '0xc7198437980c041c805A1EDcbA50c1Ce5db95118' },
]

const payer = privateKeyToAccount(generatePrivateKey())
const merchant = privateKeyToAccount(generatePrivateKey())
const bystander = privateKeyToAccount(generatePrivateKey())

const reasonOf = (err) => {
  const hay = [err?.shortMessage, err?.details, err?.metaMessages?.join(' '), err?.message].filter(Boolean).join('\n')
  const m = hay.match(/reverted with the following reason:\s*\n?(.+)/)
  return (m ? m[1] : hay).trim().split('\n')[0].slice(0, 60)
}
const readStr = (client, addr, fn) => client.readContract({
  address: addr, abi: [{ name: fn, type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }],
  functionName: fn,
}).catch(() => null)

/** A dropped request is not a contract verdict — the same distinction prove.mjs makes. */
const isTransport = (err) => {
  const hay = [err?.shortMessage, err?.details, err?.message].filter(Boolean).join('\n')
  return /HTTP request failed|RPC Request failed|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed out|socket hang up|rate limit|429|503|Internal error|could not be found/i.test(hay)
}
/** Retry only transport failures, never a revert: a revert is an answer. */
async function settled(fn, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return { ok: true, value: await fn() } }
    catch (err) {
      if (!isTransport(err) || i === tries - 1) return { ok: false, err, transport: isTransport(err) }
      await new Promise((r) => setTimeout(r, 900 * (i + 1)))
    }
  }
}

console.log(`\n\x1b[1mCooling-off primitives, as the deployed contracts answer them\x1b[0m`)
console.log(D(`  eth_call only · throwaway key · no funds, no gas, nothing written\n`))

const rows = []
for (const t of TOKENS) {
  const client = createPublicClient({ chain: t.chain, transport: http(t.rpc) })
  // Support is decided by the functional probes below, not by one accessor
  // call: XSGD's proxy has no version() at all, and treating a dropped request
  // as a missing standard flipped USD₮0's verdict between runs. A transport
  // failure gets retried; a revert is an answer either way.
  const state = await settled(() => client.readContract({
    address: t.addr, abi: ABI, functionName: 'authorizationState',
    args: ['0x0000000000000000000000000000000000000001', `0x${'00'.repeat(32)}`],
  }))
  if (!state.ok && state.transport) {
    rows.push({ ...t, unreachable: true })
    console.log(`${Y('?')} ${`${t.label} · ${t.net}`.padEnd(22)} ${D('RPC unreachable — no verdict, not a finding')}`)
    continue
  }
  if (!state.ok) {
    rows.push({ ...t, eip3009: false })
    console.log(`${R('✗')} ${`${t.label} · ${t.net}`.padEnd(22)} ${D('no EIP-3009 — needs the Permit2 binding')}`)
    continue
  }

  const name = (await readStr(client, t.addr, 'name')) ?? t.label
  const version = t.version ?? (await readStr(client, t.addr, 'version')) ?? '1'

  const now = Math.floor(Date.now() / 1000)
  const auth = {
    from: payer.address, to: merchant.address, value: 1000n,
    validAfter: BigInt(now + 120), validBefore: BigInt(now + 3720),
    nonce: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`,
  }
  const domain = { name, version, chainId: t.chain.id, verifyingContract: t.addr }
  const sig = await payer.signTypedData({ domain, types: TYPES.receive, primaryType: 'ReceiveWithAuthorization', message: auth })
  const split = [parseInt(sig.slice(130, 132), 16), `0x${sig.slice(2, 66)}`, `0x${sig.slice(66, 130)}`]

  const w = await settled(() => client.simulateContract({
    address: t.addr, abi: ABI, functionName: 'receiveWithAuthorization',
    args: [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, ...split],
    account: auth.to,
  }))
  const windowSays = w.ok ? 'SETTLED EARLY — window not enforced' : reasonOf(w.err)
  const windowHeld = !w.ok && !w.transport && /not yet valid|auth early|too early/i.test(windowSays)

  const cs = await payer.signTypedData({ domain, types: TYPES.cancel, primaryType: 'CancelAuthorization', message: { authorizer: payer.address, nonce: auth.nonce } })
  const csSplit = [parseInt(cs.slice(130, 132), 16), `0x${cs.slice(2, 66)}`, `0x${cs.slice(66, 130)}`]
  const cx = await settled(() => client.simulateContract({
    address: t.addr, abi: ABI, functionName: 'cancelAuthorization',
    args: [payer.address, auth.nonce, ...csSplit], account: bystander.address,
  }))
  const relayCancel = cx.ok
  const cancelSays = cx.ok ? 'accepted from a stranger' : reasonOf(cx.err)

  const ok = windowHeld && relayCancel
  rows.push({ ...t, eip3009: true, ok, windowSays })
  console.log(`${ok ? G('✓') : Y('~')} ${`${t.label} · ${t.net}`.padEnd(22)} window: ${windowSays.padEnd(46)} cancel: ${cancelSays}`)
}

const yes = rows.filter((r) => r.ok)
const no = rows.filter((r) => !r.eip3009 && !r.unreachable)
const skipped = rows.filter((r) => r.unreachable)
const strings = [...new Set(yes.map((r) => r.windowSays))]

console.log(`\n${G(`■ ${yes.length} of ${rows.length - skipped.length} answering tokens carry both primitives`)} — the window is a property of EIP-3009, not of any one issuer.`)
if (skipped.length) console.log(Y(`  ${skipped.length} could not be reached this run and are reported as no verdict.`))
if (no.length) {
  console.log(D(`  ${no.length} without EIP-3009 (${[...new Set(no.map((r) => r.label))].join(', ')}) reach the same flow through the Permit2 binding,`))
  console.log(D(`  which needs no token support at all.`))
}
if (strings.length > 1) {
  console.log(Y(`\n  Note the revert strings differ across conforming tokens:`))
  for (const s of strings) console.log(Y(`    "${s}"  — ${yes.filter((r) => r.windowSays === s).map((r) => r.label).join(', ')}`))
  console.log(Y(`  An implementation matching one issuer's wording misreads the others as an`))
  console.log(Y(`  unknown failure. This is why the binding says probe the contract, not the name.\n`))
}

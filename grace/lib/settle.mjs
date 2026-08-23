/**
 * GRACE — on-chain execution: settle, cancel, and read authorization state.
 *
 * The two write paths are deliberately asymmetric, and that asymmetry IS the product:
 *
 *   settle()  -> receiveWithAuthorization, which reverts unless msg.sender == to.
 *                Only the merchant can cash the claim.
 *   cancel()  -> cancelAuthorization, a meta-transaction signed by the payer.
 *                Only the payer can void it, but ANYONE can pay the gas to do so.
 *
 * Neither party can do the other's job, and no third party can do either.
 * There is no contract to deploy and no custodian to trust.
 */

import { createPublicClient, createWalletClient, http } from 'viem'
import { ABI, REVERTS, isWindowHeld } from './xsgd.mjs'
import { argsFor } from './authorization.mjs'

export function publicClientFor(net) {
  return createPublicClient({ chain: net.chain, transport: http() })
}

export function walletClientFor(net, account) {
  return createWalletClient({ account, chain: net.chain, transport: http() })
}

/** true once the nonce has been spent OR cancelled — FiatTokenV2_2 conflates the two. */
export async function authorizationState(net, authorizer, nonce, client = publicClientFor(net)) {
  return client.readContract({
    address: net.token, abi: ABI, functionName: 'authorizationState', args: [authorizer, nonce],
  })
}

export async function balanceOf(net, address, client = publicClientFor(net)) {
  return client.readContract({ address: net.token, abi: ABI, functionName: 'balanceOf', args: [address] })
}

/** Pull the bare revert reason out of viem's (very verbose) error object. */
/**
 * Did the contract answer, or did we never reach it? A DNS failure and a
 * signature rejection both throw, and treating them alike lets a network
 * outage impersonate a security property — a forged-cancellation check that
 * "passes" because the RPC was down has proven nothing.
 */
export function isContractVerdict(err) {
  const hay = [err?.shortMessage, err?.details, err?.metaMessages?.join(' '), err?.message]
    .filter(Boolean).join('\n')
  if (Object.values(REVERTS).some((r) => hay.includes(r))) return true
  if (/reverted|execution reverted|revert reason/i.test(hay)) return true
  // viem's transport-layer errors: nothing on chain was consulted.
  if (/HTTP request failed|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed out|socket hang up|network|rate limit/i.test(hay)) return false
  return false // unknown shape: refuse to call it a verdict
}

export function revertReason(err) {
  const hay = [err?.shortMessage, err?.details, err?.metaMessages?.join(' '), err?.message]
    .filter(Boolean).join('\n')
  for (const reason of Object.values(REVERTS)) if (hay.includes(reason)) return reason
  const m = hay.match(/reverted with the following reason:\s*\n?(.+)/)
  return m ? m[1].trim() : (err?.shortMessage ?? err?.message ?? 'unknown revert').slice(0, 200)
}

/**
 * Map a revert into the state the UI should show. The merchant console leans on
 * this: hitting SETTLE early or after a cancel is not an error to be swallowed,
 * it is the demo.
 */
export function classify(reason) {
  // Issuer-agnostic: USD₮0 says "TetherToken: auth early" for the same condition.
  if (isWindowHeld(reason)) {
    return { state: 'cooling-off', headline: 'Cannot settle yet', detail: 'The cooling-off window has not closed. The chain is enforcing this, not the merchant.' }
  }
  if (reason === REVERTS.spent) {
    // "authorization is used or canceled" is exactly that: the contract does not
    // say which. A settled payment and a cancelled one leave the same revert and
    // the same authorizationState, so claiming "the payer cancelled" here would
    // report a completed sale as a refusal. Only the events can tell them apart.
    return {
      state: 'nonce_unavailable',
      headline: 'Nonce consumed',
      detail: 'Settled or cancelled — the revert cannot distinguish them. Read AuthorizationUsed / AuthorizationCanceled to attribute it.',
    }
  }
  if (reason === REVERTS.expired) {
    return { state: 'expired', headline: 'Authorization expired', detail: 'The merchant did not settle before validBefore. The claim lapsed on its own.' }
  }
  if (reason === REVERTS.wrongCaller) {
    return { state: 'wrong-caller', headline: 'Not the payee', detail: 'receiveWithAuthorization requires msg.sender == to. Only the merchant can settle.' }
  }
  if (reason === REVERTS.noFunds) {
    return { state: 'insufficient', headline: 'Payer has insufficient balance', detail: 'The authorization is valid but the wallet cannot cover it.' }
  }
  return { state: 'error', headline: 'Reverted', detail: reason }
}

/**
 * Dry-run a settlement without spending gas. The merchant console calls this on
 * a timer so the SETTLE button can show, live, exactly why the chain would say no.
 */
export async function simulateSettle(net, { authorization, v, r, s }, client = publicClientFor(net)) {
  try {
    await client.simulateContract({
      address: net.token, abi: ABI, functionName: 'receiveWithAuthorization',
      args: argsFor(authorization, { v, r, s }),
      account: authorization.to,
    })
    return { ok: true, reason: null, reached: true, ...classify(null), state: 'settleable', headline: 'Ready to settle' }
  } catch (err) {
    const reason = revertReason(err)
    const reached = isContractVerdict(err)
    return { ok: false, reason, reached, ...(reached ? classify(reason) : { state: 'unreachable', headline: 'Chain not reached', detail: reason }) }
  }
}

/** For real. Merchant pays the gas; merchant must be the `to` address. */
export async function settle(net, merchantAccount, { authorization, v, r, s }) {
  const wallet = walletClientFor(net, merchantAccount)
  const client = publicClientFor(net)
  const { request } = await client.simulateContract({
    address: net.token, abi: ABI, functionName: 'receiveWithAuthorization',
    args: argsFor(authorization, { v, r, s }),
    account: merchantAccount,
  })
  const hash = await wallet.writeContract(request)
  const receipt = await client.waitForTransactionReceipt({ hash })
  return { hash, receipt, explorerUrl: `${net.explorer}/tx/${hash}` }
}

/**
 * Burn the nonce. Signed by the payer, broadcast by whoever holds gas —
 * here the configured GRACE demo relayer. Zero-AVAX cancellation depends on that
 * relayer being funded, available, and successfully landing the transaction.
 */
export async function broadcastCancel(net, relayerAccount, { message, v, r, s }) {
  const wallet = walletClientFor(net, relayerAccount)
  const client = publicClientFor(net)
  const { request } = await client.simulateContract({
    address: net.token, abi: ABI, functionName: 'cancelAuthorization',
    args: [message.authorizer, message.nonce, v, r, s],
    account: relayerAccount,
  })
  const hash = await wallet.writeContract(request)
  const receipt = await client.waitForTransactionReceipt({ hash })
  return { hash, receipt, explorerUrl: `${net.explorer}/tx/${hash}` }
}

/** Same as above but only checks the signature would be accepted — no gas. */
export async function simulateCancel(net, relayerAddress, { message, v, r, s }, client = publicClientFor(net)) {
  try {
    await client.simulateContract({
      address: net.token, abi: ABI, functionName: 'cancelAuthorization',
      args: [message.authorizer, message.nonce, v, r, s],
      account: relayerAddress,
    })
    return { ok: true, reason: null, reached: true }
  } catch (err) {
    const reached = isContractVerdict(err)
    return { ok: false, reason: revertReason(err), reached }
  }
}

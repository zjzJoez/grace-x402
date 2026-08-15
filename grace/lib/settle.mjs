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
import { ABI, REVERTS } from './xsgd.mjs'
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
  if (reason === REVERTS.tooEarly) {
    return { state: 'cooling-off', headline: 'Cannot settle yet', detail: 'The cooling-off window has not closed. The chain is enforcing this, not the merchant.' }
  }
  if (reason === REVERTS.spent) {
    return { state: 'void', headline: 'Authorization void', detail: 'The payer cancelled during the cooling-off window. The nonce is burned on-chain and can never be settled.' }
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
    return { ok: true, reason: null, ...classify(null), state: 'settleable', headline: 'Ready to settle' }
  } catch (err) {
    const reason = revertReason(err)
    return { ok: false, reason, ...classify(reason) }
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
 * here the GRACE relayer, so a phone with zero AVAX can still kill a payment.
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
    return { ok: true, reason: null }
  } catch (err) {
    return { ok: false, reason: revertReason(err) }
  }
}

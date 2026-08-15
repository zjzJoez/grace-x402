/**
 * StraitsX AgentiX Playground — x402 / EIP-3009 client for XSGD on Avalanche.
 *
 * Every value below was verified live against card.straitsx.ai on 2026-08-14.
 * The non-obvious part is the PAID envelope: the challenge entry must be echoed
 * verbatim under the key `accepted` (not `accepts`) — the server parses amount,
 * asset, etc. from YOUR echo, not from its own challenge. Omit it and you get
 * `cannot parse payment amount: x402: invalid atomic amount ""`, which looks like
 * a signature problem and is not. (Confirmed by StraitsX devrel on 2026-08-15:
 * "make sure the accepted object is included in the base64". The x402Version
 * field itself is accepted as either 1 or 2.)
 *
 * Gas: you pay none. The StraitsX facilitator relayer (0x4B9E841a...7202) submits
 * transferWithAuthorization on your behalf. Your wallet needs XSGD, not AVAX.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, erc20Abi, formatUnits, toHex } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import crypto from 'node:crypto'

export const ENV = {
  sandbox: {
    issueCard: 'https://card.straitsx.ai/sandbox/cardapi/issue_card',
    mcpSse: 'https://card.straitsx.ai/sandbox/sse',
    xsgd: '0xd769410dc8772695a7f55a304d2125320a65c2a5',
    chain: avalancheFuji,
    explorer: 'https://testnet.snowtrace.io/tx/',
  },
  production: {
    issueCard: 'https://card.straitsx.ai/production/cardapi/issue_card',
    mcpSse: 'https://card.straitsx.ai/production/sse',
    xsgd: '0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E',
    chain: avalanche,
    explorer: 'https://snowtrace.io/tx/',
  },
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

/** Unpaid POST. Free, safe, unlimited — build against this before you have any XSGD. */
export async function getChallenge(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}: ${await res.text()}`)
  const header = res.headers.get('payment-required')
  if (!header) throw new Error('no PAYMENT-REQUIRED header')
  return JSON.parse(Buffer.from(header, 'base64').toString()).accepts[0]
}

/**
 * Sign the EIP-3009 authorization.
 *
 * `nonce` is a caller-chosen 32 bytes. It defaults to random, but it is the single
 * most useful free field on the wire: put a hash in it (a cart hash, a mandate id,
 * an invoice id) and the settled Avalanche transaction becomes self-describing —
 * FiatTokenV2_2 emits AuthorizationUsed(authorizer, nonce), so the commitment is
 * publicly readable forever, with zero cooperation from StraitsX.
 */
export async function signAuthorization(account, challenge, { nonce } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const authorization = {
    from: account.address,
    to: challenge.payTo,
    value: BigInt(challenge.amount),
    validAfter: 0n,
    validBefore: BigInt(now + (challenge.maxTimeoutSeconds ?? 300)),
    nonce: nonce ?? toHex(crypto.randomBytes(32)),
  }

  // Build the domain FROM the challenge. Hardcoding it is the #1 cause of
  // invalid_exact_evm_payload_signature when the issuer rotates anything.
  const signature = await account.signTypedData({
    domain: {
      name: challenge.extra.name,
      version: challenge.extra.version,
      chainId: challenge.chainId,
      verifyingContract: challenge.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  })

  return { signature, authorization }
}

/** The v2 envelope. `accepted` must be the challenge entry echoed verbatim. */
export function buildPaymentHeader(challenge, { signature, authorization }) {
  const envelope = {
    x402Version: 2,
    accepted: challenge,
    payload: {
      signature,
      authorization: Object.fromEntries(
        Object.entries(authorization).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
      ),
    },
  }
  return Buffer.from(JSON.stringify(envelope)).toString('base64')
}

/** Full loop: 402 -> sign -> retry. Returns the issued card. */
export async function issueCard({ privateKey, amountSgd, cardholderName, env = 'sandbox', nonce } = {}) {
  const cfg = ENV[env]
  const account = privateKeyToAccount(privateKey)
  const body = { amount_sgd: amountSgd, cardholder_name: cardholderName }

  const challenge = await getChallenge(cfg.issueCard, body)
  const signed = await signAuthorization(account, challenge, { nonce })

  const res = await fetch(cfg.issueCard, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': buildPaymentHeader(challenge, signed),
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)

  const card = JSON.parse(text)
  const paymentResponse = res.headers.get('payment-response')
  return {
    ...card,
    nonce: signed.authorization.nonce,
    explorerUrl: card.settlement_tx ? cfg.explorer + card.settlement_tx : null,
    paymentResponse: paymentResponse
      ? JSON.parse(Buffer.from(paymentResponse, 'base64').toString())
      : null,
  }
}

export async function xsgdBalance(address, env = 'sandbox') {
  const cfg = ENV[env]
  const client = createPublicClient({ chain: cfg.chain, transport: http() })
  const raw = await client.readContract({
    address: cfg.xsgd,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
  return { raw, formatted: formatUnits(raw, 6) }
}

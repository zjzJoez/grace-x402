/**
 * GRACE — the cooling-off rail.
 *
 * A normal agentic payment is a signed EIP-3009 authorization the merchant can
 * cash the instant it arrives. GRACE changes exactly one field:
 *
 *     validAfter = now + windowSeconds
 *
 * That single number turns an instantly-cashable instrument into one that is
 * cryptographically un-cashable until the window closes. During the window the
 * payer — and only the payer — can broadcast `cancelAuthorization`, which burns
 * the nonce on-chain forever.
 *
 * There is no escrow, no smart contract, no custodian. The money never leaves
 * the payer's wallet during the window; the merchant simply holds a claim that
 * is not yet valid. Reversal is not a refund — nothing moved to refund.
 *
 * Settlement uses `receiveWithAuthorization`, not `transferWithAuthorization`,
 * because it requires `msg.sender == to`. That gives the rail its symmetry:
 *
 *     only the merchant can cash it   (receiveWithAuthorization: caller must be the payee)
 *     only the payer can void it      (cancelAuthorization: signed by the authorizer)
 *
 * Nobody can do both, and no third party can do either.
 */

import { toHex, keccak256, stringToBytes, parseUnits, formatUnits } from 'viem'
import crypto from 'node:crypto'
import { domainFor, TYPES, DECIMALS } from './xsgd.mjs'

/**
 * The 32-byte nonce is caller-chosen and is the only free field on the wire.
 * GRACE spends it on an order *commitment*, so `AuthorizationUsed(authorizer,
 * nonce)` and `AuthorizationCanceled(authorizer, nonce)` bind each outcome to
 * what was bought — for anyone who is shown the preimage. A hash on its own
 * reveals nothing, and without the salt below it reveals too much: a bare
 * order hash over a small catalogue is brute-forceable in milliseconds, which
 * is why the binding makes the salt a MUST rather than a suggestion.
 *
 * `canonical()` is deliberately not `JSON.stringify(order, keys.sort())` — the
 * array form of the replacer applies at every depth, so any key absent from the
 * top level is silently dropped from nested objects, and two orders differing
 * only in nested data would commit to the same nonce.
 */
export function orderNonce(order, salt) {
  if (!order) return toHex(crypto.randomBytes(32))
  const s = salt ?? toHex(crypto.randomBytes(16))
  return { nonce: keccak256(stringToBytes(canonical({ order, salt: s }))), salt: s }
}

/** Deterministic serialisation: keys sorted at every level, arrays in order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export const toAtomic = (sgd) => parseUnits(String(sgd), DECIMALS)
export const toSgd = (atomic) => formatUnits(atomic, DECIMALS)

/**
 * Sign a deferred payment authorization.
 *
 * @param account       viem account (the payer / agent wallet)
 * @param net           entry from NETWORKS
 * @param opts.to       merchant address (must be the settling caller)
 * @param opts.amountSgd  human amount, e.g. 4.5
 * @param opts.windowSeconds  cooling-off period; merchant cannot settle before it elapses
 * @param opts.ttlSeconds     how long the authorization stays cashable AFTER the window
 * @param opts.order    arbitrary object hashed into the nonce (cart, mandate id, invoice)
 */
export async function signDeferredPayment(account, net, opts) {
  const {
    to,
    amountSgd,
    windowSeconds = 60,
    ttlSeconds = 3600,
    order = null,
    now = Math.floor(Date.now() / 1000),
  } = opts

  const validAfter = BigInt(now + windowSeconds)
  const validBefore = BigInt(now + windowSeconds + ttlSeconds)

  // A salted commitment: the payer keeps the salt, so the order stays private
  // on-chain and can still be proved to anyone who is shown it.
  const { nonce, salt } = order
    ? orderNonce(order, opts.orderSalt)
    : { nonce: orderNonce(null), salt: null }

  const authorization = {
    from: account.address,
    to,
    value: toAtomic(amountSgd),
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await account.signTypedData({
    domain: domainFor(net),
    types: TYPES.receive,
    primaryType: 'ReceiveWithAuthorization',
    message: authorization,
  })

  return {
    authorization,
    signature,
    ...splitSig(signature),
    // Everything the merchant needs, and nothing it can use early.
    window: { opensAt: Number(validAfter), closesAt: Number(validBefore), seconds: windowSeconds },
    order,
    orderSalt: salt,
  }
}

/**
 * Sign the cancellation. This is a meta-transaction: the payer signs, but ANY
 * address can broadcast it and pay the gas. That matters — it means a phone with
 * no AVAX can still kill a payment, and it means the cancel path does not depend
 * on the payer holding native gas at the moment they change their mind.
 */
export async function signCancellation(account, net, nonce) {
  const message = { authorizer: account.address, nonce }
  const signature = await account.signTypedData({
    domain: domainFor(net),
    types: TYPES.cancel,
    primaryType: 'CancelAuthorization',
    message,
  })
  return { message, signature, ...splitSig(signature) }
}

export function splitSig(signature) {
  return {
    r: `0x${signature.slice(2, 66)}`,
    s: `0x${signature.slice(66, 130)}`,
    v: parseInt(signature.slice(130, 132), 16),
  }
}

/** JSON-safe view of an authorization (bigints -> decimal strings). */
export function wireFormat(authorization) {
  return Object.fromEntries(
    Object.entries(authorization).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  )
}

/** Inverse of wireFormat. */
export function fromWire(obj) {
  return {
    from: obj.from,
    to: obj.to,
    value: BigInt(obj.value),
    validAfter: BigInt(obj.validAfter),
    validBefore: BigInt(obj.validBefore),
    nonce: obj.nonce,
  }
}

export const argsFor = (a, { v, r, s }) => [
  a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s,
]

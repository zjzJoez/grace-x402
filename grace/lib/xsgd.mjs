/**
 * GRACE — chain constants for XSGD (FiatTokenV2_2) on Avalanche C-Chain.
 *
 * Everything here was read off the live contracts on 2026-08-14/15, not from docs:
 *   - both proxies point at a 20220-byte FiatTokenV2_2 implementation
 *   - transferWithAuthorization / receiveWithAuthorization / cancelAuthorization
 *     / authorizationState selectors are all present
 *   - version() and DOMAIN_SEPARATOR() are NOT exposed, so the EIP-712 domain
 *     version cannot be read on-chain. It is "2" — confirmed empirically: signing
 *     with version "2" and a future validAfter reverts with
 *     `FiatTokenV2: authorization is not yet valid` (i.e. the signature recovered
 *     correctly and execution reached the time check). A wrong domain would have
 *     failed earlier with `invalid signature`.
 */

import { avalanche, avalancheFuji } from 'viem/chains'

export const NETWORKS = {
  mainnet: {
    label: 'Avalanche C-Chain',
    chain: avalanche,
    token: '0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E',
    explorer: 'https://snowtrace.io',
    // StraitsX x402 facilitator relayer — pays gas for settlement in the card flow.
    facilitator: '0x4B9E841a1A86730B3f42c7e963c86c4767847202',
  },
  fuji: {
    label: 'Avalanche Fuji',
    chain: avalancheFuji,
    token: '0xd769410dc8772695a7f55a304d2125320a65c2a5',
    explorer: 'https://testnet.snowtrace.io',
    facilitator: '0x4B9E841a1A86730B3f42c7e963c86c4767847202',
  },
}

export const DECIMALS = 6

/** EIP-712 domain. `version` is not readable on-chain — see file header. */
export function domainFor(net) {
  return {
    name: 'XSGD',
    version: '2',
    chainId: net.chain.id,
    verifyingContract: net.token,
  }
}

const AUTH_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
]

export const TYPES = {
  transfer: { TransferWithAuthorization: AUTH_FIELDS },
  receive: { ReceiveWithAuthorization: AUTH_FIELDS },
  cancel: {
    CancelAuthorization: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
}

export const ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'receiveWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'cancelAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'isBlacklisted',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'AuthorizationUsed',
    inputs: [
      { name: 'authorizer', type: 'address', indexed: true },
      { name: 'nonce', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AuthorizationCanceled',
    inputs: [
      { name: 'authorizer', type: 'address', indexed: true },
      { name: 'nonce', type: 'bytes32', indexed: true },
    ],
  },
]

/**
 * The four revert strings FiatTokenV2_2 emits on the paths GRACE cares about.
 * These are the demo — the merchant's SETTLE button is *supposed* to hit them.
 */
export const REVERTS = {
  tooEarly: 'FiatTokenV2: authorization is not yet valid',
  expired: 'FiatTokenV2: authorization is expired',
  spent: 'FiatTokenV2: authorization is used or canceled',
  wrongCaller: 'FiatTokenV2: caller must be the payee',
  badSig: 'EIP712: invalid signature',
  noFunds: 'ERC20: transfer amount exceeds balance',
}

export function pickNetwork(name = process.env.GRACE_NETWORK ?? 'mainnet') {
  const net = NETWORKS[name]
  if (!net) throw new Error(`unknown network "${name}" — use mainnet | fuji`)
  return { ...net, key: name }
}

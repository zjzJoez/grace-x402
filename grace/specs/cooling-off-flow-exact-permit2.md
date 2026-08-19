# `cooling-off` binding for `exact` on EVM (`permit2`)

> Second binding of the [`cooling-off` payment flow](cooling-off-payment-flow.md).
> Works for **any ERC-20**, not only EIP-3009 tokens. The on-chain window check
> already ships in x402's own deployed contracts; the payer-side cancel is a
> canonical Permit2 call. No new contract is required.

## Summary

The `exact` / `permit2` asset transfer method routes settlement through
`x402ExactPermit2Proxy`, which commits a `Witness(address to, uint256 validAfter)`
into the payer's Permit2 signature and enforces, in `_settle`:

```solidity
if (block.timestamp < validAfter) revert PaymentTooEarly();
```

(`contracts/evm/src/x402BasePermit2Proxy.sol`; `WITNESS_TYPEHASH` in
`contracts/evm/src/x402ExactPermit2Proxy.sol`; deployed on Base at
`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`.)

Today's tooling backdates `validAfter` so payments are immediately settleable. This
binding sets it forward — `validAfter = signedAt + coolingOffSeconds` — and the proxy's
existing check becomes the ledger-enforced cooling-off window. **The primitive is
already deployed in the x402 contract tree; only the spec text and SDK defaults forbid
using it.**

## Cancellation: `invalidateUnorderedNonces`

Canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) exposes, on the
SignatureTransfer side used by this proxy:

```solidity
function invalidateUnorderedNonces(uint256 wordPos, uint256 mask) external;
```

The caller flips bits in their **own** nonce bitmap; a signed-but-unspent permit whose
nonce is invalidated can never be executed. Because the x402 client chooses the Permit2
nonce itself and it passes through untransformed (`createPermit2Nonce()` →
`permit2Authorization.nonce` → `PermitTransferFrom`), the payer always knows exactly
which `(wordPos, mask)` to invalidate: `wordPos = nonce >> 8`, `mask = 1 << uint8(nonce)`.

Measured on Base mainnet (2026-08-19): `invalidateUnorderedNonces(0, 1)` estimates
**45,946 gas** (≈2.8e-7 ETH at prevailing prices).

### Honest differences from the EIP-3009 binding

| | `eip3009` binding | `permit2` binding |
| :-- | :-- | :-- |
| Cancel authorization | payer-signed meta-tx — **any relayer may broadcast**; payer needs no native gas (relay availability caveats apply) | **payer's own transaction** — ~46k gas, payer MUST hold native currency on the chain |
| Token coverage | EIP-3009 tokens (USDC, XSGD, EURC, FiatToken derivatives) | **any ERC-20** (one-time Permit2 approval prerequisite, as in stock `exact`/`permit2`) |
| Window enforcement | token contract (`authorization is not yet valid`) | `x402ExactPermit2Proxy` (`PaymentTooEarly`), validAfter signature-bound via the Witness |
| Cancel finality signal | `AuthorizationCanceled` event | `UnorderedNonceInvalidation` event |

A wallet that cannot fund ~46k gas has no working veto under this binding. Resource
servers targeting the `principal-protected` authority profile SHOULD prefer the
EIP-3009 binding or verify the payer's gas balance covers a cancellation at acceptance
time; clients SHOULD warn when the payer's native balance cannot fund a cancel.

## PaymentRequirements

Identical to `exact` / `permit2` today, plus the flow keys:

```json
{
  "scheme": "exact",
  "network": "eip155:8453",
  "amount": "4500000",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
  "maxTimeoutSeconds": 3600,
  "extra": {
    "assetTransferMethod": "permit2",
    "paymentFlow": "cooling-off",
    "coolingOffSeconds": 90,
    "cancellationSafetySeconds": 10
  }
}
```

## PaymentPayload

Unchanged from `exact` / `permit2` except the witness derivation:

| Field | `exact` today | Under `cooling-off` |
| :-- | :-- | :-- |
| `witness.validAfter` | `0` (SDK backdates; proxy check passes trivially) | **`signedAt + coolingOffSeconds`** |
| `permit2Authorization.deadline` | `now + maxTimeoutSeconds` | `validAfter + maxTimeoutSeconds` |
| `permit2Authorization.nonce` | client-random 32 bytes | unchanged (client-random; client persists it for cancellation) |
| everything else | — | unchanged |

The client MUST persist the nonce (and derived `wordPos`/`mask`) wherever the human's
cancellation affordance lives, so the veto does not depend on the agent process.

## Verification

As `exact` / `permit2`, with the same two changes as the EIP-3009 binding:

1. Replace the "active now" check with the window check:
   `|witness.validAfter − (now + coolingOffSeconds)| <= skewTolerance` against a recent
   chain-head timestamp (the stock verifier's `ErrPermit2NotYetValid` rejection MUST NOT
   apply when `paymentFlow` is `cooling-off`).
2. A settlement simulation before `validAfter` is expected to revert `PaymentTooEarly()`
   and MUST be classified as the window holding, not as a verification failure.

Nonce-unused is read from `Permit2.nonceBitmap(payer, wordPos)`; balance and allowance
checks are indicative only (funds stay with the payer during the window).

## Settlement

Unchanged call — `x402ExactPermit2Proxy.settle(...)` — scheduled at
`validAfter + buffer`, submitted before `deadline`. Terminal outcomes:

| Outcome | Signal | Report |
| :-- | :-- | :-- |
| Settled | transfer executed via proxy | success |
| Client cancelled | Permit2 `InvalidNonce` revert; `UnorderedNonceInvalidation(payer, wordPos, mask)` observed | terminal `canceled_by_client` — not an error |
| Broadcast too early | `PaymentTooEarly()` | facilitator scheduling defect |
| Missed deadline | Permit2 `SignatureExpired` | facilitator scheduling defect |
| Payer spent funds / revoked Permit2 approval | ERC-20 / allowance revert | failure; lost sale, never a lost good |

The race, cutoff, and confirmation rules of the flow document apply unchanged; the
cancellation clock gate is the nonce bitmap, not `validAfter`, so the payer's veto
persists until settlement actually lands — facilitators MUST settle promptly.

## What changes in implementations

| Component | Change |
| :-- | :-- |
| Client SDK | When `paymentFlow == "cooling-off"`: set `witness.validAfter` forward instead of `0`; persist the nonce for cancellation; expose an `invalidateUnorderedNonces` helper and a native-gas-balance warning. |
| Facilitator `/verify` | Window check above; stop treating future `validAfter` as `ErrPermit2NotYetValid` under this flow. |
| Facilitator `/settle` | Hold until `validAfter`; map `InvalidNonce` to `canceled_by_client`. |
| Contracts | **Nothing.** The deployed proxy already enforces the window. |

## Evidence and limits

The mechanism facts above were verified against the repo source
(`x402BasePermit2Proxy.sol`, `x402ExactPermit2Proxy.sol`, `SignatureTransfer.sol` in
canonical Permit2) and live Base mainnet (deployed bytecode present at both addresses;
gas measured via `eth_estimateGas`). No end-to-end cooling-off purchase has been run on
this binding yet — the running reference implementation
(<https://github.com/zjzJoez/grace-x402>) exercises the EIP-3009 binding on Avalanche
mainnet. Treat this document as a specified-but-not-yet-demonstrated profile; the
EIP-3009 binding is the demonstrated one.

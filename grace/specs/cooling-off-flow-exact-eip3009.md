# Payment Flow `cooling-off` — binding for `exact` on EVM (`eip3009`)

> Binds the [`cooling-off` payment flow](cooling-off-payment-flow.md) to the existing `exact`
> scheme on EVM using the `eip3009` asset transfer method. No new scheme, no new
> contract, no change to the settlement call — only *when* it is made, and one new
> `extra` key.

## Summary

EIP-3009 authorizations already carry `validAfter`, and today every x402 implementation
sets it to the past so the authorization is immediately settleable. This binding sets it
to the **future**:

```
validAfter  = signedAt + coolingOffSeconds
validBefore = validAfter + maxTimeoutSeconds
```

Until `validAfter`, the token contract refuses settlement — the resource server holds a
signed, amount-locked, payer-bound claim nobody can cash yet. Throughout, the client may
withdraw the payment with `cancelAuthorization`, a payer-signed message any relayer may
broadcast, so a client wallet holding no native gas keeps a working veto.

Requires an EIP-3009 token implementing `cancelAuthorization`. Circle's FiatToken
implementation (USDC, XSGD, EURC and derivatives) qualifies on every chain where it is
deployed.

## PaymentRequirements

Standard `PaymentRequirements`; see
[§5 Types](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
The scheme remains `exact`.

```json
{
  "scheme": "exact",
  "network": "eip155:43114",
  "amount": "4500000",
  "asset": "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
  "payTo": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
  "maxTimeoutSeconds": 3600,
  "extra": {
    "assetTransferMethod": "eip3009",
    "paymentFlow": "cooling-off",
    "coolingOffSeconds": 90,
    "name": "XSGD",
    "version": "2"
  }
}
```

### `extra` fields

Only one key is new. `assetTransferMethod`, `paymentFlow`, `name` and `version` keep
their existing meanings.

| Field | Required | Type | Description |
| :-- | :-- | :-- | :-- |
| `paymentFlow` | Yes | `"cooling-off"` | Required by §6.1 for any flow other than `authorization`. |
| `coolingOffSeconds` | Yes | `uint32` | Length of the client's withdrawal window in seconds, measured from signing. MUST be > 0 when `paymentFlow` is `cooling-off`. |

`maxTimeoutSeconds` keeps its meaning — how long the authorization must remain
settleable — but is measured **from `validAfter`**, not from signing. Servers SHOULD
allow comfortably more than their settlement scheduling jitter.

## PaymentPayload

Unchanged from `exact` / `eip3009`; see
[`scheme_exact_evm.md`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md).
Only the derivation of `validAfter` differs.

### Field derivation

| Field | `exact` today | Under `cooling-off` |
| :-- | :-- | :-- |
| `authorization.validAfter` | `now` or earlier | **`signedAt + extra.coolingOffSeconds`** |
| `authorization.validBefore` | `now + maxTimeoutSeconds` | `validAfter + maxTimeoutSeconds` |
| everything else | — | unchanged |

```json
"authorization": {
  "from": "0x855A4b2085B16065204c379439773a4F9Ef7F424",
  "to": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
  "value": "4500000",
  "validAfter": "1786822425",
  "validBefore": "1786826025",
  "nonce": "0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde"
}
```

Servers MAY derive `nonce` as `keccak256` of the canonical order (including an order id
or salt), which makes each on-chain settlement or cancellation event a self-describing
commitment to what was purchased. This is OPTIONAL and changes nothing normative.

## Verification

`/verify` answers "will this settle at `validAfter`", not "will this settle now".
Relative to `exact` / `eip3009` verification, two rules change and the rest are
unchanged:

1. **Window honoured** (replaces `validAfter <= now`). The facilitator MUST check
   `|validAfter − (now + coolingOffSeconds)| <= skewTolerance`, and SHOULD use a
   tolerance of at least 60 s.
2. **Settlement runway.** `validBefore` MUST exceed `validAfter` by a margin sufficient
   to settle; a facilitator SHOULD require at least 60 s.
3. **Simulation.** A settlement simulation performed now MUST be expected to revert with
   `FiatTokenV2: authorization is not yet valid`. A facilitator MUST NOT report this as
   a verification failure — under this flow it is positive evidence that the window is
   being enforced — and SHOULD instead simulate against a block timestamp at or after
   `validAfter` to exercise the remaining conditions.

Signature recovery, amount, `payTo`, asset, network, nonce-unused and balance checks are
unchanged.

A facilitator SHOULD report when settlement becomes possible, so the resource server can
schedule and can show the principal a countdown:

```json
{ "isValid": true, "payer": "0x855A…F424", "settleableAt": 1786822425 }
```

This field is additive; see [#3085](https://github.com/x402-foundation/x402/issues/3085)
for the parallel gap in `SettlementResponse`.

## Settlement

1. The facilitator MUST NOT broadcast before `validAfter`, SHOULD schedule for
   `validAfter` plus a small buffer absorbing block-time variance, and MUST broadcast
   before `validBefore`.
2. The call itself is unchanged: `transferWithAuthorization(from, to, value, validAfter,
   validBefore, nonce, v, r, s)` on the asset.
3. `AuthorizationUsed(authorizer, nonce)` is the receipt.

A resource server that settles for itself MAY instead use `receiveWithAuthorization`,
which the token additionally gates on `msg.sender == payTo`. That variant requires the
payee to hold native gas and is not required by this binding.

### Client withdrawal

The client signs the EIP-712 struct `CancelAuthorization(address authorizer, bytes32
nonce)` under the token's domain; any address MAY submit
`cancelAuthorization(authorizer, nonce, v, r, s)`.

- The signer MUST be the authorization's `from`; the contract rejects others with
  `FiatTokenV2: invalid signature`.
- The submitter may be anyone, so the client needs no native gas. Facilitators SHOULD
  offer cancellation relay; a resource server MAY relay for its own clients.
- The contract gates cancellation on the nonce being **unused, not on the clock**
  (verified against live mainnet: a cancellation simulated after `validAfter` has passed
  still succeeds while the authorization is unspent). Withdrawal therefore remains
  available until settlement actually lands, which is why facilitators MUST settle
  promptly.
- Cancellation is terminal and emits `AuthorizationCanceled(authorizer, nonce)`.

### Terminal outcomes

| Outcome | Revert / event | Facilitator MUST report |
| :-- | :-- | :-- |
| Settled | `AuthorizationUsed` | success |
| Client withdrew | `FiatTokenV2: authorization is used or canceled` | terminal `canceled_by_client` — not an error |
| Client spent the funds | `ERC20: transfer amount exceeds balance` | failure; server loses a sale, not an obligation |
| Broadcast too early | `FiatTokenV2: authorization is not yet valid` | facilitator scheduling defect |
| Missed the deadline | `FiatTokenV2: authorization is expired` | facilitator scheduling defect |

Resource servers MUST NOT fulfil the obligation on any outcome other than success.

## Reference implementation and evidence

Working merchant, buying agent, and an `at(validAfter)` settlement scheduler:
<https://github.com/zjzJoez/grace-x402>. It predates this binding and self-settles with
`receiveWithAuthorization`; the mechanics of the window and the withdrawal are identical.

`node grace/prove.mjs` runs 13 assertions against live Avalanche C-Chain state with no
keys and no gas (~20 s): settlement inside the window reverts as "not yet valid"; the
same authorization becomes settleable afterwards; a third party cannot cash a
`receiveWithAuthorization` claim; a payer-signed cancellation succeeds when broadcast by
a different wallet; a forged cancellation is rejected; a burned nonce can never settle.

Mainnet transactions, XSGD `0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E` on Avalanche
C-Chain (`eip155:43114`):

| What it demonstrates | Transaction |
| :-- | :-- |
| Settlement after the window, final | [`0xf6ccdc44…`](https://snowtrace.io/tx/0xf6ccdc44fdc93ad3bc46242f41f9e636cad43c90e5202f2e89fee73525c593db) |
| Client withdrew during the window; balance never moved | [`0xd5bab3ab…`](https://snowtrace.io/tx/0xd5bab3abf1cf09e8ff67d94d85f0c6fabdee47aa4d16cf6196622863f7709cdd) |
| Withdrawal relayed by another wallet — client paid no gas | [`0x75d6bba1…`](https://snowtrace.io/tx/0x75d6bba1055bef67e73bfa0235c79bfd84f46266d10c490fb08bbe025002bdb5) |
| Scheduled settlement fired at `validAfter`, no human involved | [`0x2addd508…`](https://snowtrace.io/tx/0x2addd508ef83d2efd9df0655c6f344fd205b1e8761501c4549830c3a7c772b50) |

## What an implementation has to change

| Component | Change |
| :-- | :-- |
| Client SDK | When `extra.paymentFlow == "cooling-off"`, set `validAfter` forward by `coolingOffSeconds` instead of backdating it; expose a cancellation helper. |
| Facilitator `/verify` | Swap the `validAfter <= now` assertion for the window check; stop treating a "not yet valid" simulation revert as failure. |
| Facilitator `/settle` | Hold until `validAfter` instead of broadcasting on receipt; map the cancellation revert to `canceled_by_client`. |
| Resource server | Advertise `paymentFlow` and `coolingOffSeconds`; do not fulfil before settlement; surface a confirmation reference to the human principal. |
| Token, contracts, chain | Nothing. |

Facilitators that do not implement `cooling-off` are unaffected: §6.1 already requires
clients to skip `accepts[]` entries whose `paymentFlow` they do not recognise, and
servers can advertise a `cooling-off` entry alongside a plain `exact` one.

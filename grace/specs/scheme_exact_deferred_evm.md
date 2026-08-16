# Scheme: `exact-deferred` on `EVM`

## Summary

`exact-deferred` on EVM is `exact` on EVM with one field changed: the client signs an
EIP-3009 authorization whose `validAfter` is in the **future**. The token contract
enforces the window — settlement attempted before `validAfter` reverts — and EIP-3009's
`cancelAuthorization` gives the payer a gasless unilateral veto for as long as the
authorization is unspent.

No new contract is involved. The scheme works on any EIP-3009 token: USDC, XSGD, EURC
and other FiatToken-derived assets, on every chain where they are already deployed.

Two asset transfer methods are defined:

| AssetTransferMethod | Settlement call | Broadcaster | When to use |
| :-- | :-- | :-- | :-- |
| **`eip3009`** (default) | `transferWithAuthorization` | Facilitator | Matches the `exact` operating model; the facilitator pays gas and schedules the call. |
| **`eip3009-receive`** | `receiveWithAuthorization` | Payee (`payTo`) | The token additionally enforces `msg.sender == payTo`, so settlement timing is the payee's alone. Requires the payee to hold native gas. |

Both methods commit the same amount to the same recipient; they differ only in who may
submit the settling transaction. `eip3009` is RECOMMENDED for facilitator-mediated
deployments. Under `eip3009`, any party may broadcast once the window closes, but funds
can still only reach `payTo`, since the destination is inside the signature.

## PaymentRequirements

A server advertising `exact-deferred` returns a standard `PaymentRequirements` entry.
See `PaymentRequirements` in [x402-specification.md](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

```json
{
  "scheme": "exact-deferred",
  "network": "eip155:43114",
  "amount": "4500000",
  "asset": "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
  "payTo": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
  "maxTimeoutSeconds": 3600,
  "extra": {
    "assetTransferMethod": "eip3009",
    "name": "XSGD",
    "version": "2",
    "coolingOffSeconds": 90
  }
}
```

### `extra` Fields

| Field | Required | Type | Description |
| :-- | :-- | :-- | :-- |
| `name` | Yes | `string` | EIP-712 token-domain name (e.g. `"XSGD"`). Used for authorization signing only. |
| `version` | Yes | `string` | EIP-712 token-domain version (e.g. `"2"`). |
| `coolingOffSeconds` | Yes | `uint32` | Length of the client's cancellation window, in seconds. `0` makes the scheme behave exactly as `exact`. |
| `assetTransferMethod` | No | `"eip3009" \| "eip3009-receive"` | Settlement call to use. Default `"eip3009"`. A payload using the non-default method MUST echo it in `accepted.extra`. |

`maxTimeoutSeconds` retains its usual meaning of "how long the server needs the
authorization to remain settleable", but it is measured **from `validAfter`**, not from
signing time — see the derivation table below. Servers SHOULD choose a value comfortably
larger than their settlement scheduling jitter.

Servers MUST advertise `coolingOffSeconds` per resource. A resource delivered instantly
MUST NOT advertise a non-zero window (see the ordering requirement in
[`scheme_exact_deferred.md`](scheme_exact_deferred.md#ordering-requirement-settle-before-deliver)).

## PaymentPayload

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://shop.example.com/checkout/tee-agentix",
    "description": "AgentiX Hackathon Tee",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact-deferred",
    "network": "eip155:43114",
    "amount": "4500000",
    "asset": "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
    "payTo": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "assetTransferMethod": "eip3009",
      "name": "XSGD",
      "version": "2",
      "coolingOffSeconds": 90
    }
  },
  "payload": {
    "signature": "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9bd15092f9ecab05ded3d6293af148b571c",
    "authorization": {
      "from": "0x855A4b2085B16065204c379439773a4F9Ef7F424",
      "to": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
      "value": "4500000",
      "validAfter": "1786822425",
      "validBefore": "1786826025",
      "nonce": "0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde"
    }
  }
}
```

### Field derivation

| Field | Value |
| :-- | :-- |
| `authorization.from` | Client's own address |
| `authorization.to` | `requirements.payTo` (both methods — the payee is the recipient, not a collector contract) |
| `authorization.value` | `requirements.amount` |
| `authorization.validAfter` | **`signedAt + extra.coolingOffSeconds`** — the one departure from `exact` |
| `authorization.validBefore` | `validAfter + requirements.maxTimeoutSeconds` |
| `authorization.nonce` | Unique `bytes32`. RECOMMENDED: `keccak256` of the canonical order object including an order id or salt, making settlement events self-describing. |

The EIP-712 domain is the token contract's own (`name`, `version`, `chainId`, the token
address as `verifyingContract`). The primary type is `TransferWithAuthorization` for
`eip3009` and `ReceiveWithAuthorization` for `eip3009-receive`; both have the field list
`(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore,
bytes32 nonce)`.

## Verification

`/verify` answers "will this settle at `validAfter`", not "will this settle now".

1. **Signature.** Recovers to `authorization.from` under the token's EIP-712 domain and
   the primary type implied by `assetTransferMethod`.
2. **Requirements match.** `value == amount`, `to == payTo`, asset and network match.
3. **Window honoured.** `validAfter` MUST be in the future and MUST be consistent with
   the advertised window:
   `|validAfter - (now + coolingOffSeconds)| <= skewToleranceSeconds`.
   A facilitator SHOULD use a tolerance of at least 60 s. When `coolingOffSeconds` is
   `0`, this reduces to `exact`'s `validAfter <= now` rule.
4. **Settlement runway.** `validBefore > validAfter + minSettlementRunwaySeconds`
   (RECOMMENDED minimum 60 s), so the authorization cannot expire in the instant it
   becomes valid.
5. **Nonce unused.** `authorizationState(from, nonce) == false`.
6. **Balance.** The client's balance covers `value` at verification time. This is
   indicative only — see [Solvency](#solvency-is-not-guaranteed).
7. **Simulation.** Simulating settlement now MUST revert with
   `FiatTokenV2: authorization is not yet valid` (or the token's equivalent). This
   revert is the expected, passing result: it is positive evidence that the chain is
   holding the window. Facilitators MUST NOT treat it as a verification failure, and
   SHOULD simulate against `validAfter` (e.g. `eth_call` with a future block timestamp)
   to check the remaining conditions.

A successful `/verify` response SHOULD include the moment settlement becomes possible so
the server can schedule and can show the human a countdown:

```json
{ "isValid": true, "payer": "0x855A…F424", "settleableAt": 1786822425 }
```

## Settlement

1. **Wait.** The facilitator MUST NOT broadcast before `validAfter`. It SHOULD schedule
   the call for `validAfter` plus a small buffer (a few seconds) to absorb block-time
   variance, and MUST submit before `validBefore`.
2. **Submit.** Call `transferWithAuthorization(from, to, value, validAfter, validBefore,
   nonce, v, r, s)` on the asset (or `receiveWithAuthorization` with the payee as
   `msg.sender` under `eip3009-receive`).
3. **Report.** On success, return the standard settlement response. The
   `AuthorizationUsed(authorizer, nonce)` event is the receipt; where the nonce is an
   order hash, it commits on-chain to what was bought.
4. **Cancelled payments are a normal outcome.** If the client vetoed, settlement reverts
   with `FiatTokenV2: authorization is used or canceled`. The facilitator MUST report
   this as the terminal state `canceled_by_client`, not as a server or network error.
   Servers MUST NOT deliver the resource in this case.

### Cancellation

The client cancels by signing the EIP-712 struct `CancelAuthorization(address
authorizer, bytes32 nonce)` under the same token domain and having anyone submit
`cancelAuthorization(authorizer, nonce, v, r, s)`.

- The signer MUST be the authorization's `from`; the contract rejects any other signer
  with `FiatTokenV2: invalid signature`.
- The submitter may be any address, so the payer needs no native gas. Facilitators
  SHOULD offer cancellation relay as a service endpoint; a server MAY relay
  cancellations for its own payers.
- The contract gates cancellation on the nonce being unused, not on the clock, so the
  veto remains exercisable until settlement actually lands.
- After cancellation the nonce is permanently consumed and emits
  `AuthorizationCanceled(authorizer, nonce)`.

### Solvency is not guaranteed

Funds stay in the client's wallet during the window, so a client may spend them
elsewhere. Settlement then reverts with `ERC20: transfer amount exceeds balance`. This
is a lost sale for the server, not a loss of goods, because delivery follows settlement.
Servers requiring guaranteed funds at delivery time want `auth-capture`.

## Error Codes

### Verification Errors

| Code | Condition |
| :-- | :-- |
| `unsupported_scheme` | Scheme is not `exact-deferred`. |
| `invalid_payload_format` | Payload does not match the EIP-3009 authorization shape. |
| `invalid_signature` | Signature does not recover to `authorization.from`. |
| `invalid_amount` | `value != amount`. |
| `invalid_pay_to` | `to != payTo`. |
| `network_mismatch` | Payload network differs from requirements. |
| `invalid_cooling_off_window` | `validAfter` is not within tolerance of `now + coolingOffSeconds` (including a past-dated `validAfter` when a window was required). |
| `insufficient_settlement_runway` | `validBefore` leaves too little time after `validAfter`. |
| `nonce_already_used` | The authorization nonce is spent or cancelled. |
| `insufficient_funds` | Client balance below `value` at verification time. |

### Settlement Errors

| Code | Condition |
| :-- | :-- |
| `settlement_too_early` | Broadcast attempted before `validAfter` (`authorization is not yet valid`). Indicates a scheduling bug in the facilitator. |
| `canceled_by_client` | `authorization is used or canceled` — the payer exercised the veto. Terminal, expected, not an error condition for the payer. |
| `authorization_expired` | `authorization is expired` — settlement missed `validBefore`. |
| `insufficient_funds` | Client spent the funds during the window. |
| `invalid_caller` | `eip3009-receive` only: `caller must be the payee`. |

## Reference Implementation and Evidence

A working merchant, buying agent, and settlement scheduler:
<https://github.com/zjzJoez/grace-x402>. It implements `eip3009-receive`; the `eip3009`
method described above is the straightforward simplification for facilitator-mediated
settlement.

`node grace/prove.mjs` runs 13 assertions against live Avalanche C-Chain state with no
keys and no gas (~20 s), including: settlement inside the window reverts with
`authorization is not yet valid`; the same authorization becomes settleable after the
window; a third party cannot cash a `receiveWithAuthorization` claim; a payer-signed
cancellation succeeds when broadcast by a different wallet; a forged cancellation is
rejected; a burned nonce can never settle.

Mainnet transactions on Avalanche C-Chain (43114), XSGD
`0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E`:

| Event | Transaction |
| :-- | :-- |
| Settlement after the window, final | [`0xf6ccdc44…`](https://snowtrace.io/tx/0xf6ccdc44fdc93ad3bc46242f41f9e636cad43c90e5202f2e89fee73525c593db) |
| Payer cancellation during the window, balance untouched | [`0xd5bab3ab…`](https://snowtrace.io/tx/0xd5bab3abf1cf09e8ff67d94d85f0c6fabdee47aa4d16cf6196622863f7709cdd) |
| Cancellation relayed by a third party (payer paid no gas) | [`0x75d6bba1…`](https://snowtrace.io/tx/0x75d6bba1055bef67e73bfa0235c79bfd84f46266d10c490fb08bbe025002bdb5) |
| Scheduled settlement fired at `validAfter`, no human involved | [`0x2addd508…`](https://snowtrace.io/tx/0x2addd508ef83d2efd9df0655c6f344fd205b1e8761501c4549830c3a7c772b50) |

## Appendix

### Token compatibility

Requires an EIP-3009 token with `validAfter` enforcement and `cancelAuthorization`.
Verified against Circle's FiatTokenV2_2 implementation, whose revert strings appear in
the error tables above. Tokens whose EIP-3009 implementation omits `cancelAuthorization`
can support the window but not the veto, and MUST NOT be advertised for this scheme.

### What a facilitator must change

Support is a scheduling change, not an architectural one:

1. `/verify` — replace the `validAfter <= now` assertion with the window check in
   [Verification](#verification), and stop treating a
   `authorization is not yet valid` simulation revert as failure.
2. `/settle` — hold the authorization until `validAfter` instead of broadcasting on
   receipt, and map the cancellation revert to `canceled_by_client`.
3. Client SDKs — set `validAfter` forward by `coolingOffSeconds` instead of backdating
   it, when the advertised scheme is `exact-deferred`.

Nothing else in the protocol, the token, or the chain changes. Facilitators that do not
implement the scheme are unaffected: servers advertise it alongside `exact`, and clients
that do not recognise it fall back.

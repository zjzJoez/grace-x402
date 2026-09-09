# `cooling-off` binding for `exact` on EVM (`eip3009`)

> Binds the [`cooling-off` payment flow](cooling-off-payment-flow.md) to the existing
> `exact` scheme and `eip3009` asset transfer method. No token contract changes;
> facilitator `/verify` and `/settle` stay synchronous.

## Summary

EIP-3009 already supplies both primitives the flow requires: `validAfter` prevents
settlement until a signed timestamp, and `cancelAuthorization` lets the authorizer
permanently burn an unused nonce. This binding future-dates the authorization, records
it durably at the resource server, and settles synchronously once chain time passes
`validAfter`.

```text
validAfter  = clientNow + coolingOffSeconds
cancelBy    = validAfter - cancellationSafetySeconds
validBefore = validAfter + maxTimeoutSeconds
```

`cancellationSafetySeconds` is a network/relay inclusion-and-finality buffer, not
decision time. Only a finalized `AuthorizationCanceled` event is an on-chain
cancellation guarantee.

## Asset conformance

A compatible asset's **deployed** implementation: (1) implements EIP-3009 transfer and
`cancelAuthorization` over the same nonce state; (2) rejects transfer while
`block.timestamp <= validAfter`; (3) rejects both once the nonce is used or canceled;
and (4) emits distinguishable `AuthorizationUsed` and `AuthorizationCanceled` events.
Implementations MUST probe or allowlist the deployed contract — a token name is not
evidence across chains, proxies, and versions. The `principal-protected` profile
additionally requires the `bytes`-signature overload with ERC-1271 validation (Circle
FiatToken v2.2 has it via `SignatureChecker`; each deployment still needs checking).

Probed on mainnet (`node grace/token-conformance.mjs`, 2026-08-24 — `eth_call` only,
throwaway key, no funds). Each row: an authorization dated 120s ahead cannot be settled
now, and the payer's cancellation is accepted when broadcast by a stranger.

| Asset | Chain | Both primitives | Window revert |
| :-- | :-- | :--: | :-- |
| USDC | Base, Avalanche | ✅ | `FiatTokenV2: authorization is not yet valid` |
| EURC | Base | ✅ | same |
| XSGD | Avalanche | ✅ | same |
| USD₮0 (Stargate) | Base | ✅ | **`TetherToken: auth early`** |
| USDT (native, `.e`) | Ethereum, Avalanche | ❌ no EIP-3009 | — use the [Permit2 binding](cooling-off-flow-exact-permit2.md) |

Two things follow, and both are why the probe rule is normative rather than advisory.

**The window is a property of EIP-3009, not of any issuer.** It holds identically on
Circle's tokens and on Tether's USD₮0, across two chains, with no cooperation from
anyone.

**Conforming tokens word the refusal differently.** USD₮0 enforces the window exactly
as USDC does and says `TetherToken: auth early`. A facilitator matching Circle's string
reads a correctly held window as an unknown failure — and would reject a conforming
payment. Implementations MUST classify the window by behaviour (settlement refused
before `validAfter`, accepted after) or by an allowlist of per-asset strings, never by
one issuer's wording. `grace/lib/xsgd.mjs` carries the pattern list this repo uses.

**Classic USDT has no EIP-3009 at all** — no `transferWithAuthorization`, no
`cancelAuthorization`, not even EIP-2612 `permit`. The largest stablecoin in circulation
is therefore out of reach for this binding, which is the specific reason the Permit2
binding exists.

## PaymentRequirements

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
    "cancellationSafetySeconds": 15,
    "quoteExpiresAt": 1786822395,
    "name": "XSGD",
    "version": "2"
  }
}
```

A `cooling-off` entry in `PaymentRequired.extensions` additionally advertises
`cancelRelayUrls` (MAY be empty when only self-broadcast is supported), an explicit
`cancellationFinality` rule, and the status protocol; it is echoed in `PaymentPayload`
under the normal extension rule.

### `extra` fields

| Field | Required | Rule |
| :-- | :--: | :-- |
| `paymentFlow` | Yes | `"cooling-off"` selects this lifecycle |
| `coolingOffSeconds` | Yes | total future activation delay; MUST be > 0 |
| `cancellationSafetySeconds` | Yes | MUST be > 0 and **≤ 25% of `coolingOffSeconds`** — the floor that keeps the advertised window honest |
| `quoteExpiresAt` | Yes | absolute Unix seconds; acceptance after it MUST be refused |
| `name`, `version` | Yes | deployed token EIP-712 domain values |

`maxTimeoutSeconds` is the settlement runway **after** `validAfter`, and MUST cover
retries plus the advertised settlement finality. `cancellationSafetySeconds` MUST be
chosen from measured network and relay behaviour — it is an operational margin, not a
promise that a transaction submitted at `cancelBy` lands.

## PaymentPayload

The payload is the existing `exact`/`eip3009` payload; only the timestamp derivation
changes:

```text
validAfter  = floor(client wall-clock seconds) + coolingOffSeconds
validBefore = validAfter + maxTimeoutSeconds
```

The client MUST expose `cancelBy = validAfter − cancellationSafetySeconds` — not
`validAfter` — as the normal cancellation deadline, and any countdown MUST be derived
from the absolute signed `validAfter`, never from the advertised window length, so a
skewed client clock mislabels nothing.

Nonces are random 32 bytes by default. Deriving a nonce from order data is OPTIONAL and
MUST include an unpredictable salt (an unsalted public-order digest leaks linkage and
invites preemptive cancellation). Both intent-binding profiles of the flow document
apply: salted digest-nonce with normative canonicalization, or a separately signed
intent record for `principal-protected` deployments.

## Verification

`/verify` answers whether the authorization is structurally valid and expected to
settle later. In addition to ordinary `exact`/EIP-3009 checks, the facilitator MUST:

1. use a recent chain-head timestamp, not local wall time alone;
2. verify `validAfter` is in the future and its remaining delay is within
   `coolingOffSeconds` **± a declared tolerance** (two-sided: materially short and
   implausibly long are both rejected), the tolerance being a small fraction of the
   window; a large clock discrepancy MUST be reported, not silently accepted;
3. verify `validBefore == validAfter + maxTimeoutSeconds` (subject only to a documented
   base-scheme tolerance);
4. verify `0 < cancellationSafetySeconds <= 0.25 × coolingOffSeconds`, and that the
   remaining safe decision interval (`cancelBy` minus observed chain time) has not
   already elapsed;
5. verify the quote has not expired (`now <= quoteExpiresAt`);
6. verify nonce unused, balance sufficient at verification time, and
   signature/domain/amount/payee valid; and
7. verify the deployed asset's conformance profile (above).

An immediate settlement simulation is **expected** to revert `authorization is not yet
valid`; that revert MUST be classified as the window holding, never as failure. At the
later `/settle`, `validAfter` in the past is expected: the facilitator re-checks
signature, nonce, balance, `block.timestamp > validAfter` and `< validBefore` against
the persisted requirements, and MUST NOT reapply the initial future-window test to a
correctly matured payment.

## Coordinator and settlement

The resource server, not `/settle`, owns delayed execution: persist `preparing` →
register relays idempotently → commit outbox and flip to `pending` in one durability
boundary → only then 202 → a worker wakes from durable state. The worker MUST NOT rely
on a wall clock alone: it waits for an observed chain head with
`timestamp > validAfter`, then (1) compare-and-sets the record from a live state
(`pending` or `blocked`) to `settlement_submitted`, having confirmed no cancellation
was accepted; (2) re-reads `authorizationState` and balance; (3) broadcasts via the
synchronous `/settle`; (4) fulfils only after the advertised settlement finality.
At-least-once delivery is safe because the ledger nonce makes execution idempotent; the
worker MUST re-read record and nonce state immediately before broadcast. Restart
recovery scans every non-terminal record; a memory timer or a held-open request is not
conformant.

**Settle promptly, and make the delay observable.** The worker MUST broadcast at the
first observed eligible block. Its retry schedule MUST be bounded, MUST be declared in
the advertised `cooling-off` extension, and is in any case cut off at `validBefore` —
"retrying" is not a licence to choose a better price. The status record MUST expose the
interval between first eligibility and broadcast. `validBefore − validAfter` is
otherwise a free timing option written by the payer: the payer's window is bounded and
advertised, so the payee's must be too.

## Cancellation

The cancellation message is `CancelAuthorization(address authorizer, bytes32 nonce)`
under the token's own EIP-712 domain; the contract validates it against
`authorization.from` and the transaction sender may be anyone.

**Authority profiles.** *mistake-recovery*: transfer and cancellation signer are the
same EOA or agent wallet — protects against duplicates and cooperative mistakes, and
implementations MUST use that narrower language; a cancel button is not a human veto
over an agent that exclusively holds the key. *principal-protected*: the agent process
does not exclusively control the payer's root/recovery authority, and the principal has
a broadcast path independent of the merchant. Conforming wallet patterns: an external
policy signer (HSM/policy service with a separately authenticated human channel), or an
ERC-1271 smart account whose policy accepts an agent session key for transfers and an
independent owner/recovery signature for cancellation — the session key MUST NOT be
able to remove or block the recovery policy during the window. A separate `cancelAuthority` EOA
field is deliberately not defined: the token would reject it; separation is a wallet
custody property.

**Coordinator `cancelUrl`** (idempotent POST with `paymentId`, `authorizer`, `nonce`,
`signature`): load the previously verified record and compare every field; verify or
simulate the cancellation signature (ERC-1271 included) — simulation is admission, not
proof; compare-and-set the record from a live state (`pending` **or** `blocked` — the
payer whose balance is short is precisely the one who needs the capability dead) to
`cancel_requested` before acknowledging; stop the settlement job; broadcast or forward
to a registered relay; and report `canceled` only after `AuthorizationCanceled` meets
finality.

**Independent relays** are registered by the coordinator over an authenticated service
channel before the 202 (never disclosing the transfer signature — it is a bearer
capability); a failed registration means that relay MUST NOT be advertised for the
payment. A relay MUST bind requests to pre-registered records, verify fields and
signature, accept durably before returning `relay_accepted`, broadcast promptly, treat
the eventual event as the only proof, be idempotent, and MUST NOT pay gas for arbitrary
nonces — an open endpoint doing so is a gas-drain vector. A relay SHOULD send an
authenticated, idempotent cancellation notification to the coordinator (the
coordinator's mandatory pre-broadcast nonce re-read remains the fallback when it does
not arrive). Registration endpoints MUST be authenticated, quota-limited, and available
only to approved coordinators or an equivalent funded-client admission mechanism —
authentication alone still permits an open-signup registrar, which reopens the
subsidized-gas-drain vector. A relay MAY attempt a post-`cancelBy` cancellation but
MUST mark it `raceable: true`.

Outcome vocabulary: `202 cancel_requested` / `202 relay_accepted` (accepted, not yet
chain-final), `200 canceled` (finalized event), `400 invalid_cancellation_signature`,
`404 unknown_payment`, `409 already_settled` / `settlement_in_flight`,
`409 cancel_window_elapsed` (a relay's optional refusal of a late request — the
coordinator itself accepts late cancellations and reports them raceable),
`503 relay_unavailable`.

## Race and cutoff

The deployed checks are strict — `block.timestamp > validAfter`,
`block.timestamp < validBefore`, nonce unused — and cancellation checks the nonce and
signature but **not the clock**, so it stays callable after `validAfter` and races
settlement from that point. Client UI and APIs MUST distinguish: before `cancelBy`
(normal interval — the coordinator can still durably stop itself), from `cancelBy`
through settlement (best-effort, raceable), after settlement (impossible for this
nonce). The only cryptographic terminal fact is a finalized `AuthorizationCanceled`
before an `AuthorizationUsed`; `cancel_requested` MUST remain visibly pending until
then, and coordinators MUST read both events, since the boolean authorization state
does not distinguish them.

`transferWithAuthorization` is broadcastable by any payload holder, so leakage enlarges
the race surface; `receiveWithAuthorization` restricts the caller to `payTo` but makes
settlement payee-controlled and is not the stock x402 transfer path — implementations
MUST state which they use. No no-new-contract design can grant cancellation priority
once both actions are valid; deployments requiring that property want `auth-capture` or
escrow.

## Terminal outcomes

| State | Required evidence | x402 result |
| :-- | :-- | :-- |
| `settled` | expected transfer plus `AuthorizationUsed`, final | `success: true`, settlement hash |
| `canceled` | `AuthorizationCanceled`, final | `success: false`, `authorization_canceled`, cancellation hash |
| `failed` | an immutable defect in the payload itself | specific stable reason |
| `expired` | chain time past `validBefore` | `invalid_exact_evm_payload_authorization_valid_before` |

Insufficient balance is **not** on the list: the authorization stays executable by any
payload holder until `validBefore` regardless of today's balance, so the record is
`blocked` and stays under reconciliation — treating it as terminal is how a payer gets
charged for an order the merchant wrote off (see the flow document). The resource
server MUST NOT fulfil in any state except `settled`.

## The rejection this binding asks to be gated

The change requested of `/verify` is not hypothetical. Two live public facilitators
were sent two `exact`/`eip3009` payloads on Avalanche C-Chain — same wallet, same
amount, same payee, differing in the activation time and what follows from it
(`node grace/facilitator-probe.mjs`, 2026-08-23):

| `validAfter` | `facilitator.payai.network` | `x402.dexter.cash` |
| :-- | :-- | :-- |
| `now − 600` (what SDKs send today) | `isValid: true` | `isValid: true` |
| `now + 90` (what this flow needs) | `invalid_exact_evm_payload_authorization_valid_after` | same |

Both reject on the window alone, with the reference implementation's canonical
identifier (`ErrValidAfterInFuture`). Nothing was settled — `/verify` is read-only.

An independent re-run from an **unfunded** wallet
([#3182](https://github.com/x402-foundation/x402/issues/3182), 2026-08-23) established
what the funded run could not: both facilitators evaluate the window *before* the
balance — the unfunded control got past the window and failed on
`invalid_exact_evm_insufficient_balance`, while the cooling payload never got that far.
The refusal that carries this proposal reproduces with no funds at all; funding only
adds the control's acceptance.

This is the precise, and only, behaviour the binding asks to become flow-conditional:
unchanged for `exact`, gated when `paymentFlow` is `cooling-off`
(`ErrValidAfterInFuture` in the TS and Go reference facilitators).

## Evidence and limits

Reference implementation: <https://github.com/zjzJoez/grace-x402> — merchant, buying
agent, an `at(validAfter)` scheduler, and `prove.mjs`, 17 assertions of which 9 are
decided by the deployed XSGD contract on Avalanche C-Chain via `eth_call` (window gate,
strict boundary at `validAfter`, payee binding, relayed and forged cancellation,
burned-nonce replay, same-signature maturation), no keys, no gas. Mainnet transactions:
settlement after the window
([`0xf6ccdc44…`](https://snowtrace.io/tx/0xf6ccdc44fdc93ad3bc46242f41f9e636cad43c90e5202f2e89fee73525c593db)),
payer cancellation with balance untouched
([`0xd5bab3ab…`](https://snowtrace.io/tx/0xd5bab3abf1cf09e8ff67d94d85f0c6fabdee47aa4d16cf6196622863f7709cdd)),
third-party-relayed cancellation
([`0x75d6bba1…`](https://snowtrace.io/tx/0x75d6bba1055bef67e73bfa0235c79bfd84f46266d10c490fb08bbe025002bdb5)),
scheduler-fired settlement with no human involved
([`0x2addd508…`](https://snowtrace.io/tx/0x2addd508ef83d2efd9df0655c6f344fd205b1e8761501c4549830c3a7c772b50)).

These prove token mechanics, not the asynchronous protocol above: the demo predates the
coordinator requirements and self-settles via `receiveWithAuthorization`. Cancellation
is relayable, not guaranteed gasless — payer gaslessness is an operational property of
a named, funded relay.

## References

- [Flow document](cooling-off-payment-flow.md) · state machine, status mapping, guardrails
- [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)
- [`exact` on EVM](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)
- [Issue #3182](https://github.com/x402-foundation/x402/issues/3182) · discussion and independent reproductions

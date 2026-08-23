# Payment Flow: `cooling-off`

> Proposed addition to `x402-specification-v2.md` §6.1. Two EVM bindings, both with
> zero new contracts: [`cooling-off-flow-exact-eip3009.md`](cooling-off-flow-exact-eip3009.md)
> (gasless payer cancel, EIP-3009 tokens) and
> [`cooling-off-flow-exact-permit2.md`](cooling-off-flow-exact-permit2.md)
> (payer-gas cancel, any ERC-20 — the on-chain window check already ships in
> x402's own `x402ExactPermit2Proxy`).

## Summary

`cooling-off` is a durably deferred payment flow with a bounded pre-settlement
cancellation period:

```text
verify → persist contingent commitment → respond pending → settle → fulfil
```

The response before settlement is a **contingent commitment record**, not the paid
deliverable and not proof of payment. The underlying obligation MUST NOT begin until
settlement succeeds with the finality the network binding requires.

No funds are escrowed. The binding MUST provide both a ledger-enforced earliest
settlement time and a payer-authorized way to invalidate the outstanding authorization.
This flow adds no recourse after settlement.

## Applicability

For order acknowledgements, booking references, refundable inventory holds, work
orders — commitments that become effective only after settlement.

The flow MUST NOT protect instant digital delivery, an API result, content, a secret,
or any resource with standalone paid value: receiving such a resource and then
cancelling is free-riding. Delivery disputes and merchant non-performance remain out of
scope and are better served by `auth-capture` or escrow. The flow guarantees intent
finality only; it does not reserve payer funds, and a payer can spend the balance
before settlement.

## Protocol changes

The current flow model can express settlement before the handler (`upfront`, `escrow`)
or after the handler but before the response (`authorization`). It cannot express
response-before-settlement. This proposal adds `"cooling-off"` to `PaymentFlowName`
with the ordering:

```text
verify before handler · no settle around the handler · settle deferred after reply
```

Field names are implementation-specific; the semantics are not: the route returns only
after the pending record and durable work are committed, and the existing synchronous
facilitator `/settle` runs later in a worker. §6.1's invariant holds — a read-only
`/verify` runs before the resource executes.

**Roles.** The *resource server* advertises the flow, issues the commitment, and owns
the obligation not to fulfil early. The *coordinator* — part of the resource server or
a service it remains responsible for — durably owns pending state, cancellation
arbitration, scheduling, retries, and status. The *facilitator* keeps today's
synchronous `/verify` and `/settle`; it never sleeps, holds a request open, or owns a
timer. The *client* retains what it needs to query and, per its profile, cancel.

## Request processing

For a paid retry selecting `extra.paymentFlow == "cooling-off"`, the coordinator MUST:

1. call `/verify` and reject an invalid authorization;
2. durably create a unique record binding the payment to a digest of the order,
   registering any promised relay paths idempotently, with scheduled work committed in
   the same durability boundary (a transactional outbox suffices);
3. return HTTP `202 Accepted` with the commitment record, `Location: <statusUrl>`,
   `Retry-After`, and a non-terminal `PAYMENT-RESPONSE` — only after step 2 completes;
4. accept cancellation only through the binding's authenticated mechanism;
5. when due, atomically choose settlement only if cancellation has not been accepted,
   then call the unchanged synchronous `/settle`; and
6. mark the obligation fulfilable only after settlement finality.

Keeping the original request open until the timer fires is non-conformant: it creates
no durable recovery contract.

The persisted record MUST carry at least: the payment id and commitment digest, the
complete payload and requirements, the ledger identity `(network, asset, payer, nonce)`
— which MUST be unique; a duplicate paid request returns the existing record and MUST
NOT enqueue another settlement — the three timestamps (`validAfter`, `cancelBy`,
`validBefore`), state with a version for compare-and-set, retry attempts and the next
attempt time, observed transaction hashes with their observed block, and
created/updated timestamps. The signed payload is a bearer
settlement capability once valid: storage, logs, backups and queues MUST be
access-controlled, SHOULD be encrypted at rest, and `statusUrl` MUST NOT expose it.

## State machine

| State | Terminal | Meaning |
| :-- | :--: | :-- |
| `preparing` | No, internal | verified; durable registration incomplete; no 202 yet |
| `pending` | No | verified and durably scheduled |
| `blocked` | No | live, but settlement cannot proceed right now |
| `cancel_requested` | No | cancellation durably accepted; coordinator settlement disabled |
| `settlement_submitted` | No | settlement transaction submitted; not final |
| `settled` | Yes | settlement meets finality policy |
| `canceled` | Yes | cancellation meets finality policy |
| `failed` | Yes | the authorization is provably unexecutable |
| `expired` | Yes | the binding deadline passed without settlement |

**Terminal means the capability is dead.** A state is terminal only when the signed
capability can never execute again — a property of the authorization, not of the
coordinator's retry counter. `expired`, `canceled` and `settled` are reached by their
own evidence. `failed` covers only immutable defects: the payload does not decode or
its signature does not recover to the stated payer; the EIP-712 domain does not match
the deployed asset; or the ledger slot it needs is provably consumed but unattributable
(the Permit2 `nonce_unavailable` case — dead either way, terminal, but MUST NOT be
reported as `canceled`). A wrong-payee payload is not defective — it is someone else's
valid authorization — so it is refused at `/verify` and never becomes a record.

Everything recoverable is `blocked`: insufficient balance (the payer can top up),
missing or revoked approval (re-grantable), RPC or relay outages, an exhausted retry
budget. None of these kills the capability, and the capability is a **bearer** one —
under `transferWithAuthorization` anyone holding the payload can submit it, and the
Permit2 proxy is a public entrypoint. A coordinator that declares `failed` on
"insufficient funds" and disables fulfilment has stopped nothing: the funds can return,
the payment can land, and the payer is charged for goods nobody is shipping. So the
coordinator MUST keep reconciling `blocked` records against the ledger through
`validBefore`, MUST NOT release the payer while the capability remains executable, and
MUST NOT promise terminal failure it cannot enforce — abandoning an order early
requires a finalized cancellation or expiry.

**`pending` and `blocked` are the two live states**, differing only in whether the
coordinator currently has a reason to hold off; transitions between them are ordinary,
and a `blocked` record MUST be re-attempted while `validBefore` is ahead. The
transition into `cancel_requested` or `settlement_submitted` MUST be an atomic
compare-and-set **from the set of live states** — that single arbitration point is what
keeps settlement and cancellation mutually exclusive. Once cancellation is durably
accepted the coordinator MUST NOT initiate settlement; if a settlement transaction is
already in flight, the response MUST say the outcome is raceable rather than claim
cancellation. A payer MAY cancel a `blocked` record — the payer who cannot fund a
payment is precisely the one who needs the outstanding capability dead — and a binding
whose cancel endpoint accepts only `pending` is non-conformant.

**Recovery.** On startup and periodically the coordinator MUST scan non-terminal
records: finish or abandon `preparing` registrations idempotently; re-arm `pending`
jobs; re-test `blocked` and return it to `pending` when the condition clears; track
`cancel_requested` per relay policy; reconcile submitted hashes and ledger events,
handling dropped or reorganized transactions without fulfilling early; and expire what
cannot settle in time. Retries MUST be idempotent. Where a network exposes only a
boolean used/canceled state, the coordinator MUST inspect events to learn which
terminal outcome occurred.

## Pending response and status

```http
HTTP/1.1 202 Accepted
Location: https://merchant.example/x402/payments/pay_01J...
Retry-After: 3
PAYMENT-RESPONSE: <base64 SettlementResponse>
```

with a decoded `SettleResponse` of `success: false`, a **pre-broadcast non-terminal
reason** (written here as `deferred_until`), an empty `transaction`, and a
`cooling-off` extension carrying `state`, `paymentId`, `settleableAt`, `cancelBy`,
`expiresAt`, `statusUrl`, `cancelUrl`, and any `relayCancelUrls`.

This flow depends on the status vocabulary proposed in
[x402-foundation/x402#3208](https://github.com/x402-foundation/x402/issues/3208)
(as amended there: `settled` / post-broadcast `pending` / `deferred_until(T, basis)` /
`canceled(by)` / `expired`; this flow additionally needs `blocked`, which maps to none
of those five and belongs in that thread as a proposed sixth rather than smuggled into
`pending`). The dependency is real: `settlement_pending` MUST NOT be
reused for the pre-settlement response, because §5.3/§9 require a non-empty
`transaction` with it — #3083 defined it to mean "broadcast, confirmation unknown", and
a payment that has not been broadcast has no hash to name. Until a non-terminal reason
exists that does not imply a broadcast, this flow cannot answer truthfully — which is
why #3208 should land first. Whatever the code, a pending response MUST NOT use
`success: true` and MUST NOT invent a transaction hash.

Two anchor rules from that vocabulary are load-bearing here, and bindings MUST supply
them: `settled` carries the settlement timestamp, and `canceled` carries a **revocation
reference** so the state is re-derivable from the ledger. An anchor MUST actually prove
the state it is offered for: `AuthorizationCanceled` does (emitted only on successful
cancellation of an unused nonce); a bare Permit2 `UnorderedNonceInvalidation` does
**not** — see that binding — so a binding MUST define its anchors together with the
ordering evidence that makes them conclusive, and MUST report ambiguity rather than
assert `canceled`.

An unaware client is protected by verification, not selection: stock clients match on
scheme and network and MAY select this entry despite the unrecognized `paymentFlow`,
but such a client signs a backdated activation time, and the window check rejects it
deterministically with a clean `402`. The safety property comes from verify.

`GET statusUrl` MUST be safe, idempotent, and return the same `SettleResponse` as JSON
and in `PAYMENT-RESPONSE`:

| State | `success` | `errorReason` | `transaction` |
| :-- | :--: | :-- | :-- |
| `settled` | `true` | omitted | settlement hash |
| `cancel_requested` | `false` | non-terminal cancel-accepted reason | empty until the cancellation lands |
| `settlement_submitted` | `false` | post-broadcast `pending` reason | broadcast hash |
| `canceled` | `false` | `canceled_by_client` | cancellation hash |
| `failed` | `false` | specific stable reason | hash if one exists, else empty |
| `blocked` | `false` | stable reason, distinguishable from any terminal one | broadcast hash if one exists, else empty |
| `expired` | `false` | `authorization_expired` | empty |

Status and cancellation URLs MUST be unguessable or access-controlled, HTTPS, and
disclose no signature or sensitive order data.

## Cancellation paths

The pending response distinguishes the coordinator-owned `cancelUrl` — acceptance there
atomically moves the record to `cancel_requested` and stops the coordinator's own
settlement — from record-specific `relayCancelUrls` created from services advertised
before signing, which may be independently operated and cannot mutate the coordinator's
database. Acceptance at either is **not** ledger cancellation: `202 cancel_requested` /
`202 relay_accepted` until the binding's transaction meets finality, `200 canceled`
only after. Coordinator and relay endpoints MUST return distinguishable explicit outcomes for
invalid signature, unknown payment, already settled/canceled, late raceable requests,
and relay unavailability — a generic error collapses the payer's veto automation. Relays
MUST accept only payments bound to previously registered records, verify every field and
the cancellation signature, rate-limit by payment and payer, and be idempotent — an open
endpoint paying gas for arbitrary nonces is a gas-drain vector.
A broadcastable signature is *relayable*, not protocol-guaranteed gasless; a
merchant-controlled relay alone is not an independent cancellation path, because the
merchant can withhold it. Principal-protected clients submit to `cancelUrl` first and
retain an independent broadcast path.

## Clock and window integrity

The window is enforced against ledger time; the client signs with its own clock. Two
rules stop a skewed clock from silently shrinking the human's window: verification MUST
bound the signed activation time against the verifier's clock — rejecting a remaining
window materially shorter or implausibly longer than advertised, within a declared
tolerance, which SHOULD be a small fraction of the window (a flat allowance can consume
a material share of a short window, which defeats the advertisement) — and MUST report
a large discrepancy rather than accept a degraded window; and any user-facing countdown
MUST derive from the absolute signed activation time, never from the advertised window
length.

## Authority profiles and intent binding

Product and security claims MUST declare a profile. **mistake-recovery** protects
cooperative signer mistakes and duplicates; it makes no claim that a human can overrule
an adversarial agent holding the only payer key. **principal-protected** requires a
cancellation authority independent of the agent process and a broadcast path
independent of the merchant. The profile is a client-wallet custody property; a server
MUST NOT treat a self-declaration as proof.

The authorization signs payment fields, not the order. **digest-nonce** commits the
nonce to a canonical order digest — then canonicalization and salt-disclosure rules
MUST be normative in the binding and the nonce MUST include an unpredictable salt.
**signed-intent** adds a separately signed record a third party can verify without the
resource server; heavier, but this flow's audience is a claim someone will eventually
audit, and `principal-protected` deployments SHOULD use it.

## Resource-server requirements

A resource server offering this flow MUST: set `accepts[].extra.paymentFlow` to
`"cooling-off"`; advertise all binding timing parameters including the effective
decision interval; return only a contingent commitment before settlement; keep
fulfilment disabled until settlement finality; expose durable status and an
authenticated cancellation path; and retain enough audit data to reconcile its
application order with the ledger.

**The interval the human actually gets.** The usable window is `coolingOffSeconds −
cancellationSafetySeconds`, both the server's own parameters, so disclosure alone does
not prevent a 90-second advertisement hiding a one-second decision.
`cancellationSafetySeconds` MUST NOT exceed **25% of `coolingOffSeconds`** (bindings
enforce this at verification). Advertising both constituent parameters in the same
`PaymentRequired` the client signs against satisfies the advertisement requirement —
with the floor in place, their difference is an honest number — and any consumer-facing
claim MUST quote that effective number, not `coolingOffSeconds`.

**A quote expires, and a cancelled quote is dead.** `PaymentRequired` MUST carry an
absolute quote expiry (binding field `quoteExpiresAt`), and acceptance past it MUST be
refused — otherwise an unsigned quote is a free price option of arbitrary maturity,
since the client controls signing time. After `canceled`, `expired`, or `failed` the
server MUST issue a fresh quote and MUST NOT honour the old price: without this, the
window itself becomes a price option — worth a rounding error at 90 stablecoin seconds,
but scaling with the square root of the window. Servers SHOULD bound
`coolingOffSeconds` when the payment asset is not the unit of account of the price.

**Exposure and griefing.** Funds are unreserved, so verification proves ability to pay
*this* authorization only, and one unit price in a wallet can back unbounded
simultaneous commitments. A server SHOULD cap a payer's outstanding commitments at the
balance it verified — evaluated at admission; a record later moving to `blocked` does
not retroactively breach it, and the cap binds only within this server's view, since
the same balance can back commitments elsewhere. The enforceable defences are
unconditional: a server MUST NOT reserve scarce or non-fungible capacity for a
`cooling-off` commitment without separate non-refundable consideration, MUST rate-limit
commit/cancel cycles keyed on payer **and** contended resource (an address costs one
funding transfer to replace), and MUST NOT describe a reversible hold as fulfilment.

## Security considerations

- **Race.** A cancellation request is not a cancellation. A binding MUST define a
  safety cutoff and finality rule, and clients MUST label post-cutoff requests
  best-effort; ledger order decides once both actions are valid. No no-new-contract
  design grants cancellation priority — deployments needing that property want
  `auth-capture` or escrow.
- **Settlement timing.** The payee's discretion is bounded too: bindings require prompt
  settlement at eligibility with the delay observable, because an unbounded settlement
  window is a free timing option written by the payer.
- **Coordinator failure.** A 202 creates a server obligation with no settled payment
  behind it, so atomic persistence, restart recovery, reconciliation, idempotency and
  bounded retry are normative, not advice.
- **Merchant withholding.** The coordinator's no-settle-after-cancel promise is local;
  principal protection requires an independent broadcast path.
- **Solvency and delivery.** The payer can cancel or spend the funds — escrow is the
  tool when guaranteed funds are needed. Settlement does not prove delivery; this
  proposal deliberately does not solve the recourse problem discussed in #1169.

## Relationship to other flows

| | `authorization` | `upfront` | `escrow` | `cooling-off` |
| :-- | :-- | :-- | :-- | :-- |
| Response before final settlement | No | No | between escrow and capture | **Yes, explicitly pending** |
| Funds during window | payer wallet | settled | escrow | **payer wallet** |
| Pre-settlement payer invalidation | No | No | operator/arbiter rules | **binding-defined, unilateral** |
| Post-settlement recourse | No | No | Yes | **No** |
| Pre-settlement resource | paid resource | paid resource | paid resource | **contingent commitment only** |

Batch settlement is precedent for representing a commitment before later settlement,
but its commitments are capital-backed; a revocable authorization MUST remain visibly
pending and MUST NOT be represented as final.

## References

- [x402 specification v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [`auth-capture` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md)
- [batch-settlement scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md)
- [Issue #3208](https://github.com/x402-foundation/x402/issues/3208) · status vocabulary this flow depends on
- [Issue #1169](https://github.com/x402-foundation/x402/issues/1169) · the free-riding vector this flow inverts

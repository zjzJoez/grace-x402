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
settlement succeeds with the finality required by the network binding.

No funds are escrowed. The binding MUST provide both a ledger-enforced earliest
settlement time and a payer-authorized way to invalidate the outstanding authorization.
This flow adds no recourse after settlement.

## Applicability

Appropriate examples include an order acknowledgement, booking reference, refundable
inventory hold, or work order that becomes effective only after settlement.

The flow MUST NOT protect instant digital delivery, an API result, content, a secret, or
any resource with standalone paid value. Allowing a client to receive such a resource
and then cancel is free-riding. Delivery disputes and merchant non-performance remain
out of scope and are better served by `auth-capture` or escrow.

The flow guarantees intent finality only within its stated trust and timing profile. It
does not reserve payer funds; a payer can spend the balance before settlement.

## Protocol changes

### Core payment-flow lifecycle

The current core flow model can express settlement before the resource handler or after
the handler but before the HTTP response. It cannot express response-before-settlement.
This proposal therefore requires:

- `"cooling-off"` in `PaymentFlowName`; and
- a deferred-settlement phase or equivalent hook with this configuration:

```text
verifyBeforeHandler       = true
settleBeforeHandler       = false
settleAfterHandler        = false
settleDeferredAfterReply  = true
```

The exact field name is implementation-specific. Its required semantics are not: the
route returns only after the pending record and durable work are committed, while the
existing synchronous facilitator `/settle` call runs later in a worker.

### Roles

- **resource server** advertises the flow, creates the contingent commitment, and owns
  the obligation not to fulfil early;
- **coordinator** durably owns pending state, cancellation arbitration, scheduling,
  retries, and status. It is part of the resource server or an explicitly delegated
  service for which the resource server remains responsible;
- **facilitator** keeps the existing synchronous `/verify` and `/settle` semantics. It
  does not sleep, retain an open HTTP request, or implicitly own a timer;
- **client** retains the information and authority required to query and, where its
  conformance profile permits, cancel.

## Request processing

For a paid retry selecting `extra.paymentFlow == "cooling-off"`, the coordinator MUST:

1. call `/verify` and reject an invalid authorization;
2. construct the commitment record and bind it to a digest of the order and payment;
3. durably create a unique internal `preparing` record;
4. idempotently register any promised independent relay paths;
5. in one final durability boundary, store relay tickets, scheduled work (a
   transactional outbox is sufficient), and transition `preparing` to `pending`;
6. return HTTP `202 Accepted` with the commitment record, `Location: <statusUrl>`,
   `Retry-After`, and a non-terminal `PAYMENT-RESPONSE`;
7. accept cancellation only through the binding's authenticated mechanism;
8. when due, atomically choose settlement only if cancellation has not been accepted,
   then call the unchanged synchronous `/settle`; and
9. mark the obligation fulfilable only after settlement confirmation/finality.

Returning 202 before step 5 completes is non-conformant. Keeping the original request
open until the timer fires is also non-conformant because it gives no durable recovery
contract and defeats the purpose of the asynchronous flow.

## Durable record and idempotency

Before acknowledging a payment, the coordinator MUST persist at least:

| Data | Purpose |
| :-- | :-- |
| `paymentId` and order/commitment digest | stable status identity and application binding |
| complete `PaymentPayload` and requirements | later synchronous settlement and audit |
| network, asset, payer, nonce | unique ledger identity |
| `validAfter`, `cancelBy`, `validBefore` | scheduling and race policy |
| state, version, attempts, next attempt | compare-and-set transitions and retries |
| settlement/cancellation tx hashes and observed block | chain reconciliation |
| created/updated timestamps | recovery and audit |

`(network, asset, payer, nonce)` MUST be unique. A duplicate paid request returns the
existing record; it MUST NOT enqueue another settlement.

The complete signed payment payload becomes a bearer settlement capability when it is
valid. Storage, logs, backups, and queues MUST therefore be access-controlled and SHOULD
encrypt it at rest. The payload MUST NOT be exposed by `statusUrl`.

## State machine and recovery

The minimum state machine is:

| State | Terminal | Meaning |
| :-- | :--: | :-- |
| `preparing` | No, internal | verified record exists; relay/job acceptance is incomplete and no 202 has been returned |
| `pending` | No | verified and durably scheduled |
| `cancel_requested` | No | valid cancellation durably accepted; coordinator settlement disabled |
| `settlement_submitted` | No | settlement transaction submitted; outcome not final |
| `settled` | Yes | settlement event/receipt meets finality policy |
| `canceled` | Yes | cancellation event meets finality policy |
| `failed` | Yes | deterministic failure or exhausted retry policy |
| `expired` | Yes | settlement did not succeed before the binding deadline |

The transition from `pending` to either `cancel_requested` or
`settlement_submitted` MUST use an atomic compare-and-set. Once cancellation is durably
accepted, the coordinator MUST NOT initiate settlement for that record. If a settlement
transaction is already in flight, the response MUST say the outcome is raceable rather
than claim cancellation.

On startup and periodically, the coordinator MUST scan non-terminal records:

- finish or safely abandon `preparing` records using idempotent relay registration;
- re-arm `pending` records whose job is absent;
- rebroadcast or continue tracking `cancel_requested` according to relay policy;
- reconcile receipts and ledger events for submitted transactions;
- handle a dropped/replaced/reorganized transaction without fulfilling early; and
- expire records that cannot settle inside the binding deadline.

Retries MUST be idempotent. Transient RPC, fee, or mempool errors MAY be retried; a
deterministic invalid signature, used/canceled nonce, insufficient balance, or expired
authorization is reconciled to a terminal result. If a network exposes only a boolean
used/canceled state, the coordinator MUST inspect the corresponding events to determine
which terminal outcome occurred.

## Pending and status transport

Current HTTP transport documents only settled success (`200`) and failure (`402`). This
flow adds a recognized non-terminal mapping:

```http
HTTP/1.1 202 Accepted
Location: https://merchant.example/x402/payments/pay_01J...
Retry-After: 3
PAYMENT-RESPONSE: <base64 SettlementResponse>
```

The decoded `SettleResponse` is:

```json
{
  "success": false,
  "errorReason": "settlement_pending",
  "transaction": "",
  "network": "eip155:43114",
  "payer": "0x855A...F424",
  "extensions": {
    "cooling-off": {
      "info": {
        "state": "pending",
        "paymentId": "pay_01J...",
        "settleableAt": 1786822425,
        "cancelBy": 1786822410,
        "expiresAt": 1786826025,
        "statusUrl": "https://merchant.example/x402/payments/pay_01J...",
        "cancelUrl": "https://merchant.example/x402/payments/pay_01J.../cancel",
        "relayCancelUrls": ["https://relay.example/x402/cancel/rt_01J..."]
      },
      "schema": {
        "type": "object",
        "required": ["state", "paymentId", "statusUrl"]
      }
    }
  }
}
```

[x402-foundation/x402#3208](https://github.com/x402-foundation/x402/issues/3208) proposes
the transport-neutral vocabulary this flow actually wants — `settled` / `pending` /
`deferred_until(T)` / `canceled(by)` — as an additive evolution of `SettleResponse`.
Two properties of that vocabulary matter to this flow specifically, and bindings MUST
supply them: `settled` carries the settlement timestamp, and `canceled` carries a
**revocation reference** so the terminal state is re-derivable from the ledger rather
than taken on the facilitator's word — the `AuthorizationCanceled` transaction under the
EIP-3009 binding, the `UnorderedNonceInvalidation` event under the Permit2 binding.
Until #3208 lands, this flow maps onto today's fields as follows.

For a recognized flow, `settlement_pending` is non-terminal; `success: false` truthfully
states that settlement has not succeeded. A pending response MUST NOT use `success:
true` or invent a transaction hash.

An unaware client is protected by verification, not by selection behaviour. Stock
clients typically match an `accepts[]` entry on scheme and network and MAY select this
one despite the unrecognized `paymentFlow`; such a client signs an immediate,
backdated activation time, and the verification rule above — the remaining delay MUST
fall within the advertised window — rejects it deterministically with a clean `402`
rather than admitting a payment with no cooling-off period. The safety property comes
from verify.

`GET statusUrl` MUST be safe, idempotent, and return the same `SettleResponse` as JSON
and in `PAYMENT-RESPONSE`. Terminal mappings are:

| State | `success` | `errorReason` | `transaction` |
| :-- | :--: | :-- | :-- |
| `settled` | `true` | omitted | settlement hash |
| `canceled` | `false` | `canceled_by_client` | cancellation hash |
| `failed` | `false` | specific stable reason | hash if one exists, otherwise empty |
| `expired` | `false` | `authorization_expired` | empty |

Status and cancellation URLs MUST be unguessable or separately access-controlled, use
HTTPS, and disclose no signature or sensitive order data.

## Cancellation discovery and relay contract

`PaymentRequired.extensions["cooling-off"].info` advertises client capabilities before
signing:

```json
{
  "cancelRelayUrls": ["https://relay.example/x402/cancel"],
  "statusProtocol": "poll-v1"
}
```

The extension is echoed in `PaymentPayload` under normal x402 extension rules. The
pending response supplies two distinct kinds of endpoint:

- `cancelUrl` is coordinator-owned. Acceptance there atomically changes the coordinator
  record to `cancel_requested` and stops its own settlement job; and
- `relayCancelUrls` are record-specific broadcast endpoints created from the advertised
  relay services. They MAY be independently operated and cannot atomically mutate the
  coordinator database.

Coordinator or relay acceptance is not ledger cancellation. The coordinator returns
`202 cancel_requested`; an independent relay returns `202 relay_accepted`. They return
`200 canceled` only after the binding's transaction meets finality. Both MUST return
explicit outcomes for invalid signature, unknown payment,
already settled/canceled, late raceable requests, and relay unavailability.

Relay operators MUST accept only a payment they can bind to a previously verified
record, verify all record fields and the cancellation signature, rate-limit by payment
and payer, and make duplicate requests idempotent. An open endpoint that pays gas for an
arbitrary nonce is non-conformant and exposes a gas-drain vector.

A principal-protected client SHOULD submit first to `cancelUrl` to stop an honest
coordinator and also retain or use an independent broadcast path. If the coordinator is
unavailable or suppresses the request, the independent path still competes on chain,
subject to the binding's safety cutoff.

A broadcastable signature is **relayable**, not protocol-guaranteed gasless. Payer
gaslessness is an operational property of a named relay. Direct self-broadcast remains a
valid fallback. A merchant relay alone is not an independent cancellation path because
the merchant can withhold it.

## Clock and window integrity

The window is enforced against ledger time, while the client signs with its own clock.
Two rules keep a skewed clock from silently shrinking or erasing the human's window:

- The resource server (or facilitator) MUST bound the signed activation time against its
  own clock at verification — reject when the remaining window is materially shorter or
  implausibly longer than advertised — and MUST report a large discrepancy rather than
  accept a degraded window. Bindings state concrete tolerances.
- Any user-facing countdown MUST be derived from the absolute signed activation time
  (as the ledger will enforce it), never from the advertised window length.

## Authority profiles

SDKs and product/security claims MUST declare one of these profiles:

- **mistake-recovery** protects cooperative signer mistakes and duplicate actions. It
  makes no claim that a human can overrule an adversarial agent holding the only payer
  key.
- **principal-protected** requires a human/recovery cancellation path independent of
  the agent process and a broadcast path independent of the merchant. The binding
  specifies how the payer address validates multiple wallet authorities.

The profile is a client-wallet security property, not a claim a resource server can
verify from an EOA address. A client MAY self-declare it in the echoed extension for
telemetry or policy, but a server MUST NOT treat that declaration as proof.

## Intent binding

The payment authorization signs payment fields, not the application order. Two profiles:

- **digest-nonce** (lightweight): the authorization nonce commits to a canonical order
  digest. When used, the canonicalization rules and salt-disclosure procedure MUST be
  normative in the binding, and the nonce MUST include an unpredictable salt — otherwise
  the commitment is invisible to any third party and leaks order linkage.
- **signed-intent** (checkable): the client additionally signs a self-describing intent
  record that a facilitator or auditor can verify without the resource server's
  cooperation. Heavier, but this flow's audience is precisely the claim — "my agent
  bought something I didn't want" — that someone will eventually need to audit.
  Deployments making `principal-protected` claims SHOULD use it.

## Resource-server requirements

A resource server offering this flow:

- MUST set `accepts[].extra.paymentFlow` to `"cooling-off"`;
- MUST advertise all binding timing parameters;
- MUST return only a contingent commitment before settlement;
- MUST keep fulfilment disabled until terminal settlement finality;
- MUST expose durable status and an authenticated cancellation path; and
- MUST retain enough audit data to reconcile its application order with the ledger.

It MAY reserve reversible capacity during the window, but SHOULD rate-limit repeated
commit/cancel griefing and MUST NOT describe a reversible hold as fulfilment.

## Security considerations

**Late cancellation and race.** A cancellation request is not a cancellation. The
binding MUST define a safety cutoff and finality rule, and clients MUST label later
requests best-effort. Ledger order decides once cancellation and settlement are both
valid or already submitted.

**Coordinator failure.** A process timer is insufficient. Atomic persistence, restart
recovery, chain reconciliation, idempotency, and bounded retry are normative because a
202 response creates a server obligation even though no payment has settled.

**Merchant withholding.** The coordinator promises not to settle after accepting a
valid cancellation, but a merchant-controlled relay cannot prove cancellation liveness.
The principal-protected profile therefore needs direct or independent relay access.

**Griefing and solvency.** The payer can cancel or spend the funds, consuming reversible
server capacity. Rate limits and low-cost holds are expected; escrow is required when
the server needs guaranteed funds.

**Delivery risk.** Settlement does not prove delivery. This proposal deliberately does
not solve the buyer-protection problem discussed in issue #1169.

## Relationship to other flows

| | `authorization` | `upfront` | `escrow` | `cooling-off` |
| :-- | :-- | :-- | :-- | :-- |
| Response before final settlement | No | No | Between escrow and capture | **Yes, explicitly pending** |
| Funds during window | payer wallet | settled | escrow | **payer wallet** |
| Pre-settlement payer invalidation | No | No | operator/arbiter rules | **binding-defined** |
| Post-settlement recourse | No | No | Yes | **No** |
| Pre-settlement resource | paid resource | paid resource | paid resource | **contingent commitment only** |

Batch settlement is precedent for representing a commitment before later financial
settlement, but its commitment and trust model differ. A revocable authorization MUST
remain visibly pending and MUST NOT be represented as capital-backed or final.

## References

- [x402 specification v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [batch-settlement scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md)
- [`auth-capture` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md)
- [Issue #1169](https://github.com/x402-foundation/x402/issues/1169)

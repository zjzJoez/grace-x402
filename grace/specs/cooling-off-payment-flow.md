# Payment Flow: `cooling-off`

> Proposed addition to `x402-specification-v2.md` §6.1 (Asset Transfer Methods and
> Payment Flow Models). Network binding for `exact` / `eip3009`:
> [`cooling-off-flow-exact-eip3009.md`](cooling-off-flow-exact-eip3009.md).

## Summary

`cooling-off` is a payment flow in which settlement is deliberately delayed by a
**client-cancellable window**. The client's authorization is signed and delivered
normally, but it does not become settleable until a declared moment; until then the
underlying ledger primitive refuses settlement, and the client MAY withdraw the payment
unilaterally.

| Flow | Ordering |
| :-- | :-- |
| `cooling-off` | verify → resource → respond → *(cancellable window)* → settle |

The flow differs from `authorization` in one respect: the response to the client is
returned **before** settlement rather than after, because settlement is scheduled for a
future instant rather than attempted immediately. It satisfies §6.1's invariant — a
read-only `/verify` runs before the resource executes.

Nothing is escrowed and no custodian holds funds during the window. Where the network
binding supports it (EIP-3009 does), the window is enforced by the token contract itself
and withdrawal is a signature the client can have relayed at no gas cost.

## Motivation

x402 today has two positions on client recourse:

- `authorization` with `exact` — no recourse. Settlement is immediate and final.
- `escrow` with `auth-capture` — recourse purchased with custody: funds enter an escrow
  contract, and void/refund/capture belong to the captureAuthorizer or an arbiter.

Agent-initiated commerce produces a third case that neither serves well: the payment was
authorized by software acting for a human, and the human's objection is not *"the goods
were unsatisfactory"* but *"I never wanted this"* — a misread instruction, a repeated
checkout, a prompt injection. Arbitration is the wrong instrument for that dispute,
because there is nothing to arbitrate; the principal simply needs an opportunity to
decline before value moves.

`cooling-off` provides that opportunity as a property of the flow rather than as a service
someone operates.

## Applicability

`cooling-off` MUST NOT be used where the protected resource is itself the thing of value
(instant digital delivery, API responses, content). Those resources are the domain of
`authorization` and `upfront`.

`cooling-off` is applicable when the protected resource is a **commitment record** — an
order acknowledgement, a booking reference, a work order — whose value to the client is
contingent on the payment settling. Fulfilment of the underlying obligation happens
after settlement and outside the protocol.

This constraint is what makes the flow safe rather than exploitable; see
[Security Considerations](#security-considerations).

## Requirements

A resource server offering `cooling-off`:

- MUST set `accepts[].extra.paymentFlow` to `"cooling-off"`. §6.1 already requires the key
  to be present for any flow other than `authorization`.
- MUST declare the window length in the binding's `extra` (for `exact` / `eip3009`:
  `coolingOffSeconds`), per resource.
- MUST NOT deliver, begin, or irreversibly reserve the underlying obligation before
  settlement succeeds. Returning the commitment record is permitted and is the resource.
- SHOULD return, in its response, the instant settlement becomes possible and a
  reference by which the client can observe or withdraw the payment.

A facilitator supporting `cooling-off`:

- MUST verify that the authorization becomes settleable at the declared moment rather
  than immediately, and MUST NOT treat "not settleable yet" as a verification failure.
- MUST NOT attempt settlement before that moment, and MUST attempt it promptly once
  reached.
- MUST report a client withdrawal as a distinct terminal outcome, not as a settlement
  error.

A client:

- MAY withdraw the payment at any time before settlement, by the mechanism the binding
  defines.
- MUST NOT assume the obligation is being fulfilled before settlement.

## Relationship to Other Flows

| | `authorization` | `upfront` | `escrow` | `cooling-off` |
| :-- | :-- | :-- | :-- | :-- |
| Ordering | verify → resource → settle → respond | settle → resource → respond | settle → resource → settle → respond | verify → resource → respond → settle |
| Funds before settlement | in client's wallet | committed first | in escrow | **in client's wallet** |
| Client may withdraw after authorizing | No | No | Via operator/arbiter, or reclaim after deadline | **Yes, unilaterally** |
| Recourse after settlement | None | None | Refund window | None |
| Resource may be the deliverable | Yes | Yes | Yes | **No — commitment only** |

`cooling-off` and `escrow` are complements, not competitors. `escrow` guarantees the funds
will be there and provides recourse after delivery, at the cost of custody, a deployed
contract, and a trusted operator. `cooling-off` guarantees only that a settled payment is
one the principal did not veto, and provides nothing after settlement — but requires no
custody, no contract, and no trusted party. A resource server MAY offer both in
`accepts[]` and let the client choose.

## Security Considerations

**Free-riding.** [#1169](https://github.com/x402-foundation/x402/issues/1169) documents
a client cancelling an authorization after receiving a resource, leaving the facilitator
unable to collect. `cooling-off` deliberately grants that same capability, and is safe only
because of the applicability constraint above: the resource in this flow is a commitment
record with no standalone value, and the obligation it commits to is not begun until
settlement. A client who withdraws obtains nothing. Facilitators MAY decline to serve
`cooling-off` to resource servers they believe deliver value pre-settlement; this is not
detectable from the payload.

**Risk inversion.** #1169's thread notes that settling before delivery moves risk onto
the client. `cooling-off` is the milder form of that trade: the client's funds are not
committed during the window either, so the client's exposure begins only at settlement —
and the client, not the server, chooses when to stop objecting.

**Solvency.** The flow guarantees intent, not funds. Because the money remains with the
client, the client MAY spend it during the window, in which case settlement fails. The
resource server's loss is a cancelled commitment, never a delivered obligation.

**Withdrawal availability.** The value of the window depends on the principal being able
to act within it. Resource servers SHOULD surface a human-reachable confirmation
reference; bindings SHOULD prefer withdrawal mechanisms that do not require the client
to hold native gas.

**Griefing.** A client, or a compromised agent, MAY commit and withdraw repeatedly,
consuming resource-server capacity such as inventory holds. The flow provides no defence;
resource servers SHOULD rate-limit and SHOULD avoid irreversible reservations before
settlement.

**Window integrity.** Where the window is enforced by a ledger primitive, it is only as
precise as that ledger's clock. Bindings MUST specify the tolerance a facilitator applies
and SHOULD NOT permit windows shorter than the network's block-time variance.

**Late settlement.** If a facilitator settles later than the declared moment, the client's
ability to withdraw persists for as long as the payment is unsettled. This degrades in
the client's favour and never the server's; bindings MUST state whether withdrawal is
gated on the clock or on the payment being unspent.

## Network Bindings

A network can support `cooling-off` if its payment primitive can express "not settleable
before time T" and offers the client a way to invalidate an outstanding authorization.

- **EVM, `exact` / `eip3009`** — [`cooling-off-flow-exact-eip3009.md`](cooling-off-flow-exact-eip3009.md).
  EIP-3009 supplies both: `validAfter` for the window and `cancelAuthorization` for a
  gasless client withdrawal. Already deployed on USDC, XSGD and other FiatToken assets;
  no new contract required.
- Other networks are out of scope for this proposal. A binding MUST NOT be claimed for a
  network whose primitive lacks a client-invalidation path, since the window would then
  be a delay without a veto.

### References

- [x402 specification v2 §6.1](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) — payment flow models this extends
- [`auth-capture` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md) — the custody-based answer to client recourse
- [Issue #1169](https://github.com/x402-foundation/x402/issues/1169) — pre-settlement client cancellation as a free-riding vector, and the risk-inversion objection
- [PR #1133](https://github.com/x402-foundation/x402/pull/1133) — `subscribe`, prior use of future-dated `validAfter` within x402
- [Issue #3085](https://github.com/x402-foundation/x402/issues/3085) — settlement timing is not currently expressible in `SettlementResponse`

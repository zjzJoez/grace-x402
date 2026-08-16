# Scheme: `exact-deferred`

## Summary

`exact-deferred` is `exact` with a client-controlled cancellation window in front of it.

The client signs an authorization for an exact amount whose validity *starts in the
future*: `validAfter = now + coolingOffSeconds`. Until that moment the token contract
itself refuses settlement, so the server holds a signed, amount-locked, payer-bound
claim that nobody — server, facilitator, or third party — can cash yet. During the
window the client may withdraw the payment unilaterally by cancelling the
authorization; the cancellation is a signed message that any relayer can broadcast, so
a client wallet with no native gas can still exercise it.

Nothing is escrowed, nothing is custodied, and no new contract is deployed. The funds
never leave the client's wallet, which is what makes withdrawal free: there is nothing
to return, because nothing moved. Once the window closes and settlement lands, the
payment is as final as `exact` — there is no post-settlement refund path in this scheme.

`coolingOffSeconds: 0` is exactly today's `exact` behaviour, so the scheme is a strict
superset and a server can adopt it per-resource without changing anything else.

## Example Use Cases

- **Agent purchases a human may not have intended.** An autonomous agent misreads an
  instruction, fires a checkout twice, or is prompt-injected into buying something. The
  window is the human's chance to say no — before any value moves, without a dispute
  process, and without the server carrying the risk.
- **Deposits and reservations.** Booking fees, no-show deposits, appointment holds:
  payments where the money *is* the product, so there is no delivery quality to dispute,
  only intent to confirm.
- **Deferred-fulfilment goods and services from long-tail sellers.** Made-to-order and
  ship-later commerce outside a marketplace, where no platform exists to arbitrate and
  neither party wants to trust an escrow operator or an arbiter.
- **High-value agent-to-agent tasks with a human sponsor.** A signed commitment that a
  human principal can veto for a bounded time before the counterparty begins work.

## Settlement Path

```
402 CHALLENGE → CLIENT SIGNS (validAfter = now + coolingOffSeconds)
              → COOLING-OFF WINDOW  ── client may cancel ──▶ TERMINAL: cancelled
              → SETTLE at validAfter
              → RESOURCE DELIVERED
```

1. **Challenge.** The server advertises `scheme: "exact-deferred"` and a per-resource
   `extra.coolingOffSeconds`.
2. **Sign.** The client signs an authorization whose validity begins at
   `validAfter = signing time + coolingOffSeconds` and ends at
   `validBefore = validAfter + maxTimeoutSeconds`.
3. **Window.** The chain rejects settlement attempts before `validAfter`. The client may
   cancel the authorization; a cancelled authorization can never be settled by anyone.
4. **Settle.** At `validAfter` the facilitator (or the payee, depending on the transfer
   method) submits the authorization. Settlement is final.
5. **Deliver.** The server delivers the resource **after** settlement succeeds.

Step 5 is a requirement of this scheme, not a deployment preference — see
[Ordering Requirement](#ordering-requirement-settle-before-deliver).

## Core Properties

### Fund Safety

- The amount, the recipient, and the payer are fixed by the client's signature; no party
  can alter them.
- Funds remain in the client's wallet for the whole window. A server that never settles,
  a facilitator that disappears, and a cancelled payment all leave the client's balance
  untouched.
- The server's exposure is a lost sale, never a lost good, because delivery follows
  settlement.

### Cancellation Authority

- Only the payer can cancel: the cancellation is authenticated by the payer's signature
  over the authorization nonce.
- Cancellation is a meta-transaction — anyone may broadcast it — so a wallet holding
  zero native gas retains a working veto.
- Cancellation is unilateral and needs no arbiter, operator, or server cooperation.
  Nobody can be bribed to deny it because nobody holds the power to grant it.
- Cancellation is terminal: the nonce is consumed, and settlement of that authorization
  reverts permanently.

### Replay Prevention

- Each authorization carries a unique nonce that the token contract consumes on first
  use, so an authorization settles at most once.
- Servers SHOULD derive the nonce deterministically from the canonical order
  (`keccak256` of the order's canonical serialisation), which makes every on-chain
  settlement and cancellation event a self-describing commitment to what was bought.
  Servers that do this MUST include enough entropy (an order id or salt) to keep two
  identical carts from colliding.

### Expiry Enforcement

Two absolute timestamps govern the lifecycle, both signed by the client:

- **`validAfter`** — settlement is impossible before this moment. This is the
  cooling-off window's closing time.
- **`validBefore`** — the authorization lapses on its own. An unsettled authorization
  self-destructs rather than lingering as a claim on the client's wallet.

### Settlement Atomicity

Settlement is a single token-contract call that either consumes the nonce and moves the
exact amount, or reverts. There is no intermediate state in which funds are held by a
third party, and therefore no state that requires anyone's cooperation to unwind.

## Ordering Requirement: Settle Before Deliver

A server implementing `exact-deferred` **MUST NOT** deliver the resource before
settlement succeeds.

This scheme deliberately gives the client a power that x402 elsewhere treats as an
attack: cancelling an authorization the server is relying on
([#1169](https://github.com/x402-foundation/x402/issues/1169) documents exactly this as
a free-riding vector in settle-after-deliver flows). The inversion is safe only because
the ordering is inverted with it. Deliver-then-settle plus a client cancellation window
is free-riding by construction; settle-then-deliver plus the same window is buyer
protection with zero server downside.

Consequently `exact-deferred` is **not** suitable for instant digital delivery, which is
`exact`'s domain. Servers for such resources set `coolingOffSeconds: 0` (degrading to
`exact`) or advertise `exact` directly.

## Scope and Non-Goals

- **Intent finality, not solvency.** The scheme guarantees that a settled payment is one
  the payer did not veto. It does not guarantee the payer's balance will still cover it
  at `validAfter`; a client can spend the funds during the window. The server's flow
  makes that a failed sale, not a loss.
- **No post-settlement recourse.** Delivery disputes, quality claims, and non-delivery
  are out of scope. Servers needing recourse *after* value moves want
  [`auth-capture`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md), which is a different and
  complementary trade: it takes custody in exchange for that power.
- **Not a marketplace substitute.** Where a platform already arbitrates, the platform is
  the buyer protection; this scheme is for exchanges that have no such layer.

## Relationship to `exact` and `auth-capture`

| Aspect | `exact` | `exact-deferred` | `auth-capture` |
| :-- | :-- | :-- | :-- |
| Funds during window | n/a — immediate | **stay in client's wallet** | held in escrow contract |
| New contract required | No | **No** | Yes (escrow) |
| Client can withdraw | No | **Yes, unilaterally, gasless** | Only via operator/arbiter, or reclaim after deadline |
| Server/operator can withdraw | n/a | No | Yes (void / refund) |
| Recourse after settlement | None | None | Refund window |
| Settlement finality | Immediate | At `validAfter`, then final | On capture |
| Delivery ordering | Either | **Settle → deliver (required)** | Deliver → capture |
| Guarantees payer solvency | n/a | No | Yes, once escrowed |
| Trust surface | Token contract | **Token contract** | Token + escrow contract + operator + arbiter |

`exact-deferred` and `auth-capture` answer the same question — "what recourse does an
agent's principal have?" — at opposite ends of a trade-off. `auth-capture` buys
post-delivery recourse and payer-solvency assurance with custody, a deployed contract,
and a trusted operator. `exact-deferred` buys a pre-settlement veto with none of those,
and pays for it by covering a narrower window. A server can offer both, per resource.

## Security Considerations

- **Free-riding (the #1169 inversion).** Addressed by the mandatory settle-before-deliver
  ordering above. A facilitator MAY refuse to serve `exact-deferred` to servers it
  believes deliver first; it cannot detect this from the payload alone.
- **Cancellation availability.** The veto's value depends on the payer being able to get
  a cancellation broadcast during the window. Wallets and agent frameworks SHOULD expose
  a cancellation affordance, and servers SHOULD publish a client-facing confirmation URL
  in the payment response so the human principal can act without tooling.
- **Cancellation window extends until settlement, not until `validAfter`.** Cancellation
  is gated on the authorization being unused, not on the clock. If a server settles late,
  the payer's veto simply persists — an availability failure degrades toward the client's
  favour, never the reverse. Servers wanting a crisp window MUST settle promptly at
  `validAfter`.
- **Last-moment race.** A cancellation broadcast in the same block window as settlement
  resolves atomically on-chain: whichever consumes the nonce first wins, with no partial
  state. Servers SHOULD treat "cancelled" as a normal terminal outcome rather than an
  error, and SHOULD prefer networks whose finality is short relative to the window.
- **Cancellation griefing.** A client (or a compromised agent) can repeatedly commit and
  cancel, consuming server resources such as inventory holds. This scheme provides no
  defence; servers SHOULD apply rate limits or reputation at the application layer, and
  SHOULD avoid irreversible reservations before settlement.
- **Clock skew.** `validAfter` is enforced against block timestamps. Facilitators MUST
  allow tolerance when checking that a client honoured the requested window, and servers
  SHOULD NOT choose windows shorter than the network's block-time variance.
- **Authorization scope.** An `exact-deferred` authorization is single-use, amount-exact,
  and payee-bound; it confers no standing spending authority. A client signing one is
  strictly safer than signing the equivalent `exact` authorization, which is immediately
  cashable.

## Appendix

Network-specific implementation details are in per-network documents:
[`scheme_exact_deferred_evm.md`](scheme_exact_deferred_evm.md) (EVM, via EIP-3009).

The mechanism requires only a token whose transfer authorizations carry a
start-of-validity timestamp and a payer-signed cancellation. On EVM this is EIP-3009
(`validAfter` + `cancelAuthorization`), which is already deployed on USDC, XSGD, EURC and
other FiatToken-derived assets — no new contract, on any chain where they exist. Chains
whose native authorization primitive has an equivalent "not valid before" field can
implement the same scheme.

### References

- [`exact` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact.md) — the immediate-settlement baseline this extends
- [`auth-capture` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md) — the escrow-based alternative
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009) — `validAfter`, `validBefore`, `cancelAuthorization`
- [Issue #1169](https://github.com/x402-foundation/x402/issues/1169) — pre-settlement client cancellation, documented as an attack in deliver-first flows
- [PR #1133](https://github.com/x402-foundation/x402/pull/1133) — `subscribe` scheme, prior use of deliberately future-dated `validAfter`
- Reference implementation and mainnet evidence: <https://github.com/zjzJoez/grace-x402>

# `cooling-off` binding for `exact` on EVM (`eip3009`)

> Binds the [`cooling-off` payment flow](cooling-off-payment-flow.md) to the
> existing `exact` scheme and `eip3009` asset transfer method. It changes no token
> contract and keeps facilitator `/settle` synchronous.

## Summary

EIP-3009 already supplies the two on-chain primitives required by this flow:

- `validAfter` prevents settlement until a signed timestamp; and
- `cancelAuthorization` lets the authorizer permanently burn an unused nonce.

This binding future-dates the authorization, durably records it at the resource server,
and invokes ordinary synchronous settlement only after the chain clock passes
`validAfter`.

```text
validAfter  = clientNow + coolingOffSeconds
cancelBy    = validAfter - cancellationSafetySeconds
validBefore = validAfter + maxTimeoutSeconds
```

`coolingOffSeconds` is the total activation delay. Its final
`cancellationSafetySeconds` are a network/relay inclusion and finality buffer, not a
normal decision window. Only a finalized `AuthorizationCanceled` event is an on-chain
cancellation guarantee.

## Asset conformance

An asset is compatible only if its deployed implementation:

1. implements EIP-3009 transfer and `cancelAuthorization` for the same nonce state;
2. rejects transfer while `block.timestamp <= validAfter`;
3. rejects transfer and cancellation after the nonce is used or canceled; and
4. emits distinguishable `AuthorizationUsed` and `AuthorizationCanceled` events.

Implementations MUST probe or allowlist the exact deployed asset implementation. A token
name such as USDC, EURC, or XSGD is not sufficient evidence across every chain, proxy
upgrade, or historical version.

The `principal-protected` authority profile additionally requires the asset's EIP-3009
`bytes` signature overload to validate ERC-1271 contract-wallet signatures. Circle
FiatToken v2.2 does this through `SignatureChecker`, but each deployed proxy still needs
capability verification.

## PaymentRequired and PaymentRequirements

Example:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://merchant.example/orders",
    "description": "Contingent order acknowledgement",
    "mimeType": "application/json"
  },
  "accepts": [{
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
      "name": "XSGD",
      "version": "2"
    }
  }],
  "extensions": {
    "cooling-off": {
      "info": {
        "cancelRelayUrls": ["https://relay.example/x402/cancel"],
        "cancellationFinality": {"type": "confirmations", "value": 1},
        "statusProtocol": "poll-v1"
      },
      "schema": {
        "type": "object"
      }
    }
  }
}
```

The production JSON Schema MUST constrain all advertised `info` fields; the abbreviated
schema above keeps the example readable.

### `extra` fields

| Field | Required | Type | Rule |
| :-- | :--: | :-- | :-- |
| `paymentFlow` | Yes | `"cooling-off"` | selects this lifecycle |
| `coolingOffSeconds` | Yes | `uint32` | total future activation delay; MUST be > 0 |
| `cancellationSafetySeconds` | Yes | `uint32` | MUST be > 0 and < `coolingOffSeconds` |
| `name`, `version` | Yes | string | deployed token EIP-712 domain values |

`maxTimeoutSeconds` is the settlement runway after `validAfter`, not the cooling-off
window. It MUST be large enough for retries and the advertised settlement finality.

`cancellationSafetySeconds` MUST be chosen from measured network and relay behaviour and
cover expected transaction inclusion, the advertised cancellation finality rule, and
clock skew. It is an operational safety margin, not a cryptographic promise that a
transaction submitted exactly at `cancelBy` will land.

`PaymentRequired.extensions["cooling-off"]` is echoed in `PaymentPayload` under the
normal x402 extension rule. `cancelRelayUrls` MAY be empty when the server supports only
self-broadcast. `cancellationFinality` MUST be explicit, for example a finalized block
tag or a positive confirmation count appropriate for the network.

## PaymentPayload

The payload remains the existing `exact` / `eip3009` payload. Only the timestamp
derivation changes:

```json
{
  "signature": "0x...",
  "authorization": {
    "from": "0x855A4b2085B16065204c379439773a4F9Ef7F424",
    "to": "0x7a8fDE09C400325C8B1fCe870C89d3f68A26D30d",
    "value": "4500000",
    "validAfter": "1786822425",
    "validBefore": "1786826025",
    "nonce": "0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde"
  }
}
```

The client derives:

```text
validAfter  = floor(client wall-clock seconds) + coolingOffSeconds
validBefore = validAfter + maxTimeoutSeconds
```

The client MUST display or otherwise expose `cancelBy = validAfter -
cancellationSafetySeconds`, not `validAfter`, as the normal cancellation deadline.

Deriving a nonce from order data is OPTIONAL and MUST include an unpredictable salt.
Random 32-byte nonces remain the recommended default. A deterministic, public order-only
nonce leaks linkage and allows preemptive cancellation attempts if a valid authorizer
signature can be obtained.

## Verification

`/verify` answers whether the authorization is structurally valid and expected to settle
later; it does not claim current settleability or future balance availability.

In addition to ordinary `exact` / EIP-3009 checks, the facilitator MUST:

1. use a recent chain-head timestamp rather than only local wall time;
2. verify `validAfter` is still in the future and its remaining delay is within the
   advertised `coolingOffSeconds` plus a declared clock/network tolerance;
3. verify `validBefore == validAfter + maxTimeoutSeconds`, subject only to an explicitly
   documented tolerance if the base scheme permits one;
4. verify `0 < cancellationSafetySeconds < coolingOffSeconds`;
5. verify the nonce is unused, the payer has sufficient balance at verification time,
   and the signature/domain/amount/payee are valid; and
6. verify the deployed asset supports the required cancellation and signature profile.

An immediate transfer simulation is expected to revert as “not yet valid”. That revert
MUST be classified separately from all other failures. If the RPC supports a future
timestamp simulation, the facilitator SHOULD also simulate at a timestamp strictly
greater than `validAfter`; otherwise it performs signature, balance, nonce, code, and
domain checks separately and re-verifies immediately before settlement.

Verification MUST fail if the remaining safe decision interval (`cancelBy` minus the
observed chain time) has already elapsed. A large client/server clock discrepancy MUST be
reported rather than silently reducing the human's window.

The initial `/verify` rule and settlement-time re-verification are different phases. On
the later synchronous `/settle` call, `validAfter` being in the past is expected. The
facilitator MUST compare the payload with the persisted, already verified requirements,
then re-check signature/policy validity, nonce, balance, `block.timestamp > validAfter`,
and `block.timestamp < validBefore`; it MUST NOT reapply the initial "future window"
test and reject a correctly matured payment.

### Client display rule

Any countdown or "cancellable until" indication shown to the human MUST be derived from
the absolute `validAfter` in the signed authorization — the value the token contract
will enforce — never from the advertised `coolingOffSeconds`. A skewed client clock then
mislabels nothing: the display and the chain agree by construction.

### Intent binding profiles

This binding supports both profiles of the flow document's Intent binding section: the
salted digest-nonce (canonicalization and salt disclosure per the rules above) and, for
`principal-protected` deployments, an additional client-signed intent record verifiable
without the resource server's cooperation.

## Durable coordinator and synchronous `/settle`

The resource server, not `/settle`, owns delayed execution:

1. after successful `/verify`, it atomically persists the complete payload, selected
   requirements, commitment digest, and times as an internal `preparing` record;
2. it idempotently registers any promised independent relay, then atomically persists
   the relay ticket and durable outbox/job while changing `preparing` to `pending`;
3. only then it returns the flow's HTTP 202 pending response;
4. a worker wakes from durable state and observes chain time;
5. only after observing a block with `timestamp > validAfter`, it atomically changes
   `pending` to `settlement_submitted` and calls the ordinary synchronous `/settle`;
6. it stores the transaction hash and waits for the settlement finality policy before
   changing the order to fulfilable.

At-least-once job delivery is acceptable because the record transition and ledger nonce
make execution idempotent. The worker MUST re-read the record and on-chain nonce state
immediately before broadcast. It retries transient errors only while a successful
transaction can still land before `validBefore`.

The coordinator MUST recover after restart by scanning every non-terminal record,
finishing or abandoning `preparing` registration, re-arming pending jobs, and reconciling
submitted hashes and token events. A memory timer, an open 90-second HTTP request, or a
facilitator process sleep is not conformant.

## Cancellation authorization and authority profiles

The EIP-712 cancellation message is:

```text
CancelAuthorization(address authorizer, bytes32 nonce)
```

It uses the same token EIP-712 domain (`name`, `version`, chain id, verifying contract)
as the transfer authorization. The contract validates the cancellation against
`authorization.from`; the transaction sender may be any address.

### `mistake-recovery`

The transfer signer and cancellation signer are the same EOA or the same agent-operated
wallet. This profile protects against accidental duplication, stale context, or a user
noticing and stopping a cooperative agent. It does **not** protect a human from a
prompt-injected or compromised agent that exclusively controls that payer key and the
only cancellation/broadcast path.

Implementations of this profile MUST use that narrower language. Merely exposing a
cancel button does not create an independent human veto.

### `principal-protected`

This profile requires both authority and delivery separation:

- the agent process does not exclusively control the payer's root/recovery authority;
  and
- the principal has direct broadcast capability or an independent relayer not controlled
  by the merchant.

Two conforming wallet patterns are:

1. **external policy signer** — the payer key remains in a wallet/HSM/policy service with
   an agent request channel and a separately authenticated human/recovery channel. The
   agent cannot extract or disable the root key, and the human can independently request
   a cancellation signature and broadcast; or
2. **ERC-1271 smart account** — `authorization.from` is the smart account. Its validation
   policy accepts the agent/session-key transfer signature and independently accepts an
   owner/recovery cancellation signature. The agent/session key MUST NOT be able to
   remove or block the recovery policy during the window.

Pattern 2 requires the token's `cancelAuthorization(authorizer, nonce, bytes)` path and
ERC-1271 validation. The current x402 EIP-3009 facilitator already handles smart-wallet
transfer signatures, but this proposal still requires new client cancellation and relay
support and per-asset capability checks.

A separate arbitrary `cancelAuthority` EOA field is intentionally not defined: the token
would reject it. Separation is a payer-wallet custody/policy property.

## Relay API

The client MAY self-broadcast `cancelAuthorization`. The coordinator-owned cancellation
endpoint accepts:

```http
POST /x402/payments/{paymentId}/cancel
Content-Type: application/json
Idempotency-Key: cancel-{paymentId}
```

```json
{
  "x402Version": 2,
  "paymentId": "pay_01J...",
  "network": "eip155:43114",
  "asset": "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
  "authorizer": "0x855A4b2085B16065204c379439773a4F9Ef7F424",
  "nonce": "0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde",
  "signature": "0x..."
}
```

Before returning 202 with an independent relay path, the coordinator MUST register the
verified record with that relay over an authenticated service channel. A minimal
registration is:

```http
POST /x402/cancel-registrations
Authorization: <relay-specific service credential>
```

```json
{
  "paymentId": "pay_01J...",
  "network": "eip155:43114",
  "asset": "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
  "authorizer": "0x855A4b2085B16065204c379439773a4F9Ef7F424",
  "nonce": "0xbc42530aa36162255bc91b9e4ba463531e3f2a006c1a1ff9860b81695b2afbde",
  "validAfter": 1786822425,
  "cancelBy": 1786822410,
  "validBefore": 1786826025
}
```

The relay returns an opaque record-specific `relayCancelUrl` or `relayTicket`, which the
coordinator persists and exposes in the pending response. Registration MUST NOT disclose
the transfer signature: it is a bearer settlement capability. If registration fails,
that relay MUST NOT be advertised as available for the payment. A client requiring an
independent zero-native-gas path rejects the acceptance unless it receives a registered
independent `relayCancelUrl`.

The registration endpoint itself MUST be authenticated, quota-limited, and available
only to approved coordinators (or use an equivalent funded-client admission mechanism).
This is how the relay avoids subsidizing attacker-created arbitrary nonces while still
remaining operationally independent of the merchant at cancellation time.

The coordinator `cancelUrl` MUST:

1. load a previously verified `paymentId` and compare every supplied field with it;
2. verify or simulate the CancelAuthorization signature under the stored token domain,
   including ERC-1271 semantics when applicable;
3. atomically change `pending` to `cancel_requested` before acknowledging acceptance;
4. stop its settlement job and either broadcast itself or forward to a registered relay;
   and
5. report `canceled` only after `AuthorizationCanceled` meets finality.

An independent `relayCancelUrl` cannot atomically mutate the coordinator database. It
MUST instead:

1. load the pre-registered descriptor and compare every supplied field with it;
2. verify or simulate the cancellation signature;
3. durably accept the relay job before returning `relay_accepted`;
4. broadcast promptly, persist the hash, and retry according to policy; and
5. report `canceled` only after the event meets finality.

It SHOULD send an authenticated, idempotent cancellation notification to the coordinator,
but the client cannot rely on a merchant-controlled callback for principal protection.
The coordinator's mandatory pre-settlement nonce re-read and the safety margin remain the
fallback when the coordinator did not receive the cancellation request directly.

It MUST NOT pay gas for an arbitrary authorizer/nonce not tied to one of its records.
Requests are idempotent: a repeat returns the current status and never intentionally
creates duplicate broadcasts.

ERC-1271 validity can change between blocks. Off-chain verification is therefore an
admission check, not a guarantee; the relay MUST classify the eventual receipt/event as
authoritative and MUST NOT report `canceled` from simulation alone.

Recommended responses:

| HTTP | State / error | Meaning |
| :--: | :-- | :-- |
| `202` | `cancel_requested` | durably accepted; settlement stopped locally; chain outcome pending |
| `202` | `relay_accepted` | independent relay durably accepted broadcast; coordinator stop is not implied |
| `200` | `canceled` | cancellation event meets advertised finality |
| `400` | `invalid_cancellation_signature` | signature or record binding invalid |
| `404` | `unknown_payment` | no relay-eligible record |
| `409` | `already_settled` / `settlement_in_flight` | cancellation cannot be promised |
| `409` | `cancel_window_elapsed` | relay declines a late raceable request |
| `503` | `relay_unavailable` | no broadcast acceptance; client should use another path |

A relay MAY attempt a post-`cancelBy` cancellation but MUST return `raceable: true` and
MUST NOT describe acceptance as success. A client SHOULD try independent relays
sequentially to avoid needless duplicate gas expenditure.

For the normal path, a principal-protected client submits the same signed cancellation
to the coordinator `cancelUrl` to stop its job and retains an independent
`relayCancelUrl` or direct-broadcast fallback. If the coordinator is unavailable or
malicious, the independent path still races on chain; it does not inherit the
coordinator's local no-settlement promise.

The signature is relayable because transaction sender and authorizer differ. “Payer paid
no native gas” is true only for a transaction actually landed by someone else. The
protocol cannot guarantee gaslessness without an available, funded relayer and a stated
service policy.

## Race, cutoff, and confirmation rules

Circle-style EIP-3009 checks are strict:

```text
block.timestamp > validAfter
block.timestamp < validBefore
authorizationState(authorizer, nonce) == unused
```

Cancellation checks the unused nonce and authorizer signature but not the clock. This
means cancellation remains technically callable after `validAfter`, yet it races with
settlement from that point onward.

### Normal cancellation interval

The normal decision interval ends at:

```text
cancelBy = validAfter - cancellationSafetySeconds
```

Client UI and APIs MUST distinguish:

- **before `cancelBy`**: normal cancellation interval. The coordinator can durably stop
  its own settlement; the relay targets inclusion/finality before activation;
- **from `cancelBy` through settlement**: best-effort, raceable cancellation; and
- **after terminal settlement**: impossible for this nonce.

Submitting before `cancelBy` improves liveness but is not itself a chain guarantee. The
only cryptographic terminal fact is a finalized `AuthorizationCanceled` event before an
`AuthorizationUsed` event. `cancel_requested` MUST remain visibly pending until then.

### Settlement gate

The coordinator MUST NOT use its wall clock alone. It waits until it observes a chain
head whose timestamp is strictly greater than `validAfter`, then:

1. verifies the database state is still `pending` using compare-and-set;
2. re-reads `authorizationState` and payer balance;
3. broadcasts settlement through synchronous `/settle`; and
4. waits for the advertised settlement finality before fulfilment.

If cancellation and settlement transactions are already in flight, block ordering is
authoritative. The coordinator MUST inspect `AuthorizationCanceled` and
`AuthorizationUsed` logs because common implementations expose both as the same boolean
authorization state.

`transferWithAuthorization` may be broadcast by any party possessing the signed payload,
so payload leakage enlarges the race surface. `receiveWithAuthorization` restricts the
caller to `payTo`, but requires payee-controlled settlement and is not the current x402
`eip3009` transfer path. Implementations MUST state which function they use and protect
the payload accordingly.

No no-new-contract design can grant cancellation priority once both actions are valid.
If that property is required, use `auth-capture`, escrow, or a new contract whose state
machine encodes explicit priority.

## Terminal outcomes

| State | Required evidence | x402 result |
| :-- | :-- | :-- |
| `settled` | expected transfer plus `AuthorizationUsed`, final | `success: true`, settlement hash |
| `canceled` | `AuthorizationCanceled`, final | `success: false`, `canceled_by_client`, cancellation hash |
| `failed` | deterministic failure or exhausted bounded retry | specific stable reason |
| `expired` | chain time/deadline makes settlement impossible | `authorization_expired` |

The resource server MUST NOT fulfil in `pending`, `cancel_requested`,
`settlement_submitted`, `failed`, or `expired`.

An `authorizationState == true` read without event reconciliation is insufficient to
classify settled versus canceled.

## Implementation changes

| Component | Required change |
| :-- | :-- |
| Client SDK | future-date `validAfter`; expose `cancelBy`, status polling, signing, self-broadcast/relay helpers, and honest profile labels |
| Facilitator `/verify` | validate a future authorization without treating the expected time gate as generic failure |
| Facilitator `/settle` | no async behaviour; re-verify and synchronously submit only when called after activation |
| Resource server/coordinator | durable record, outbox/job recovery, CAS state machine, 202/status/cancel endpoints, chain reconciliation |
| Relayer | discoverable, funded, idempotent record-bound cancellation API with explicit availability errors |
| Token/chain | no change, but deployed capability must be verified |

## Evidence and limits

The GRACE repository includes live Avalanche C-Chain XSGD evidence for:

- settlement failing before `validAfter` and succeeding after it;
- payer-authorized cancellation preventing later settlement;
- cancellation broadcast by a different transaction sender;
- forged cancellation rejection; and
- `receiveWithAuthorization` caller restriction.

Repository: <https://github.com/zjzJoez/grace-x402>

Those transactions prove token mechanics. They do not prove production coordinator
durability, relayer availability, human/agent key separation, or absence of a deadline
race; those are the normative requirements added by this revision.

## References

- [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)
- [Circle EIP3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol)
- [Circle SignatureChecker](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/util/SignatureChecker.sol)
- [Circle stablecoin-evm changelog](https://github.com/circlefin/stablecoin-evm/blob/master/CHANGELOG.md)
- [x402 exact EVM scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)
- [x402 HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)

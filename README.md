# GRACE — a cooling-off rail for agentic payments

**Track 3 · AI-native Commerce · StraitsX AgentiX Playground 2026**

> Merchants can't price the risk of an AI customer. GRACE makes that risk zero —
> with one field of EIP-3009 that everyone else hardcodes to zero.

---

## The problem no chargeback code covers

An AI agent places an order. The merchant cannot tell whether the human behind it
actually wanted this — a misread instruction, a prompt injection, a triple-fired
checkout all look identical to a legitimate purchase. In card land, disputes have
no reason code for *"my agent did it"*. On-chain, settlement is instant and final,
so the buyer's protection is zero. Result: rational merchants must reject or
surcharge agent traffic, and rational humans won't hand real money to agents.
Agentic commerce is deadlocked from both sides.

Today's answers both fail the same way: escrow contracts and PSP holds *take the
money first* in order to maybe give it back later.

## The mechanism: one field, already deployed

XSGD is Circle-standard FiatTokenV2_2. Every EIP-3009 authorization carries
`validAfter` — and every production integration sets it to a time in the past.
Set it to the near future instead and a dormant field becomes a cooling-off rail:

```
validAfter  = now + coolingOffSeconds   ← until then, the CHAIN refuses settlement
validBefore = validAfter + settleBy     ← after that, the claim lapses on its own
nonce       = keccak256(order)          ← settlement events commit to what was bought
```

During the window the merchant holds a signed, amount-locked, payer-bound claim
that **nobody on earth can cash yet** — while the payer keeps a unilateral veto:

| power | who | enforced by |
|---|---|---|
| cash the claim | merchant only | `receiveWithAuthorization` — caller must be the payee |
| void the claim | payer only | `cancelAuthorization` — meta-tx, anyone may pay its gas |

Neither party can do the other's job. No third party can do either. **No escrow,
no custodian, no new contract** — the money never leaves the payer's wallet, so
"reversal" costs nothing: nothing moved.

Cancellation being a meta-transaction matters: a phone holding **zero AVAX** can
still kill a payment. Signed by the payer, broadcast by anyone.

## The protocol: `exact-deferred`, an x402 scheme extension

The 402 challenge gains two fields, everything else is stock x402:

```json
{ "scheme": "exact-deferred",
  "asset":  "0xb2F85b7AB3c2b6f62DF06dE6aE7D09c010a5096E",
  "amount": "4500000", "payTo": "<merchant>",
  "extra":  { "name": "XSGD", "version": "2",
              "coolingOffSeconds": 90, "settleBySeconds": 3600 } }
```

- `coolingOffSeconds: 0` degrades to today's `exact` scheme — fully backwards compatible.
- The window is **declared by the merchant per SKU**: physical goods that ship in
  days cost nothing to protect for 90 seconds; instant digital goods set 0.
  Cooling-off becomes a trust signal merchants compete on, like "free returns".
- Works unchanged on **any** EIP-3009 token — USDC included.

## Proven on mainnet, with real money

Full loop executed on Avalanche C-Chain (43114) against live XSGD:

| beat | evidence |
|---|---|
| order accepted, settlement chain-blocked | console shows the chain's own verdict: `FiatTokenV2: authorization is not yet valid` |
| forced early settle | reverts with the same string — the chain polices the window, not our server |
| payer cancels in-window | [`cancelAuthorization` tx](https://snowtrace.io/tx/0xd5bab3abf1cf09e8ff67d94d85f0c6fabdee47aa4d16cf6196622863f7709cdd) — payer's balance never moved |
| settle after cancel | reverts forever: `FiatTokenV2: authorization is used or canceled` |
| un-cancelled order settles | [`receiveWithAuthorization` tx](https://snowtrace.io/tx/0xf6ccdc44fdc93ad3bc46242f41f9e636cad43c90e5202f2e89fee73525c593db) — S$4.50 settled, final |

Plus `prove.mjs`: 13 adversarial checks (payee binding, forged-cancel rejection,
burned-nonce replay, order-hash commitment …) — all passing against live mainnet
state, no contract deployed, no gas spent.

## Deployed on AWS, not drawn on a slide

Merchant service on **EC2** (ap-southeast-1) at <http://13.212.242.21>.

**GRACE Autopilot** — on every accepted order the merchant creates a one-shot
**EventBridge Scheduler** schedule at `validAfter`, which wakes a **Lambda** that
rings the merchant's settle endpoint. The Lambda holds **zero keys**; the chain
stays the only authority. The merchant never presses a button — humans only ever
say no. Measured end to end: window opened 09:05:31Z, final on-chain 09:06:13Z.

If the payer vetoed during the window, the schedule still fires and settlement
reverts with `authorization is used or canceled`. In the Lambda log that is not
an error, it is the product working.

**Bedrock** hosts the buying agent's purchase-decision brain, consulted before any
signature exists — it approves in-budget carts and refuses over-budget ones
outright. That is advisory, not the guarantee: the guarantee is the cooling-off
window, because GRACE assumes agents will sometimes be wrong.

Architecture diagram: [`grace/architecture.drawio`](grace/architecture.drawio)
· [open in viewer](https://viewer.diagrams.net/?lightbox=1&url=https%3A%2F%2Fraw.githubusercontent.com%2FzjzJoez%2Fgrace-x402%2Fmain%2Fgrace%2Farchitecture.drawio)

## Honest edges

- **GRACE guarantees intent-finality, not solvency.** The payer could drain the
  wallet mid-window. The merchant's flow is *settle-then-ship*: a failed
  settlement is a lost sale, never a lost good. Merchant downside is strictly zero.
- **Scope**: deferred-fulfilment commerce. Instant delivery keeps `window = 0`.
- Settlement is merchant-broadcast (existing facilitators would settle instantly
  and revert). A facilitator adopts the scheme by adding one rule: settle at
  `validAfter`, not on receipt.

## See it

**<http://13.212.242.21>** — one live screen. The countdown sits between the two
parties on purpose: the same number means *"you cannot cash this"* to the merchant
and *"you can still kill this"* to the payer. Below it, both balances carry a
running "unchanged for" timer, because *nothing moved* is the claim and it should
be measured rather than asserted.

## Run it yourself

```bash
npm i                                   # viem only
node grace/prove.mjs                    # 13 mainnet proofs — no keys, no gas, ~20s
node grace/server.mjs                   # merchant → http://localhost:4021
node grace/agent.mjs --sku tee-agentix --server http://localhost:4021 [--brain]
```

`prove.mjs` is the one to run if you only run one: it asserts every claim in this
README against live Avalanche mainnet state, from a throwaway key, spending nothing.

```
grace/
├── lib/xsgd.mjs           chain constants, ABI, revert strings (all live-verified)
├── lib/authorization.mjs  deferred-payment + cancellation signing, order-hash nonce
├── lib/settle.mjs         settle / cancel / simulate, revert classification
├── lib/brain.mjs          Bedrock purchase decision, taken before any signature exists
├── server.mjs             merchant: x402 exact-deferred endpoint + order book + autopilot
├── mission.mjs            the live screen
├── themes.mjs             visual themes; ?theme=<key>, ?picker=1 to compare
├── agent.mjs              buyer agent CLI
├── prove.mjs              adversarial proof suite against live mainnet
└── architecture.drawio    functional blocks, AWS deployment, data flow
```

*One line we want to leave behind:*
**No one needs to hold your money in order to give it back.**

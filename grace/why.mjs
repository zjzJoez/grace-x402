/**
 * /why — the whole argument, readable in two minutes, no presenter required.
 *
 * Judging happens on submitted materials before anyone gets to present, so the
 * story cannot live in the pitch. This page is the pitch: the deadlock, the
 * one-field insight, the asymmetry, what the window really costs, the proof,
 * and what each sponsor's piece actually does. Same paper as everything else.
 */

export function whyPage(net) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Why GRACE exists</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --paper:#e9e2d4; --card:#fffefb; --card2:#faf7f0; --ink:#221f1a; --muted:#6b6459;
    --faint:#9a9287; --rule:rgba(34,31,26,.10); --rust:#a94b2a; --green:#2f6b52;
    --red:#a02a2a; --blue:#345c7e; --amber:#a4651f; --violet:#6a4fa8;
    --serif:"New York",ui-serif,"Iowan Old Style",Palatino,Georgia,serif;
    --sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --lift:0 1px 2px rgba(60,49,33,.055),0 10px 24px -14px rgba(60,49,33,.30),inset 0 1px 0 rgba(255,255,255,.9);
  }
  body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 var(--serif);
    padding:52px 24px 110px;-webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto}
  .kicker{font:700 11px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
  h1{font:600 46px/1.12 var(--serif);letter-spacing:-.025em;margin:10px 0 6px}
  h1 b{font-style:italic;font-weight:600;color:var(--rust)}
  .lede{font:italic 20px/1.55 var(--serif);color:#575046;margin:14px 0 0}
  h2{font:600 27px/1.25 var(--serif);letter-spacing:-.02em;margin:54px 0 14px}
  p{margin:0 0 14px;color:#3a352d}
  p b{color:var(--ink)}
  .rulebar{height:1px;background:var(--rule);margin:40px 0 0}
  code{font:14px var(--mono);color:var(--ink)}
  .diff{background:#221f1a;border-radius:13px;padding:18px 22px;margin:20px 0;
    font:15.5px/1.8 var(--mono);box-shadow:0 12px 28px -16px rgba(34,31,26,.75)}
  .diff .del{color:#c98a7d} .diff .del::before{content:"−  "}
  .diff .add{color:#6fd6a4;font-weight:700} .diff .add::before{content:"+  "}
  .diff .ctx{color:#8d857a}
  .duo{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
  .duo>div{background:var(--card);border:1px solid var(--rule);border-radius:13px;
    padding:18px 20px;box-shadow:var(--lift)}
  .duo .h{font:700 10px/1 var(--sans);letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px}
  .duo .mB{color:var(--blue)} .duo .mR{color:var(--rust)}
  .duo p{font:15px/1.6 var(--sans);color:var(--muted);margin:0}
  .duo p b{color:var(--ink)}
  table{width:100%;border-collapse:collapse;font:15px/1.5 var(--sans);margin:18px 0}
  th{font:700 10.5px/1.4 var(--sans);letter-spacing:.13em;text-transform:uppercase;
    color:var(--faint);text-align:left;padding:0 14px 8px 0;border-bottom:1px solid var(--rule)}
  td{padding:10px 14px 10px 0;border-bottom:1px solid var(--rule);color:#3a352d;vertical-align:top}
  td code{font-size:12.5px}
  td a{color:var(--blue);text-decoration:none;border-bottom:1px solid rgba(52,92,126,.3)}
  .sponsor{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin:20px 0}
  .sponsor>div{background:var(--card2);border:1px solid var(--rule);border-radius:13px;
    padding:16px 18px;box-shadow:var(--lift)}
  .sponsor .h{font:700 10px/1 var(--sans);letter-spacing:.15em;text-transform:uppercase;margin-bottom:7px}
  .sponsor p{font:14px/1.6 var(--sans);color:var(--muted);margin:0}
  .sponsor p b{color:var(--ink)}
  .pull{border-left:3px solid var(--rust);padding:4px 0 4px 22px;margin:26px 0;
    font:italic 22px/1.5 var(--serif);color:#514b41}
  .foot{margin-top:56px;padding-top:22px;border-top:1px solid var(--rule);
    font:13px var(--mono);color:var(--faint);display:flex;gap:26px;flex-wrap:wrap}
  .foot a{color:var(--blue);text-decoration:none}
  .toplink{position:fixed;top:18px;right:22px;font:600 13px var(--sans)}
  .toplink a{color:var(--blue);text-decoration:none;background:var(--card);
    border:1px solid var(--rule);border-radius:999px;padding:9px 18px;box-shadow:var(--lift)}
  @media(max-width:720px){h1{font-size:32px}.duo,.sponsor{grid-template-columns:1fr}}
</style></head><body>
<div class="toplink"><a href="/">watch it live →</a></div>
<div class="wrap">

  <div class="kicker">Why GRACE exists</div>
  <h1>Everyone else makes agents pay.<br><b>GRACE makes merchants able to accept.</b></h1>
  <p class="lede">A cooling-off rail for agentic payments — built from one dormant field of a
  token that is already deployed, with no escrow, no custodian, and no new contract.</p>

  <div class="rulebar"></div>

  <h2>The deadlock nobody demos</h2>
  <p>When an AI agent places an order, the merchant cannot tell whether the human behind it
  actually wanted it. A misread instruction, a prompt injection, a duplicate checkout — all of
  them arrive looking exactly like a legitimate purchase.</p>
  <p>In the card world, every dispute maps to a reason code — and <b>no reason code exists for
  “my agent did it.”</b> On-chain it is worse: settlement is instant and final, so the buyer's
  protection is zero. A rational merchant facing agent traffic has two moves: refuse it, or
  price the unknown risk into every order.</p>
  <p>Meanwhile every attempted fix — escrow contracts, PSP holds — makes the same trade:
  <b>take the money first</b>, and promise to maybe give it back.</p>

  <h2>The insight: the fix was already deployed</h2>
  <p>XSGD is a Circle-standard FiatToken. Every EIP-3009 payment authorization carries a field
  called <code>validAfter</code> — and every production integration on earth hardcodes it to
  the past. It has always been treated as replay-protection plumbing. It is actually a
  commercial primitive:</p>
  <div class="diff">
    <div class="ctx">// the entire protocol change</div>
    <div class="del">validAfter: 0</div>
    <div class="add">validAfter: now + coolingOffSeconds</div>
  </div>
  <p>Set it ninety seconds into the future and the merchant now holds a signed, amount-locked
  claim <b>that nobody on earth can cash yet</b> — while the payer keeps a unilateral veto.
  The money never leaves the payer's wallet, so “reversal” costs nothing: nothing moved.</p>

  <h2>The asymmetry is the product</h2>
  <div class="duo">
    <div><div class="h mB">Only the merchant can cash it</div>
      <p><code>receiveWithAuthorization</code> requires <code>msg.sender == payee</code>.
      A stolen signature is worthless to anyone else — <b>we proved this on mainnet</b>.</p></div>
    <div><div class="h mR">Only the payer can void it</div>
      <p><code>cancelAuthorization</code> must be signed by the payer — and it is a
      meta-transaction, so <b>a phone with zero gas can still kill a payment</b>.</p></div>
  </div>
  <p>Neither side can do the other's job. No third party can do either. That is dispute
  protection with no one in the middle — enforced by the token, not by our server.</p>

  <h2>“So every purchase waits ninety seconds?”</h2>
  <p>No one waits. The agent finishes in two seconds and the buyer walks away. The <i>money</i>
  waits — and for physical goods the money was going to wait anyway, because settle-then-ship
  was already the merchant's flow. The window is a per-item field the merchant declares:</p>
  <table>
    <tr><th>item</th><th>window</th><th>why it costs nothing</th></tr>
    <tr><td>hackathon tee</td><td>90 s</td><td>ships tomorrow — settlement lands hours before the courier</td></tr>
    <tr><td>coffee beans</td><td>120 s</td><td>same: fulfilment is the slow part, not the money</td></tr>
    <tr><td>API credits</td><td>0 s</td><td>instant goods degrade to today's x402 <code>exact</code> — fully compatible</td></tr>
  </table>
  <p>A cooling-off window becomes a trust signal merchants compete on — the on-chain version
  of “free returns,” compressed to seconds and enforced by mathematics instead of customer
  service.</p>

  <h2>Proof, not promises</h2>
  <p>Everything below happened on Avalanche C-Chain <b>mainnet</b> with real XSGD. Anyone can
  re-run the 13-check adversarial suite (<code>node grace/prove.mjs</code>) with no keys and
  no gas.</p>
  <table>
    <tr><th>claim</th><th>on-chain evidence</th></tr>
    <tr><td>early settlement is impossible</td><td><code>FiatTokenV2: authorization is not yet valid</code> — the token's own words, quoted live on the rail</td></tr>
    <tr><td>the payer's veto is real</td><td><a href="https://snowtrace.io/tx/0xd5bab3abf1cf09e8ff67d94d85f0c6fabdee47aa4d16cf6196622863f7709cdd">cancelAuthorization tx</a> — balance never moved</td></tr>
    <tr><td>settlement is final</td><td><a href="https://snowtrace.io/tx/0xf6ccdc44fdc93ad3bc46242f41f9e636cad43c90e5202f2e89fee73525c593db">receiveWithAuthorization tx</a> — S$4.50, no chargeback exists</td></tr>
    <tr><td>no human needs to press settle</td><td><a href="https://snowtrace.io/tx/0x2addd508ef83d2efd9df0655c6f344fd205b1e8761501c4549830c3a7c772b50">EventBridge-driven settlement</a> — 42 s after the window opened, zero hands</td></tr>
    <tr><td>the whole loop runs inside AWS</td><td><a href="https://snowtrace.io/tx/0xce3ecb824c35dec55899f6061ceac1b861f44154d9934be43d88fe42266b177d">Bedrock-approved purchase</a> → scheduled settlement, end to end</td></tr>
  </table>

  <h2>What each sponsor's piece actually does</h2>
  <div class="sponsor">
    <div><div class="h" style="color:var(--violet)">XSGD · StraitsX</div>
      <p><b>Carries the rule.</b> The entire dispute layer lives inside FiatTokenV2_2 as
      already deployed. StraitsX could publish <code>exact-deferred</code> tomorrow without
      shipping anything — and it works on any EIP-3009 token, USDC included.</p></div>
    <div><div class="h" style="color:#c0392b">Avalanche</div>
      <p><b>Makes a 90-second window safe.</b> ~2 s finality means the veto lands long before
      the edge; on a slower chain the race window would swallow the product. Every settlement
      and every cancellation here is a real C-Chain transaction.</p></div>
    <div><div class="h" style="color:var(--amber)">AWS</div>
      <p><b>Decides when to ask — never whether it succeeds.</b> Each order gets a one-shot
      EventBridge schedule at <code>validAfter</code> → Lambda rings the settle endpoint.
      The Lambda holds <b>zero keys</b>. Bedrock's Claude approves or refuses the purchase
      before any signature exists.</p></div>
  </div>

  <h2>Where the edges are — honestly</h2>
  <p>GRACE guarantees <b>intent-finality, not solvency</b>: a payer could drain the wallet
  mid-window, so the merchant's flow is settle-then-ship and a failed settlement is a lost
  sale, never a lost good. Instant digital goods keep a zero window. We say this out loud
  because a protection layer that overclaims is worse than none.</p>

  <div class="pull">No one needs to hold your money in order to give it back.</div>

  <div class="foot">
    <a href="/">the live rail</a>
    <a href="https://github.com/zjzJoez/grace-x402">github.com/zjzJoez/grace-x402</a>
    <a href="https://viewer.diagrams.net/?lightbox=1&url=https%3A%2F%2Fraw.githubusercontent.com%2FzjzJoez%2Fgrace-x402%2Fmain%2Fgrace%2Farchitecture.drawio">architecture</a>
    <span>Track 3 · StraitsX AgentiX Playground 2026</span>
  </div>
</div></body></html>`
}

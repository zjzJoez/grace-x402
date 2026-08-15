/**
 * Stage pages — the surfaces that make the demo legible.
 *
 * A dashboard shows state; it cannot show WHO is acting. The video (and a
 * judge clicking around) needs three vantage points:
 *
 *   /stage/terminal  the buyer's side — a terminal where the agent visibly
 *                    works. The recorder streams the REAL agent's stdout into
 *                    it via window.__term(line), so the typing is staged but
 *                    every output line is genuine.
 *   /phone?id=<id>   the human's side — the payer page inside a phone frame.
 *                    The CANCEL tapped in here broadcasts a real mainnet
 *                    cancellation.
 *   /stage/end       the closing card.
 *
 * All three share the editorial paper so cuts between pages read as cuts,
 * not as glitches.
 */

const BASE = /* css */ `
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:#e9e2d4;color:#221f1a;
    font:16px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:40px;-webkit-font-smoothing:antialiased}
  .kicker{font:700 10.5px/1 ui-sans-serif,-apple-system,sans-serif;letter-spacing:.16em;
    text-transform:uppercase;color:#9a9287;margin-bottom:14px}
`

export function terminalPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GRACE · the buyer's side</title>
<style>
  ${BASE}
  .term{width:min(1080px,92vw);background:#191713;border:1px solid #0e0c09;border-radius:14px;
    box-shadow:0 2px 10px rgba(0,0,0,.18),0 30px 70px -30px rgba(40,32,22,.6),inset 0 1px 0 rgba(255,255,255,.06);
    overflow:hidden}
  .bar{display:flex;gap:8px;align-items:center;padding:13px 16px;background:#221f1a;
    border-bottom:1px solid #0e0c09}
  .dot{width:12px;height:12px;border-radius:50%}
  .d1{background:#ff5f57}.d2{background:#febc2e}.d3{background:#28c840}
  .bar span{margin-left:10px;font:12px ui-monospace,"SF Mono",Menlo,monospace;color:#8d857a}
  .body{padding:22px 26px 26px;font:16.5px/1.85 ui-monospace,"SF Mono",Menlo,monospace;
    min-height:380px;color:#d9d2c6}
  .ps1{color:#7d766c}
  #cmd{color:#fdfcfa;font-weight:600}
  #cmd .caret{display:inline-block;width:9px;height:19px;background:#fdfcfa;vertical-align:-3px;
    animation:blink 1s steps(1) infinite;margin-left:1px}
  @keyframes blink{50%{opacity:0}}
  #out div{opacity:0;transform:translateY(3px);animation:in .3s ease forwards}
  @keyframes in{to{opacity:1;transform:none}}
  #out .dim{color:#8d857a}
  #out .ok{color:#6fd6a4;font-weight:700}
  #out .brain{color:#ffb340;font-weight:700}
  #out .link{color:#7db8e8}
</style></head><body>
  <div class="kicker">THE BUYER'S SIDE · A REAL PURCHASE, LIVE</div>
  <div class="term">
    <div class="bar"><i class="dot d1"></i><i class="dot d2"></i><i class="dot d3"></i><span>agent — zsh</span></div>
    <div class="body">
      <div><span class="ps1">buyer@laptop ~ %</span> <span id="cmd"><span class="caret"></span></span></div>
      <div id="out"></div>
    </div>
  </div>
<script>
  // the recorder drives this: __type() the command, then __term() each REAL stdout line
  window.__type = (text, cps=28) => new Promise((done) => {
    const el = document.getElementById('cmd');
    let i = 0;
    const t = setInterval(() => {
      i++;
      el.innerHTML = text.slice(0, i).replace(/</g,'&lt;') + '<span class="caret"></span>';
      if (i >= text.length) { clearInterval(t); setTimeout(done, 250); }
    }, 1000 / cps);
  });
  window.__term = (line, cls='') => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = line;
    document.getElementById('out').appendChild(d);
  };
</script></body></html>`
}

export function phonePage(id, publicUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GRACE · the payer's phone</title>
<style>
  ${BASE}
  .stagegrid{display:flex;align-items:center;gap:64px;padding-bottom:96px}
  .aside{max-width:360px}
  .aside h2{font:600 30px/1.25 "New York",ui-serif,Georgia,serif;letter-spacing:-.02em;margin:0 0 12px}
  .aside h2 b{font-style:italic;font-weight:600;color:#a94b2a}
  .aside p{color:#6b6459;font-size:15px;line-height:1.65;margin:0}
  .aside p code{font:12.5px ui-monospace,Menlo,monospace;color:#221f1a}
  .phone{width:376px;height:752px;background:#191713;border-radius:54px;padding:14px;
    box-shadow:0 2px 10px rgba(0,0,0,.2),0 40px 90px -35px rgba(40,32,22,.65),
      inset 0 1px 0 rgba(255,255,255,.09);position:relative;flex-shrink:0}
  .notch{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:96px;height:24px;
    background:#191713;border-radius:20px;z-index:3}
  .phone iframe{width:100%;height:100%;border:0;border-radius:38px;background:#0b0e14}
</style></head><body>
  <div class="stagegrid">
    <div class="aside">
      <div class="kicker">THE PAYER'S PHONE</div>
      <h2>The human keeps <b>the last word.</b></h2>
      <p>This page is live at <code>${publicUrl}/pay/${id}</code>. The cancel button signs a real
         <code>cancelAuthorization</code> — the payer's wallet needs no gas, and no permission from anyone.</p>
    </div>
    <div class="phone"><div class="notch"></div><iframe id="pf" src="/pay/${id}"></iframe></div>
  </div>
</body></html>`
}

export function endPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GRACE</title>
<style>
  ${BASE}
  body{text-align:center}
  .word{font:600 96px/1 "New York",ui-serif,Georgia,serif;letter-spacing:-.03em}
  .word b{color:#a94b2a;font-weight:600}
  .line{margin:26px auto 0;max-width:720px;font:italic 24px/1.5 "New York",ui-serif,Georgia,serif;color:#514b41}
  .roles{display:flex;gap:44px;justify-content:center;margin-top:46px}
  .r{font:700 11px/1.7 ui-sans-serif,-apple-system,sans-serif;letter-spacing:.15em;text-transform:uppercase}
  .r span{display:block;font:400 13px/1.5 ui-sans-serif,-apple-system,sans-serif;
    letter-spacing:0;text-transform:none;color:#6b6459;margin-top:2px}
  .rX{color:#6a4fa8}.rA{color:#c0392b}.rW{color:#a4651f}
  .repo{margin-top:44px;font:13px ui-monospace,Menlo,monospace;color:#9a9287}
  .repo b{color:#221f1a;font-weight:600}
</style></head><body>
  <div>
    <div class="word">GRACE<b>.</b></div>
    <div class="line">Nobody ever held your money.<br>Nobody had to.</div>
    <div class="roles">
      <div class="r rX">XSGD<span>carries the rule</span></div>
      <div class="r rA">AVALANCHE<span>makes 90s safe</span></div>
      <div class="r rW">AWS<span>settles on time</span></div>
    </div>
    <div class="repo">live · <b>13.212.242.21</b> &nbsp;·&nbsp; code · <b>github.com/zjzJoez/grace-x402</b></div>
  </div>
</body></html>`
}

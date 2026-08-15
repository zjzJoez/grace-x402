/**
 * GRACE themes — one markup, several points of view.
 *
 * The demo screen is judged by strangers on a projector and on their own
 * phones, so the visual register matters as much as the mechanism. Each theme
 * below styles the exact same DOM; `?theme=<key>` picks one, and the picker bar
 * lets us compare them live instead of arguing about screenshots.
 */

// `themes-codex.mjs` registers during this module's static-import cycle. Keep
// the registry lazily initialised so those registrations are available before
// the baseline theme below is evaluated.
export var THEMES

export function register(key, meta, css) { (THEMES ??= {})[key] = { key, ...meta, css } }

register('control', {
  name: 'Control room',
  note: 'the original dark build — kept as the baseline to compare against',
  arc: { cooling: '#ffb340', void: '#ff5f5f', settled: '#3ddc91', lapsed: '#4a5568' },
}, `
  :root {
    --bg:#080b11; --panel:#0f141d; --panel2:#131a25; --edge:#1e2735; --edge2:#2a3547;
    --text:#e6ebf4; --dim:#7c879b; --faint:#4a5568;
    --green:#3ddc91; --red:#ff5f5f; --amber:#ffb340; --blue:#5aa9ff; --violet:#a78bfa;
    --mono:"SF Mono",ui-monospace,Menlo,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
  }
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;
       padding:20px 24px 28px;font-size:15px;line-height:1.5}
  .wrap{max-width:1500px;margin:0 auto}

  /* ── header ─────────────────────────────────────────── */
  .top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
       padding-bottom:14px;border-bottom:1px solid var(--edge);margin-bottom:18px;flex-wrap:wrap}
  .brand{font-size:30px;font-weight:800;letter-spacing:-.02em}
  .brand b{color:var(--green)}
  .tag{color:var(--dim);font-size:14px;margin-top:2px}
  .chain{display:flex;gap:26px;font-family:var(--mono);font-size:12px;color:var(--dim);text-align:right}
  .chain b{display:block;color:var(--text);font-size:14px;font-weight:600;margin-top:2px}
  .live::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;
       background:var(--green);margin-right:7px;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}

  /* ── thesis ─────────────────────────────────────────── */
  .thesis{background:linear-gradient(90deg,#101826,transparent);border-left:3px solid var(--green);
       padding:12px 18px;margin-bottom:18px;font-size:16px}
  .thesis b{color:var(--green)}

  /* ── lifecycle rail ─────────────────────────────────── */
  .rail{display:flex;align-items:center;gap:0;margin-bottom:6px;flex-wrap:wrap}
  .railnote{font-size:12.5px;color:var(--dim);margin-bottom:18px}
  .railnote i{color:var(--text);font-style:normal;font-weight:600}
  .step{flex:1;min-width:120px;padding:10px 12px;border-top:2px solid var(--edge);
        font-size:12.5px;color:var(--faint);transition:.4s;position:relative}
  .step .n{font-family:var(--mono);font-size:10.5px;opacity:.7}
  .step .t{font-weight:600;margin-top:1px}
  .step.done{border-top-color:var(--edge2);color:var(--dim)}
  .step.done .t{color:var(--dim)}
  .step.on{border-top-color:var(--amber);color:var(--amber)}
  .step.on .t{color:var(--amber);font-weight:700}
  .step.on::after{content:"";position:absolute;top:-2px;left:0;height:2px;width:100%;
        background:var(--amber);animation:pulse 1.4s infinite}
  .step.kill{border-top-color:var(--red);color:var(--red)}
  .step.kill .t{color:var(--red)}
  .step.fin{border-top-color:var(--green);color:var(--green)}
  .step.fin .t{color:var(--green)}

  /* ── the split ──────────────────────────────────────── */
  .split{display:grid;grid-template-columns:1fr 260px 1fr;gap:18px;align-items:stretch;margin-bottom:18px}
  .side{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:18px 20px;
        display:flex;flex-direction:column}
  .side.merchant{border-top:3px solid var(--blue)}
  .side.payer{border-top:3px solid var(--red)}
  .who{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:3px}
  .verdictline{font-size:19px;font-weight:700;margin-bottom:12px}
  .can{color:var(--green)} .cant{color:var(--red)} .wait{color:var(--amber)}
  .quote{background:#070a0f;border:1px dashed var(--edge2);border-radius:8px;padding:13px 15px;margin-top:auto}
  .quote .lbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
  .quote .said{font-family:var(--mono);font-size:16px;color:var(--red);margin-top:5px;word-break:break-word}
  .quote.ok .said{color:var(--green)}
  .quote .prov{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:6px}
  .fnote{font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:10px;line-height:1.6}
  button{font:inherit;font-weight:700;border:0;border-radius:9px;padding:13px 20px;cursor:pointer;
         width:100%;letter-spacing:.03em;font-size:15px;transition:.15s}
  button:disabled{opacity:.4;cursor:not-allowed}
  .bSettle{background:var(--blue);color:#04121f}
  .bSettle.blocked{background:#1a2433;color:var(--dim)}
  .bCancel{background:var(--red);color:#1c0505}
  .bCancel:hover:not(:disabled){filter:brightness(1.12)}

  /* ── the ring ───────────────────────────────────────── */
  .ring{display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:var(--panel2);border:1px solid var(--edge);border-radius:12px;padding:16px 10px}
  .ring svg{transform:rotate(-90deg)}
  .ringwrap{position:relative;width:170px;height:170px}
  .ringtxt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ringnum{font-size:46px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
  .ringlbl{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-top:4px}
  .ringcap{font-size:11.5px;color:var(--dim);text-align:center;margin-top:12px;line-height:1.45}
  .ringcap b{color:var(--text)}

  /* ── money ──────────────────────────────────────────── */
  .money{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:16px 20px;margin-bottom:18px}
  .money h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600}
  .mrow{display:flex;align-items:center;gap:14px;margin-top:11px;font-family:var(--mono);font-size:13.5px}
  .mrow .nm{width:130px;color:var(--dim)}
  .mrow .bar{flex:1;height:15px;background:#0a0e14;border-radius:4px;overflow:hidden}
  .mrow .bar i{display:block;height:100%;transition:width .6s ease}
  .mrow.p .bar i{background:linear-gradient(90deg,#2d7a5a,var(--green))}
  .mrow.m .bar i{background:linear-gradient(90deg,#2a5b8f,var(--blue))}
  .mrow .dv{width:82px;text-align:right;color:var(--faint);font-size:12.5px}
  .mrow .dv.moved{color:var(--green);font-weight:700}
  .mrow .v{width:120px;text-align:right;font-weight:700;font-size:15px}
  .still{margin-top:11px;font-size:13px;color:var(--green)}
  .still b{font-variant-numeric:tabular-nums}

  /* ── coupling + events ──────────────────────────────── */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:16px 20px}
  .card h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
           font-weight:600;margin-bottom:12px}
  .piece{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--edge);font-size:13px}
  .piece:last-child{border:0}
  .piece .k{width:96px;font-weight:700;flex-shrink:0}
  .piece .d{color:var(--dim);font-size:12.5px}
  .piece .d code{font-family:var(--mono);color:var(--text);font-size:11.5px}
  .kA{color:#e84142} .kX{color:var(--violet)} .kW{color:var(--amber)}
  .ev{display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--edge);
      font-family:var(--mono);font-size:12px}
  .ev:last-child{border:0}
  .ev .kind{font-weight:700;width:186px;flex-shrink:0}
  .ev .used{color:var(--green)} .ev .canc{color:var(--red)}
  .ev .meta{color:var(--dim);flex:1;word-break:break-all}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  .empty{color:var(--faint);font-size:13px;padding:8px 0}
  .cta{font-family:var(--mono);font-size:13px;color:var(--dim);background:#070a0f;
       border:1px dashed var(--edge2);border-radius:8px;padding:14px 16px;margin-top:12px;line-height:1.7}
  .cta b{color:var(--amber)}
  @media(max-width:1180px){.split{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}}
`)

export function themeFor(key) {
  return THEMES[key] ?? THEMES.control
}

/** The picker strip. Present on every theme so switching stays one click. */
export function pickerHtml(active) {
  const items = Object.values(THEMES).map((t) =>
    `<a class="tpick${t.key === active ? ' on' : ''}" href="?theme=${t.key}">${t.name}</a>`
  ).join('')
  return `<div class="tbar"><span class="tbl">style</span>${items}</div>`
}

export const PICKER_CSS = `
  .tbar{position:fixed;right:14px;bottom:14px;z-index:99;display:flex;gap:6px;align-items:center;
    background:rgba(10,12,18,.86);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);
    border-radius:999px;padding:6px 10px;font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    box-shadow:0 8px 28px rgba(0,0,0,.35)}
  .tbl{color:#8892a4;text-transform:uppercase;letter-spacing:.12em;font-size:10px;padding:0 4px}
  .tpick{color:#c8d0dd;text-decoration:none;padding:6px 11px;border-radius:999px;white-space:nowrap}
  .tpick:hover{background:rgba(255,255,255,.09);text-decoration:none}
  .tpick.on{background:#fff;color:#0b0f16;font-weight:700}
  @media(max-width:720px){.tbar{left:8px;right:8px;max-width:none;overflow-x:auto;justify-content:flex-start;
    border-radius:14px;padding:7px 9px;scrollbar-width:none}.tbar::-webkit-scrollbar{display:none}}
  @media print{.tbar{display:none}}
`

import './themes-codex.mjs'

register('editorial-tight', {
  name: 'Editorial ledger (tightened)',
  note: 'the chosen editorial look with the page reduced to four bands: masthead, rail, the split, the proofs.',
  arc: { cooling: '#b76523', void: '#a12b2b', settled: '#39725a', lapsed: '#8c877d' },
}, THEMES.editorial.css + `
  .sub{margin-top:9px;max-width:760px;color:#5f594f;font:italic 15px/1.5 Georgia,"Times New Roman",serif}
  .sub i{font-style:normal;color:#24221e}
  .split{margin-bottom:22px}
  .fnote{line-height:1.7}
  .card{margin-bottom:18px}
  .pieces{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;
    padding-top:15px;border-top:1px solid #bdb4a5}
  .pieces .piece{display:block;padding:0;border:0}
  .pieces .piece .k{width:auto;margin-bottom:4px;font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
    letter-spacing:.14em;text-transform:uppercase}
  .pieces .piece .d{color:#716b61;font:13px/1.5 Georgia,"Times New Roman",serif}
  .pieces .piece .d b{color:#24221e;font-weight:700}
  .pieces .piece .d code{font:11.5px "SFMono-Regular",Consolas,monospace;color:#24221e}
  @media(max-width:900px){.pieces{grid-template-columns:1fr;gap:14px}}
`)
import './themes-codex-round2.mjs'

import './themes-codex.mjs'

register('editorial-tight', {
  name: 'Editorial ledger (tightened)',
  note: 'the chosen editorial look with the page reduced to four bands: masthead, rail, the split, the proofs.',
  arc: { cooling: '#b76523', void: '#a12b2b', settled: '#39725a', lapsed: '#8c877d' },
}, THEMES.editorial.css + `
  .sub{margin-top:9px;max-width:760px;color:#5f594f;font:italic 15px/1.5 Georgia,"Times New Roman",serif}
  .sub i{font-style:normal;color:#24221e}
  .split{margin-bottom:22px}
  .fnote{line-height:1.7}
  .card{margin-bottom:18px}
  .pieces{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;
    padding-top:15px;border-top:1px solid #bdb4a5}
  .pieces .piece{display:block;padding:0;border:0}
  .pieces .piece .k{width:auto;margin-bottom:4px;font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
    letter-spacing:.14em;text-transform:uppercase}
  .pieces .piece .d{color:#716b61;font:13px/1.5 Georgia,"Times New Roman",serif}
  .pieces .piece .d b{color:#24221e;font-weight:700}
  .pieces .piece .d code{font:11.5px "SFMono-Regular",Consolas,monospace;color:#24221e}
  @media(max-width:900px){.pieces{grid-template-columns:1fr;gap:14px}}
`)

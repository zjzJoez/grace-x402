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
  .whylink{font-style:normal;font-weight:600;color:#345c7e;text-decoration:none;border-bottom:1px solid rgba(52,92,126,.35)}
  .phlink{margin-top:10px;text-align:center;font-size:13px}
  .phlink a{color:#345c7e}
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

register('editorial-raised', {
  name: 'Editorial ledger (raised)',
  note: 'the editorial argument on lifted paper: system-serif headlines, geometric sans labels, and every module a double-layer card.',
  arc: { cooling: '#b76523', void: '#a12b2b', settled: '#39725a', lapsed: '#8c877d' },
}, `
  :root{
    /* page sits darker than the cards so every module lifts off it */
    --paper:#e9e2d4; --card:#fffefb; --card2:#faf7f0;
    --ink:#221f1a; --muted:#6b6459; --faint:#9a9287;
    --rule:rgba(34,31,26,.10); --rule2:rgba(34,31,26,.16);
    --rust:#a94b2a; --green:#2f6b52; --red:#a02a2a; --blue:#345c7e; --amber:#a4651f;
    --serif:"New York",ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,sans-serif;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
    /* two-step depth: a hairline frame plus a soft, wide shadow */
    --lift:0 1px 2px rgba(60,49,33,.055), 0 10px 24px -14px rgba(60,49,33,.30), inset 0 1px 0 rgba(255,255,255,.9);
    --liftSm:0 1px 2px rgba(60,49,33,.05), 0 4px 12px -8px rgba(60,49,33,.22), inset 0 1px 0 rgba(255,255,255,.85);
  }
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);
    font:16px/1.6 var(--sans);padding:36px 38px 92px;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1420px;margin:0 auto}

  /* ── masthead ─────────────────────────────────────── */
  .top{display:grid;grid-template-columns:1fr auto;gap:34px;align-items:end;
    margin-bottom:26px;padding-bottom:22px;border-bottom:1px solid var(--rule2)}
  .brand{max-width:920px;font:600 44px/1.08 var(--serif);letter-spacing:-.022em}
  .brand b{font-weight:600;font-style:italic;color:var(--rust)}
  .tag{margin-top:13px;color:var(--muted);font:600 11px/1.4 var(--sans);
    letter-spacing:.13em;text-transform:uppercase}
  .tag code{font:11px var(--mono);text-transform:none;letter-spacing:0;color:var(--ink)}
  .whylink{font-style:normal;font-weight:600;color:#345c7e;text-decoration:none;border-bottom:1px solid rgba(52,92,126,.35)}
  .phlink{margin-top:10px;text-align:center;font-size:13px}
  .phlink a{color:#345c7e}
  .sub{margin-top:10px;max-width:790px;color:#575046;font:italic 17px/1.5 var(--serif)}
  .sub i{font-style:normal;color:var(--ink);font-weight:600}
  .chain{display:flex;gap:26px;text-align:right;color:var(--faint);
    font:600 9.5px/1.3 var(--sans);letter-spacing:.13em;text-transform:uppercase}
  .chain b{display:block;margin-top:6px;color:var(--ink);
    font:600 14px/1.2 var(--mono);letter-spacing:-.01em;text-transform:none}
  .live::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;
    background:var(--green);margin-right:6px;box-shadow:0 0 0 3px rgba(47,107,82,.15);
    animation:erP 2.2s infinite}
  @keyframes erP{50%{opacity:.3}}

  /* ── lifecycle rail: raised chips, not a flat table ── */
  .rail{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:9px}
  .step{background:var(--card);border:1px solid var(--rule);border-radius:12px;
    padding:13px 15px;box-shadow:var(--liftSm);transition:.35s}
  .step .n{font:700 9.5px/1.2 var(--sans);letter-spacing:.14em;color:var(--faint)}
  .step .t{margin-top:4px;font:italic 14px/1.35 var(--serif);color:var(--muted)}
  .step.done{background:var(--card2)}
  .step.done .t{color:#5f584d}
  .step.on{border-color:rgba(169,75,42,.45);background:#fdf6ef;
    box-shadow:0 1px 2px rgba(60,49,33,.06),0 12px 26px -14px rgba(169,75,42,.5),inset 0 1px 0 #fff}
  .step.on .n{color:var(--rust)} .step.on .t{color:var(--rust);font-weight:700}
  .step.kill{border-color:rgba(160,42,42,.42);background:#fdf3f2}
  .step.kill .n{color:var(--red)} .step.kill .t{color:var(--red);font-weight:700}
  .step.fin{border-color:rgba(47,107,82,.42);background:#f2f8f5}
  .step.fin .n{color:var(--green)} .step.fin .t{color:var(--green);font-weight:700}
  .railnote{margin:0 0 24px;color:var(--muted);font:italic 14px/1.5 var(--serif);text-align:right}
  .railnote i{color:var(--ink);font-style:normal;font-weight:600}

  /* ── the split ────────────────────────────────────── */
  .split{display:grid;grid-template-columns:1fr 252px 1fr;gap:16px;margin-bottom:22px;align-items:stretch}
  .side,.ring,.money,.card{background:var(--card);border:1px solid var(--rule);
    border-radius:16px;box-shadow:var(--lift)}
  .side{padding:22px 24px;display:flex;flex-direction:column}
  .side.merchant{border-top:3px solid var(--blue)}
  .side.payer{border-top:3px solid var(--rust)}
  .who{font:700 9.5px/1.2 var(--sans);letter-spacing:.15em;text-transform:uppercase;color:var(--faint)}
  .verdictline{margin:9px 0 16px;font:600 25px/1.2 var(--serif);letter-spacing:-.018em}
  .can{color:var(--green)} .cant{color:var(--red)} .wait{color:var(--amber)}
  .fnote{font:13px/1.7 var(--sans);color:var(--muted)}
  .fnote b{display:block;margin-bottom:2px;color:var(--ink);font:600 14px/1.4 var(--sans)}

  /* the contract's own words: an inset slab, the darkest thing on the page */
  .quote{margin-top:auto;background:#221f1a;border:1px solid #100e0b;border-radius:13px;
    padding:16px 18px;box-shadow:0 12px 28px -16px rgba(34,31,26,.75),inset 0 1px 0 rgba(255,255,255,.07)}
  .quote .lbl{font:10px/1.4 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:#8d857a}
  .quote .said{margin-top:8px;font:700 17px/1.35 var(--mono);color:#ff8f6e;word-break:break-word}
  .quote .prov{margin-top:9px;font:10.5px/1.4 var(--mono);color:#7d766c}
  .quote.ok .said{color:#6fd6a4}

  button{font:600 14px/1 var(--sans);letter-spacing:.02em;border:1px solid transparent;
    border-radius:11px;padding:14px 20px;cursor:pointer;width:100%;transition:.15s}
  button:disabled{opacity:.45;cursor:not-allowed}
  .bSettle{background:var(--card2);color:var(--ink);border-color:var(--rule2);box-shadow:var(--liftSm)}
  .bSettle.blocked{color:var(--muted)}
  .bSettle:hover:not(:disabled){background:#fff}
  .bCancel{background:var(--red);color:#fff;
    box-shadow:0 1px 2px rgba(160,42,42,.25),0 10px 22px -12px rgba(160,42,42,.85)}
  .bCancel:hover:not(:disabled){background:#8e2424}

  .ring{display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:20px 14px;background:linear-gradient(180deg,#fffefb,#f7f2e8)}
  .ring svg{transform:rotate(-90deg)}
  .ring svg circle:first-child{stroke:#e2dacb}
  .ringwrap{position:relative;width:172px;height:172px}
  .ringtxt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .ringnum{font:600 50px/1 var(--serif);letter-spacing:-.035em;font-variant-numeric:tabular-nums}
  .ringlbl{margin-top:7px;font:700 9.5px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
  .ringcap{margin-top:16px;text-align:center;font:italic 13px/1.5 var(--serif);color:var(--muted)}
  .ringcap b{color:var(--ink);font-weight:600;font-style:normal}

  /* ── money ────────────────────────────────────────── */
  .money{padding:20px 24px;margin-bottom:22px}
  .money h3,.card h3{margin:0 0 14px;font:700 9.5px/1.2 var(--sans);
    letter-spacing:.15em;text-transform:uppercase;color:var(--faint)}
  .mrow{display:flex;align-items:center;gap:18px;margin-top:12px;font:14px/1.4 var(--sans)}
  .mrow .nm{width:132px;color:var(--muted)}
  .mrow .bar{flex:1;height:12px;border-radius:6px;background:#eae3d5;
    box-shadow:inset 0 1px 2px rgba(60,49,33,.12);overflow:hidden}
  .mrow .bar i{display:block;height:100%;border-radius:6px;transition:width .6s ease}
  .mrow.p .bar i{background:linear-gradient(90deg,#4b8f72,var(--green))}
  .mrow.m .bar i{background:linear-gradient(90deg,#4d7ea6,var(--blue))}
  .mrow .dv{width:82px;text-align:right;color:var(--faint);font:12px/1 var(--mono)}
  .mrow .dv.moved{color:var(--green);font-weight:700}
  .mrow .v{width:118px;text-align:right;font:600 17px/1 var(--mono);font-variant-numeric:tabular-nums}
  .still{margin-top:16px;padding:11px 15px;border-radius:11px;background:#f1f7f3;
    border:1px solid rgba(47,107,82,.2);color:#2b6349;font:italic 14px/1.5 var(--serif)}
  .still b{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums}

  /* ── events + footer notes ────────────────────────── */
  .card{padding:20px 24px;margin-bottom:22px}
  .ev{display:flex;gap:16px;align-items:baseline;padding:11px 0;
    border-bottom:1px solid var(--rule);font:12.5px/1.4 var(--mono)}
  .ev:last-child{border:0;padding-bottom:0}
  .ev .kind{width:190px;flex-shrink:0;font-weight:700}
  .ev .used{color:var(--green)} .ev .canc{color:var(--red)}
  .ev .meta{flex:1;color:var(--muted);word-break:break-all}
  .empty{padding:6px 0;color:var(--faint);font:italic 14px/1.5 var(--serif)}

  .pieces{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .pieces .piece{display:block;padding:16px 18px;background:var(--card2);
    border:1px solid var(--rule);border-radius:13px;box-shadow:var(--liftSm)}
  .pieces .piece .k{width:auto;margin-bottom:6px;font:700 9.5px/1 var(--sans);
    letter-spacing:.15em;text-transform:uppercase}
  .pieces .piece .d{color:var(--muted);font:13.5px/1.55 var(--sans)}
  .pieces .piece .d b{color:var(--ink);font-weight:650}
  .pieces .piece .d code{font:12px var(--mono);color:var(--ink)}
  .kX{color:#6a4fa8} .kA{color:#c0392b} .kW{color:var(--amber)}

  .cta{padding:15px 17px;border-radius:12px;background:var(--card2);
    border:1px solid var(--rule);box-shadow:var(--liftSm);
    font:13px/1.7 var(--mono);color:var(--muted)}
  .cta b{color:var(--rust)}
  a{color:var(--blue);text-decoration:none;border-bottom:1px solid rgba(52,92,126,.3)}
  a:hover{border-bottom-color:var(--blue)}

  @media(max-width:1180px){.split{grid-template-columns:1fr}.rail{grid-template-columns:1fr 1fr}
    .pieces{grid-template-columns:1fr}.brand{font-size:34px}}
  /* phones: the masthead has to stop being a poster and start being a header */
  @media(max-width:640px){
    body{padding:22px 16px 60px}
    .top{grid-template-columns:1fr;gap:16px;align-items:start}
    .brand{font-size:27px;line-height:1.15;letter-spacing:-.015em}
    .sub{font-size:15px}
    .chain{gap:18px;text-align:left;flex-wrap:wrap}
    .chain b{font-size:12.5px}
    .rail{grid-template-columns:1fr;gap:7px}
    .step{padding:10px 13px;display:flex;align-items:baseline;gap:10px}
    .step .n{flex-shrink:0} .step .t{margin-top:0}
    .railnote{text-align:left;font-size:13px}
    .side{padding:17px 18px}
    .verdictline{font-size:21px}
    .quote .said{font-size:15px}
    .mrow{flex-wrap:wrap;gap:8px 12px}
    .mrow .nm{width:auto;flex:1} .mrow .bar{order:5;flex-basis:100%}
    .mrow .dv{width:auto} .mrow .v{width:auto}
  }
`)

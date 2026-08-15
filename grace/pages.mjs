/**
 * GRACE UI — three server-rendered pages, zero build step, zero dependencies.
 * Dark terminal aesthetic: the demo's star is a revert string, so the UI is
 * built around showing chain output big and verbatim.
 */

const CSS = /* css */ `
  :root {
    --bg: #0b0e14; --panel: #11151f; --edge: #1e2432;
    --text: #d7dce6; --dim: #6b7385;
    --green: #3ecf8e; --red: #ff5d5d; --amber: #ffb454; --blue: #59a7ff;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 15px/1.55 "SF Mono", ui-monospace, Menlo, monospace;
    min-height: 100vh; padding: 28px 20px 60px;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 19px; letter-spacing: .04em; }
  h1 .g { color: var(--green); }
  .sub { color: var(--dim); font-size: 12.5px; margin: 4px 0 26px; }
  .card {
    background: var(--panel); border: 1px solid var(--edge);
    border-radius: 10px; padding: 18px 20px; margin-bottom: 14px;
  }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .badge {
    display: inline-block; padding: 2px 10px; border-radius: 99px;
    font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase;
  }
  .b-cooling { background: #2b2413; color: var(--amber); }
  .b-settleable { background: #10291e; color: var(--green); }
  .b-void, .b-voided, .b-error, .b-insufficient { background: #2c1416; color: var(--red); }
  .b-settled { background: #13233a; color: var(--blue); }
  .amount { font-size: 26px; font-weight: 700; }
  .dim { color: var(--dim); font-size: 12.5px; }
  .addr { color: var(--dim); font-size: 11.5px; word-break: break-all; }
  .verdict {
    margin-top: 12px; padding: 12px 14px; border-radius: 8px;
    background: #0d1017; border: 1px dashed var(--edge); font-size: 13px;
  }
  .verdict .reason { color: var(--red); font-size: 15px; font-weight: 600; display: block; margin-top: 4px; }
  .verdict.ok .reason { color: var(--green); }
  button {
    font: inherit; font-weight: 700; letter-spacing: .05em;
    border: 0; border-radius: 8px; padding: 12px 22px; cursor: pointer;
  }
  .settle { background: var(--green); color: #04130c; }
  .settle.blocked { background: #1c2330; color: var(--dim); }
  .cancel { background: var(--red); color: #1b0505; width: 100%; padding: 18px; font-size: 17px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .count { font-variant-numeric: tabular-nums; font-size: 44px; font-weight: 700; text-align: center; margin: 10px 0 2px; }
  .bar { height: 6px; background: var(--edge); border-radius: 3px; overflow: hidden; margin: 10px 0 18px; }
  .bar i { display: block; height: 100%; background: var(--amber); transition: width 1s linear; }
  a { color: var(--blue); text-decoration: none; }
  .txlink { font-size: 12px; }
  .flash { animation: flash .5s ease; }
  @keyframes flash { from { background: #2c1416; } }
  .bal { display: flex; gap: 26px; margin-bottom: 22px; }
  .bal div b { font-size: 19px; display: block; }
  .center { text-align: center; }
  .big-state { font-size: 21px; font-weight: 700; margin: 16px 0 6px; }
  code { background: #0d1017; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  td, th { text-align: left; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--edge); }
  th { color: var(--dim); font-weight: 400; font-size: 12px; }
`

const shell = (title, body, refreshJs = '') => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${CSS}</style></head>
<body><div class="wrap">${body}</div><script>${refreshJs}</script></body></html>`

// ── merchant console ─────────────────────────────────────────────────────────
export function consolePage(net) {
  const body = `
    <h1><span class="g">GRACE</span> · merchant console</h1>
    <div class="sub">${net.label} · every verdict below is the chain's own answer, refreshed live</div>
    <div class="bal" id="bal"></div>
    <div id="orders"><div class="card dim">loading order book…</div></div>`

  const js = `
  const fmt = (s) => new Date(s * 1000).toLocaleTimeString();
  async function tick() {
    const r = await fetch('/api/orders'); const d = await r.json();
    document.getElementById('bal').innerHTML =
      '<div><span class="dim">merchant XSGD</span><b>' + d.merchantXsgd + '</b></div>' +
      '<div><span class="dim">buyer XSGD</span><b>' + d.buyerXsgd + '</b></div>';
    const el = document.getElementById('orders');
    if (!d.orders.length) { el.innerHTML = '<div class="card dim">no orders yet — run the buyer agent</div>'; return; }
    el.innerHTML = d.orders.map(o => {
      const st = o.live.state;
      const badge = '<span class="badge b-' + st + '">' + st + '</span>';
      const countdown = st === 'cooling-off'
        ? '<span class="dim">window closes in <b>' + o.secondsLeft + 's</b> (' + fmt(o.opensAt) + ')</span>' : '';
      const verdict = o.live.reason
        ? '<div class="verdict">chain says:<span class="reason">"' + o.live.reason + '"</span><span class="dim">' + o.live.detail + '</span></div>'
        : (st === 'settleable' ? '<div class="verdict ok">chain says:<span class="reason">ready — receiveWithAuthorization will succeed</span></div>' : '');
      const txs = Object.entries(o.txs || {}).map(([k, h]) =>
        '<a class="txlink" target="_blank" href="' + o.explorer + '/tx/' + h + '">' + k + ' tx ↗</a>').join(' · ');
      const btn = (st === 'settled' || st === 'void')
        ? '' : '<button class="settle ' + (st === 'settleable' ? '' : 'blocked') + '" onclick="doSettle(\\'' + o.id + '\\', this)">SETTLE</button>';
      return '<div class="card" id="o-' + o.id + '">' +
        '<div class="row"><div><b>' + o.name + '</b> <span class="dim">#' + o.id + '</span><br>' +
        '<span class="addr">payer ' + o.payer + '</span></div>' +
        '<div class="amount">S$' + o.amountSgd + '</div></div>' +
        '<div class="row" style="margin-top:10px">' + badge + countdown + btn + '</div>' +
        verdict + (txs ? '<div style="margin-top:8px">' + txs + '</div>' : '') + '</div>';
    }).join('');
  }
  async function doSettle(id, btn) {
    btn.disabled = true; btn.textContent = 'broadcasting…';
    const r = await fetch('/api/orders/' + id + '/settle', { method: 'POST' });
    const d = await r.json();
    if (!d.ok) {
      const card = document.getElementById('o-' + id);
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    }
    await tick();
  }
  tick(); setInterval(tick, 2000);`
  return shell('GRACE · merchant', body, js)
}

// ── buyer phone page ─────────────────────────────────────────────────────────
export function payPage(order, net) {
  const body = `
    <h1><span class="g">GRACE</span> · payment pending</h1>
    <div class="sub">your agent signed this — nothing has left your wallet</div>
    <div class="card center" id="main">
      <div class="dim">${order.name}</div>
      <div class="amount" style="font-size:38px">S$${order.amountSgd}</div>
      <div class="addr" style="margin:6px 0 2px">to merchant ${order.authorization.to}</div>
      <div id="stateArea">
        <div class="count" id="count">–</div>
        <div class="dim">until the merchant can settle</div>
        <div class="bar"><i id="bar" style="width:100%"></i></div>
        <button class="cancel" id="cancelBtn" onclick="doCancel(this)">CANCEL — costs you nothing</button>
        <div class="dim" style="margin-top:10px">cancellation burns the authorization on-chain.<br>your wallet needs no gas: a relayer broadcasts your signature.</div>
      </div>
    </div>`

  const js = `
  const id = '${order.id}', opensAt = ${order.opensAt}, windowSeconds = ${order.windowSeconds};
  let done = false;
  function render(o) {
    const area = document.getElementById('stateArea');
    if (o.status === 'voided') {
      done = true;
      area.innerHTML = '<div class="big-state" style="color:var(--red)">✕ CANCELLED</div>' +
        '<div class="dim">The nonce is burned on-chain — this payment can never be settled by anyone.</div>' +
        (o.txs.cancel ? '<div style="margin-top:10px"><a target="_blank" href="' + o.explorer + '/tx/' + o.txs.cancel + '">cancelAuthorization tx ↗</a></div>' : '') +
        '<div class="dim" style="margin-top:14px">your balance never moved.</div>';
      return;
    }
    if (o.status === 'settled') {
      done = true;
      area.innerHTML = '<div class="big-state" style="color:var(--blue)">✓ SETTLED</div>' +
        '<div class="dim">The cooling-off window passed without objection. Settlement is final.</div>' +
        (o.txs.settle ? '<div style="margin-top:10px"><a target="_blank" href="' + o.explorer + '/tx/' + o.txs.settle + '">settlement tx ↗</a></div>' : '');
      return;
    }
    const left = Math.max(0, opensAt - Math.floor(Date.now() / 1000));
    document.getElementById('count').textContent = left + 's';
    document.getElementById('bar').style.width = (100 * left / windowSeconds) + '%';
    if (left === 0) {
      document.getElementById('cancelBtn').disabled = true;
      document.getElementById('cancelBtn').textContent = 'window closed — merchant may settle';
    }
  }
  async function doCancel(btn) {
    btn.disabled = true; btn.textContent = 'broadcasting cancellation…';
    const r = await fetch('/api/orders/' + id + '/cancel', { method: 'POST' });
    const d = await r.json();
    if (!d.ok) { btn.disabled = false; btn.textContent = 'CANCEL — costs you nothing'; alert(d.reason); return; }
    render(d.order);
  }
  async function poll() {
    if (done) return;
    const r = await fetch('/api/orders/' + id); render(await r.json());
  }
  setInterval(() => { if (!done) render({ status: 'pending', txs: {} }); }, 1000);
  poll(); setInterval(poll, 2500);`
  return shell('GRACE · confirm', body, js)
}

// ── storefront / docs ────────────────────────────────────────────────────────
export function storefrontPage(catalog, net, merchantAddr) {
  const rows = Object.entries(catalog).map(([sku, i]) =>
    `<tr><td><code>${sku}</code></td><td>${i.name}</td><td>S$${i.priceSgd}</td>
     <td>${i.coolingOffSeconds}s</td><td class="dim">${i.fulfilment}</td></tr>`).join('')
  const body = `
    <h1><span class="g">GRACE</span> · demo storefront</h1>
    <div class="sub">${net.label} · a merchant that sells to AI agents over x402 — with a cooling-off period</div>
    <div class="card">
      <table>
        <tr><th>sku</th><th>item</th><th>price</th><th>cooling-off</th><th>fulfilment</th></tr>
        ${rows}
      </table>
    </div>
    <div class="card">
      <b>Protocol</b>
      <div class="dim" style="margin-top:8px">
        POST /checkout {"sku": …} → <code>402</code> with scheme <code>exact-deferred</code> and
        <code>extra.coolingOffSeconds</code>.<br><br>
        The agent signs a standard EIP-3009 ReceiveWithAuthorization with
        <code>validAfter = now + coolingOffSeconds</code>. Until validAfter, XSGD itself refuses
        settlement; the payer may cancel unilaterally. coolingOffSeconds = 0 is exactly today's
        <code>exact</code> scheme — fully backwards compatible.<br><br>
        merchant ${merchantAddr}
      </div>
    </div>
    <div class="card dim">console: <a href="/console">/console</a></div>`
  return shell('GRACE · store', body)
}

/**
 * GRACE Mission Control — the one screen the demo lives on.
 *
 * Design brief: a judge at the back of a room, sixty seconds, thirty payment
 * demos already seen today. The screen has to carry the argument on its own:
 *
 *   1. the countdown sits BETWEEN the two parties, because the same number
 *      means "you cannot cash this" to one of them and "you can still kill it"
 *      to the other — that asymmetry is the entire product
 *   2. the chain's refusal is quoted verbatim and huge; it is the evidence that
 *      the rule lives in the token, not in our server
 *   3. the payer's balance is shown with a running "unchanged for" timer, so
 *      "nothing moved" is measured rather than claimed
 *   4. Avalanche / XSGD / AWS each appear as a working part with live state
 *      (block height, contract address, the scheduler's firing time) rather
 *      than as logos
 */

const CSS = /* css */ `
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
`

export function missionPage(net) {
  const body = /* html */ `
  <div class="wrap">
    <div class="top">
      <div>
        <div class="brand">The claim moves now. <b>The money moves only after the veto window.</b></div>
        <div class="tag">GRACE · a cooling-off rail for agentic payments · x402 scheme <code>exact-deferred</code></div>
      </div>
      <div class="chain">
        <div><span class="live">network</span><b>${net.label}</b></div>
        <div>block<b id="blk">…</b></div>
        <div>XSGD contract<b id="tok" style="font-size:11.5px">${net.token.slice(0, 10)}…${net.token.slice(-6)}</b></div>
      </div>
    </div>

    <div class="thesis" id="thesis">
      A merchant can't tell whether the human behind an AI agent actually wanted the order —
      and no dispute code exists for <i>"my agent did it"</i>.
      <b>GRACE makes every settled payment one a human chose not to veto.</b>
    </div>

    <div class="rail" id="rail"></div>
    <div class="railnote">AWS decides <i>when to ask</i>. XSGD decides <i>whether it succeeds</i>. Nobody decides on the payer's behalf.</div>

    <div class="split">
      <div class="side merchant">
        <div class="who">merchant · holds the claim</div>
        <div class="verdictline" id="mVerdict">waiting for an order</div>
        <div class="fnote">receiveWithAuthorization<br>requires msg.sender == payee<br><b>only the merchant can cash it</b></div>
        <div style="margin-top:14px" id="mBtn"></div>
        <div class="quote" id="mQuote" style="display:none">
          <div class="lbl">Avalanche RPC → XSGD ${net.token.slice(0, 8)}…${net.token.slice(-4)} → receiveWithAuthorization()</div>
          <div class="said" id="mSaid"></div>
          <div class="prov" id="mProv">eth_call · no transaction submitted · 0 gas spent</div>
        </div>
      </div>

      <div class="ring">
        <div class="ringwrap">
          <svg width="170" height="170">
            <circle cx="85" cy="85" r="72" fill="none" stroke="#1a2231" stroke-width="11"/>
            <circle id="arc" cx="85" cy="85" r="72" fill="none" stroke="#ffb340" stroke-width="11"
                    stroke-linecap="round" stroke-dasharray="452" stroke-dashoffset="452"/>
          </svg>
          <div class="ringtxt">
            <div class="ringnum" id="ringNum">—</div>
            <div class="ringlbl" id="ringLbl">cooling-off</div>
          </div>
        </div>
        <div class="ringcap" id="ringCap">the same number means<br><b>"not yet yours"</b> to the merchant<br>and <b>"still yours"</b> to the payer</div>
      </div>

      <div class="side payer">
        <div class="who">payer · holds the veto</div>
        <div class="verdictline" id="pVerdict">no payment pending</div>
        <div class="fnote">cancelAuthorization<br>signed by the payer, broadcast by anyone<br><b>the payer's wallet needs zero AVAX</b></div>
        <div style="margin-top:14px" id="pBtn"></div>
      </div>
    </div>

    <div class="money">
      <h3>where the money is</h3>
      <div class="mrow p"><div class="nm">payer wallet</div><div class="bar"><i id="pBar" style="width:0"></i></div><div class="dv" id="pDelta">Δ 0.00</div><div class="v" id="pVal">—</div></div>
      <div class="mrow m"><div class="nm">merchant wallet</div><div class="bar"><i id="mBar" style="width:0"></i></div><div class="dv" id="mDelta">Δ 0.00</div><div class="v" id="mVal">—</div></div>
      <div class="still" id="still"></div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>how the three pieces carry the rail</h3>
        <div class="piece"><div class="k kX">XSGD</div><div class="d">The rule lives in the token. <code>FiatTokenV2_2</code> already implements EIP-3009 — GRACE deploys <b>no contract</b> and changes one field: <code>validAfter</code>.</div></div>
        <div class="piece"><div class="k kA">Avalanche</div><div class="d">~2s finality is what makes a 90-second window safe: the veto lands long before the edge. Settlement and cancellation are both real C-Chain transactions.</div></div>
        <div class="piece"><div class="k kW">AWS</div><div class="d" id="awsD">One-shot EventBridge schedule per order at <code>validAfter</code> → Lambda → settle. The Lambda holds <b>zero keys</b>; the chain stays the only authority.</div></div>
      </div>
      <div class="card">
        <h3>on-chain events · nonce = keccak256(order)</h3>
        <div id="events"><div class="empty">no settlements or cancellations yet</div></div>
      </div>
    </div>
  </div>`

  const js = /* js */ `
  const $=(i)=>document.getElementById(i);
  const CIRC=452, MAXBAR=20;
  // Five verbs, each owned by a named system — the coupling has to read as
  // machinery, not as a sponsor strip.
  const STEPS=[
    {n:'BEDROCK',t:'decides'},{n:'AGENT',t:'signs'},
    {n:'XSGD',t:'holds the window'},{n:'EVENTBRIDGE → LAMBDA',t:'call at validAfter'},{n:'XSGD',t:'settles, finally'}
  ];
  let d=null, base=null, baseOrder=null;

  function rail(state){
    let active=-1, kill=false, fin=false;
    if(state==='cooling-off'){active=2}
    else if(state==='settleable'||state==='insufficient'){active=3}
    else if(state==='settled'){fin=true;active=4}
    else if(state==='voided'||state==='void'){kill=true;active=2}
    $('rail').innerHTML=STEPS.map((s,i)=>{
      let c='step';
      if(fin&&i<=4)c+=' fin';
      else if(kill&&i===2)c+=' kill';
      else if(i<active)c+=' done';
      else if(i===active)c+=' on';
      return '<div class="'+c+'"><div class="n">'+s.n+'</div><div class="t">'+
        (kill&&i===2?'✕ vetoed by the human':s.t)+'</div></div>';
    }).join('');
  }

  function fmtAge(ms){
    const s=Math.floor(ms/1000);
    if(s<60)return s+'s';
    const m=Math.floor(s/60);
    return m+'m '+(s%60)+'s';
  }

  async function act(id,what,btn){
    // Honest labels: an early settle never leaves the node — it is an eth_call
    // that reverts. Only a valid settle becomes a transaction.
    btn.disabled=true; btn.textContent=what==='settle'?'calling XSGD…':'signing + broadcasting cancellation…';
    try{ await fetch('/api/orders/'+id+'/'+what,{method:'POST'}); }catch(e){}
    await pull();
  }

  function render(){
    if(!d)return;
    $('blk').textContent=d.chain.block?Number(d.chain.block).toLocaleString():'…';

    const p=parseFloat(d.wallets.payerXsgd), m=parseFloat(d.wallets.merchantXsgd);
    $('pVal').textContent=d.wallets.payerXsgd+' XSGD';
    $('mVal').textContent=d.wallets.merchantXsgd+' XSGD';
    $('pBar').style.width=Math.min(100,p/MAXBAR*100)+'%';
    $('mBar').style.width=Math.min(100,m/MAXBAR*100)+'%';
    // Δ against the balances as they stood when this order was signed: the
    // claim exists, the money has not answered for it.
    if(base===null){base={p,m}}
    const dp=p-base.p, dm=m-base.m;
    const fmtD=(x)=>(x===0?'Δ 0.00':(x>0?'Δ +':'Δ ')+x.toFixed(2));
    $('pDelta').textContent=fmtD(dp); $('pDelta').className='dv'+(dp?' moved':'');
    $('mDelta').textContent=fmtD(dm); $('mDelta').className='dv'+(dm?' moved':'');

    const o=d.active;
    const st=o?o.live.state:null;
    // A new order re-anchors the delta baseline.
    if(o && o.id!==baseOrder){ baseOrder=o.id; base={p,m}; }
    rail(st);

    if(!o){
      $('mVerdict').innerHTML='<span class="wait">waiting for an order</span>';
      $('pVerdict').innerHTML='<span class="wait">no payment pending</span>';
      $('mQuote').style.display='none';
      $('ringNum').textContent='—'; $('ringLbl').textContent='idle';
      $('arc').style.strokeDashoffset=CIRC;
      $('mBtn').innerHTML='';
      $('pBtn').innerHTML='<div class="cta">start a purchase:<br><b>node grace/agent.mjs --sku tee-agentix \\\\<br>&nbsp;&nbsp;--server '+location.origin+' --brain</b></div>';
      $('still').innerHTML='balances idle · <b>'+fmtAge(d.wallets.unchangedForMs)+'</b> since the last on-chain movement';
      return;
    }

    const left=Math.max(0,o.opensAt-Math.floor(Date.now()/1000));
    const total=o.windowSeconds||1;

    if(st==='cooling-off'){
      $('ringNum').textContent=left+'s'; $('ringLbl').textContent='cooling-off';
      $('arc').setAttribute('stroke','#ffb340');
      $('arc').style.strokeDashoffset=CIRC*(1-left/total);
      $('mVerdict').innerHTML='<span class="cant">cannot cash it — '+left+'s to go</span>';
      $('pVerdict').innerHTML='<span class="can">can void it, unilaterally</span>';
      $('mBtn').innerHTML='<button class="bSettle blocked" onclick="act(\\''+o.id+'\\',\\'settle\\',this)">SETTLE anyway →</button>';
      $('pBtn').innerHTML='<button class="bCancel" onclick="act(\\''+o.id+'\\',\\'cancel\\',this)">CANCEL AUTHORIZATION · payer pays 0 gas</button>';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'…')+'"';
      $('ringCap').innerHTML='the same number means<br><b>"not yet yours"</b> to the merchant<br>and <b>"still yours"</b> to the payer';
    } else if(st==='voided'||st==='void'){
      $('ringNum').textContent='✕'; $('ringLbl').textContent='voided';
      $('arc').setAttribute('stroke','#ff5f5f'); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="cant">this claim is dead forever</span>';
      $('pVerdict').innerHTML='<span class="can">vetoed · balance never moved</span>';
      $('mBtn').innerHTML='<button class="bSettle blocked" onclick="act(\\''+o.id+'\\',\\'settle\\',this)">SETTLE anyway →</button>';
      $('pBtn').innerHTML='<div class="cta">the nonce is burned on-chain.<br><b>no one can ever settle it</b></div>';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'FiatTokenV2: authorization is used or canceled')+'"';
      $('ringCap').innerHTML='nothing was refunded<br><b>because nothing ever left</b>';
    } else if(st==='settled'){
      $('ringNum').textContent='✓'; $('ringLbl').textContent='final';
      $('arc').setAttribute('stroke','#3ddc91'); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="can">settled · final, no chargeback exists</span>';
      $('pVerdict').innerHTML='<span class="wait">window passed without objection</span>';
      $('mBtn').innerHTML=''; $('pBtn').innerHTML='';
      $('mQuote').style.display='none';
      $('ringCap').innerHTML='the human did not object<br><b>so the money moved — once, finally</b>';
    } else if(st==='expired'){
      $('ringNum').textContent='—'; $('ringLbl').textContent='lapsed';
      $('arc').setAttribute('stroke','#4a5568'); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="cant">claim lapsed — merchant waited too long</span>';
      $('pVerdict').innerHTML='<span class="wait">nothing was ever taken</span>';
      $('mBtn').innerHTML=''; $('pBtn').innerHTML='';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'')+'"';
      $('ringCap').innerHTML='claims expire on their own<br><b>the payer risks nothing by waiting</b>';
    } else {
      $('ringNum').textContent='0s'; $('ringLbl').textContent='window closed';
      $('arc').setAttribute('stroke','#3ddc91'); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="can">may cash it now</span>';
      $('pVerdict').innerHTML='<span class="cant">veto expired</span>';
      $('mBtn').innerHTML='<button class="bSettle" onclick="act(\\''+o.id+'\\',\\'settle\\',this)">SETTLE →</button>';
      $('pBtn').innerHTML='<div class="cta">the window closed.<br><b>AWS settles this automatically</b></div>';
      $('mQuote').style.display=o.live.reason?'block':'none';
      if(o.live.reason)$('mSaid').textContent='"'+o.live.reason+'"';
      $('ringCap').innerHTML='AWS EventBridge fires at<br><b>'+new Date(o.opensAt*1000).toLocaleTimeString()+'</b>';
    }

    const moved=(st==='settled');
    $('still').innerHTML=moved
      ?'settlement moved <b>S$'+o.amountSgd+'</b> · finality is the point: there is no reversal after this'
      :'the payer\\'s balance has not moved for <b>'+fmtAge(d.wallets.unchangedForMs)+'</b> — there is nothing to refund';

    $('events').innerHTML=d.events.length?d.events.map(e=>
      '<div class="ev"><div class="kind '+(e.kind==='AuthorizationUsed'?'used':'canc')+'">'+e.kind+'</div>'+
      '<div class="meta">S$'+e.amountSgd+' · nonce '+e.nonce.slice(0,14)+'… · '+
      '<a target="_blank" href="'+d.chain.explorer+'/tx/'+e.tx+'">'+e.tx.slice(0,12)+'… ↗</a></div></div>'
    ).join(''):'<div class="empty">no settlements or cancellations yet</div>';
  }

  async function pull(){
    try{ d=await (await fetch('/api/state')).json(); render(); }catch(e){}
  }
  window.act=act;
  pull(); setInterval(pull,2000); setInterval(()=>{ if(d)render(); },1000);
  `

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GRACE · mission control</title><style>${CSS}</style></head>
<body>${body}<script>${js}</script></body></html>`
}

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

import { themeFor, pickerHtml, PICKER_CSS } from './themes.mjs'

export function missionPage(net, themeKey = 'editorial', showPicker = false) {
  const theme = themeFor(themeKey)
  const body = /* html */ `
  <div class="wrap">
    <div class="top">
      <div>
        <div class="brand">The claim moves now. <b>The money moves only after the veto window.</b></div>
        <div class="tag">GRACE · a cooling-off rail for agentic payments · x402 scheme <code>exact-deferred</code></div>
        <div class="sub">No dispute code exists for <i>“my agent did it.”</i> So every payment settled here is one a human chose not to veto.</div>
      </div>
      <div class="chain">
        <div><span class="live">network</span><b>${net.label}</b></div>
        <div>block<b id="blk">…</b></div>
        <div>XSGD contract<b id="tok" style="font-size:11.5px">${net.token.slice(0, 10)}…${net.token.slice(-6)}</b></div>
      </div>
    </div>

    <div class="rail" id="rail"></div>
    <div class="railnote">AWS decides <i>when to ask</i>. XSGD decides <i>whether it succeeds</i>. Nobody decides on the payer's behalf.</div>

    <div class="split">
      <div class="side merchant">
        <div class="who">merchant · holds the claim</div>
        <div class="verdictline" id="mVerdict">waiting for an order</div>
        <div class="fnote"><b>only the merchant can cash it</b><br>receiveWithAuthorization requires msg.sender == payee</div>
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
        <div class="fnote"><b>only the payer can void it</b><br>cancelAuthorization is signed by the payer, broadcast by anyone</div>
        <div style="margin-top:14px" id="pBtn"></div>
      </div>
    </div>

    <div class="money">
      <h3>where the money is</h3>
      <div class="mrow p"><div class="nm">payer wallet</div><div class="bar"><i id="pBar" style="width:0"></i></div><div class="dv" id="pDelta">Δ 0.00</div><div class="v" id="pVal">—</div></div>
      <div class="mrow m"><div class="nm">merchant wallet</div><div class="bar"><i id="mBar" style="width:0"></i></div><div class="dv" id="mDelta">Δ 0.00</div><div class="v" id="mVal">—</div></div>
      <div class="still" id="still"></div>
    </div>

    <div class="card">
      <h3>on-chain events · nonce = keccak256(order)</h3>
      <div id="events"><div class="empty">no settlements or cancellations yet</div></div>
    </div>

    <div class="pieces">
      <div class="piece"><div class="k kX">XSGD</div><div class="d">the rule lives in the token — <b>no contract deployed</b>, one field changed: <code>validAfter</code></div></div>
      <div class="piece"><div class="k kA">Avalanche</div><div class="d">~2s finality is what makes a 90s window safe — the veto lands long before the edge</div></div>
      <div class="piece"><div class="k kW">AWS</div><div class="d">one-shot EventBridge schedule → Lambda → settle; the Lambda holds <b>zero keys</b></div></div>
    </div>
  </div>`

  const js = /* js */ `
  const $=(i)=>document.getElementById(i);
  const CIRC=452, MAXBAR=20, ARC=${JSON.stringify(theme.arc)};
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
      $('arc').setAttribute('stroke',ARC.cooling);
      $('arc').style.strokeDashoffset=CIRC*(1-left/total);
      $('mVerdict').innerHTML='<span class="cant">cannot cash it — '+left+'s to go</span>';
      $('pVerdict').innerHTML='<span class="can">can void it, unilaterally</span>';
      $('mBtn').innerHTML='<button class="bSettle blocked" onclick="act(\\''+o.id+'\\',\\'settle\\',this)">SETTLE anyway →</button>';
      $('pBtn').innerHTML='<button class="bCancel" onclick="act(\\''+o.id+'\\',\\'cancel\\',this)">CANCEL AUTHORIZATION · payer pays 0 gas</button>'+
        '<div class="phlink"><a href="/phone?id='+o.id+'">open this on the payer\\'s phone →</a></div>';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'…')+'"';
      $('ringCap').innerHTML='the same number means<br><b>"not yet yours"</b> to the merchant<br>and <b>"still yours"</b> to the payer';
    } else if(st==='voided'||st==='void'){
      $('ringNum').textContent='✕'; $('ringLbl').textContent='voided';
      $('arc').setAttribute('stroke',ARC.void); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="cant">this claim is dead forever</span>';
      $('pVerdict').innerHTML='<span class="can">vetoed · balance never moved</span>';
      $('mBtn').innerHTML='<button class="bSettle blocked" onclick="act(\\''+o.id+'\\',\\'settle\\',this)">SETTLE anyway →</button>';
      $('pBtn').innerHTML='<div class="cta">the nonce is burned on-chain.<br><b>no one can ever settle it</b></div>';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'FiatTokenV2: authorization is used or canceled')+'"';
      $('ringCap').innerHTML='nothing was refunded<br><b>because nothing ever left</b>';
    } else if(st==='settled'){
      $('ringNum').textContent='✓'; $('ringLbl').textContent='final';
      $('arc').setAttribute('stroke',ARC.settled); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="can">settled · final, no chargeback exists</span>';
      $('pVerdict').innerHTML='<span class="wait">window passed without objection</span>';
      $('mBtn').innerHTML=''; $('pBtn').innerHTML='';
      $('mQuote').style.display='none';
      $('ringCap').innerHTML='the human did not object<br><b>so the money moved — once, finally</b>';
    } else if(st==='expired'){
      $('ringNum').textContent='—'; $('ringLbl').textContent='lapsed';
      $('arc').setAttribute('stroke',ARC.lapsed); $('arc').style.strokeDashoffset=0;
      $('mVerdict').innerHTML='<span class="cant">claim lapsed — merchant waited too long</span>';
      $('pVerdict').innerHTML='<span class="wait">nothing was ever taken</span>';
      $('mBtn').innerHTML=''; $('pBtn').innerHTML='';
      $('mQuote').style.display='block'; $('mQuote').className='quote';
      $('mSaid').textContent='"'+(o.live.reason||'')+'"';
      $('ringCap').innerHTML='claims expire on their own<br><b>the payer risks nothing by waiting</b>';
    } else {
      $('ringNum').textContent='0s'; $('ringLbl').textContent='window closed';
      $('arc').setAttribute('stroke',ARC.settled); $('arc').style.strokeDashoffset=0;
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
<title>GRACE · mission control</title><style>${theme.css}
${PICKER_CSS}</style></head>
<body>${body}${showPicker ? pickerHtml(theme.key) : ''}<script>${js}</script></body></html>`
}

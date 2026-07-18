/* ============================================================
   Algo Trading — Live Dashboard front-end (v2)
   Adds: live prices, per-trade log + trade explorer, chart
   hover crosshair w/ dates, hedge-fund tearsheet metrics,
   monthly heatmap, rolling Sharpe, exposure & return dist.
   Pure vanilla JS + hand-drawn SVG (works offline).
   ============================================================ */
"use strict";

let SNAP = null;
const CHARTS = {};           // id -> {curve, geom} for hover
let cid = 0;

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const dash = "—";
const fmtUsd = v => (v==null? dash : "$"+Math.round(v).toLocaleString("en-US"));
const fmtUsdS= v => (v==null? dash : (v<0?"-":"")+"$"+Math.abs(Math.round(v)).toLocaleString("en-US"));
const fmtK   = v => "$"+(v/1000).toFixed(0)+"k";
const pct    = (v,d=1)=> (v==null? dash : (v*100).toFixed(d)+"%");
const pctSigned = (v,d=1)=> (v==null? dash : (v>=0?"+":"")+(v*100).toFixed(d)+"%");
const n2     = (v,d=1)=> (v==null? dash : (+v).toFixed(d));
const cls = v => v==null?"":(v>=0?"pos":"neg");
const esc = s => String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ---------- data access (works on the live Flask server AND on static
   hosting like GitHub Pages / Vercel, which serve data/*.json instead) ---- */
async function apiGet(name){
  try{ const r=await fetch("api/"+name,{cache:"no-store"}); if(r.ok) return await r.json(); }catch(e){}
  const r2=await fetch("data/"+name+".json",{cache:"no-store"}); return await r2.json();
}

/* ---------- boot ---------- */
async function boot(){
  try{
    SNAP = await apiGet("snapshot");
    render(); $("#boot").style.display="none";
  }catch(e){ $("#boot").innerHTML="<div class='msg'>Failed to load snapshot:<br>"+esc(e.message)+"</div>"; }
}
function render(){
  Object.keys(CHARTS).forEach(k=>delete CHARTS[k]);
  renderFearMini(); renderOverview(); renderStrategies();
  renderSuggestions(); renderUniverse(); renderMacro();
  const p=SNAP.period;
  $("#freshness").textContent = `Daily bars · ${p.start} → ${p.end} · ${p.bars} sessions`;
  wireCharts();
}

/* ============================================================
   CHART PRIMITIVES  (registry-backed so hover can read data)
   ============================================================ */
function yearTicks(dates){const o=[];let l=null;dates.forEach((d,i)=>{const y=d.slice(0,4);if(y!==l){o.push({i,y});l=y;}});return o;}
function pathFrom(vals,x0,x1,y0,y1,mn,mx){const n=vals.length;return vals.map((v,i)=>{
  const x=x0+(x1-x0)*i/(n-1), y=y1-(y1-y0)*(v-mn)/((mx-mn)||1);
  return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);}).join(" ");}

function lineChart(curve,{height=300,showSpy=true}={}){
  const id="c"+(cid++), W=1000,H=height,pL=62,pR=16,pT=14,pB=26;
  const x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const {dates,values,spy}=curve;
  const all=(showSpy&&spy)?values.concat(spy):values;
  let mn=Math.min(...all),mx=Math.max(...all);const sp=(mx-mn)||1;mn-=sp*.06;mx+=sp*.06;
  let g="";
  for(let k=0;k<=4;k++){const yy=y0+(y1-y0)*k/4,val=mx-(mx-mn)*k/4;
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">${fmtK(val)}</text>`;}
  yearTicks(dates).forEach(t=>{const xx=x0+(x1-x0)*t.i/(dates.length-1);
    g+=`<text class="axis" x="${xx}" y="${H-8}" text-anchor="middle">${t.y}</text>`;});
  const p=pathFrom(values,x0,x1,y0,y1,mn,mx);
  g+=`<path d="${p} L ${x1} ${y1} L ${x0} ${y1} Z" fill="var(--accent-dim)"/>`;
  if(showSpy&&spy) g+=`<path d="${pathFrom(spy,x0,x1,y0,y1,mn,mx)}" fill="none" stroke="var(--faint)" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  g+=`<path d="${p}" fill="none" stroke="var(--accent)" stroke-width="2.1"/>`;
  const ly=y1-(y1-y0)*(values.at(-1)-mn)/(mx-mn);
  g+=`<circle cx="${x1}" cy="${ly}" r="3.4" fill="var(--accent)"/>`;
  g+=`<line class="xhair" id="xh-${id}" y1="${y0}" y2="${y1}"/>`;
  CHARTS[id]={kind:"equity",curve,x0,x1,y0,y1,mn,mx,n:dates.length};
  return `<svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}
function ddChart(curve,{height=170,target=8}={}){
  const id="c"+(cid++),W=1000,H=height,pL=62,pR=16,pT=12,pB=24;
  const x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const {dd,dates}=curve; const mn=Math.min(...dd,-target)*1.08,mx=0;
  let g="";
  for(let k=0;k<=3;k++){const val=mn+(mx-mn)*k/3,yy=y1-(y1-y0)*(val-mn)/(mx-mn);
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">${val.toFixed(0)}%</text>`;}
  yearTicks(dates).forEach(t=>{const xx=x0+(x1-x0)*t.i/(dates.length-1);
    g+=`<text class="axis" x="${xx}" y="${H-7}" text-anchor="middle">${t.y}</text>`;});
  const p=pathFrom(dd,x0,x1,y0,y1,mn,mx),zeroY=y1-(y1-y0)*(0-mn)/(mx-mn);
  g+=`<path d="${p} L ${x1} ${zeroY} L ${x0} ${zeroY} Z" fill="color-mix(in srgb,var(--loss) 22%,transparent)"/>`;
  g+=`<path d="${p}" fill="none" stroke="var(--loss)" stroke-width="1.4"/>`;
  const ty=y1-(y1-y0)*(-target-mn)/(mx-mn);
  g+=`<line x1="${x0}" y1="${ty}" x2="${x1}" y2="${ty}" stroke="var(--warn)" stroke-width="1.3" stroke-dasharray="5 3"/>`;
  g+=`<line class="xhair" id="xh-${id}" y1="${y0}" y2="${y1}"/>`;
  CHARTS[id]={kind:"dd",curve,x0,x1,y0,y1,mn,mx,n:dates.length};
  return `<svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}
/* candlestick chart — weekly OHLC + optional overlay lines (e.g. SPY, QQQ) */
function candleChart(curve,{height=300,overlays=[]}={}){
  const cd=curve.candles;
  if(!cd||!cd.ohlc||!cd.ohlc.length) return "<div class='muted small'>No candle data.</div>";
  const id="c"+(cid++),W=1000,H=height,pL=62,pR=16,pT=14,pB=26;
  const x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const {dates,ohlc}=cd;
  let mn=Math.min(...ohlc.map(o=>o[2])),mx=Math.max(...ohlc.map(o=>o[1]));
  overlays.forEach(ov=>{if(ov.values&&ov.values.length){mn=Math.min(mn,...ov.values);mx=Math.max(mx,...ov.values);}});
  const sp=(mx-mn)||1;mn-=sp*.05;mx+=sp*.05;
  const n=dates.length,slot=(x1-x0)/n,bw=Math.max(1.4,slot*0.62);
  const yAt=v=>y1-(y1-y0)*(v-mn)/(mx-mn);
  let g="";
  for(let k=0;k<=4;k++){const yy=y0+(y1-y0)*k/4,val=mx-(mx-mn)*k/4;
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">${fmtK(val)}</text>`;}
  yearTicks(dates).forEach(t=>{const xx=x0+slot*(t.i+0.5);
    g+=`<text class="axis" x="${xx}" y="${H-8}" text-anchor="middle">${t.y}</text>`;});
  ohlc.forEach((o,i)=>{const[op,hi,lo,cl]=o,cx=x0+slot*(i+0.5);
    const up=cl>=op,col=up?"var(--gain)":"var(--loss)";
    g+=`<line x1="${cx.toFixed(1)}" y1="${yAt(hi).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yAt(lo).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
    const ytop=yAt(Math.max(op,cl)),h=Math.max(0.8,Math.abs(yAt(op)-yAt(cl)));
    g+=`<rect x="${(cx-bw/2).toFixed(1)}" y="${ytop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>`;});
  overlays.forEach(ov=>{if(!ov.values||!ov.values.length)return;const m=Math.min(ov.values.length,n);
    let d="";for(let i=0;i<m;i++){const X=x0+slot*(i+0.5),Y=yAt(ov.values[i]);d+=(i?"L":"M")+X.toFixed(1)+" "+Y.toFixed(1);}
    g+=`<path d="${d}" fill="none" stroke="${ov.color}" stroke-width="1.4" stroke-dasharray="${ov.dash||'4 3'}"/>`;});
  g+=`<line class="xhair" id="xh-${id}" y1="${y0}" y2="${y1}"/>`;
  CHARTS[id]={kind:"candle",cd,overlays,x0,x1,y0,y1,n,slot};
  return `<svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

/* rolling sharpe / generic mini line with zero + target guides */
function miniLine(series,{height=150,guide=null,color="var(--accent2)"}={}){
  const {dates,values}=series;
  if(!values||!values.length) return "<div class='muted small'>Not enough history.</div>";
  const id="c"+(cid++),W=1000,H=height,pL=44,pR=14,pT=12,pB=22;
  const x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  let mn=Math.min(...values,guide??values[0]),mx=Math.max(...values,guide??values[0]);
  const sp=(mx-mn)||1;mn-=sp*.1;mx+=sp*.1;
  let g="";
  for(let k=0;k<=2;k++){const val=mn+(mx-mn)*k/2,yy=y1-(y1-y0)*(val-mn)/(mx-mn);
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-6}" y="${yy+3}" text-anchor="end">${val.toFixed(1)}</text>`;}
  yearTicks(dates).forEach(t=>{const xx=x0+(x1-x0)*t.i/(dates.length-1);
    g+=`<text class="axis" x="${xx}" y="${H-6}" text-anchor="middle">${t.y}</text>`;});
  if(guide!=null){const gy=y1-(y1-y0)*(guide-mn)/(mx-mn);
    g+=`<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="var(--warn)" stroke-width="1.1" stroke-dasharray="5 3"/>`;}
  g+=`<path d="${pathFrom(values,x0,x1,y0,y1,mn,mx)}" fill="none" stroke="${color}" stroke-width="1.9"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}
/* allocation — stacked area of invested (green) + cash (grey), holdings on hover */
function allocChart(al,{height=260}={}){
  if(!al||!al.available) return "<div class='muted small'>No allocation data.</div>";
  const id="c"+(cid++),W=1000,H=height,pL=58,pR=16,pT=14,pB=26,x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const {dates,cash,invested}=al,n=dates.length;
  const total=cash.map((c,i)=>c+invested[i]);
  const mx=Math.max(...total)*1.06||1;
  const xAt=i=>x0+(x1-x0)*i/(n-1), yAt=v=>y1-(y1-y0)*v/mx;
  let g="";
  for(let k=0;k<=4;k++){const yy=y0+(y1-y0)*k/4,val=mx-mx*k/4;
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">${fmtK(val)}</text>`;}
  yearTicks(dates).forEach(t=>{g+=`<text class="axis" x="${xAt(t.i)}" y="${H-8}" text-anchor="middle">${t.y}</text>`;});
  // invested area (0 -> invested)
  let inv=`M ${x0} ${y1}`;invested.forEach((v,i)=>inv+=` L ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`);inv+=` L ${x1} ${y1} Z`;
  g+=`<path d="${inv}" fill="color-mix(in srgb,var(--gain) 32%,transparent)" stroke="var(--gain)" stroke-width="1"/>`;
  // cash area (invested -> total), stacked on top
  let ct=`M ${x0} ${yAt(invested[0]).toFixed(1)}`;
  invested.forEach((v,i)=>ct+=` L ${xAt(i).toFixed(1)} ${yAt(total[i]).toFixed(1)}`);
  for(let i=n-1;i>=0;i--)ct+=` L ${xAt(i).toFixed(1)} ${yAt(invested[i]).toFixed(1)}`;ct+=" Z";
  g+=`<path d="${ct}" fill="color-mix(in srgb,var(--faint) 26%,transparent)" stroke="var(--faint)" stroke-width="1"/>`;
  g+=`<line class="xhair" id="xh-${id}" y1="${y0}" y2="${y1}"/>`;
  CHARTS[id]={kind:"alloc",al,total,x0,x1,y0,y1,n};
  return `<svg class="chart" data-cid="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

/* histogram */
function histChart(h,{height=150}={}){
  if(!h.counts||!h.counts.length) return "";
  const W=1000,H=height,pL=30,pR=14,pT=10,pB=20,x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const mx=Math.max(...h.counts),n=h.counts.length,bw=(x1-x0)/n;
  let g="";
  h.counts.forEach((c,i)=>{const bh=(y1-y0)*c/mx,x=x0+i*bw,mid=(h.edges[i]+h.edges[i+1])/2;
    const col=mid>=0?"var(--gain)":"var(--loss)";
    g+=`<rect x="${(x+1).toFixed(1)}" y="${(y1-bh).toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}" opacity=".8" rx="1"/>`;});
  const zx=x0+(x1-x0)*(0-h.edges[0])/(h.edges.at(-1)-h.edges[0]);
  g+=`<line x1="${zx}" y1="${y0}" x2="${zx}" y2="${y1}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 2"/>`;
  g+=`<text class="axis" x="${x0}" y="${H-6}">${h.edges[0]}%</text><text class="axis" x="${x1}" y="${H-6}" text-anchor="end">+${h.edges.at(-1)}%</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}
/* trade-explorer: CANDLESTICK price + entry ▲ / exit ▼ markers for one ticker */
function explorerChart(tk,priceBook,trades,{height=320}={}){
  const pb=priceBook[tk];
  if(!pb||!pb.ohlc.length) return "<div class='muted'>No price series.</div>";
  const {dates,ohlc}=pb;
  const W=1000,H=height,pL=56,pR=16,pT=14,pB=26,x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  let mn=Math.min(...ohlc.map(o=>o[2])),mx=Math.max(...ohlc.map(o=>o[1]));
  const sp=(mx-mn)||1;mn-=sp*.07;mx+=sp*.07;
  const n=dates.length,slot=(x1-x0)/n,bw=Math.max(1.2,slot*0.62);
  const xAt=i=>x0+slot*(i+0.5), yAt=v=>y1-(y1-y0)*(v-mn)/(mx-mn);
  const dateIdx=d=>{let best=0,bd=1e18;dates.forEach((dd,i)=>{const t=Math.abs(new Date(dd)-new Date(d));if(t<bd){bd=t;best=i;}});return best;};
  let g="";
  for(let k=0;k<=4;k++){const yy=y0+(y1-y0)*k/4,val=mx-(mx-mn)*k/4;
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">$${val.toFixed(0)}</text>`;}
  yearTicks(dates).forEach(t=>{g+=`<text class="axis" x="${xAt(t.i)}" y="${H-8}" text-anchor="middle">${t.y}</text>`;});
  ohlc.forEach((o,i)=>{const[op,hi,lo,cl]=o,cx=xAt(i),up=cl>=op,col=up?"var(--gain)":"var(--loss)";
    g+=`<line x1="${cx.toFixed(1)}" y1="${yAt(hi).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yAt(lo).toFixed(1)}" stroke="${col}" stroke-width="0.9"/>`;
    const ytop=yAt(Math.max(op,cl)),h=Math.max(0.7,Math.abs(yAt(op)-yAt(cl)));
    g+=`<rect x="${(cx-bw/2).toFixed(1)}" y="${ytop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}"/>`;});
  trades.filter(t=>t.ticker===tk).forEach(t=>{
    const eX=xAt(dateIdx(t.entry_date)),eY=yAt(t.entry_price),xX=xAt(dateIdx(t.exit_date)),xY=yAt(t.exit_price);
    g+=`<line x1="${eX}" y1="${eY}" x2="${xX}" y2="${xY}" stroke="${t.pnl>=0?'var(--gain)':'var(--loss)'}" stroke-width="1" opacity=".45"/>`;
    g+=`<path d="M ${eX} ${(eY+13).toFixed(1)} l 5 9 l -10 0 z" fill="var(--accent2)" stroke="#fff" stroke-width="0.5"/>`;
    g+=`<path d="M ${xX} ${(xY-13).toFixed(1)} l 5 -9 l -10 0 z" fill="var(--loss)" stroke="#fff" stroke-width="0.5"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

/* ---------- hover wiring ---------- */
function wireCharts(){
  const tip=$("#chartTip");
  $$("svg.chart[data-cid]").forEach(svg=>{
    const meta=CHARTS[svg.dataset.cid]; if(!meta)return;
    const xh=svg.querySelector(".xhair");
    svg.addEventListener("mousemove",e=>{
      const r=svg.getBoundingClientRect();
      const vbx=(e.clientX-r.left)/r.width*1000;
      let rows="",dateLbl="",X;
      if(meta.kind==="candle"){
        let i=Math.floor((vbx-meta.x0)/meta.slot);i=Math.max(0,Math.min(meta.n-1,i));
        X=meta.x0+meta.slot*(i+0.5);
        const o=meta.cd.ohlc[i],up=o[3]>=o[0],col=up?"var(--gain)":"var(--loss)";
        dateLbl="Week of "+meta.cd.dates[i];
        rows=`<div class="r"><span>Open</span><b>${fmtUsd(o[0])}</b></div>
          <div class="r"><span>High</span><b>${fmtUsd(o[1])}</b></div>
          <div class="r"><span>Low</span><b>${fmtUsd(o[2])}</b></div>
          <div class="r"><span style="color:${col}">Close</span><b style="color:${col}">${fmtUsd(o[3])}</b></div>`;
        (meta.overlays||[]).forEach(ov=>{if(ov.values&&ov.values[i]!=null)
          rows+=`<div class="r"><span><i style="background:${ov.color}"></i>${ov.label}</span><b>${fmtUsd(ov.values[i])}</b></div>`;});
      }else if(meta.kind==="alloc"){
        let frac=(vbx-meta.x0)/(meta.x1-meta.x0);frac=Math.max(0,Math.min(1,frac));
        const i=Math.round(frac*(meta.n-1)),a=meta.al;
        X=meta.x0+(meta.x1-meta.x0)*i/(meta.n-1);dateLbl=a.dates[i];
        rows=`<div class="r"><span><i style="background:var(--gain)"></i>Invested</span><b>${fmtUsd(a.invested[i])}</b></div>
          <div class="r"><span><i style="background:var(--faint)"></i>Cash</span><b>${fmtUsd(a.cash[i])}</b></div>
          <div class="r"><span>Total</span><b>${fmtUsd(meta.total[i])}</b></div>`;
        const hh=a.holdings[i]||[];
        if(hh.length){rows+=`<div class="d" style="margin:5px 0 3px">Holdings (${hh.length})</div>`;
          hh.slice(0,8).forEach(h=>rows+=`<div class="r"><span>${h.ticker}</span><b>${fmtUsd(h.value)}</b></div>`);}
        else rows+=`<div class="d" style="margin-top:4px">100% cash</div>`;
      }else{
        let frac=(vbx-meta.x0)/(meta.x1-meta.x0);frac=Math.max(0,Math.min(1,frac));
        const i=Math.round(frac*(meta.n-1)),c=meta.curve;
        X=meta.x0+(meta.x1-meta.x0)*i/(meta.n-1);dateLbl=c.dates[i];
        if(meta.kind==="equity"){
          rows=`<div class="r"><span><i style="background:var(--accent)"></i>Strategy</span><b>${fmtUsd(c.values[i])}</b></div>`;
          if(c.spy)rows+=`<div class="r"><span><i style="background:var(--faint)"></i>SPY</span><b>${fmtUsd(c.spy[i])}</b></div>`;
          if(c.dd)rows+=`<div class="r"><span><i style="background:var(--loss)"></i>Drawdown</span><b>${c.dd[i].toFixed(1)}%</b></div>`;
          if(c.exposure)rows+=`<div class="r"><span><i style="background:var(--warn)"></i>Exposure</span><b>${c.exposure[i]}%</b></div>`;
        }else{rows=`<div class="r"><span><i style="background:var(--loss)"></i>Drawdown</span><b>${c.dd[i].toFixed(2)}%</b></div>`;}
      }
      if(xh){xh.setAttribute("x1",X);xh.setAttribute("x2",X);xh.style.opacity=1;}
      tip.innerHTML=`<div class="d">${dateLbl}</div>${rows}`;
      tip.style.display="block";
      let tx=e.clientX+14; if(tx+180>window.innerWidth)tx=e.clientX-190;
      tip.style.left=tx+"px"; tip.style.top=(e.clientY-10)+"px";
    });
    svg.addEventListener("mouseleave",()=>{tip.style.display="none";if(xh)xh.style.opacity=0;});
  });
}

/* ============================================================
   STAT TILES
   ============================================================ */
function statTiles(m){
  const netpl=m.final_equity-SNAP.initial_capital, t=SNAP.targets;
  return `<div class="stats">
    <div class="stat"><div class="k">Net P&L</div>
      <div class="v ${cls(netpl)}">${fmtUsdS(netpl)}</div>
      <div class="s ${cls(m.total_return)}">${pctSigned(m.total_return)}</div></div>
    <div class="stat"><div class="k">Max Drawdown <span class="pill ${m.max_drawdown<=t.max_drawdown?'pass':'miss'}">${m.max_drawdown<=t.max_drawdown?'PASS':'MISS'}</span></div>
      <div class="v neg">-${pct(m.max_drawdown)}</div>
      <div class="s">target &lt; ${pct(t.max_drawdown,0)}</div></div>
    <div class="stat"><div class="k">Sharpe <span class="pill ${m.sharpe>=t.sharpe?'pass':'miss'}">${m.sharpe>=t.sharpe?'PASS':'MISS'}</span></div>
      <div class="v">${n2(m.sharpe,2)}</div>
      <div class="s">CAGR ${pct(m.cagr)} · tgt &gt;${t.sharpe.toFixed(1)}</div></div>
    <div class="stat"><div class="k">Win Rate</div>
      <div class="v">${pct(m.win_rate)}</div>
      <div class="s">${m.num_trades} trades</div></div>
    <div class="stat"><div class="k">Profit Factor</div>
      <div class="v ${m.profit_factor>=1?'pos':'neg'}">${n2(m.profit_factor,2)}</div>
      <div class="s">exp. ${fmtUsdS(m.expectancy)}/trade</div></div>
  </div>`;
}
function metaStrip(m){
  const b=SNAP.benchmark;
  const items=[
    ["CAGR",pct(m.cagr),`tgt >${pct(SNAP.targets.annual_return,0)}`],
    ["Volatility",pct(m.volatility),"annualised"],
    ["Sortino",n2(m.sortino,2),"downside-adj"],
    ["Calmar",n2(m.calmar,2),"ret/maxDD"],
    ["Beta",n2(m.beta,2),"vs SPY"],
    ["Alpha",m.alpha==null?dash:pctSigned(m.alpha),"annual, vs SPY"],
    ["DD Duration",m.dd_duration_days+"d","longest underwater"],
    ["Avg Hold",n2(m.avg_hold_bars,0)+"d","per trade"],
    ["Best Month",pctSigned(m.best_month),""],
    ["Worst Month",pctSigned(m.worst_month),""],
    ["Avg Win",fmtUsdS(m.avg_win),""],
    ["Avg Loss",fmtUsdS(m.avg_loss),""],
    ["Commission",fmtUsd(m.total_commission),"total IB fees"],
  ];
  return `<div class="metastrip">${items.map(it=>`<div class="mt-i"><div class="k">${it[0]}</div>
    <div class="v">${it[1]}</div><div class="sub">${it[2]}</div></div>`).join("")}</div>`;
}

/* ---------- PM risk panel: the numbers a fund manager reads daily ---------- */
function pmPanel(m){
  if(m.var95==null && m.up_capture==null) return "";   // old snapshot — hide
  const items=[
    ["Up Capture",m.up_capture==null?dash:pct(m.up_capture),"SPY升市日食幾多 (>100%好)"],
    ["Down Capture",m.down_capture==null?dash:pct(m.down_capture),"SPY跌市日捱幾多 (<100%好)"],
    ["VaR 95%",m.var95==null?dash:"-"+pct(m.var95),"單日95%情況蝕唔過呢個數"],
    ["CVaR 95%",m.cvar95==null?dash:"-"+pct(m.cvar95),"最差嗰5%日子嘅平均蝕幅"],
    ["Payoff",m.payoff==null?dash:n2(m.payoff,2),"平均贏 ÷ 平均輸"],
    ["Best Day",pctSigned(m.best_day),""],
    ["Worst Day",pctSigned(m.worst_day),""],
    ["Skew",m.skew==null?dash:n2(m.skew,2),"負=大跌尾巴風險"],
    ["Tail Ratio",m.tail_ratio==null?dash:n2(m.tail_ratio,2),">1=賺尾大過蝕尾"],
  ];
  return `<div class="panel mt"><div class="eyebrow" style="margin-bottom:4px">PM Risk Panel — 基金經理日常睇嘅風險數</div>
    <div class="sect-sub" style="margin-bottom:10px">Capture 係同 SPY 比：理想係升市食足、跌市縮沙。VaR/CVaR 係「平常最多蝕幾多」嘅統計底線。</div>
    <div class="metastrip">${items.map(it=>`<div class="mt-i"><div class="k">${it[0]}</div>
      <div class="v">${it[1]}</div><div class="sub">${it[2]}</div></div>`).join("")}</div></div>`;
}

/* ---------- P&L attribution: who made / who lost the money ---------- */
function attribPanel(s){
  const a=s.attribution;
  if(!a||!a.top||!a.top.length) return "";
  const row=r=>`<tr><td class="tk" style="text-align:left">${esc(r.ticker)}</td>
    <td class="${cls(r.pnl)}">${fmtUsdS(r.pnl)}</td><td class="muted">${r.trades}</td></tr>`;
  return `<div class="grid g2 mt">
    <div class="panel"><div class="eyebrow">Top Contributors 💰</div>
      <div class="sect-sub" style="margin-bottom:8px">邊隻股賺最多（淨P&L / 單數）</div>
      <table style="width:100%"><thead><tr><th style="text-align:left">Ticker</th><th>Net P&L</th><th>Trades</th></tr></thead>
      <tbody>${a.top.map(row).join("")}</tbody></table></div>
    <div class="panel"><div class="eyebrow">Top Detractors 🔻</div>
      <div class="sect-sub" style="margin-bottom:8px">邊隻股蝕最多——PM 每週必問嘅問題</div>
      <table style="width:100%"><thead><tr><th style="text-align:left">Ticker</th><th>Net P&L</th><th>Trades</th></tr></thead>
      <tbody>${a.bottom.map(row).join("")}</tbody></table></div></div>`;
}

/* ---------- correlation matrix: the multi-strategy (JGF) lens ---------- */
function corrPanel(){
  const C=SNAP.correlation;
  if(!C||!C.labels||C.labels.length<2) return "";
  const cell=v=>{
    const a=Math.min(Math.abs(v),1);
    const bg=v>=0.75?`rgba(220,80,80,${0.15+a*0.35})`:v>=0.4?`rgba(220,160,60,${0.1+a*0.3})`:`rgba(80,180,120,${0.12+(1-a)*0.25})`;
    return `<td style="background:${bg};text-align:center">${v.toFixed(2)}</td>`;};
  return `<div class="panel mt"><div class="eyebrow" style="margin-bottom:4px">Strategy Correlation Matrix — 多策略基金嘅核心視角</div>
    <div class="sect-sub" style="margin-bottom:10px">JGF 呢類 multi-strategy fund 嘅秘密唔係單一勁策略，而係揸住一批「唔會一齊跌」嘅策略。
    紅 = 高相關（一齊upside但都一齊冧）· 綠 = 低/負相關（真正分散）。你嘅目標：加入同 V6 相關低嘅新 sleeve。</div>
    <div class="tbl-wrap" style="border:none;overflow-x:auto"><table style="min-width:420px">
      <thead><tr><th></th>${C.labels.map(l=>`<th>${esc(l)}</th>`).join("")}</tr></thead>
      <tbody>${C.matrix.map((row,i)=>`<tr><td class="tk" style="text-align:left">${esc(C.labels[i])}</td>${row.map(cell).join("")}</tr>`).join("")}</tbody>
    </table></div></div>`;
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverview(){
  const co=SNAP.combined,t=SNAP.targets,mac=SNAP.macro,bm=SNAP.benchmarks;
  if(!co||!co.available){$("#page-overview").innerHTML="<div class='panel muted'>No deployed strategy yet.</div>";return;}
  const m=co.metrics;
  const met=[m.cagr>=t.annual_return,m.sharpe>=t.sharpe,m.max_drawdown<=t.max_drawdown].filter(Boolean).length;
  const names=SNAP.deployed_names.join(" + ");
  const benchTxt=Object.values(bm).map(b=>`${b.ticker} ${pct(b.cagr)}`).join(" / ");
  $("#page-overview").innerHTML=`
    <div class="banner">
      <div class="bv" style="color:${met>=2?'var(--gain)':met>=1?'var(--warn)':'var(--loss)'}">${met}<span style="color:var(--faint);font-size:18px">/3</span></div>
      <div class="bt"><b>Combined Live Portfolio</b> — equal-capital blend of every DEPLOYED strategy, starting from <b>${fmtUsd(SNAP.initial_capital)}</b>. Live: <b>Strategy A · ${esc(names)}</b>. <span style="color:var(--warn)">Strategy B (momentum) not yet connected</span> — folds in here once built. Sharpe <b>${n2(m.sharpe,2)}</b>, CAGR <b>${pct(m.cagr)}</b>, Max DD <b>${pct(m.max_drawdown)}</b> vs CAGR of ${benchTxt}.</div>
    </div>
    ${statTiles(m)}
    ${metaStrip(m)}
    <div class="panel mt">
      <div class="card-head"><div><div class="eyebrow">Portfolio Equity · weekly candles</div>
        <div class="sect-sub">Combined book value (green up-week / red down-week) vs SPY & QQQ · hover for OHLC</div></div>
        <div class="legend"><span><i class="swatch" style="background:var(--gain)"></i> Up</span>
          <span><i class="swatch" style="background:var(--loss)"></i> Down</span>
          <span><i class="swatch" style="background:var(--faint)"></i> SPY</span>
          <span><i class="swatch" style="background:var(--accent2)"></i> QQQ</span></div></div>
      ${candleChart(co.curve,{height:300,overlays:[
        {values:co.curve.spy_weekly,color:"var(--faint)",label:"SPY"},
        {values:co.curve.qqq_weekly,color:"var(--accent2)",label:"QQQ",dash:"2 3"}]})}
    </div>
    <div class="panel mt">
      <div class="card-head"><div><div class="eyebrow">Drawdown</div>
        <div class="sect-sub">Red = underwater vs peak · amber = 8% target</div></div></div>
      ${ddChart(co.curve,{height:170})}
    </div>
    <div class="grid g2 mt">
      <div class="panel"><div class="eyebrow">Macro Fear Gauge</div>
        <div class="sect-sub" style="margin-bottom:14px">100 = max fear · 0 = complacency</div>
        ${mac&&mac.available?gaugeSVG(mac.fear_score,mac.regime,150):"<div class='muted'>Macro unavailable</div>"}</div>
      <div class="panel"><div class="eyebrow">Top Picks · 1-Month Hold</div>
        <div class="sect-sub" style="margin-bottom:12px">Live prices · see Suggested Buys for method</div>
        ${SNAP.suggestions.month.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
          <div><span class="tk" style="font-size:15px">${p.ticker}</span> <span class="muted small">${fmtUsd(p.price)}</span></div>
          <div><span class="num" style="font-weight:700;color:var(--accent)">${p.composite}</span> <span class="muted small">comp</span></div></div>`).join("")}</div>
    </div>`;
}

/* ============================================================
   STRATEGIES
   ============================================================ */
function renderStrategies(){
  const rows=SNAP.strategies.map(s=>{
    const m=s.metrics;
    return `<div>
      <div class="strat-row" data-strat="${s.id}">
        <span class="vid">${s.id.toUpperCase()}</span>
        <div style="min-width:170px"><div class="nm">${esc(s.name)} ${s.deployed?'<span class="pill buy" style="margin-left:4px">● LIVE</span>':''}</div><div class="dsc">${esc(s.desc)}</div></div>
        <div class="mini">
          <div><b>${n2(m.sharpe,2)}</b><br>Sharpe</div>
          <div><b>${pct(m.cagr)}</b><br>CAGR</div>
          <div><b class="neg">-${pct(m.max_drawdown)}</b><br>MaxDD</div>
          <div><b>${m.num_trades}</b><br>Trades</div></div>
        <div class="ret ${cls(m.total_return)}">${pctSigned(m.total_return,0)}</div></div>
      <div class="strat-detail" id="detail-${s.id}"></div></div>`;
  }).join("");
  $("#page-strategies").innerHTML=`
    <div id="fwdPin"></div>
    ${corrPanel()}
    <div class="eyebrow">Strategy A — Composite Scoring · variants</div>
    <div class="sect-sub" style="margin-bottom:16px">Same signal engine, two risk/hold configs (V4 is the live production build). Click to expand full tearsheet, trade log & candlestick trade explorer. Daily bars, ${SNAP.period.start} → ${SNAP.period.end}.</div>
    <div class="strat-list">${rows}</div>`;
  $$(".strat-row").forEach(r=>r.onclick=()=>{
    const id=r.dataset.strat,d=$("#detail-"+id),open=d.classList.contains("open");
    $$(".strat-detail").forEach(x=>{x.classList.remove("open");x.innerHTML="";});
    $$(".strat-row").forEach(x=>x.classList.remove("open"));
    if(!open){d.innerHTML=stratDetail(id);d.classList.add("open");r.classList.add("open");wireCharts();wireExplorer(id);}
  });
  renderFwdPin();
}

/* Pinned highlight box at the top of Strategies: which strategy is LIVE in
   forward-test right now, plus a live P&L peek (click -> Forward Test page). */
async function renderFwdPin(){
  const el=$("#fwdPin");
  if(!el)return;
  el.innerHTML=`<div class="panel mt" style="border:2px solid var(--accent)">
    <div class="small muted">載入緊 Forward Test 狀態…</div></div>`;
  let L=null;
  try{L=await apiGet("live");}catch(e){el.innerHTML="";return;}
  const cap=SNAP.initial_capital,half=cap/2;
  const A=L.paper_a7||L.paper_a_v7||L.paper_a;
  const aEq=A?(A.equity_curve&&A.equity_curve.length?A.equity_curve.at(-1).equity:(A.cash??half)):half;
  const aPnl=aEq-half;
  const started=(A&&A.equity_curve&&A.equity_curve[0])?A.equity_curve[0].date:null;
  el.innerHTML=`<div class="panel mt" id="fwdPinBox" style="border:2px solid var(--accent);background:var(--accent-dim);cursor:pointer">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <div class="eyebrow" style="color:var(--accent)">🔴 而家跑緊 Forward Test（真實市場，紙上倉）</div>
        <div class="small" style="margin-top:5px;line-height:1.5">
          <b style="color:var(--text)">A</b>（V7 半對沖，波段）＋ <b>N</b>（市場中性）＋ <b>T</b>（跨資產趨勢）實驗中
          ${started?` · 由 ${esc(started)} 開始`:""} · 撳去 <b>Forward Test</b> 頁睇齊細節</div>
      </div>
      <div style="text-align:right">
        <div class="num" style="font-size:24px;font-weight:700;color:${aPnl>=0?'var(--gain)':'var(--loss)'}">${fmtUsdS(aPnl)}</div>
        <div class="small muted">A 戶口 ${fmtUsd(aEq)}</div>
      </div>
    </div></div>`;
  const box=$("#fwdPinBox");
  if(box)box.onclick=()=>document.querySelector('.nl[data-page="live"]').click();
}
function stratDetail(id){
  const s=SNAP.strategies.find(x=>x.id===id),m=s.metrics;
  const traded=Object.keys(s.price_book);
  return `${s.caveat?`<div class="panel mt" style="border-left:3px solid var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--panel))">
      <div class="small" style="line-height:1.65;color:var(--text)">${esc(s.caveat)}</div></div>`:""}
    <div class="panel mt" style="border-left:3px solid var(--accent)">
      <div class="eyebrow" style="margin-bottom:8px">How ${esc(s.name)} trades — the rules</div>
      <ol class="ruleslist">${s.rules.map(r=>`<li>${esc(r)}</li>`).join("")}</ol></div>
    ${statTiles(m)}${metaStrip(m)}${pmPanel(m)}${attribPanel(s)}
    <div class="panel mt">
      <div class="card-head"><div><div class="eyebrow">Portfolio Equity · weekly candles</div><div class="sect-sub">Book value vs SPY & QQQ · hover for OHLC</div></div>
        <div class="legend"><span><i class="swatch" style="background:var(--gain)"></i> Up</span><span><i class="swatch" style="background:var(--loss)"></i> Down</span><span><i class="swatch" style="background:var(--faint)"></i> SPY</span><span><i class="swatch" style="background:var(--accent2)"></i> QQQ</span></div></div>
      ${candleChart(s.curve,{height:280,overlays:[
        {values:s.curve.spy_weekly,color:"var(--faint)",label:"SPY"},
        {values:s.curve.qqq_weekly,color:"var(--accent2)",label:"QQQ",dash:"2 3"}]})}</div>
    <div class="panel mt">
      <div class="card-head"><div><div class="eyebrow">Cash vs Invested — book composition over time</div>
        <div class="sect-sub">Green = deployed in stocks · grey = cash on the sidelines · hover any date to see exactly which stocks you held & the cash balance</div></div>
        <div class="legend"><span><i class="swatch" style="background:var(--gain)"></i> Invested</span><span><i class="swatch" style="background:var(--faint)"></i> Cash</span></div></div>
      ${allocChart(s.allocation,{height:250})}</div>
    <div class="grid g2 mt">
      <div class="panel"><div class="eyebrow">Drawdown</div>${ddChart(s.curve,{height:160})}</div>
      <div class="panel"><div class="eyebrow">Exit Reasons</div><div class="sect-sub" style="margin-bottom:12px">${m.num_trades} closed trades</div>${exitBars(s.reasons)}</div></div>
    <div class="grid g2 mt">
      <div class="panel"><div class="eyebrow">Rolling Sharpe (6-month)</div><div class="sect-sub" style="margin-bottom:8px">Amber = target 2.0</div>${miniLine(s.rolling_sharpe,{height:150,guide:2})}</div>
      <div class="panel"><div class="eyebrow">Daily Return Distribution</div><div class="sect-sub" style="margin-bottom:8px">Fat left tail = crash risk</div>${histChart(s.histogram,{height:150})}</div></div>
    <div class="panel mt"><div class="eyebrow">Monthly Returns (%)</div><div class="sect-sub" style="margin-bottom:12px">Green up · red down · last col = full year</div>${heatmap(s.monthly)}</div>
    <div class="panel mt">
      <div class="explorer-head"><div class="eyebrow" style="margin-right:auto">Trade Explorer</div>
        <span class="small muted">Pick a ticker to see entries ▲ / exits ▼ on price</span>
        <select class="tksel" id="tksel-${id}">${traded.map(t=>`<option value="${t}">${t}</option>`).join("")}</select></div>
      <div id="explorer-${id}"></div></div>
    <div class="panel mt"><div class="eyebrow">Trade Log</div><div class="sect-sub" style="margin-bottom:12px">${s.trades.length} most recent closed trades · P&L is net of IB commission · total fees ${fmtUsd(m.total_commission)}</div>
      <div class="trades-scroll"><table>
        <thead><tr><th style="text-align:left">Ticker</th><th>Entry</th><th>Exit</th><th>Shares</th><th>Entry $</th><th>Exit $</th><th>Return</th><th>Fees</th><th>Net P&L</th><th>Days</th><th style="text-align:left">Reason</th></tr></thead>
        <tbody>${s.trades.map(tradeRow).join("")}</tbody></table></div></div>`;
}
function tradeRow(t){
  return `<tr><td class="tk" style="text-align:left">${t.ticker}</td>
    <td>${t.entry_date}</td><td>${t.exit_date}</td>
    <td>${t.shares}</td><td>$${t.entry_price}</td><td>$${t.exit_price}</td>
    <td class="${cls(t.return_pct)}">${t.return_pct>=0?"+":""}${t.return_pct}%</td>
    <td class="muted">${fmtUsd(t.commission)}</td>
    <td class="${cls(t.pnl)}">${fmtUsdS(t.pnl)}</td><td>${t.bars_held}</td>
    <td style="text-align:left"><span class="rz ${t.reason}">${t.reason.replace("_"," ")}</span></td></tr>`;
}
function wireExplorer(id){
  const s=SNAP.strategies.find(x=>x.id===id);
  const sel=$("#tksel-"+id),box=$("#explorer-"+id);
  if(!sel)return;
  const draw=()=>{box.innerHTML=explorerChart(sel.value,s.price_book,s.trades,{height:300});};
  sel.onchange=draw; draw();
}
function exitBars(reasons){
  const colors={take_profit:"var(--gain)",trail_stop:"#3fb0a6",eod_close:"var(--accent2)",time_exit:"var(--neutral)",score_exit:"var(--warn)",stop_loss:"var(--loss)"};
  const names={take_profit:"Take-profit",trail_stop:"Trail-stop (profit lock)",eod_close:"Market-on-close (day-trade)",time_exit:"Time exit",score_exit:"Score exit",stop_loss:"Stop-loss"};
  const tot=Object.values(reasons).reduce((a,b)=>a+b,0)||1;
  return ["take_profit","trail_stop","eod_close","time_exit","score_exit","stop_loss"].filter(k=>reasons[k]||["take_profit","stop_loss"].includes(k)).map(k=>{
    const v=reasons[k]||0,w=(v/tot*100);
    return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
      <span>${names[k]}</span><span class="num muted">${v} · ${w.toFixed(0)}%</span></div>
      <div style="height:7px;background:var(--panel2);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:${w}%;background:${colors[k]}"></i></div></div>`;
  }).join("");
}
function heatmap(monthly){
  const mon=["J","F","M","A","M","J","J","A","S","O","N","D"],cap=15;
  const color=v=>{if(v==null||Math.abs(v)<0.05)return "var(--panel2)";
    const t=Math.min(1,Math.abs(v)/cap),base=v>0?"53,208,127":"255,95,95";
    return `rgba(${base},${(0.16+t*0.8).toFixed(2)})`;};
  const years=Object.keys(monthly).sort();
  let g=`<div class="hhead"></div>`+mon.map(x=>`<div class="hhead">${x}</div>`).join("")+`<div class="hhead">YR</div>`;
  years.forEach(y=>{const row=monthly[y];
    g+=`<div class="hlbl">${y}</div>`;
    for(let mi=1;mi<=12;mi++){const v=row[mi];
      g+=`<div class="hc" style="background:${color(v)}" title="${y}-${String(mi).padStart(2,"0")}: ${v==null?'—':v+'%'}">${v!=null&&Math.abs(v)>=0.05?(v>0?"+":"")+v.toFixed(0):""}</div>`;}
    const yv=row["Y"];
    g+=`<div class="hc hy" style="background:${color(yv)}" title="${y} full year">${yv!=null?(yv>0?"+":"")+yv.toFixed(0):""}</div>`;
  });
  return `<div class="hscroll"><div class="heat">${g}</div></div>`;
}

/* ============================================================
   SUGGESTIONS
   ============================================================ */
function renderSuggestions(){
  const meth=SNAP.suggestions.methodology;
  const groups=[["week","1 Week"],["month","1 Month"],["quarter","3 Months"]];
  // find a name that illustrates the horizon difference (in one list, absent from another)
  const inList=(k,tk)=>SNAP.suggestions[k].some(x=>x.ticker===tk);
  const wk=SNAP.suggestions.week[0];
  let example="";
  if(wk && !inList("month",wk.ticker)){
    const mrow=SNAP.universe.find(u=>u.ticker===wk.ticker);
    example=`<b>${wk.ticker}</b> tops the <b>1-week</b> list on a short-term momentum burst (${esc(wk.why)}), but it's <b>not</b> in the 1-month list because its overall composite score${mrow&&mrow.composite?` (${mrow.composite})`:""} / trend isn't strong enough to rank there — different horizon, different question.`;
  }else{
    example="A name can top one horizon's list yet miss another's — each horizon asks a different question of the same data.";
  }
  $("#page-suggestions").innerHTML=`
    <div class="eyebrow">Suggested Stocks to Buy</div>
    <div class="sect-sub">Live idea shortlist from the scored universe · prices live (${SNAP.period.end}).</div>
    <div class="panel mt" style="border-left:3px solid var(--accent)">
      <div class="eyebrow" style="margin-bottom:8px">How these are chosen</div>
      <div class="small" style="line-height:1.6;color:var(--muted)">${esc(meth.note)}</div>
      <div class="small mt" style="line-height:1.6;background:var(--panel2);border-radius:8px;padding:10px 13px">💡 ${example}</div>
    </div>
    ${groups.map(([k,l])=>`<div class="sug-group">
      <div class="sug-head"><span class="hz">HOLD ${l.toUpperCase()}</span><span class="lbl">${esc(meth[k].title)}</span></div>
      <div class="small muted" style="margin:-2px 0 10px">Criteria: ${esc(meth[k].criteria)}</div>
      <div class="sug-cards">${SNAP.suggestions[k].map((p,i)=>sugCard(p,i)).join("")}</div></div>`).join("")}
    <div class="panel mt" style="border-left:3px solid var(--warn)"><div class="small muted">Research signals, not advice — model rankings from free data with the documented fundamentals caveat. Size with the strategy's risk rules and confirm before acting.</div></div>`;
}
function sugCard(p,i){
  const sig=p.above_trend?'<span class="pill buy">IN TREND</span>':'<span class="pill watch">BELOW TREND</span>';
  return `<div class="sug"><div class="top"><div><div class="tkr">#${i+1} ${p.ticker}</div><div class="px">${fmtUsd(p.price)}</div></div>${sig}</div>
    <div class="why"><b style="color:var(--text)">Why ranked:</b> ${esc(p.driver)}</div>
    <div class="why" style="margin-top:5px">${esc(p.why)}</div>
    <div class="sc"><div><span>Composite</span><b style="color:var(--accent)">${p.composite}</b></div>
      <div><span>Technical</span><b>${p.tech}</b></div><div><span>Fundamental</span><b>${p.fund}</b></div></div></div>`;
}

/* ============================================================
   UNIVERSE
   ============================================================ */
let uSort={key:"composite",dir:-1};
function renderUniverse(){
  const cols=[["ticker","Ticker","t"],["sector","Sector","t"],["price","Price","usd"],["chg_pct","Chg%","pctv"],
    ["forward_pe","Fwd P/E","x1"],["eps_growth","EPS Grw","pctr"],["peg","PEG","x2"],
    ["profit_margin","Margin","pctr"],["roe","ROE","pctr"],
    ["tech_score","Tech","score"],["fund_score","Fund","score"],["composite","Score","score"],["signal","Signal","sig"]];
  const asof=SNAP.universe.find(r=>r.asof)?.asof||SNAP.period.end;
  $("#page-universe").innerHTML=`
    <div class="eyebrow">Universe — ${SNAP.universe_count} names</div>
    <div class="sect-sub" style="margin-bottom:12px">Fundamentals + live scores · <span class="px-live"><span class="dotlive"></span>Live prices as of ${asof}</span> · click a header to sort.</div>
    <div class="panel" style="border-left:3px solid var(--accent2);margin-bottom:14px">
      <div class="eyebrow" style="margin-bottom:8px">How scoring works & where the data comes from</div>
      <div class="small" style="line-height:1.6;color:var(--muted)">
        <b style="color:var(--text)">Backtests are 100% technical & point-in-time.</b> The engine's score (RSI · MACD · Bollinger · trend · momentum) is recomputed every day from daily OHLC only — <b style="color:var(--gain)">fundamentals are completely excluded from backtests</b>, because yfinance only provides a today-snapshot and projecting it into history would be look-ahead bias.
        <b style="color:var(--text)">Fundamental score</b> (fwd P/E · EPS growth · PEG · margins) appears on THIS page and in Suggested Buys only, where "today's snapshot" is exactly the right data for a live, forward-looking ranking.
        <b style="color:var(--text)">Data source:</b> yfinance (free) — prices split/dividend-adjusted & reliable; fundamentals current-snapshot, occasionally missing. Point-in-time fundamentals need a paid feed (later upgrade).
      </div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>${cols.map(c=>`<th data-k="${c[0]}" class="${uSort.key===c[0]?'sorted':''}">${c[1]}${uSort.key===c[0]?(uSort.dir<0?" ▾":" ▴"):""}</th>`).join("")}</tr></thead>
      <tbody>${uRows(cols)}</tbody></table></div>`;
  $$("#page-universe th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;
    if(uSort.key===k)uSort.dir*=-1;else{uSort.key=k;uSort.dir=-1;}renderUniverse();});
}
function uRows(cols){
  const rows=[...SNAP.universe].sort((a,b)=>{let x=a[uSort.key],y=b[uSort.key];
    if(x==null)return 1;if(y==null)return -1;
    if(typeof x==="string")return uSort.dir*x.localeCompare(y);return uSort.dir*(x-y);});
  const fmt={t:v=>esc(v),usd:v=>fmtUsd(v),
    pctv:v=>v==null?dash:`<span class="${cls(v)}">${v>=0?"+":""}${v.toFixed(2)}%</span>`,
    x1:v=>v==null?dash:v.toFixed(1),x2:v=>v==null?dash:v.toFixed(2),
    pctr:v=>v==null?dash:(v*100).toFixed(0)+"%",
    score:v=>v==null?dash:`<span class="scorebar">${v.toFixed(0)}<span class="track"><i style="width:${Math.min(100,v)}%"></i></span></span>`,
    sig:v=>`<span class="pill ${({BUY:'buy',WATCH:'watch',NEUTRAL:'neutral','NO-DATA':'nodata'})[v]}">${v}</span>`};
  return rows.map(r=>`<tr>${cols.map(c=>{const cell=fmt[c[2]](r[c[0]]);
    return `<td${c[0]==="ticker"?' class="tk"':(c[0]==="sector"?' class="sector"':"")}>${cell}</td>`;}).join("")}</tr>`).join("");
}

/* ============================================================
   MACRO + gauge
   ============================================================ */
function polar(cx,cy,r,deg){const a=(deg-180)*Math.PI/180;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];}
function arc(cx,cy,r,d0,d1){const[x0,y0]=polar(cx,cy,r,d0),[x1,y1]=polar(cx,cy,r,d1);
  const large=(d1-d0)>180?1:0;return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;}
function gaugeSVG(score,regime,size=170){
  const cx=120,cy=124,r=98;
  const zones=[[0,25,"var(--gain)"],[25,45,"#3fb0a6"],[45,62,"var(--warn)"],[62,80,"#f5852a"],[80,100,"var(--loss)"]];
  let g="";zones.forEach(([a,b,c])=>{g+=`<path d="${arc(cx,cy,r,a/100*180,b/100*180)}" fill="none" stroke="${c}" stroke-width="15"/>`;});
  const [nx,ny]=polar(cx,cy,r-6,score/100*180);
  g+=`<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--text)" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="6" fill="var(--text)"/>`;
  g+=`<text x="20" y="120" class="axis">0 calm</text><text x="200" y="120" class="axis" text-anchor="end">100 fear</text>`;
  return `<div class="gauge-wrap"><div class="gauge-svg"><svg width="${size*1.6}" height="${size}" viewBox="0 0 240 145">${g}</svg>
    <div style="text-align:center;margin-top:-6px"><div class="gauge-center"><b>${score}</b><small>${esc(regime)}</small></div></div></div></div>`;
}
function renderMacro(){
  const mac=SNAP.macro;
  if(!mac||!mac.available){$("#page-macro").innerHTML="<div class='panel muted'>Macro data unavailable.</div>";return;}
  const comps=mac.components.map(c=>{const col=c.score>=62?"var(--loss)":c.score>=45?"var(--warn)":c.score>=25?"#3fb0a6":"var(--gain)";
    return `<div class="comp"><div class="cn">${esc(c.name)}</div><div class="cd">${esc(c.detail)} · <b style="color:${col}">${c.score.toFixed(0)}</b></div>
      <div class="ct"><i style="width:${c.score}%;background:${col}"></i></div></div>`;}).join("");
  const sk=mac.vix_spark,W=300,H=70;let mn=Math.min(...sk),mx=Math.max(...sk),sp=(mx-mn)||1;
  const p=sk.map((v,i)=>`${(i/(sk.length-1)*W).toFixed(1)},${(H-(v-mn)/sp*H).toFixed(1)}`).join(" ");
  $("#page-macro").innerHTML=`
    <div class="eyebrow">Macro / Volatility Regime</div>
    <div class="sect-sub" style="margin-bottom:16px">100 = maximum fear/panic, 0 = maximum optimism. Built from VIX, drawdown, momentum & safe-haven flows.</div>
    <div class="grid g2">
      <div class="panel"><div class="eyebrow" style="margin-bottom:10px">Fear Score</div>
        <div class="gauge-wrap">${gaugeSVG(mac.fear_score,mac.regime,160)}<div class="comp-list">${comps}</div></div></div>
      <div class="panel"><div class="eyebrow">VIX — last ~120 sessions</div>
        <div class="sect-sub" style="margin-bottom:10px">Now <b class="num" style="color:var(--text)">${mac.vix}</b></div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="max-height:110px"><polyline points="${p}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>
        <div class="small muted mt">Regime: <b style="color:var(--text)">${esc(mac.regime)}</b> — ${mac.tone==='greed'?'complacent, low hedging demand':mac.tone==='risk-on'?'calm, trend-friendly':mac.tone==='neutral'?'balanced':'defensive, elevated stress'}.</div></div>
    </div>
    <div class="panel mt small muted">PM read: a <b style="color:var(--text)">low</b> fear score favours the trend variants (V1/V3); a <b style="color:var(--text)">rising</b> score toward 60+ is your cue to tighten stops or shift to defensive V2. This is a regime filter, not a timing signal.</div>`;
}
function renderFearMini(){
  const mac=SNAP.macro;if(!mac||!mac.available)return;
  const col=mac.fear_score>=62?"var(--loss)":mac.fear_score>=45?"var(--warn)":mac.fear_score>=25?"#3fb0a6":"var(--gain)";
  $("#fmVal").textContent=mac.fear_score;$("#fmVal").style.color=col;
  $("#fmReg").textContent=mac.regime;$("#fmReg").style.color=col;
}

/* ============================================================
   PAGE: LIVE SIGNALS (B2 forward test — reads /api/live)
   ============================================================ */
function fwdChart(seriesList,{height=240}={}){
  // seriesList: [{label,color,curve:[{date,equity}]}] — union date axis
  const all=[...new Set(seriesList.flatMap(s=>s.curve.map(p=>p.date)))].sort();
  if(all.length<2) return "<div class='small muted'>Equity chart appears after 2+ trading days of data.</div>";
  const W=1000,H=height,pL=56,pR=14,pT=12,pB=24,x0=pL,x1=W-pR,y0=pT,y1=H-pB;
  const vals=seriesList.flatMap(s=>s.curve.map(p=>p.equity));
  let mn=Math.min(...vals),mx=Math.max(...vals);const sp=(mx-mn)||1;mn-=sp*.1;mx+=sp*.1;
  const xAt=d=>x0+(x1-x0)*all.indexOf(d)/(all.length-1);
  const yAt=v=>y1-(y1-y0)*(v-mn)/(mx-mn);
  let g="";
  for(let k=0;k<=3;k++){const yy=y0+(y1-y0)*k/3,val=mx-(mx-mn)*k/3;
    g+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="var(--grid)"/>`;
    g+=`<text class="axis" x="${x0-8}" y="${yy+3}" text-anchor="end">${fmtK(val)}</text>`;}
  g+=`<text class="axis" x="${x0}" y="${H-6}">${all[0]}</text><text class="axis" x="${x1}" y="${H-6}" text-anchor="end">${all.at(-1)}</text>`;
  seriesList.forEach(s=>{
    // forward-fill each series onto the union axis
    let last=null,d="";
    all.forEach(dt=>{const hit=s.curve.find(p=>p.date===dt);if(hit)last=hit.equity;
      if(last!=null)d+=(d?" L ":"M ")+xAt(dt).toFixed(1)+" "+yAt(last).toFixed(1);});
    g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.label==='A+B'?2.4:1.6}" ${s.dash?`stroke-dasharray="${s.dash}"`:""}/>`;});
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
}

let _aVar=null;   // which Strategy-A variant the Forward Test page is showing
async function loadLive(){
  const el=$("#page-live");
  el.innerHTML="<div class='panel muted'>Loading live data…</div>";
  let L=null;
  try{L=await apiGet("live");}
  catch(e){el.innerHTML="<div class='panel muted'>Failed to load live data: "+esc(e.message)+"</div>";return;}
  if(_aVar===null) _aVar=L.primary_a||"v6";
  const aV7=(_aVar==="v7");
  const aName=aV7?"V7 · Market-Hedged":"V6 · Long-Only";
  const B=L.paper,A=aV7?(L.paper_a_v7||L.paper_a):L.paper_a,pm=L.premarket,tjl=L.tjl;
  const N=L.paper_n,T=L.paper_t;
  const hedgePnl=(A&&A.hedge)?(A.hedge.account||0):null;
  const cap=SNAP.initial_capital;
  // live quotes -> intraday mark-to-market (falls back to entry/last close)
  const Q=L.quotes||{};
  const px=s=>Q[s]?.price;
  const liveVal=bk=>{if(!bk)return null;let v=bk.cash??bk.equity??0,any=false;
    (bk.open||[]).forEach(p=>{const q=px(p.symbol);v+=p.shares*(q??p.entry);if(q!=null)any=true;});
    if(bk.hedge)v+=bk.hedge.account||0;return any?Math.round(v*100)/100:null;};
  const aLive=liveVal(A);
  const bLive=(B&&B.open&&B.open.length)
    ?Math.round(((B.equity??cap/2)+B.open.reduce((s,t)=>s+((px(t.symbol)??t.entry)-t.entry)*t.shares,0))*100)/100:null;
  const qAsof=Object.keys(Q).length?(L.published_at||("ET "+L.now_et)):null;
  const aEq=aLive??(A?A.equity_curve.at(-1)?.equity??A.cash:cap/2);
  const bEq=bLive??(B?(B.equity??cap/2):cap/2);
  const total=aEq+bEq, totPnl=total-cap;
  const aTr=A?A.trades:[], bTr=B?B.trades:[];
  const allTr=[...aTr,...bTr], wins=allTr.filter(t=>t.pnl>0).length;

  let html=`<div class="banner" style="border-left-color:var(--accent)">
    <div class="bv" style="color:var(--accent);font-size:18px">FWD</div>
    <div class="bt"><b>Forward Test — 多 sleeve 實盤紙上交易</b>（started 2026-07-13）。
    ET now: <b>${esc(L.now_et)}</b>。A（波段）每日跑；N（市場中性）、T（跨資產趨勢）係實驗 sleeve。所有成交 WhatsApp 通知。
    <br><span class="small muted">Strategy B（日內 TJL）3年真數據證實只係邊緣貨，已下架；B2（Opening Range Breakout）研發中。</span></div></div>
    <div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat"><div class="k">A 戶口（主·${esc(aName.split(" ")[0])}）${aLive!=null?" ⚡":""}</div><div class="v">${fmtUsd(aEq)}</div><div class="s ${cls(aEq-cap/2)}">${fmtUsdS(aEq-cap/2)}${aLive!=null?" · 市價估值":""}</div></div>
      <div class="stat"><div class="k">A 持倉</div><div class="v" style="font-size:16px">${A?A.open.length+" 隻":"—"}</div><div class="s">${A?aTr.length+" 已平倉":""}</div></div>
      <div class="stat"><div class="k">N 中性（實驗）</div><div class="v">${N?fmtUsd(N.equity_curve?.at(-1)?.equity??N.equity??cap/2):dash}</div><div class="s">market-neutral</div></div>
      <div class="stat"><div class="k">T 趨勢（實驗）</div><div class="v">${T?fmtUsd(T.equity_curve?.at(-1)?.equity??T.equity??cap/2):dash}</div><div class="s">危機保險</div></div>
    </div>
    <div class="panel mt"><div class="card-head"><div><div class="eyebrow">Forward Equity — 各 sleeve 並排</div>
      <div class="sect-sub">Real-time paper results, one point per trading day</div></div>
      <div class="legend"><span><i class="swatch" style="background:var(--gain)"></i> A（${esc(aName.split(" ")[0])}）</span>
        ${N?`<span><i class="swatch" style="background:var(--warn)"></i> N (中性·實驗)</span>`:""}
        ${T?`<span><i class="swatch" style="background:#c084fc"></i> T (趨勢·實驗)</span>`:""}
        ${L.paper?`<span><i class="swatch" style="background:var(--accent2)"></i> B2 (日內ORB)</span>`:""}</div></div>
      ${fwdChart([
        {label:"A",color:"var(--gain)",curve:A?A.equity_curve:[]},
        ...(N&&N.equity_curve?[{label:"N",color:"var(--warn)",dash:"2 2",curve:N.equity_curve}]:[]),
        ...(T&&T.equity_curve?[{label:"T",color:"#c084fc",dash:"6 3",curve:T.equity_curve}]:[]),
        ...(L.paper&&L.paper.equity_curve?[{label:"B2",color:"var(--accent2)",dash:"4 3",curve:L.paper.equity_curve}]:[]),
      ])}</div>`;

  // ---------- Strategy A book (V6 / V7 switchable) ----------
  const segBtn=(v,label,note)=>`<button class="segbtn ${_aVar===v?'on':''}" data-avar="${v}"
      style="padding:5px 12px;border:1px solid var(--grid);background:${_aVar===v?'var(--accent)':'transparent'};
      color:${_aVar===v?'#fff':'var(--text)'};cursor:pointer;font-size:12px;border-radius:6px">
      ${label}${note?` <span style="opacity:.7">${note}</span>`:''}</button>`;
  html+=`<div class="panel mt"><div class="card-head"><div>
      <div class="eyebrow" style="margin-bottom:6px">Strategy A — ${esc(aName)} (paper)</div>
      <div class="sect-sub">Both variants run in parallel on the same signals; V7 adds a short-SPY hedge (0.5× exposure).
      <b>V7 is the primary</b> — the one to deploy to IB paper. Switch to compare →</div></div>
      <div id="aVarToggle" style="display:flex;gap:6px;align-items:center">
        ${segBtn("v6","V6","long-only")}${segBtn("v7","V7","hedged ★")}</div></div>`;
  if(hedgePnl!=null)
    html+=`<div class="eyebrow" style="margin:2px 0 10px;color:${hedgePnl>=0?'var(--gain)':'var(--loss)'}">
      🛡️ 對沖 leg 累計 P&L: ${fmtUsdS(hedgePnl)}（做空 SPY，抵銷大市方向）</div>`;
  if(A){
    if(A.pending&&A.pending.length)
      html+=`<div class="eyebrow" style="margin:4px 0 8px;color:var(--warn)">⏳ Queued for next market open — NOT filled yet</div>
        <div class="tbl-wrap" style="border:none;margin-bottom:12px"><table style="min-width:460px">
        <thead><tr><th style="text-align:left">Ticker</th><th>Score</th><th>Ref Close</th><th>Est. Shares</th></tr></thead>
        <tbody>${A.pending.map(o=>`<tr><td class="tk" style="text-align:left">${esc(o.symbol)}</td>
          <td style="color:var(--accent)">${o.score}</td><td>${o.ref_close!=null?fmtUsd(o.ref_close):dash}</td>
          <td>${o.est_shares!=null?"~"+o.est_shares:dash}</td></tr>`).join("")}</tbody></table></div>`;
    html+= A.open.length
      ? `<div class="tbl-wrap" style="border:none"><table style="min-width:680px">
         <thead><tr><th style="text-align:left">Ticker</th><th>Entry Date</th><th>Entry $</th><th>現價</th><th>賺蝕</th><th>Trail Stop $</th><th>Shares</th><th>Days</th></tr></thead>
         <tbody>${A.open.map(t=>{const q=px(t.symbol),up=q!=null?(q-t.entry)*t.shares:null;
           return `<tr><td class="tk" style="text-align:left">${esc(t.symbol)}</td><td>${esc(t.entry_date)}</td>
           <td>$${t.entry}</td><td>${q!=null?"$"+q:dash}</td>
           <td class="${up!=null?cls(up):''}">${up!=null?fmtUsdS(up):dash}</td>
           <td class="${t.stop>t.entry?'pos':'neg'}">$${t.stop}</td><td>${t.shares}</td><td>${t.days}</td></tr>`;}).join("")}</tbody></table></div>`
        + (qAsof?`<div class="small muted" style="margin-top:6px">現價截至 ${esc(qAsof)}（本地版即時，公開網每次自動 publish 更新）· 未平倉賺蝕合計 <b class="${cls(A.open.reduce((s,t)=>s+((px(t.symbol)??t.entry)-t.entry)*t.shares,0))}">${fmtUsdS(A.open.reduce((s,t)=>s+((px(t.symbol)??t.entry)-t.entry)*t.shares,0))}</b></div>`:"")
      : `<div class="small muted">No open positions.</div>`;
    if(aTr.length)
      html+=`<div class="trades-scroll" style="margin-top:10px"><table style="min-width:600px">
        <thead><tr><th style="text-align:left">Ticker</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>P&L</th><th style="text-align:left">Reason</th></tr></thead>
        <tbody>${[...aTr].reverse().map(t=>`<tr><td class="tk" style="text-align:left">${esc(t.symbol)}</td>
          <td>${esc(t.entry_date)}</td><td>${esc(t.exit_date)}</td><td>$${t.entry}</td><td>$${t.exit}</td>
          <td class="${cls(t.pnl)}">${fmtUsdS(t.pnl)}</td>
          <td style="text-align:left"><span class="rz ${t.reason==='stop'?'stop_loss':t.reason==='trail'?'trail_stop':'time_exit'}">${esc(t.reason)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }else{
    html+=`<div class="small muted">Book opens on the first scheduled run (Mon after US close). Test now: <b style="color:var(--text)">python main.py run-a --force</b></div>`;
  }
  html+=`</div>`;

  // ---------- Strategy B RETIRED — replaced by B2 (Opening Range Breakout, in R&D) ----------

  // ---------- realised correlation monitor (the live test of the JGF thesis) --
  function realisedCorrPanel(bkA, bkN){
    const rets=ec=>{const m={}; if(!ec) return m;
      for(let i=1;i<ec.length;i++) m[ec[i].date]=ec[i].equity/ec[i-1].equity-1; return m;};
    const rA=rets(bkA&&bkA.equity_curve), rN=rets(bkN&&bkN.equity_curve);
    const common=Object.keys(rA).filter(d=>d in rN).sort();
    if(common.length<10)
      return `<div class="panel mt"><div class="eyebrow">🔬 實盤相關監察 — N vs V6</div>
        <div class="small muted" style="margin-top:6px">呢個 panel 監察緊成個 multi-strat 實驗嘅核心假設：N 同 V6 嘅實盤日回報相關應該 ≈ 0（backtest 話係）。
        依家儲緊數據：<b style="color:var(--text)">${common.length}/10</b> 個共同交易日，夠 10 日就開始顯示。</div></div>`;
    const xs=common.map(d=>rA[d]), ys=common.map(d=>rN[d]);
    const mean=a=>a.reduce((s,x)=>s+x,0)/a.length, mx=mean(xs), my=mean(ys);
    let num=0,dx=0,dy=0;
    for(let i=0;i<xs.length;i++){num+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}
    const corr=num/Math.sqrt((dx*dy)||1);
    const col=Math.abs(corr)<0.3?"var(--gain)":Math.abs(corr)<0.6?"var(--warn)":"var(--loss)";
    const verdict=Math.abs(corr)<0.3?"真分散 ✓（JGF 效應成立中）":Math.abs(corr)<0.6?"半分散 — 繼續觀察":"假分散 ✗ — 同 V6 一齊上落";
    return `<div class="panel mt"><div class="eyebrow">🔬 實盤相關監察 — N vs V6</div>
      <div style="display:flex;align-items:baseline;gap:14px;margin:8px 0">
        <span style="font-size:28px;font-weight:700;color:${col}">${corr.toFixed(2)}</span>
        <span class="small" style="color:${col}">${verdict}</span></div>
      <div class="small muted">${common.length} 個共同實盤交易日 · backtest 預期 ≈ 0.00 · |corr|<0.3 = 綠</div></div>`;
  }

  // ---------- Strategy N book (market-neutral experiment) ----------
  if(N){
    const nEq=N.equity_curve?.at(-1)?.equity??N.equity??cap/2, nPnl=nEq-(N.start_capital??cap/2);
    const lastReb=(N.rebalances||[]).at(-1);
    html+=`<div class="panel mt" style="border-left:3px solid var(--warn)">
      <div class="eyebrow" style="margin-bottom:4px">🧬 Strategy N — Market-Neutral（實驗 · 一個月試跑）</div>
      <div class="sect-sub" style="margin-bottom:12px">做多 top-8 高分股（等權）− 沽 SPY 對沖 → 唔賭大市方向，只賭選股相對強弱。
      研究顯示同 V6 相關 ≈ 0，溝落組合可提升 Sharpe。<b>實驗中，未落真錢。</b></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <div class="stat"><div class="k">N 戶口（市場中性）</div><div class="v">${fmtUsd(nEq)}</div><div class="s ${cls(nPnl)}">${fmtUsdS(nPnl)}</div></div>
        <div class="stat"><div class="k">持倉</div><div class="v" style="font-size:15px">${(N.longs||[]).length} 隻等權</div><div class="s">每週換倉</div></div>
        <div class="stat"><div class="k">對沖</div><div class="v" style="font-size:15px">沽 SPY</div><div class="s">dollar-neutral</div></div>
      </div>`;
    if(N.longs&&N.longs.length)
      html+=`<div class="eyebrow" style="margin:2px 0 6px">本週做多籃子（等權）</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${N.longs.map(s=>{const q=px(s);
          return `<span class="tk" style="padding:4px 9px;border:1px solid var(--grid);border-radius:6px;font-size:12px">${esc(s)}${q!=null?` <span class="muted">$${q}</span>`:""}</span>`;}).join("")}
        <span class="tk" style="padding:4px 9px;border:1px solid var(--loss);border-radius:6px;font-size:12px;color:var(--loss)">− SPY 對沖</span></div>`;
    if(lastReb)
      html+=`<div class="small muted">最近換倉 ${esc(lastReb.date)}${lastReb.added?.length?" · 新增 "+lastReb.added.join("、"):""}${lastReb.removed?.length?" · 剔除 "+lastReb.removed.join("、"):""}</div>`;
    html+=`</div>`;
    html+=realisedCorrPanel(L.paper_a, N);
  }

  // ---------- Strategy T book (cross-asset trend / crisis alpha) ----------
  if(T){
    const tEq=T.equity_curve?.at(-1)?.equity??T.equity??cap/2, tPnl=tEq-(T.start_capital??cap/2);
    const tw=T.weights||{};
    const longs=Object.entries(tw).filter(([k,v])=>v>0), shorts=Object.entries(tw).filter(([k,v])=>v<0);
    const chip=(k,v)=>`<span class="tk" style="padding:4px 9px;border:1px solid ${v>0?'var(--grid)':'var(--loss)'};border-radius:6px;font-size:12px;${v<0?'color:var(--loss)':''}">${esc(k)} ${(v*100).toFixed(0)}%</span>`;
    html+=`<div class="panel mt" style="border-left:3px solid #c084fc">
      <div class="eyebrow" style="margin-bottom:4px">🌊 Strategy T — 跨資產趨勢（危機保險 · 實驗）</div>
      <div class="sect-sub" style="margin-bottom:12px">9 隻 ETF（股/債/金/商品/美元）time-series momentum：升勢做多、跌勢做空。
      2022 backtest +6.9%（SPY −18%）、對 V6 相關 −0.06。角色 = 危機 alpha：牛市陰蝕係保費，持續跌市先發揮。<b>實驗中，未落真錢。</b></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <div class="stat"><div class="k">T 戶口</div><div class="v">${fmtUsd(tEq)}</div><div class="s ${cls(tPnl)}">${fmtUsdS(tPnl)}</div></div>
        <div class="stat"><div class="k">持倉</div><div class="v" style="font-size:15px">${longs.length} 多 · ${shorts.length} 空</div><div class="s">每週調倉 · inverse-vol</div></div>
        <div class="stat"><div class="k">角色</div><div class="v" style="font-size:15px">危機保險</div><div class="s">同 V6 相關 ≈ −0.06</div></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${longs.map(([k,v])=>chip(k,v)).join("")}${shorts.map(([k,v])=>chip(k,v)).join("")}</div>
    </div>`;
  }

  // ---------- Strategy B2 book (Opening Range Breakout, 5-min intraday) ----------
  const B2=L.paper;
  if(B2){
    const b2Eq=B2.equity_curve?.at(-1)?.equity??B2.equity??cap/2, b2Pnl=b2Eq-(B2.start_capital??cap/2);
    const b2Tr=B2.trades||[], b2Wins=b2Tr.filter(t=>t.pnl>0).length;
    html+=`<div class="panel mt" style="border-left:3px solid var(--accent2)">
      <div class="eyebrow" style="margin-bottom:4px">⚡ Strategy B2 — Opening Range Breakout（5分鐘日內）</div>
      <div class="sect-sub" style="margin-bottom:12px">高beta movers · 只交易「相對成交量≥3x」嘅 in-play 股 · 突破開市首5分鐘高位做多 · 2R目標 · 收市必平。
      3年5分鐘真數據回測 PF 1.27、3/4年正、~4單/週。<b>取代已下架嘅日內 B，實盤驗證中。</b></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <div class="stat"><div class="k">B2 戶口</div><div class="v">${fmtUsd(b2Eq)}</div><div class="s ${cls(b2Pnl)}">${fmtUsdS(b2Pnl)}</div></div>
        <div class="stat"><div class="k">持倉</div><div class="v" style="font-size:15px">${B2.open?.length||0} 隻</div><div class="s">日內·收市平</div></div>
        <div class="stat"><div class="k">累計</div><div class="v" style="font-size:15px">${b2Tr.length?(b2Wins/b2Tr.length*100).toFixed(0)+"% 勝":"—"}</div><div class="s">${b2Tr.length} 單</div></div>
      </div>`;
    if(B2.open&&B2.open.length)
      html+=`<div class="tbl-wrap" style="border:none"><table style="min-width:620px">
        <thead><tr><th style="text-align:left">Ticker</th><th>入場時間</th><th>入場$</th><th>現價</th><th>止蝕</th><th>2R目標</th><th>rvol</th></tr></thead>
        <tbody>${B2.open.map(t=>{const q=px(t.symbol);return `<tr><td class="tk" style="text-align:left">${esc(t.symbol)}</td>
          <td>${esc(t.entry_time)} ET</td><td>$${t.entry}</td><td>${q!=null?"$"+q:dash}</td>
          <td class="neg">$${t.stop}</td><td class="pos">$${t.target}</td><td>${t.rvol}x</td></tr>`;}).join("")}</tbody></table></div>`;
    if(b2Tr.length)
      html+=`<div class="trades-scroll" style="margin-top:10px"><table style="min-width:560px">
        <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">Ticker</th><th>入$</th><th>出$</th><th>P&L</th><th style="text-align:left">離場</th></tr></thead>
        <tbody>${[...b2Tr].reverse().slice(0,30).map(t=>`<tr><td style="text-align:left">${esc(t.date)}</td>
          <td class="tk" style="text-align:left">${esc(t.symbol)}</td><td>$${t.entry}</td><td>$${t.exit}</td>
          <td class="${cls(t.pnl)}">${fmtUsdS(t.pnl)}</td><td style="text-align:left">${esc(t.reason||"")}</td></tr>`).join("")}</tbody></table></div>`;
    else if(!(B2.open&&B2.open.length))
      html+=`<div class="small muted">未有交易 — B2 只喺開市後、有股票成交量爆升(rvol≥3)兼突破開市高位先入場（~4單/週）。今晚美股時段自動掃描。</div>`;
    html+=`</div>`;
  }

  // ---------- Strategy O book (sell-put income, weekly) ----------
  const O=L.paper_o;
  if(O){
    const oStart=O.start_capital??100000, oReal=O.realized??0, oEq=oStart+oReal;
    const oTr=O.trades||[], oWins=oTr.filter(t=>t.pnl>0).length;
    const margin=(O.open||[]).reduce((s,p)=>s+p.K*100,0);
    html+=`<div class="panel mt" style="border-left:3px solid var(--gain)">
      <div class="eyebrow" style="margin-bottom:4px">💰 Strategy O — Sell-Put 收租（每週 · 實驗）</div>
      <div class="sect-sub" style="margin-bottom:12px">Mega-cap 30-delta put · 避財報 · SPY>200天線先開倉 · 50%利潤/21DTE 平倉。
      7年真期權數據回測：年化 ~+12.3%（對按金）、PF 1.47、2022 受控。<b>名義按金 100k 追蹤實驗，未落真錢。</b></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <div class="stat"><div class="k">O 戶口（名義 100k）</div><div class="v">${fmtUsd(oEq)}</div><div class="s ${cls(oReal)}">${fmtUsdS(oReal)}</div></div>
        <div class="stat"><div class="k">持倉</div><div class="v" style="font-size:15px">${(O.open||[]).length} 張 put</div><div class="s">按金 ${fmtUsd(margin)}</div></div>
        <div class="stat"><div class="k">累計</div><div class="v" style="font-size:15px">${oTr.length?(oWins/oTr.length*100).toFixed(0)+"% 勝":"—"}</div><div class="s">${oTr.length} 張已平</div></div>
      </div>`;
    if(O.open&&O.open.length)
      html+=`<div class="tbl-wrap" style="border:none"><table style="min-width:560px">
        <thead><tr><th style="text-align:left">股票</th><th>行使價</th><th>到期</th><th>收取權利金</th><th>delta</th><th>開倉日</th></tr></thead>
        <tbody>${O.open.map(p=>`<tr><td class="tk" style="text-align:left">${esc(p.tk)}</td>
          <td>$${p.K}</td><td>${esc(p.expiry)}</td><td class="pos">$${(p.prem*100).toFixed(0)}</td>
          <td>${p.delta??dash}</td><td>${esc(p.entry_date)}</td></tr>`).join("")}</tbody></table></div>`;
    else
      html+=`<div class="small muted">未有持倉 — 逢週三（美股時段）自動揀 30-delta put 開倉（避財報、大市閘通過先開）。</div>`;
    if(oTr.length)
      html+=`<div class="trades-scroll" style="margin-top:10px"><table style="min-width:560px">
        <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">合約</th><th>P&L</th><th style="text-align:left">平倉方式</th></tr></thead>
        <tbody>${[...oTr].reverse().slice(0,20).map(t=>`<tr><td style="text-align:left">${esc(t.date)}</td>
          <td class="tk" style="text-align:left">${esc(t.tk)} ${t.K}P ${esc(t.expiry)}</td>
          <td class="${cls(t.pnl)}">${fmtUsdS(t.pnl)}</td><td style="text-align:left">${esc(t.exit||"")}</td></tr>`).join("")}</tbody></table></div>`;
    html+=`</div>`;
  }

  el.innerHTML=html;
  // wire the V6/V7 toggle — switch variant and re-render (cheap: re-reads JSON)
  $$("#aVarToggle .segbtn").forEach(b=>b.onclick=()=>{
    if(b.dataset.avar!==_aVar){ _aVar=b.dataset.avar; loadLive(); }});
}

/* ============================================================
   PAGE: LEARNINGS (self-learning memory — reads /api/learnings)
   ============================================================ */
function learnStrategyBlock(s){
  if(!s.exists)
    return `<div class="panel mt"><div class="eyebrow" style="margin-bottom:6px">${esc(s.name)}</div>
      <div class="small muted">未有交易紀錄 — 開始 forward test 就會開始學。</div></div>`;
  const buckets=s.buckets||{}, keys=Object.keys(buckets).sort();
  const cds=s.cooldowns||{}, cdKeys=Object.keys(cds);
  const ms=s.min_sample;
  let html=`<div class="panel mt"><div class="card-head"><div>
    <div class="eyebrow">${esc(s.name)}</div>
    <div class="sect-sub">已平倉 ${s.closed_trades||0} 單 · 分桶方式：${esc(s.bucket_by||"setup")} · 每桶需 ${ms} 單先可判斷</div>
    </div></div>`;
  if(!keys.length){
    html+=`<div class="small muted" style="margin-top:8px">仲未夠已平倉交易去學習 — 繼續跑，桶滿 ${ms} 單就會出現期望值同建議。</div></div>`;
    return html;
  }
  // bucket table: n / win% / expectancy(R) / verdict
  html+=`<div class="tbl-wrap" style="border:none;margin-top:10px"><table style="min-width:520px">
    <thead><tr><th style="text-align:left">Setup 桶</th><th>樣本 n</th><th>勝率</th><th>期望 (R)</th><th style="text-align:left">狀態</th></tr></thead><tbody>`;
  keys.forEach(k=>{
    const d=buckets[k], n=d.n, wr=(d.win_rate*100), er=d.expectancy_r;
    const enough=n>=ms, blocked=enough&&er<=s.block_expectancy_r;
    const tag=blocked?`<span class="rz stop_loss">避開</span>`
      :enough?`<span class="rz trail_stop">可續做</span>`
      :`<span class="rz time_exit">樣本未夠 ${n}/${ms}</span>`;
    html+=`<tr><td class="tk" style="text-align:left">${esc(k)}</td>
      <td>${n}</td><td>${wr.toFixed(0)}%</td>
      <td class="${cls(er)}">${er>=0?"+":""}${er.toFixed(2)}R</td>
      <td style="text-align:left">${tag}</td></tr>`;
  });
  html+=`</tbody></table></div>`;
  // cooldowns
  if(cdKeys.length){
    html+=`<div class="eyebrow" style="margin:14px 0 6px;color:var(--warn)">🧊 冷靜中（近期淨蝕，暫停買入）</div>
      <div class="sug-cards">${cdKeys.map(sym=>{const c=cds[sym];
        return `<div class="sug"><div class="top"><div><div class="tkr">${esc(sym)}</div>
          <div class="px ${cls(c.expectancy_r)}">${c.expectancy_r>=0?"+":""}${(+c.expectancy_r).toFixed(2)}R</div></div>
          <span class="pill" style="background:var(--warn);color:#000">HELD</span></div>
          <div class="why">${c.n} 單 · 冷靜至 ${esc(String(c.until))}</div></div>`;}).join("")}</div>`;
  }
  // plain-language lessons
  const lessons=(s.lessons||[]).filter(l=>/^[❌🧊]/.test(l));
  if(lessons.length){
    html+=`<div class="eyebrow" style="margin:14px 0 6px">📓 教訓（自動寫入 learnings 檔）</div>
      <ul class="small" style="margin:0;padding-left:18px;line-height:1.8">
      ${lessons.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>`;
  }
  html+=`</div>`;
  return html;
}

async function loadLearn(){
  const el=$("#page-learn");
  el.innerHTML="<div class='panel muted'>Loading learnings…</div>";
  let D=null;
  try{D=await apiGet("learnings");}
  catch(e){el.innerHTML="<div class='panel muted'>Failed to load learnings: "+esc(e.message)+"</div>";return;}
  const modeOn=D.mode==="block";
  const modeColor=modeOn?"var(--gain)":"var(--warn)";
  const modeText=modeOn
    ?"BLOCK 模式：過往同類蝕錢嘅 setup / 冷靜中嘅股票，會被<b>真正略過</b>唔開新倉。"
    :"SHADOW 模式：只會<b>記錄</b>「本應略過邊單」，但唔會真係略過（先觀察，之後改 config 轉 block）。";
  let html=`<div class="banner" style="border-left-color:${modeColor}">
    <div class="bv" style="color:${modeColor};font-size:18px">🧠</div>
    <div class="bt"><b>Self-Learning Memory</b> — 每次落單前，策略會查返自己<b>已平倉</b>嘅交易紀錄，
    邊類 setup 長期蝕錢就避開，邊隻股近期連蝕就入冷靜期。純用過去已完成嘅交易 → 冇 look-ahead。
    <br>${modeText}
    <br><span class="small muted">門檻：每個 setup 桶要夠 ${D.min_sample} 單、期望值 ≤ ${D.block_expectancy_r}R 先會被判「避開」。桶未夠數 = gate 不動，行為同以前一樣。</span></div></div>`;
  const S=D.strategies||{};
  ["a","b"].forEach(k=>{ if(S[k]) html+=learnStrategyBlock(S[k]); });
  el.innerHTML=html;
}

/* ============================================================
   NAV / REFRESH / THEME
   ============================================================ */
const titles={overview:["Overview","Portfolio scorecard & best variant"],
  live:["Forward Test A+B","Real-time paper trading — no hindsight"],
  learn:["Learnings","How the bots learn from their own trades"],
  strategies:["Strategies","Tearsheets, trade logs & explorer"],
  suggestions:["Suggested Buys","Live picks by holding horizon"],
  universe:["Universe","Fundamentals & live scores"],
  macro:["Macro / VIX","Volatility regime & fear gauge"]};
$$("#nav .nl").forEach(nl=>nl.onclick=()=>{const p=nl.dataset.page;
  $$("#nav .nl").forEach(x=>x.classList.remove("active"));nl.classList.add("active");
  $$(".page").forEach(x=>x.classList.remove("active"));$("#page-"+p).classList.add("active");
  $("#pageTitle").textContent=titles[p][0];$("#pageMeta").textContent=titles[p][1];
  if(p==="live")loadLive();
  if(p==="learn")loadLearn();
  try{history.replaceState(null,"","#"+p);}catch(e){}});

// deep link: opening the dashboard at .../#live jumps straight to Forward Test
(function(){const h=(location.hash||"").replace("#","");
  if(h&&document.querySelector(`.nl[data-page="${h}"]`))
    document.querySelector(`.nl[data-page="${h}"]`).click();})();
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);}
$("#refreshBtn").onclick=async()=>{const b=$("#refreshBtn");b.classList.add("loading");b.disabled=true;
  b.querySelector(".lbl").textContent="Fetching live data…";
  try{
    let r=await fetch("api/refresh",{method:"POST"});
    SNAP = r.ok ? await r.json() : await apiGet("snapshot");  // static host: just re-read
    render();toast("✓ Refreshed");
  }catch(e){try{SNAP=await apiGet("snapshot");render();toast("✓ Reloaded");}catch(_){toast("Refresh failed");}}
  finally{b.classList.remove("loading");b.disabled=false;b.querySelector(".lbl").textContent="↻ Refresh data";}};
$("#themeBtn").onclick=()=>{const cur=document.documentElement.getAttribute("data-theme"),next=cur==="dark"?"light":"dark";
  document.documentElement.setAttribute("data-theme",next);$("#themeBtn").textContent=next==="dark"?"☾":"☀";
  try{localStorage.setItem("theme",next);}catch(e){}};
(function(){try{const s=localStorage.getItem("theme");if(s){document.documentElement.setAttribute("data-theme",s);$("#themeBtn").textContent=s==="dark"?"☾":"☀";}}catch(e){}})();

boot();

// Pure deterministic reducer: no timers, DOM, network, or random side effects.
import { ExecutionReviewContract } from './execution-contract.js';

export const START_USD = 111.18;
export const DEFAULT_CONFIG = { size: .1, slippage: 3, priority: 50000, tip: .0001, tp1: 15, tp2: 35, tp3: 75, stop: 7, trailing: 7, interval: 500, velocity: .8, volume: 3, rsi: 35, strategy: 'breakout', maxPositions: 3 };
export const ASSETS = [
  { id:'SOL', name:'Solana', price:111.18, liquidity:8000000, sigma:.006, color:'#14F195' },
  { id:'BONK', name:'Bonk', price:.000022, liquidity:380000, sigma:.035, color:'#FFBE6B' },
  { id:'WIF', name:'dogwifhat', price:1.82, liquidity:210000, sigma:.045, color:'#C7A0FF' },
  { id:'POPCAT', name:'Popcat', price:.42, liquidity:130000, sigma:.05, color:'#00C2FF' },
  { id:'MOON', name:'Moon / synthetic', price:.00084, liquidity:18000, sigma:.075, color:'#FF7595' },
];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function random(s) { s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return (s.seed+.5)/4294967296; }
function normal(s) { return Math.sqrt(-2*Math.log(random(s)))*Math.cos(2*Math.PI*random(s)); }
function log(s,event) { s.sequence++;s.logs=[{at:s.now,status:'info',...event,id:s.sequence},...s.logs.slice(0,299)]; /* Copy only when an audit event is written. */ }
export function indicators(history) {
 // One bounded pass, no temporary slice/map/reduce arrays per tick.
 const n=history.length;let fast=0,slow=0,gains=0,losses=0;
 for(let i=Math.max(0,n-20);i<n;i++){
  const value=history[i].value;slow+=value;if(i>=n-5)fast+=value;
  if(i>0&&i>=n-14){const d=value-history[i-1].value;gains+=Math.max(0,d);losses+=Math.max(0,-d);}
 }
 return {rsi:gains+losses===0?50:100*gains/(gains+losses),fast:n?fast/Math.min(5,n):0,slow:n?slow/Math.min(20,n):0,velocity:n>4?(history[n-1].value/history[n-5].value-1)*100:0};
}
export function initialState(now=Date.now(),seed=7919) {
 const s={astraGate:false,version:1,executionMode:'legacy',seed,now,sequence:0,cash:START_USD,realized:0,fees:0,initial:START_USD,config:{...DEFAULT_CONFIG},assets:[],positions:[],pending:[],logs:[],running:false,lastEval:0,cooldowns:{},trades:0,notice:'Live Dashboard data connected. Auto-Simulate is ready for paper execution.'};
 s.assets=ASSETS.map(a=>{let value=a.price;const history=[];for(let i=180;i>0;i--){value*=Math.exp(normal(s)*a.sigma*.12);history.push({time:Math.floor(now/1000)-i,value});}return {...a,price:value,start:value,history,volume:1,spike:0,...indicators(history)};});
 if(s.assets[0]?.id==='SOL'){s.assets[0].price=START_USD;s.assets[0].start=START_USD;if(s.assets[0].history?.length)s.assets[0].history[s.assets[0].history.length-1]={time:Math.floor(now/1000),value:START_USD};}
 log(s,{reason:`Session initialized · 1 SOL equivalent / ${START_USD} USDC`,source:'System'});return s;
}
// Includes stop distance, allowed execution slippage, and round-trip network fees.
export function riskBudget(equity,notional,stopPercent,slippagePercent,roundTripFees){return {limit:equity*.02,modeledLoss:notional*(stopPercent+slippagePercent)/100+roundTripFees,allowed:Number.isFinite(equity)&&equity>0&&notional>0&&notional*(stopPercent+slippagePercent)/100+roundTripFees<=equity*.02};}
export function networkFee(config,solPrice) { return (Math.ceil(config.priority*200000/1e6)/1e9+config.tip+.000005)*solPrice; }
export function metrics(s) {
 // Index once: O(assets + positions), instead of two nested asset scans.
 const prices=new Map(s.assets.map(a=>[a.id,a.price]));let exposure=0,unrealized=0,reserved=0;
 for(const p of s.positions){const value=p.qty*prices.get(p.asset);exposure+=value;unrealized+=value-p.cost;}
 for(const o of s.pending)reserved+=(o.side==='buy'?o.budget:0)+o.fee;
 return {equity:s.cash+exposure,exposure,reserved,available:Math.max(0,s.cash-reserved),unrealized};
}
export function executionQuote(asset,side,amount,config,solPrice) {
 const reserve=asset.liquidity/2;
 const notional=side==='buy'?amount:amount*asset.price;
 const impact=notional*(1-.003)/reserve;
 const price=side==='buy'?asset.price*(1+impact)/(1-.003):asset.price*(1-.003)/(1+impact);
 return {price,impact:Math.abs(price/asset.price-1)*100,fee:networkFee(config,solPrice),dexFee:notional*.003};
}
function enqueue(s,assetId,side,source,reason,fraction=1,tier=null) {
 if(side==='buy'&&s.astraGate===true){s.notice='ASTRA: Entry blocked. Global top-five universe and required signals are unverified.';log(s,{asset:assetId,source,side,status:'rejected',reason:s.notice});return;}
 const asset=s.assets.find(a=>a.id===assetId);if(!asset)return;
 if(side==='buy'&&s.liveMode&&(!s.eligibleIds.includes(assetId)||s.now-s.basketAt>15000||!Number.isFinite(asset.liquidity)||asset.liquidity<=0)){log(s,{asset:assetId,side,source,status:'rejected',reason:'Entry requires a fresh observed basket and known positive liquidity.'});return;}
 if(s.pending.some(o=>o.asset===assetId)) {s.notice='An order for this asset is already pending.';return;}
 const pos=s.positions.find(p=>p.asset===assetId);
 if(side==='buy'&&(pos||s.positions.length+s.pending.filter(o=>o.side==='buy').length>=s.config.maxPositions)){s.notice='Position limit reached. Close a position before entering another.';return;}
 if(side==='sell'&&!pos)return;
 const sol=s.assets[0]?.price||150,fee=networkFee(s.config,sol),budget=s.config.size*sol;
 if(metrics(s).available<(side==='buy'?budget:0)+fee){s.notice='Insufficient available virtual balance for order and network fees.';log(s,{asset:assetId,side,source,reason:s.notice,status:'rejected'});return;}
 if(side==='buy'&&!riskBudget(metrics(s).equity,budget,s.config.stop,s.config.slippage,fee*2).allowed){s.notice='Entry rejected: modeled loss exceeds 2% of equity.';log(s,{asset:assetId,source,side,status:'rejected',reason:s.notice});return;}
 const latency=100+Math.floor(random(s)*301);
 const contract = new ExecutionReviewContract({
   mint: asset.mint || asset.id,
   side,
   source,
   reason,
   amount: side === 'buy' ? budget : (pos ? Math.min(pos.qty, pos.initialQty * fraction) : 0),
   config: { ...s.config },
 });
 contract.advance('REVIEWING', 'Order created in engine');
 contract.advance('CONFIRMED', 'Risk and capital checks passed');
 contract.advance('SUBMITTED', 'Order pending network latency simulation');

 const order={id:++s.sequence,contract,contractId:contract.contractId,asset:assetId,side,source,reason,submitted:s.now,due:s.now+latency,latency,reference:asset.price,config:{...s.config},fee,budget,qty:pos?Math.min(pos.qty,pos.initialQty*fraction):0,tier};
 s.pending.push(order);log(s,{...order,at:s.now,status:'pending'});s.notice=`${side.toUpperCase()} ${assetId} pending · ${latency} ms confirmation`;
}
function fill(s,o,emergency=false) {
 const a=s.assets.find(a=>a.id===o.asset),p=s.positions.find(p=>p.asset===o.asset);
 if(o.side==='sell'&&!p){
   if(o.contract&&!o.contract.isTerminal)try{o.contract.advance('CANCELLED','Position already closed');}catch{}
   return;
 }
 if(s.liveMode&&(!Number.isFinite(a?.observedAt)||s.now-a.observedAt>15000||a.observedAt>s.now)){
   if(o.contract&&!o.contract.isTerminal)try{o.contract.advance('CANCELLED','Asset observation stale');}catch{}
   log(s,{...o,status:'cancelled',at:s.now,reason:'Fill cancelled: asset observation is stale; no fee charged.'});
   s.notice='Waiting for a fresh asset observation. Position remains open.';return;
 }
 // Revalidate at settlement: data may disappear after submission.
 if(!a||!Number.isFinite(a.price)||a.price<=0||!Number.isFinite(a.liquidity)||a.liquidity<=0||(o.side==='buy'&&s.liveMode&&(!s.eligibleIds.includes(o.asset)||s.now-s.basketAt>15000))){
   if(o.contract&&!o.contract.isTerminal)try{o.contract.advance('CANCELLED','Fresh market data unavailable');}catch{}
   log(s,{...o,status:'cancelled',at:s.now,reason:'Fill cancelled: fresh executable market data unavailable; no fee charged.'});
   s.notice='Fill cancelled: market data unavailable. Existing positions remain open.';return;
 }
 const sellQty=p?(o.qty&&o.qty>0?Math.min(p.qty,o.qty):p.qty):0;
 const quote=executionQuote(a,o.side,o.side==='buy'?o.budget:sellQty,o.config,s.assets[0]?.price||150);
 const slippage=Math.abs(quote.price/(o.reference||a.price)-1)*100;
 const fee=o.fee;
 if(!emergency&&slippage>o.config.slippage){
   if(o.contract&&!o.contract.isTerminal)try{o.contract.advance('REJECTED','Slippage exceeded limit');}catch{}
   s.cash-=fee;s.fees+=fee;s.realized-=fee;
   log(s,{...o,status:'rejected',at:s.now,reason:'Slippage exceeded limit',fee,slippage});
   s.notice=`${o.side.toUpperCase()} ${o.asset} rejected · Slippage exceeded limit`;
   return;
 }
 let pnl=0;
 if(o.side==='buy') {
   const received=o.budget/quote.price;
   s.cash-=o.budget+fee;
   s.positions.push({asset:o.asset,qty:received,initialQty:received,entry:quote.price,cost:o.budget+fee,opened:s.now,high:a.price,stop:quote.price*(1-o.config.stop/100),tiers:[],source:o.source});
 } else {
   const qty=sellQty;
   const basis=p.cost*qty/p.qty,proceeds=qty*quote.price-fee;
   pnl=proceeds-basis;s.cash+=proceeds;s.realized+=pnl;p.cost-=basis;p.qty-=qty;
   if(o.tier!==null)p.tiers.push(o.tier);
   if(p.qty<=p.initialQty*1e-9)s.positions=s.positions.filter(x=>x!==p);
 }
 s.fees+=fee+quote.dexFee;s.trades++;
 if(o.contract&&!o.contract.isTerminal){
   try{
     o.contract.advance('ACKNOWLEDGED','Order filled on book');
     o.contract.advance('SETTLED','Settlement confirmed on ledger', {
       fillPrice: quote.price,
       fillQty: o.side==='buy'?o.budget/quote.price:sellQty,
       slippage,
       fee: fee+quote.dexFee,
       pnl,
     });
     o.contract.advance('RECONCILED','Ledger reconciled');
   }catch{}
 }
 log(s,{...o,status:'filled',at:s.now,price:quote.price,slippage,fee:fee+quote.dexFee,pnl,qty:o.side==='buy'?o.budget/quote.price:sellQty});
 s.notice=`${o.side.toUpperCase()} ${o.asset} filled · ${o.reason}`;
}
function settle(s) {
 const due=s.pending.filter(o=>o.due<=s.now);s.pending=s.pending.filter(o=>o.due>s.now);
 for(const o of due)fill(s,o);
}
function liquidate(s,reason) {
 s.running=false;
 for(const o of s.pending)log(s,{...o,at:s.now,status:'cancelled',reason:'Cancelled by emergency stop'});
 s.pending=[];
 const solPrice=s.assets[0]?.price||150;
 for(const p of [...s.positions]){const a=s.assets.find(a=>a.id===p.asset);fill(s,{asset:p.asset,side:'sell',source:'Emergency',reason,qty:p.qty,reference:a?.price||p.entry,fee:networkFee(s.config,solPrice),config:{...s.config},tier:null,latency:0,submitted:s.now},true);}
 log(s,{source:'System',reason,status:'halted'});s.notice=s.positions.length?`${reason}. ${s.positions.length} positions remain open: executable market data unavailable.`:`${reason}. All positions closed; pending orders cancelled.`;
}
function automate(s) {
 if(!s.running||s.now-s.lastEval<s.config.interval)return;s.lastEval=s.now;
 for(const p of [...s.positions]){
   const a=s.assets.find(a=>a.id===p.asset);
   if(s.pending.some(o=>o.asset===p.asset))continue;
   if(a.price<=p.stop){enqueue(s,p.asset,'sell','Auto-Bot',p.stop>p.entry?'Trailing stop':'Stop loss');continue;}
   const thresholds=[s.config.tp1,s.config.tp2,s.config.tp3];
   const tier=thresholds.findIndex((tp,i)=>!p.tiers.includes(i)&&a.price>=p.entry*(1+tp/100));
   if(tier>=0)enqueue(s,p.asset,'sell','Auto-Bot',`Take profit ${thresholds[tier]}%`,tier===2?1:.25,tier);
 }
 for(const a of s.assets){
   if(s.positions.some(p=>p.asset===a.id)||s.pending.some(o=>o.asset===a.id)||s.now-(s.cooldowns[a.id]||0)<15000)continue;
   if(s.liveMode&&(!s.eligibleIds.includes(a.id)||s.now-s.basketAt>15000))continue;
   const breakout=Number.isFinite(a.velocity)&&Number.isFinite(a.volume)&&a.velocity>s.config.velocity&&a.volume>=s.config.volume;
   const dip=[a.previousRsi,a.rsi,a.fast,a.slow].every(Number.isFinite)&&a.previousRsi<s.config.rsi&&a.rsi>=s.config.rsi&&a.fast>a.slow;
   if((s.config.strategy==='breakout'?breakout:dip)) {s.cooldowns[a.id]=s.now;enqueue(s,a.id,'buy','Auto-Bot',breakout?'Volume + velocity breakout':'RSI recovery + MA confirmation');}
 }
}
export function reducer(state,action) {
  if(action.type==='CANDIDATE_REJECTED'){
    const p=action.payload||{};
    if(!p.asset||!p.reason)return state;
    const next={...state};
    log(next,{asset:p.asset,symbol:p.symbol,mint:p.mint,code:p.code,side:'buy',status:'rejected',source:'Auto screening',reason:p.reason,at:p.timestamp??state.now,fee:0});
    return next;
  }
 if(action.type==='RESET')return initialState(action.now??Date.now(),state.seed);
 if(action.type==='SET_EXECUTION_MODE')return ['legacy','external'].includes(action.mode)?{...state,executionMode:action.mode}:state;
 // Preserve unchanged branch identities so React effects and memoized views can skip work.
 const tick=action.type==='TICK';
 const s={...state,config:action.type==='CONFIG'?{...state.config}:state.config,assets:tick?state.assets.map(a=>({...a,history:[...a.history]})):state.assets,positions:state.positions.map(p=>({...p,tiers:[...p.tiers]})),pending:[...state.pending],logs:state.logs,cooldowns:tick?{...state.cooldowns}:state.cooldowns};
 s.now=Math.max(state.now,action.now??state.now);
 if(action.type==='CONFIG'){
   const ranges={size:[.1,5],slippage:[.1,25],priority:[0,1000000],tip:[0,.01],tp1:[1,200],tp2:[2,400],tp3:[3,1000],stop:[5,8],trailing:[5,8],interval:[250,5000],velocity:[.1,10],volume:[1,8],rsi:[10,60],maxPositions:[1,5]};
   if(action.key==='strategy'&&['breakout','dip'].includes(action.value))s.config.strategy=action.value;
   else if(ranges[action.key]&&Number.isFinite(Number(action.value)))s.config[action.key]=clamp(Number(action.value),...ranges[action.key]);
   s.config.tp2=Math.max(s.config.tp1+1,s.config.tp2);s.config.tp3=Math.max(s.config.tp2+1,s.config.tp3);
 } else if(action.type==='SYNC_ASSETS'){
   let wallet=s.assets[0];
   const liveSol=(action.assets||[]).find(a=>a&&a.price>0&&(a.id==='SOL'||a.symbol==='SOL'));
   if(liveSol&&Number.isFinite(liveSol.price)&&liveSol.price>0){
     const point={time:Math.floor(s.now/1000),value:liveSol.price};
     const history=Array.isArray(wallet.history)?[...wallet.history]:[];
     if(!history.length||point.time>history.at(-1)?.time)history.push(point);
     else if(history.length)history[history.length-1]=point;
     if(history.length>300)history.shift();
     wallet={...wallet,price:liveSol.price,observedAt:liveSol.observedAt||action.at||s.now,history};
     if(s.trades===0&&s.positions.length===0&&s.pending.length===0){
       s.cash=liveSol.price;
       s.initial=liveSol.price;
     }
   }
   const incoming=(action.assets||[]).filter(a=>a&&a.id&&Number.isFinite(a.price)&&a.price>0).map(a=>({...a,history:Array.isArray(a.history)&&a.history.length?a.history:[{time:Math.floor(s.now/1000),value:a.price}],start:Number(a.start)||a.price,liquidity:Number.isFinite(a.liquidity)?a.liquidity:null,sigma:Number(a.sigma)||.02,volume:Number.isFinite(a.volume)?a.volume:null,volume1h:Number.isFinite(a.volume1h)?a.volume1h:null,rsi:a.rsi??null,previousRsi:a.previousRsi??null,fast:a.fast??null,slow:a.slow??null,velocity:a.velocity??null,spike:Number(a.spike)||0}));
   const ranked=[...new Map(incoming.filter(a=>a.id!==wallet.id&&a.id!=='SOL'&&a.symbol!=='SOL').map(a=>[a.id,{...a,observedAt:Number.isFinite(a.observedAt)?Math.min(a.observedAt,s.now):Number.isFinite(action.at)?Math.min(action.at,s.now):0}])).values()].slice(0,10);
   s.liveMode=true;s.basketAt=action.at??s.now;s.eligibleIds=ranked.map(a=>a.id);
   // Retain marks for held assets when rankings rotate; never orphan the ledger.
   const held=new Set(s.positions.map(p=>p.asset));
   for(const o of s.pending)if(o.side==='sell')held.add(o.asset);
   s.assets=[wallet,...ranked,...state.assets.filter(a=>a.id!==wallet.id&&!s.eligibleIds.includes(a.id)&&held.has(a.id))];
   s.pending=s.pending.filter(o=>{if(o.side!=='buy'||s.eligibleIds.includes(o.asset))return true;log(s,{...o,status:'cancelled',reason:'Pool left the observed entry basket.'});return false;});
   s.cooldowns=Object.fromEntries(Object.entries(s.cooldowns).filter(([id])=>s.eligibleIds.includes(id)||held.has(id)));
 } else if(action.type==='EXTERNAL_FILL'){
   const f=action.payload||{};const qty=Number(f.qty),price=Number(f.price),totalUsd=Number(f.totalUsd),feeUsd=Number(f.feeUsd||0);
   if(!['BUY','SELL'].includes(f.side)||typeof f.asset!=='string'||!f.asset||![qty,price,totalUsd,feeUsd].every(Number.isFinite)||qty<=0||price<=0||totalUsd<0||feeUsd<0){s.notice='External fill rejected: invalid normalized payload.';return s;}
   const positions=s.positions.map(p=>({...p,tiers:[...p.tiers]}));const idx=positions.findIndex(p=>p.asset===f.asset);
   if(f.side==='BUY'){
     s.cash-=totalUsd+feeUsd;s.fees+=feeUsd;
     if(idx===-1)positions.push({asset:f.asset,qty,cost:totalUsd,entry:price,initialQty:qty,opened:s.now,high:price,stop:price*(1-s.config.stop/100),tiers:[],source:'External'});
     else{const p=positions[idx],nextQty=p.qty+qty,nextCost=p.cost+totalUsd;positions[idx]={...p,qty:nextQty,cost:nextCost,entry:nextCost/nextQty,initialQty:nextQty};}
   }else{
     s.cash+=totalUsd-feeUsd;s.fees+=feeUsd;
     if(idx!==-1){const p=positions[idx],remaining=p.qty-qty;s.realized+=totalUsd-feeUsd-p.entry*Math.min(qty,p.qty);if(remaining<=1e-9)positions.splice(idx,1);else positions[idx]={...p,qty:remaining,cost:Math.max(0,p.cost-p.entry*qty),tiers:Number.isInteger(f.tier)?[...new Set([...p.tiers,f.tier])]:p.tiers};}
   }
   s.positions=positions;s.trades++;log(s,{orderId:f.orderId,asset:f.asset,side:f.side,status:'filled',price,qty,totalUsd,fee:feeUsd,at:s.now,source:'External',reason:'Confirmed paper fill',slippage:Number(f.priceImpactPct)||0,latency:Number(f.latency)||0});s.notice=`${f.side} ${f.asset} filled via observed execution`;
 } else if(action.type==='SETTLE'){if(s.executionMode!=='external')settle(s);}
 else if(action.type==='ORDER') enqueue(s,action.asset,action.side,'Manual',action.side==='buy'?'One-click entry':'Manual close');
 else if(action.type==='PAUSE'){s.running=false;s.notice='Auto-Simulate paused. Open positions remain in your portfolio.';}
 else if(action.type==='REJECT'){const f=action.payload||{};const fee=Number(f.feeUsd)||0;s.cash-=fee;s.fees+=fee;s.notice='Paper order rejected: '+(f.reason||'Execution unavailable');const asset=s.assets.find(a=>a.id===f.asset);log(s,{asset:f.asset,symbol:f.symbol||asset?.symbol,mint:f.mint||asset?.mint,side:f.side?.toLowerCase(),status:'rejected',reason:s.notice,fee,source:'External'});}
 else if(action.type==='START'){s.running=true;s.notice='Live Dashboard Auto-Simulate armed. Signals and entries use observed market data; execution remains paper-only.';log(s,{source:'System',reason:s.notice});}
 else if(action.type==='PANIC'||action.type==='HALT')liquidate(s,action.type==='PANIC'?'Panic close all':'Automation halted and portfolio liquidated');
 else if(action.type==='TICK'){
   // Cap elapsed simulation time: a sleeping browser must not create catch-up trades.
   const dt=clamp((s.now-state.now)/1000,.001,.5);
   for(const a of s.assets){
     // Live observations must never be overwritten by synthetic ticks.
     if(s.liveMode)continue;
     a.previousRsi=a.rsi;
     a.spike=Math.max(0,a.spike-dt);if(random(s)<.009)a.spike=2+random(s)*3;
     const vol=a.sigma*(a.spike?3:1);
     a.price=Math.max(a.start*.001,Math.min(a.start*100,a.price*Math.exp(-.5*vol*vol*dt+vol*Math.sqrt(dt)*normal(s))));
     a.volume=1+random(s)*.8+(a.spike?2+random(s)*4:0);
     const point={time:Math.floor(s.now/1000),value:a.price};
     if(a.history.at(-1)?.time===point.time)a.history[a.history.length-1]=point;else a.history.push(point);
     if(a.history.length>300)a.history.shift();Object.assign(a,indicators(a.history));
   }
   if(s.executionMode!=='external')settle(s);
   for(const p of s.positions){const a=s.assets.find(a=>a.id===p.asset);p.high=Math.max(p.high,a.price);p.stop=Math.max(p.stop,p.entry*(1-s.config.stop/100),p.high*(1-s.config.trailing/100));}
   if(s.executionMode!=='external')automate(s);
 }
 return s;
}
export function restore(raw,now=Date.now()) {
 try {
  const s=JSON.parse(raw);
   if(s.version!==1||!Number.isFinite(s.initial)||s.initial<=0||![s.cash,s.realized,s.fees,s.seed,s.sequence,s.now].every(Number.isFinite)||s.cash<0||!Array.isArray(s.positions)||s.positions.length>5||!Array.isArray(s.logs)||s.logs.length>300||!Array.isArray(s.assets)||!s.assets.length||s.assets.length>16||s.assets[0].id!=='SOL')throw Error();
  for(let i=0;i<s.assets.length;i++){const a=s.assets[i];if(typeof a.id!=='string'||!a.id||(!s.liveMode&&a.id!==ASSETS[i]?.id)||!Number.isFinite(a.price)||a.price<=0||!Array.isArray(a.history)||!a.history.length||a.history.length>300||a.history.some((p,j)=>!Number.isFinite(p.time)||!Number.isFinite(p.value)||p.value<=0||(j&&p.time<=a.history[j-1].time)))throw Error();}
  if(new Set(s.assets.map(a=>a.id)).size!==s.assets.length)throw Error();
  for(const p of s.positions)if(!s.assets.some(a=>a.id===p.asset)||![p.qty,p.initialQty,p.entry,p.cost,p.opened,p.high,p.stop].every(Number.isFinite)||p.qty<=0||p.cost<0||!Array.isArray(p.tiers))throw Error();
  if(new Set(s.positions.map(p=>p.asset)).size!==s.positions.length)throw Error();
   let clean={...s,astraGate:false,now,config:{...DEFAULT_CONFIG},assets:s.assets.map(a=>({...a})),eligibleIds:[],basketAt:0,running:false,pending:[],cooldowns:{},logs:s.logs.filter(x=>x&&typeof x.reason==='string'),lastEval:now};
   for(const [key,value] of Object.entries(s.config||{}))clean=reducer(clean,{type:'CONFIG',key,value});
   clean.notice='Session restored. Pending orders cancelled; automation is paused.';log(clean,{source:'System',reason:clean.notice});return clean;
 }catch{return initialState(now);}
}

import { calculateOptimalBuyPositionValue } from './position-sizer.js';
import React,{useEffect,useMemo,useReducer,useRef,useState} from 'react';
import {TokenClassification} from './components/TokenClassification.jsx';
import {OperationsSearch} from './components/OperationsSearch.jsx';
import {WORKSPACE_DETAILS} from './operator-search.js';
import {readJson} from './read-json.js';
import {appendTokenEvidenceHistory,initialWorkspace,isProjectionCurrent,workspaceReducer,stableTokenOrder,startOperatorConnection} from './operator-runtime.js';
import {AetherFlux} from './components/AetherFlux.jsx';
import {CapitalCommandView} from './components/CapitalCommandView.jsx';
import {IncidentCommandView} from './components/IncidentCommandView.jsx';
import {CommandCenterView} from './components/CommandCenterView.jsx';
import {VetoProofInspectorDrawer} from './components/VetoProofInspectorDrawer.jsx';
import {EconomicFlightRecorderDrawer} from './components/EconomicFlightRecorderDrawer.jsx';
import {RuntimeDivergenceInspector} from './components/RuntimeDivergenceInspector.jsx';
import {HotPathProofCapsuleMonitor} from './components/HotPathProofCapsuleMonitor.jsx';
import {AdversarialCouncilDrawer} from './components/AdversarialCouncilDrawer.jsx';
import {ConservationProofsDrawer} from './components/ConservationProofsDrawer.jsx';
import {HostedJevControl} from './components/HostedJevControl.jsx';
import {LayoutDashboard, Activity, Search, ArrowUpRight, Layers, TriangleAlert, Settings2, Info, Command, Menu, X} from 'lucide-react';
import {Status, Dialog} from './design-system/primitives.jsx';
import {WORKSPACES, MOBILE_WORKSPACES, readOperatorRoute, operatorRoute} from './operator-navigation.js';
import {formatPrice} from './design-system/format.js';
import './design-system/tokens.css';
import './operator-terminal.css';
import './command-center.css';
import './scaling-blueprint.css';

const pages=WORKSPACES;
const icons=[LayoutDashboard,Activity,Search,ArrowUpRight,Layers,TriangleAlert,Settings2,Info];
const mobilePages=MOBILE_WORKSPACES;
const number=v=>Number.isFinite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2,notation:'compact'}).format(v):'UNKNOWN';
const money=v=>Number.isFinite(v)?'$'+number(v):'UNKNOWN';
const age=v=>Number.isFinite(v)?(v/1000).toFixed(1)+'s':'UNKNOWN';
const reason=s=>s?.replaceAll('_',' ').toLowerCase()||'Evidence unavailable';

export default function OperatorTerminal(){
 const [projection,setProjection]=useState(null),[connection,setConnection]=useState('CONNECTING'),[clock,setClock]=useState(Date.now());
 const route=useRef(readOperatorRoute(window.location.hash));
 const [ui,dispatch]=useReducer(workspaceReducer,undefined,()=>({...initialWorkspace(),workspace:route.current.workspace,investigation:route.current.mint})),[filter,setFilter]=useState(route.current.filter),[query,setQuery]=useState(route.current.query),[notice,setNotice]=useState(''),[palette,setPalette]=useState(false);
 const order=useRef([]),selected=useRef(route.current.mint),scanId=useRef(0),scanController=useRef(null),origin=useRef(null),latestProjection=useRef(null),latestConnection=useRef('CONNECTING'),shell=useRef(null),root=useRef(null),returnContext=useRef(null);
 const [more,setMore]=useState(false);
 const [vetoInspectorOpen,setVetoInspectorOpen]=useState(false);
 const [flightRecorderOpen,setFlightRecorderOpen]=useState(false);
 const [divergenceOpen,setDivergenceOpen]=useState(false);
 const [capsuleOpen,setCapsuleOpen]=useState(false);
 const [councilOpen,setCouncilOpen]=useState(false);
 const [conservationOpen,setConservationOpen]=useState(false);
 const [discoveryPage,setDiscoveryPage]=useState(route.current.page);
 const heading=useRef(null),navigationFocus=useRef(false);
 function navigate(page){
   navigationFocus.current=true;
   const hash=operatorRoute({workspace:page,query,filter,page:discoveryPage,mint:ui.investigation});
   if(window.location.hash!==hash)window.history.pushState(null,'',hash);
   dispatch({type:'NAVIGATE',workspace:page});setMore(false);setNotice('');
 }
 useEffect(()=>{
   const restoreRoute=()=>{const next=readOperatorRoute(window.location.hash);setQuery(next.query);setFilter(next.filter);setDiscoveryPage(next.page);selected.current=next.mint;dispatch({type:'INVESTIGATE',mint:next.mint});navigationFocus.current=true;dispatch({type:'NAVIGATE',workspace:next.workspace});setMore(false);setPalette(false);};
   window.addEventListener('popstate',restoreRoute);window.addEventListener('hashchange',restoreRoute);
   return()=>{window.removeEventListener('popstate',restoreRoute);window.removeEventListener('hashchange',restoreRoute);};
 },[]);
 useEffect(()=>{const hash=operatorRoute({workspace:ui.workspace,query,filter,page:discoveryPage,mint:ui.investigation});if(window.location.hash!==hash)window.history.replaceState(null,'',hash);},[ui.workspace,ui.investigation,query,filter,discoveryPage]);
 useEffect(()=>{
   const measure=()=>root.current?.style.setProperty('--shell-height',shell.current?.getBoundingClientRect().height+'px');
   const observer=new ResizeObserver(measure);if(shell.current)observer.observe(shell.current);measure();return()=>observer.disconnect();
 },[]);
 useEffect(()=>{if(navigationFocus.current){heading.current?.focus();navigationFocus.current=false;}},[ui.workspace]);
 const [scanning,setScanning]=useState(false),[changes,setChanges]=useState([]),[tokenHistory,setTokenHistory]=useState(new Map());
 useEffect(()=>{
  const stop=startOperatorConnection({request:signal=>readJson('/api/operator',signal,3500),onState:state=>{latestConnection.current=state;setConnection(state);dispatch({type:state==='CONNECTED'?'CONNECTED':'REVALIDATE'});},onSnapshot:data=>{
   order.current=stableTokenOrder(order.current,data.rows||data.tokens||[]);
   const old=latestProjection.current;
   if(old){const next=[];for(const key of ['open','increase','reduce','close'])if(old.capabilities[key]?.state!==data.capabilities[key]?.state)next.push({id:`${data.authorityGeneration}-${data.projectionVersion}-${key}`,at:data.generatedAt,text:`${key.toUpperCase()} ${old.capabilities[key]?.state} → ${data.capabilities[key]?.state}`});if(old.marketData.state!==data.marketData.state)next.push({id:`${data.authorityGeneration}-${data.projectionVersion}-market`,at:data.generatedAt,text:`Market ${old.marketData.state} → ${data.marketData.state}`});if(next.length)setChanges(history=>[...next,...history].slice(0,80));}
   setTokenHistory(history=>appendTokenEvidenceHistory(history,data));
   latestProjection.current=data;setProjection(data);
  }});
  const timer=setInterval(()=>setClock(Date.now()),500);
  return()=>{stop();clearInterval(timer);scanController.current?.abort();};
 },[]);
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(v=>!v);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 // Entry automation is opt-in. A persisted setting may enable it only after
 // the current projection independently grants OPEN capability.
 const [autoTradePrime, setAutoTradePrime] = useState(() => typeof localStorage !== 'undefined' ? localStorage.getItem('sylph_auto_trade_prime') === 'true' : false);
 const autoTradeCooldowns = useRef(new Map());
 const [autoExitGuardian, setAutoExitGuardian] = useState(() => typeof localStorage !== 'undefined' ? localStorage.getItem('sylph_auto_exit_guardian') !== 'false' : true);
 const autoExitCooldowns = useRef(new Map());
 useEffect(() => {
  try { localStorage.setItem('sylph_auto_trade_prime', String(autoTradePrime)); } catch {}
  if (autoTradePrime) setNotice('🤖 Auto-Trade ARMED: Prime & high-signal pump candidates will be automatically paper-traded ($50, max 3 positions).');
  else setNotice('🤖 Auto-Trade PAUSED.');
 }, [autoTradePrime]);
 useEffect(() => {
  try { localStorage.setItem('sylph_auto_exit_guardian', String(autoExitGuardian)); } catch {}
  if (autoExitGuardian) setNotice('🛡️ Auto-Exit Guardian ARMED: Trailing Profit Lock (+8% peak trailing), Take-Profit (+15%), and Stop-Loss (-10%) active.');
 }, [autoExitGuardian]);
 const renderTime=Date.now();
 const current=isProjectionCurrent(projection,connection,renderTime);
 const tokens=projection?.rows||projection?.tokens||[];
 const byMint=useMemo(()=>new Map(tokens.map(t=>[t.mint,t])),[tokens]);
 const rows=useMemo(()=>order.current.map(m=>byMint.get(m)).filter(Boolean).filter(t=>(!query||`${t.symbol} ${t.mint}`.toLowerCase().includes(query.toLowerCase()))&&(filter==='All evidence'||filter==='Watch'&&t.tier==='DEVELOPING'||filter==='Vetoed'&&t.tier==='VETOED'||filter==='Prime'&&t.tier==='PRIME')),[byMint,query,filter]);
 const chosen=byMint.get(ui.investigation);
 const chosenHistory=tokenHistory.get(ui.investigation)||[];
 function investigate(token,event){origin.current=event?.currentTarget;if(ui.workspace!=='Token Intelligence')returnContext.current={workspace:ui.workspace,scroll:window.scrollY};selected.current=token.mint;scanId.current++;scanController.current?.abort();setScanning(false);setNotice('');dispatch({type:'INVESTIGATE',mint:token.mint});navigate('Token Intelligence');}
 function back(){const target=returnContext.current?.workspace||'Aether Flux';navigate(target);requestAnimationFrame(()=>{const candidates=[...document.querySelectorAll('[data-token="'+CSS.escape(ui.investigation||'')+'"]')];(candidates.find(el=>el.getClientRects().length)||heading.current)?.focus({preventScroll:true});window.scrollTo({top:returnContext.current?.scroll||0,behavior:'instant'});});}
 async function scan(){
  if(!chosen||scanning||!current)return;
  const mint=chosen.mint,id=++scanId.current,generation=projection.authorityGeneration,controller=new AbortController();scanController.current=controller;setScanning(true);setNotice('');
  try{const result=await readJson('/api/discovery/risk?mint='+encodeURIComponent(mint),controller.signal,20000);if(id===scanId.current&&selected.current===mint&&result.mint===mint&&generation===latestProjection.current?.authorityGeneration)setNotice('Scan received for '+(chosen.symbol||mint)+'. Waiting for the authoritative projection.');}
  catch{if(id===scanId.current&&!controller.signal.aborted)setNotice('Safety scan unavailable. Missing evidence remains unknown.');}
  finally{if(id===scanId.current)setScanning(false);}
 }
 async function closePaperPosition(position, skipConfirm = false, triggerOverride = null){
  if(!current||projection?.environment?.mode!=='SIMULATION'||projection?.capabilities?.close?.state!=='READY'){
   setNotice('Paper close is unavailable until the current authoritative projection permits it.');return;
  }
  if(!position?.mint||!position?.asset){setNotice('Paper close is unavailable: the recorded position lacks a mint or pool identity.');return;}
  const label=position.asset||position.mint;
  if(!skipConfirm && !window.confirm(`Close the simulated position for ${label}? This changes only the local paper ledger and cannot submit a live transaction.`))return;
  const latest=latestProjection.current,now=Date.now();
  if(!isProjectionCurrent(latest,latestConnection.current,now)||latest.authorityGeneration!==projection.authorityGeneration||latest.environment?.mode!=='SIMULATION'||latest.capabilities?.close?.state!=='READY'){setNotice('Paper close review expired. Inspect current evidence and review again.');return;}
  setNotice(`Submitting paper close for ${label} to the local simulator…`);
  try{
   const markPrice = position.markPriceUsd ?? position.mark ?? position.price;
   const exitTrigger = triggerOverride || (skipConfirm ? (position.protectionState === 'EMERGENCY_UNWIND' ? 'STOP_LOSS' : 'TRAILING_TARGET') : 'OPERATOR_CLOSE');
   const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),type:'CLOSE_POSITION',timestamp:Date.now(),initiator:skipConfirm ? 'auto_exit_guardian' : 'operator-terminal',payload:{mint:position.mint,poolAddress:position.asset,priceUsd:markPrice||undefined,fallbackPriceSol:markPrice?markPrice/150:undefined,exitTrigger}})});
   const body=await response.json();
   if(!response.ok||!body.ok)throw new Error(body?.error||body?.result?.error||'Paper close was rejected.');
   setNotice(skipConfirm ? `🛡️ Auto-Exit FILLED: Liquidated ${label} (${position.protectionState === 'EMERGENCY_UNWIND' ? 'Stop-Loss' : 'Take-Profit'}).` : `Paper close simulated for ${label}. No live transaction was submitted.`);
  }catch(error){setNotice(`Paper close unavailable: ${error instanceof Error?error.message:'local simulator request failed.'}`);}
 }
 async function openPaperPosition(token, usdAmount = null){
  if(!current||projection?.environment?.mode!=='SIMULATION'||projection?.capabilities?.open?.state!=='READY'){
   setNotice('Paper entry is unavailable until the current authoritative projection permits opening exposure.');return;
  }
  if(!token?.mint){setNotice('Paper entry is unavailable: token lacks a mint address.');return;}
  const sizing = calculateOptimalBuyPositionValue(token, {
    capital: projection?.capital,
    activePositionsCount: (projection?.positions || []).length,
    maxPositions: 2,
  });
  const finalAmount = (usdAmount != null && Number(usdAmount) > 0) ? Number(usdAmount) : sizing.optimalUsd;
  const poolAddress=token.pair||token.mint;
  const label=token.symbol||token.mint;
  if(!window.confirm(`Open simulated paper position of $${finalAmount.toFixed(2)} for ${label}?\n\nDynamic Sizing: ${sizing.rationale}\n\nThis changes only the local paper ledger and cannot submit a live transaction.`))return;
  setNotice(`Submitting dynamic paper buy of $${finalAmount.toFixed(2)} for ${label} to the command gateway…`);
  try{
   const priceUsd = token.price || (token.priceSol ? token.priceSol * 150 : undefined);
   const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),type:'SUBMIT_ORDER',timestamp:Date.now(),initiator:'operator-terminal',payload:{mint:token.mint,poolAddress,symbol:token.symbol,side:'BUY',usdAmount:finalAmount,priceUsd,fallbackPriceSol:token.priceSol||(priceUsd?priceUsd/150:undefined),liquidity:token.liquidity,highSignalIndex:token.highSignalIndex,tier:token.tier,pod:token.pod}})});
   const body=await response.json();
   if(!response.ok||!body.ok)throw new Error(body?.error||body?.result?.error||'Paper order was rejected.');
   setNotice(`Paper buy of $${finalAmount.toFixed(2)} executed for ${label}. Position opened in paper ledger.`);
  }catch(error){setNotice(`Paper buy failed: ${error instanceof Error?error.message:'Simulator request failed.'}`);}
 }
 async function setPaperCapital(amount, resetPositions = false) {
  const usd = Number(amount);
  if (!Number.isFinite(usd) || usd < 0) return;
  setNotice(`Updating paper capital to $${usd.toFixed(2)}${resetPositions ? ' and resetting positions' : ''}…`);
  try {
   const response = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     commandId: crypto.randomUUID(),
     type: 'SET_PAPER_CAPITAL',
     timestamp: Date.now(),
     initiator: 'operator-terminal',
     payload: { capitalUsd: usd, resetPositions }
    })
   });
   const body = await response.json();
   if (!response.ok || !body.ok) throw new Error(body?.error || body?.result?.error || 'Failed to update capital');
   setNotice(`Paper capital set to $${usd.toFixed(2)}${resetPositions ? ' · paper positions cleared' : ''}.`);
  } catch (e) {
   setNotice(`Failed to set capital: ${e.message}`);
  }
 }
 useEffect(() => {
  if (!autoTradePrime || !current || projection?.environment?.mode !== 'SIMULATION' || projection?.capabilities?.open?.state !== 'READY') return;
  const positions = projection?.positions || [];
  if (positions.length >= 3) return;
  if (projection?.feedStale) return;

  // 1. Gather all unowned, unvetoed pump breakout candidates (excluding base SOL & stablecoins)
  const unowned = tokens.filter(t => {
    if (!t?.mint) return false;
    const sym = (t.symbol || '').toUpperCase().trim();
    const pNum = Number(t.price || t.priceUsd || 0);
    if (pNum > 1.0 || t.mint.startsWith('So111111') || sym === 'SOL' || sym === 'WSOL' || sym === 'USDC' || sym === 'USDT' || sym === 'USDH' || t.mint.startsWith('EPjFW') || t.mint.startsWith('Es9v')) return false;
    if (positions.some(p => p.mint === t.mint || p.asset === t.mint || p.asset === t.pair)) return false;
    if (t.vetoes && t.vetoes.length > 0) return false;
    return true;
  });

  // 2. Score and rank candidates: PRIME tier (+60), HSI (0-100), UP momentum (+20), liquidity
  const scored = unowned
    .map(t => ({
      token: t,
      score: (t.tier === 'PRIME' ? 60 : 0) + (t.highSignalIndex ?? 0) + (t.pod === 'UP' ? 20 : 0) + (Number(t.liquidity) >= 20000 ? 10 : 0)
    }))
    .filter(item => item.token.tier === 'PRIME' || ((item.token.highSignalIndex ?? 0) >= 70 && item.token.pod === 'UP') || Number(item.token.liquidity) >= 25000)
    .sort((a, b) => b.score - a.score);

  const availableCash = projection?.capital?.available ?? 0;
  const reservedCash = projection?.capital?.reserved ?? 0;
  const emergencyReserve = projection?.capital?.emergencyReserve ?? (availableCash * 0.20);
  const freeCash = Math.max(0, availableCash - reservedCash - emergencyReserve);
  if (positions.length >= 2 || freeCash < 5.0) return;

  for (const { token: cand } of scored) {
   const lastAttempt = autoTradeCooldowns.current.get(cand.mint) || 0;
   if (Date.now() - lastAttempt < 30_000) continue;

   autoTradeCooldowns.current.set(cand.mint, Date.now());
   const poolAddress = cand.pair || cand.mint;
   const label = cand.symbol || cand.mint;
   const sizing = calculateOptimalBuyPositionValue(cand, {
     capital: projection?.capital,
     activePositionsCount: positions.length,
     maxPositions: 2,
   });
   const rawTarget = sizing.optimalUsd > 0 ? sizing.optimalUsd : 15.0;
   const tradeUsd = Math.round(Math.min(freeCash, Math.max(5.0, rawTarget)) * 100) / 100;
   if (tradeUsd < 5.0) continue;
   setNotice(`⚡ Auto-trading breakout candidate ${label} ($${tradeUsd.toFixed(2)} dynamic Kelly size: ${sizing.rationale})…`);

   fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     commandId: crypto.randomUUID(),
     type: 'SUBMIT_ORDER',
     timestamp: Date.now(),
     initiator: 'auto_prime_engine',
     payload: {
      mint: cand.mint,
      poolAddress,
      symbol: cand.symbol || cand.mint.slice(0, 8),
      side: 'BUY',
      usdAmount: tradeUsd,
      priceUsd: cand.price || undefined,
      fallbackPriceSol: cand.priceSol || (cand.price ? cand.price / 150 : undefined),
      liquidity: cand.liquidity,
      highSignalIndex: cand.highSignalIndex,
      tier: cand.tier,
      pod: cand.pod,
     }
    })
   })
   .then(r => r.json())
   .then(body => {
    if (body.ok) {
     setNotice(`⚡ Auto-trade FILLED: Opened $${tradeUsd.toFixed(2)} paper position for ${label}.`);
    } else {
     setNotice(`Auto-trade rejected for ${label}: ${body.error || body?.result?.error || 'Command gateway refused'}`);
    }
   })
   .catch(err => {
    setNotice(`Auto-trade failed for ${label}: ${err.message}`);
   });
   break;
  }
 }, [autoTradePrime, current, projection, tokens]);
 useEffect(() => {
  if (!autoExitGuardian || !current || projection?.environment?.mode !== 'SIMULATION') return;
  if (projection?.capabilities?.close?.state !== 'READY') return;
  const positions = projection?.positions || [];
  const now = Date.now();
  for (const pos of positions) {
   if (!pos.mint || !pos.asset) continue;
   const pnlPct = pos.unrealizedPnlPct;
   const peakPnl = pos.peakPnlPct ?? pnlPct;
   const ageMs = now - (pos.openedAt || now);
   const ageSec = ageMs / 1000;

   // 1. False-Breakout Fast Cut (Control 44):
   // Cut immediately at -3.0% within 15s-45s if peak never exceeded +1.2% (avoids deep -12% to -30% drags)
   const isFalseBreakout = ageSec >= 15 && ageSec <= 45 && (peakPnl == null || peakPnl <= 1.2) && pnlPct != null && pnlPct <= -3.0;

   // 2. Breakeven Lock (+1.0% floor once peak >= +8.0%):
   // Protect accumulated gains from round-tripping to negative
   const isBreakevenStop = peakPnl != null && peakPnl >= 8.0 && pnlPct != null && pnlPct <= 1.0;

   // 3. Dynamic Staged Trailing Stops (AGENTS.md Moonshot Standard):
   // Tier 1 (+15% to +35% peak): Trail by 5.0% from peak
   // Tier 2 (+35% to +100% peak): Trail by 10.0% from peak (letting winners surge)
   // Tier 3 (> +100% peak): Trail by 20.0% structural cushion (ride 1500% runners)
   let isTrailingStop = false;
   if (peakPnl != null && pnlPct != null) {
     if (peakPnl >= 100.0) {
       isTrailingStop = (peakPnl - pnlPct) >= 20.0;
     } else if (peakPnl >= 35.0) {
       isTrailingStop = (peakPnl - pnlPct) >= 10.0;
     } else if (peakPnl >= 15.0) {
       isTrailingStop = (peakPnl - pnlPct) >= 5.0;
     }
   }

   // 4. Parabolic Climax Take-Profit: Lock profits at +150% or higher
   const isParabolicTarget = pnlPct != null && pnlPct >= 150.0;

   // 5. Hard Stop-Loss (-8.0% or protectionState EMERGENCY_UNWIND):
   const isHardStop = pos.protectionState === 'EMERGENCY_UNWIND' || (pnlPct != null && pnlPct <= -8.0);

   // 6. Stagnation Decay (rotate dead capital after 3m if flat):
   const isStagnant = ageMs > 3 * 60 * 1000 && pnlPct != null && Math.abs(pnlPct) < 2.0;

   if (isFalseBreakout || isBreakevenStop || isTrailingStop || isParabolicTarget || isHardStop || isStagnant) {
    const lastExit = autoExitCooldowns.current.get(pos.mint) || 0;
    if (Date.now() - lastExit < 15_000) continue;
    autoExitCooldowns.current.set(pos.mint, Date.now());
    const triggerLabel = isParabolicTarget ? `Parabolic Climax (+${pnlPct?.toFixed(1)}%)`
      : isTrailingStop ? `Trailing profit secured (+${pnlPct?.toFixed(1)}% / Peak +${peakPnl?.toFixed(1)}%)`
      : isBreakevenStop ? `Breakeven profit lock (+${pnlPct?.toFixed(1)}%)`
      : isFalseBreakout ? `False-breakout quick cut (${pnlPct?.toFixed(1)}%)`
      : isStagnant ? 'Stagnant rotation (free capacity)'
      : `Stop-loss (${pnlPct?.toFixed(1)}%)`;
    setNotice(`🛡️ Auto-Exit: Liquidating ${pos.symbol || pos.mint.slice(0, 6)} (${triggerLabel}).`);
    const triggerType = isParabolicTarget ? 'PARABOLIC_CLIMAX'
      : isTrailingStop ? 'TRAILING_PROFIT_STAGED'
      : isBreakevenStop ? 'BREAKEVEN_LOCK'
      : isFalseBreakout ? 'FALSE_BREAKOUT_FAST_CUT'
      : isStagnant ? 'STAGNANT_ROTATION'
      : 'STOP_LOSS';
    closePaperPosition(pos, true, triggerType);
    break;
   }
  }
 }, [autoExitGuardian, current, projection]);
 const paperReady=current&&projection?.environment?.mode==='SIMULATION'&&projection?.capabilities?.open?.state==='READY';
 const showEnvelope=action=><section className="op-section"><h2>{action.toUpperCase()} operating envelope</h2><Status value={current?projection?.envelopes[action]?.state:'UNKNOWN'}/><p>{projection?.envelopes[action]?.dominantConstraint||'Waiting for authoritative constraints.'}</p><div className="op-table-scroll" role="region" aria-label={`${action} operating constraints`} tabIndex={0}><table><thead><tr>{['Constraint','Current','Boundary','Margin','State'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{(Array.isArray(projection?.envelopes?.[action]?.constraints)?projection.envelopes[action].constraints:[]).filter(Boolean).map(c=><tr key={c.id}><td>{c.label}<small>{c.source}</small></td><td>{number(c.current)} {c.unit}</td><td>{number(c.boundary)} {c.unit}</td><td>{number(c.margin)} {c.unit}</td><td><Status value={current?c.state:'UNKNOWN'}/></td></tr>)}</tbody></table></div><p className="op-muted">{current && projection?.envelopes?.[action]?.state === 'SAFE' ? 'All paper operating constraints satisfied for simulation.' : 'Unknown review, risk or reserve evidence prevents a complete operating envelope.'}</p></section>;
 return <div ref={root} className="op-terminal sylph">
   <a className="op-skip" href="#op-workspace" onClick={event=>{event.preventDefault();document.getElementById('op-workspace')?.focus();}}>Skip to workspace</a>
   <header ref={shell} className="op-shell" aria-label="Permanent safety and truth shell">
    <div className="op-shell-top"><a className="op-brand" href="/"><span className="op-brand-mark" aria-hidden="true">S</span>SYLPH<span className="op-brand-subtitle">FUSION / OPERATIONS</span></a><b className="op-mode">{projection?.environment.mode||'UNKNOWN'}</b><button type="button" className={`op-button ${autoTradePrime ? 'op-primary' : ''}`} style={autoTradePrime ? {background:'rgba(20,241,149,0.15)',borderColor:'#14F195',color:'#14F195',fontWeight:700,fontSize:'12px',padding:'2px 8px'} : {fontSize:'12px',padding:'2px 8px'}} onClick={()=>setAutoTradePrime(prev => !prev)} title="Toggle automatic paper trading for qualified Prime candidates">🤖 Auto-Trade Prime: {autoTradePrime ? 'ON' : 'OFF'}</button><button type="button" className="op-button" style={{color:'#14F195',borderColor:'rgba(20,241,149,0.3)',background:'rgba(20,241,149,0.08)',fontSize:'12px',padding:'2px 8px'}} onClick={()=>setFlightRecorderOpen(true)} title="Inspect 15-stage execution flight records">🔬 Flight Recorder</button><button type="button" className="op-button" style={{color:'#9bcbff',borderColor:'rgba(155,203,255,0.3)',background:'rgba(155,203,255,0.08)',fontSize:'12px',padding:'2px 8px'}} onClick={()=>setDivergenceOpen(true)} title="Inspect legacy vs unified runtime parity">⚖️ Parity</button><button type="button" className="op-button" style={{color:'#F59E0B',borderColor:'rgba(245,158,11,0.3)',background:'rgba(245,158,11,0.08)',fontSize:'12px',padding:'2px 8px'}} onClick={()=>setCapsuleOpen(true)} title="Inspect hot-path evidence leases & TTLs">⚡ Leases</button><button type="button" className="op-button" style={{color:'#9bcbff',borderColor:'rgba(155,203,255,0.3)',background:'rgba(155,203,255,0.08)',fontSize:'12px',padding:'2px 8px'}} onClick={()=>setCouncilOpen(true)} title="Inspect Prover vs Skeptic dialectic council & resource admission">⚖️ Council</button><button type="button" className="op-button" style={{color:'#14F195',borderColor:'rgba(20,241,149,0.3)',background:'rgba(20,241,149,0.08)',fontSize:'12px',padding:'2px 8px'}} onClick={()=>setConservationOpen(true)} title="Inspect exact lot-basis conservation & outcome maturity">🔒 Conservation</button><div className="op-system-health"><span>System <Status value={current?projection.system.state:connection==='CONNECTING'?'CONNECTING':'REVALIDATING'}/></span><span>Data <Status value={current?projection.marketData.state:'UNKNOWN'}/></span></div><button className="op-incident-link" aria-label={`${projection?.incidents.length??'Unknown number of'} capability blockers`} onClick={()=>navigate('Incidents')}><TriangleAlert size={16} aria-hidden="true"/>{projection?.incidents.length??'?'}<span> blockers</span></button></div>
   <div className="op-capability-strip" aria-label="Action capabilities">{['open','increase','reduce','close'].map(name=><details key={name} className="op-capability"><summary><span>{name}</span><Status value={capability(name)}/></summary><div className="op-capability-reason">{current?projection?.capabilities[name]?.reasonCodes.map(reason).join(' · '):'Current capability is unknown while backend evidence is revalidated.'}</div></details>)}<span className="op-scope-note">{projection?.environment?.mode==='SIMULATION'?'Paper ledger · Live capital unverified':'Ledger scope unverified'}</span></div>
  </header>
  {!current&&<div className="op-connection" role="status">{projection?'Connection or projection validity interrupted. Displayed observations are historical; current capability is unknown.':'Connecting to backend evidence. Operational capability is unknown.'}</div>}
  <div className="op-layout">
   <nav className="op-nav" aria-label="Primary operations"><span className="op-nav-label">Workspace</span>{pages.map((page,index)=>{const Icon=icons[index];return <button key={page} aria-current={ui.workspace===page?'page':undefined} onClick={()=>navigate(page)}><Icon size={20} strokeWidth={1.75} aria-hidden="true"/><span>{page}</span></button>;})}<button className="op-command-trigger" onClick={()=>setPalette(true)}><Command size={20} aria-hidden="true"/><span>Commands</span><kbd>Ctrl K</kbd></button><div className="op-nav-note"><span className="op-nav-note-label">WORKSPACE PRINCIPLE</span>Evidence before<br/>economic action.<a href="/simulator">Strategy simulator ↗</a></div></nav>
   <nav className="op-mobile-nav" aria-label="Mobile operations">{mobilePages.map(page=>{const Icon=icons[pages.indexOf(page)];return <button key={page} aria-current={ui.workspace===page?'page':undefined} onClick={()=>navigate(page)}><Icon size={20} aria-hidden="true"/><span>{page==='Aether Flux'?'Discover':page}</span></button>;})}<button aria-expanded={more} aria-haspopup="dialog" aria-controls="op-more-menu" aria-current={!mobilePages.includes(ui.workspace)?'page':undefined} onClick={()=>setMore(!more)}><Menu size={20} aria-hidden="true"/><span>More</span></button></nav>
   <Dialog open={more} onDismiss={()=>setMore(false)} id="op-more-menu" className="op-more-menu" labelledBy="op-more-title"><div className="op-section-heading"><h2 id="op-more-title">More workspaces</h2><button aria-label="Close more workspaces" onClick={()=>setMore(false)}><X size={20}/></button></div>{['Execution','Token Intelligence','System','Info'].map(page=><button key={page} onClick={()=>navigate(page)}>{page}</button>)}<button onClick={()=>{setMore(false);setPalette(true);}}>Commands</button></Dialog>
   <main className="op-workspace" id="op-workspace" tabIndex={-1}>
    <div className="op-workspace-heading"><div><div className="op-eyebrow"><span className="op-section-index">{String(pages.indexOf(ui.workspace)+1).padStart(2,'0')}</span> OPERATIONS / {ui.mode.replaceAll('_',' ')}</div><h1 ref={heading} tabIndex={-1}>{ui.workspace}</h1><p className="op-page-description">{WORKSPACE_DETAILS[ui.workspace]}</p></div><span className="op-update-stamp">{projection?'Updated '+new Date(projection.generatedAt).toLocaleTimeString():'Waiting for evidence'}</span></div>
    {ui.workspace==='Aether Flux'&&<AetherFlux
      page={discoveryPage} onPageChange={setDiscoveryPage}
      loading={!projection&&connection==='CONNECTING'}
      onViewSystem={()=>navigate('System')}
      tokens={tokens}
      stableOrder={order.current}
      filter={filter}
      query={query}
      current={current}
      marketState={projection?.marketData?.state}
      generatedAt={projection?.generatedAt}
      lastRefreshedAt={projection?.generatedAt}
      comparison={ui.comparison}
      onFilterChange={setFilter}
      onQueryChange={setQuery}
      onInvestigate={investigate}
      onCompare={mint=>dispatch({type:'COMPARE',mint})}
      onRefreshRanking={()=>{order.current=stableTokenOrder([],tokens);setNotice('Ranking refreshed. Subsequent numerical updates preserve row order.');}}
    />}
    {ui.workspace==='Command'&&<CommandCenterView
      projection={projection}
      current={current}
      loading={!projection&&connection==='CONNECTING'}
      onNavigate={navigate}
      onInvestigate={investigate}
      onPaperBuy={openPaperPosition}
      autoTradePrime={autoTradePrime}
      onToggleAutoTradePrime={()=>setAutoTradePrime(prev => !prev)}
      onOpenFlightRecorder={()=>setFlightRecorderOpen(true)}
      onOpenDivergence={()=>setDivergenceOpen(true)}
      onOpenCapsule={()=>setCapsuleOpen(true)}
      onOpenCouncil={()=>setCouncilOpen(true)}
      onOpenConservation={()=>setConservationOpen(true)}
    />}
    {ui.workspace==='Token Intelligence'&&(chosen?<><button className="op-back" onClick={back}>← Return to {returnContext.current?.workspace||'Aether Flux'}</button><section className="op-section"><div className="op-eyebrow">INVESTIGATION CONTEXT · {chosen.venueState?.replaceAll('_',' ')||'VENUE UNKNOWN'}</div><h2>{chosen.symbol||'Token'} <Status value={current?chosen.tier:'UNKNOWN'} label={current?undefined:`Historical tier · ${(chosen.tier||'unknown').toLowerCase()}`}/></h2><p className="op-mint">{chosen.mint}</p><div className="op-evidence-columns"><section><h3>Why this token?</h3><dl className="op-evidence-facts"><dt>Observed price</dt><dd>{formatPrice(chosen.price)}</dd><dt>Liquidity</dt><dd>{money(chosen.liquidity)}</dd><dt>High signal index</dt><dd>{chosen.highSignalIndex??'Unknown'}</dd></dl></section><section><h3>What argues against it?</h3>{chosen.qualityVetoes?.length?chosen.qualityVetoes.map(x=><p key={x} className="danger">{reason(x)}</p>):chosen.vetoes?.length?chosen.vetoes.map(x=><p key={x} className="danger">{reason(x)}</p>):<p>No veto is reported. This is not proof of safety.</p>}</section><section><h3>What is unknown?</h3>{chosen.pending?.map(x=><p key={x}>{reason(x)}</p>)}<p>Executable quote, portfolio impact and execution permit</p></section></div></section><TokenClassification token={chosen} current={current}/>{(chosen.decisionTrace||chosen.decision?.trace)&&<section className="op-section"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}><h2>Deterministic Decision &amp; Veto Trace (13 Stages)</h2><button type="button" className="op-button" style={{color:'#14F195',borderColor:'rgba(20,241,149,0.3)',background:'rgba(20,241,149,0.08)'}} onClick={()=>setVetoInspectorOpen(true)}>🔬 Inspect Cryptographic Proof</button></div><div className="op-table-scroll" role="region" aria-label="Selected token decision trace" tabIndex={0}><table><thead><tr><th scope="col">Stage</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Requirement</th><th scope="col">Meaning</th></tr></thead><tbody>{(chosen.decisionTrace||chosen.decision?.trace||[]).map((step,idx)=>{const isPass=step.status==='PASS',isFail=step.status==='FAIL',isBlock=step.status==='BLOCKED',color=isPass?'#14F195':isFail?'#FF3B69':isBlock?'#FF7595':'#F59E0B';return <tr key={idx}><td><b>{step.label||step.stage}</b></td><td><span className="font-mono text-xs" style={{color,fontWeight:700,padding:'2px 6px',background:isPass?'rgba(20,241,149,0.1)':isFail?'rgba(255,59,105,0.1)':'rgba(245,158,11,0.1)',borderRadius:'3px'}}>{step.status}</span></td><td className="font-mono">{step.observed??'—'}</td><td className="op-muted">{step.requirement??'—'}</td><td>{step.meaning}</td></tr>;})}</tbody></table></div></section>}<section className="op-section"><h2>Now · changed · next</h2><p>NOW · {current?'Backend observation':'Historical observation'} · {age(projection.generatedAt-chosen.at)} at projection</p><p>CHANGED · {chosenHistory.length>1?`${chosenHistory.length-1} decision/evidence change${chosenHistory.length===2?'':'s'} recorded in this tab.`:'No decision or evidence transition has been observed in this tab yet.'}</p>{chosenHistory.length>1&&<ol className="op-transition-list" aria-label="Session-local token evidence history">{chosenHistory.slice(1,6).map(entry=><li key={entry.id} className="op-transition-row"><span className="op-mono op-muted">{new Date(entry.at).toLocaleTimeString()}</span><span>{entry.tier} · safety {entry.safety} · {entry.pending.length} pending · {entry.vetoes.length} findings</span></li>)}</ol>}<p>NEXT · Complete missing evidence; execution remains blocked.</p><p className="op-muted">History is session-local, read-only, and records accepted backend projection changes. Model output is advisory; calibration, model version and out-of-distribution evidence are unavailable.</p><button className="op-primary" aria-busy={scanning} disabled={!current||scanning} onClick={scan}>{scanning?'Scanning evidence…':'Refresh safety evidence'}</button><button type="button" className="op-button" style={{marginLeft:'8px'}} onClick={()=>setVetoInspectorOpen(true)}>🔬 Inspect Cryptographic Proof</button>{(()=>{
  const chosenSizing = chosen ? calculateOptimalBuyPositionValue(chosen, { capital: projection?.capital, activePositionsCount: (projection?.positions || []).length }) : null;
  const bestUsd = chosenSizing ? chosenSizing.optimalUsd : 50;
  return (<>
    <button type="button" className="op-primary" disabled={!paperReady} style={{marginLeft:'8px',background:'linear-gradient(135deg, #10B981, #059669)',borderColor:'#059669',color:'#FFFFFF',fontWeight:700}} onClick={()=>openPaperPosition(chosen, bestUsd)} title={paperReady?chosenSizing?.rationale:'Opening exposure is blocked by the current projection.'}>⚡ Buy Best Size (${bestUsd.toFixed(2)})</button>
    <button type="button" className="op-button" disabled={!paperReady} style={{marginLeft:'8px',color:'#10B981',borderColor:'rgba(16,185,129,0.3)',background:'rgba(16,185,129,0.08)'}} onClick={()=>{const def = bestUsd.toFixed(2); const c=window.prompt(`Enter paper USD amount to buy ${chosen.symbol||chosen.mint} (Optimal: $${def}):`, def);if(c&&Number(c)>0)openPaperPosition(chosen,Number(c));}}>⚡ Custom Buy</button>
    {chosenSizing && (
      <div style={{marginTop:'8px',padding:'6px 10px',background:'rgba(20,241,149,0.08)',border:'1px solid rgba(20,241,149,0.25)',borderRadius:'4px',display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',fontSize:'12px'}}>
        <span style={{color:'#14F195',fontWeight:700}}>🎯 Best Position Value: ${chosenSizing.optimalUsd.toFixed(2)}</span>
        <span className="op-muted">·</span>
        <span className="op-mono op-muted">Kelly: {chosenSizing.convictionMultiplier}x</span>
        <span className="op-muted">·</span>
        <span className="op-mono op-muted">Est Impact: {chosenSizing.estimatedPriceImpactPct}%</span>
        <span className="op-muted">·</span>
        <span className="op-muted">{chosenSizing.rationale}</span>
      </div>
    )}
  </>);
})()}<button type="button" className={`op-button ${autoTradePrime ? 'op-primary' : ''}`} style={autoTradePrime ? {marginLeft:'8px',background:'rgba(20,241,149,0.15)',borderColor:'#14F195',color:'#14F195',fontWeight:700} : {marginLeft:'8px'}} onClick={()=>setAutoTradePrime(prev => !prev)} title="Toggle automated paper trading for Prime candidates">🤖 Auto-Trade Prime: {autoTradePrime ? 'ON' : 'OFF'}</button></section>{showEnvelope('open')}</>:<div className="op-empty"><h2>{ui.investigation?'Token observation unavailable':'Select a token in Aether Flux'}</h2><p>{ui.investigation?'This token is absent from the current projection. Its former classification cannot establish current evidence.':'Investigation context stays separate from execution context.'}</p><button className="op-primary" onClick={back}>Return to {returnContext.current?.workspace||'Aether Flux'}</button></div>)}
    {ui.workspace==='Token Intelligence'&&chosen&&<section className="op-section"><h2>Evidence · {chosen.evidenceCoverage?.current??'?'} / {chosen.evidenceCoverage?.total??'?'} {current?'current':'at historical projection'}</h2><div className="op-table-scroll" role="region" aria-label="Selected token evidence" tabIndex={0}><table><thead><tr>{['Evidence','State','Source','Age at projection','Meaning'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{chosen.evidence?.map(e=><tr key={e.evidenceId}><td>{e.type}</td><td><Status value={current?e.state:'UNKNOWN'}/></td><td>{e.source}<small>{e.provenance}</small></td><td>{age(e.ageMs ?? (e.observedAt ? Math.max(0, (projection?.generatedAt || Date.now()) - e.observedAt) : null))}</td><td>{e.authority}</td></tr>)}</tbody></table></div><p className="op-muted">Coverage measures observation families. A current scan can still report missing or adverse evidence.</p></section>}
    {ui.workspace==='Execution'&&<><section className="op-section"><div className="op-eyebrow">{paperReady?'PAPER SIMULATION ONLY':'DELIBERATE AUTHORIZATION'}</div><h2>{paperReady?'Paper execution controls':'Execution preparation unavailable'}</h2><p>{paperReady?'Ready actions run only against the local simulator and paper ledger. They do not create a signing permit, transaction, or live position.':'A verified quote, risk decision, capital reservation, simulation and immutable review contract are required before authorization.'}</p><dl>{['open','increase','reduce','close'].map(action=><React.Fragment key={action}><dt>{action.toUpperCase()}</dt><dd><Status value={capability(action)}/> · {projection?.capabilities[action]?.reasonCodes.map(reason).join(' · ')}</dd></React.Fragment>)}</dl><p className="op-muted">Live signing, live reconciliation and production execution remain unavailable. Submitted, confirmed, settled and reconciled are distinct states.</p></section>{showEnvelope('open')}{showEnvelope('close')}</>}
    {ui.workspace==='Positions'&&<CapitalCommandView current={current} loading={!projection} mode={projection?.environment?.mode} capital={projection?.capital} positions={projection?.positions||[]} envelopes={projection?.envelopes} capabilities={projection?.capabilities} onClosePosition={closePaperPosition} onSetCapital={setPaperCapital} tokens={tokens} autoExitGuardian={autoExitGuardian} onToggleAutoExitGuardian={()=>setAutoExitGuardian(prev => !prev)} />}
    {ui.workspace==='Incidents'&&<IncidentCommandView mode={projection?.environment?.mode} current={current} loading={!projection} incidents={projection?.incidents||[]} changes={changes} onAcknowledge={inc=>setNotice(`Incident ${inc.incidentId || inc.reasonCode} marked seen locally for this session.`)} />}
    {ui.workspace==='System'&&<><HostedJevControl/><section className="op-section"><h2>Providers and authority</h2><div className="op-table-scroll" role="region" aria-label="Provider health and authority" tabIndex={0}><table><thead><tr>{['Provider','State','Evidence age','Latency','Circuit','Authority'].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{projection?.providers.map(p=><tr key={p.id}><td>{p.id}<small>{reason(p.role)}</small></td><td><Status value={current?p.state:'UNKNOWN'}/></td><td>{age(p.ageMs)}</td><td>{p.latencyMs==null?'UNKNOWN':number(p.latencyMs)+'ms'}</td><td>{p.circuit}</td><td>{p.authority?'Authoritative':'Supplemental'}</td></tr>)}</tbody></table></div></section><section className="op-section"><h2>Automation responsibility</h2><dl>{Object.entries(projection?.automation||{}).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl></section></>}
    {ui.workspace==='Info'&&<section className="op-section"><h2>Evidence before economic action.</h2><p>SYLPH separates observed market data, derived signals, projected outcomes and unknown evidence. Missing inputs never confer safety.</p><p>This terminal is under verification. Live execution, durable position reconciliation and production certification are unavailable. The legacy strategy simulator remains an isolated experiment.</p><a href="/simulator">Open strategy simulator ↗</a><p>Keyboard: Tab through controls, Enter to activate, Ctrl/Cmd + K for navigation, Escape to close commands.</p><p>OBSERVED ≠ SAFE · ACTIONABLE ≠ EXECUTABLE · SUBMITTED ≠ SETTLED · UNKNOWN ≠ HEALTHY</p></section>}
    <div role="status" className="op-notice">{notice}</div>
   </main>
  </div>
  <footer className="op-tray"><span>Observed ≠ safe</span><span>Backend projection {projection?.projectionVersion??'unknown'}</span><span>Verification · Unverified</span></footer>
  <OperationsSearch open={palette} onDismiss={()=>setPalette(false)} tokens={tokens} current={current} onNavigate={navigate} onInvestigate={investigate}/>
  <VetoProofInspectorDrawer isOpen={vetoInspectorOpen} onClose={()=>setVetoInspectorOpen(false)} token={chosen} />
  <EconomicFlightRecorderDrawer isOpen={flightRecorderOpen} onClose={()=>setFlightRecorderOpen(false)} selectedAttemptId={ui.investigation} />
  <RuntimeDivergenceInspector isOpen={divergenceOpen} onClose={()=>setDivergenceOpen(false)} />
  <HotPathProofCapsuleMonitor isOpen={capsuleOpen} onClose={()=>setCapsuleOpen(false)} selectedMint={ui.investigation} />
  <AdversarialCouncilDrawer isOpen={councilOpen} onClose={()=>setCouncilOpen(false)} selectedFactId={ui.investigation} />
  <ConservationProofsDrawer isOpen={conservationOpen} onClose={()=>setConservationOpen(false)} selectedLotId={ui.investigation} />
 </div>;
}

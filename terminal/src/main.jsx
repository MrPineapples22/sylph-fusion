import Spotlight from './Spotlight.jsx';
import OperatorTerminal from './OperatorTerminal.jsx';
import {useLiveBasket} from './useLiveBasket.js';
import Astra from './Astra.jsx';
import LiveDashboard from './LiveDashboard.jsx';
import {SoakTelemetry} from './components/SoakTelemetry.jsx';
import {OperatorStatusStrip} from './components/OperatorStatusStrip.jsx';
import {RiskBanners} from './components/RiskBanners.jsx';
import {TokenDecisionCard} from './components/TokenDecisionCard.jsx';
import {PositionRiskPanel} from './components/PositionRiskPanel.jsx';
import {AlertCenter} from './components/AlertCenter.jsx';
import {CommandPalette} from './components/CommandPalette.jsx';
import {DecisionProvenanceDrawer} from './components/DecisionProvenanceDrawer.jsx';
import {RiskBudgetWaterfall} from './components/RiskBudgetWaterfall.jsx';
import {PaperVsBaselineComparison} from './components/PaperVsBaselineComparison.jsx';
import {CounterfactualMethodologyDrawer} from './components/CounterfactualMethodologyDrawer.jsx';
import {OperatorEmergencyView} from './components/OperatorEmergencyView.jsx';
import {formatTime, getFreshnessBadge} from './time-format.js';
import {loadSavedLayout, saveLayout, LAYOUT_MODES} from './operator-layout.js';
import {generateIncidentReport} from './incident-report.js';
import {extractSystemAlerts, readSoakGateEvidence, groupAlerts, acknowledgeAlert, acknowledgeAllAlerts, getUnacknowledgedCount} from './alert-manager.js';
import React, { useState, useReducer, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowUpRight, ArrowDownRight, AudioLines, Bell, ChartNoAxesCombined, ChevronRight, CircleHelp, CircleStop, Command, Download, FlaskConical, Gauge, Layers, PanelLeftClose, Play, Radar, RotateCcw, Scale, Settings2, ShieldCheck, Sparkles, Wallet, X, Zap } from 'lucide-react';
import { createChart, AreaSeries, createSeriesMarkers, ColorType } from 'lightweight-charts';
import { reducer, initialState, restore, metrics, executionQuote, networkFee, START_USD } from './engine.js';
import { SimulatedEngine } from '../../src/execution-engine.ts';
import { syncAssetsToEngine, evaluateDualSnapshotDrift } from './pool-sync.js';
import { SessionRecorder } from './session-recorder.js';
import { ProfilerBurstHarness } from './components/ProfilerBurstHarness.jsx';
import { OverlayDepthGauge } from './OverlayDepthGauge.jsx';
import { useExecution } from './useExecution.js';
import { useAutoSimulateExternal } from './useAutoSimulateExternal.js';
import './style.css';
import './cockpit.css';

// Reuse expensive ICU formatters across high-frequency renders.
const moneyFormats=new Map();
const usd=(n,d=2)=>{if(n==null||!Number.isFinite(n))return '—';if(!moneyFormats.has(d))moneyFormats.set(d,new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d}));return moneyFormats.get(d).format(n);};
const price=n=>{if(n==null||!Number.isFinite(n)||n<=0)return '—';return n>=10?usd(n):'$'+n.toFixed(n<.01?8:4);};
const signed=(n,d=2)=>{if(n==null||!Number.isFinite(n))return '—';return (n>=0?'+':'−')+Math.abs(n).toFixed(d);};
const pct=n=>{if(n==null||!Number.isFinite(n))return '—';return signed(n)+'%';};
const cn=n=>Number.isFinite(n)?(n>=0?'positive':'negative'):'muted';
const duration=(now,at)=>{const seconds=Math.max(0,Math.floor((now-at)/1000));return `${Math.floor(seconds/60)}m ${seconds%60}s`;};
const STORAGE='sylph-paper-terminal-v1';
function init(){
  try{
    const raw=sessionStorage.getItem(STORAGE);
    const parsed=raw?JSON.parse(raw):null;
    if(parsed&&(parsed.initial>140||parsed.cash>140||Math.abs(parsed.initial-START_USD)>25)){
      sessionStorage.removeItem(STORAGE);
      sessionStorage.removeItem('sylph-paper-engine-v1');
      return initialState();
    }
    return restore(raw);
  }catch{
    try{sessionStorage.removeItem('sylph-paper-engine-v1');}catch{}
    return initialState();
  }
}

function Chart({asset,position,config,logs}){
 const container=useRef(null),api=useRef(null),series=useRef(null),markers=useRef(null),lines=useRef([]),lastAsset=useRef(null),lastReset=useRef(0),precisionRef=useRef(null);
 useEffect(()=>{
  const chart=createChart(container.current,{autoSize:true,height:345,layout:{background:{type:ColorType.Solid,color:'#1c2026'},textColor:'#8E95A5',fontFamily:'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',fontSize:11,attributionLogo:true},grid:{vertLines:{color:'#ffffff04'},horzLines:{color:'#232733'}},rightPriceScale:{borderColor:'#232733'},timeScale:{borderColor:'#232733',timeVisible:true,secondsVisible:true,rightOffset:8},crosshair:{vertLine:{color:'#83c5e6'},horzLine:{color:'#83c5e6'}}});
  api.current=chart;series.current=chart.addSeries(AreaSeries,{lineColor:'#83c5e6',topColor:'#83c5e618',bottomColor:'#83c5e600',lineWidth:2,priceFormat:{type:'price',precision:8,minMove:.00000001}});markers.current=createSeriesMarkers(series.current,[]);
  return()=>{chart.remove();api.current=null;series.current=null;lines.current=[];lastAsset.current=null;};
 },[]);
 useEffect(()=>{
  if(!series.current)return;
  const precision=asset.price<.01?8:asset.price<10?4:2;
  if(precisionRef.current!==precision){series.current.applyOptions({priceFormat:{type:'price',precision,minMove:10**-precision}});precisionRef.current=precision;}
  const latest=asset.history.at(-1), switched=lastAsset.current!==asset.id;
  // Incremental updates replace full-series rebuilds; periodic resets bound chart memory.
  if(switched||latest.time-lastReset.current>=60||latest.time<lastReset.current){series.current.setData(asset.history);lastReset.current=latest.time;}else series.current.update(latest);
  if(switched){api.current.timeScale().fitContent();lastAsset.current=asset.id;}
 },[asset]);
 useEffect(()=>{
  if(!series.current)return;if(!position){for(const line of lines.current)series.current.removePriceLine(line);lines.current=[];return;}
  if(position){const values=[['ENTRY',position.entry,'#00C2FF'],['TRAIL / SL',position.stop,'#FF3B69'],...([config.tp1,config.tp2,config.tp3].map((tp,i)=>[`TP${i+1} +${tp}%`,position.entry*(1+tp/100),'#9945FF']))];values.forEach(([title,value,color],i)=>{const options={price:value,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title};if(lines.current[i])lines.current[i].applyOptions(options);else lines.current[i]=series.current.createPriceLine(options);});}
 },[position?.asset,position?.entry,position?.stop,config.tp1,config.tp2,config.tp3]);
 useEffect(()=>{if(markers.current)markers.current.setMarkers(logs.filter(l=>l.status==='filled'&&l.asset===asset.id&&Math.floor(l.at/1000)>=asset.history[0].time).slice(0,30).reverse().map(l=>({time:Math.floor(l.at/1000),position:l.side==='buy'?'belowBar':'aboveBar',color:l.side==='buy'?'#14F195':'#FF3B69',shape:l.side==='buy'?'arrowUp':'arrowDown',text:l.side==='buy'?'BUY':'SELL'})));},[logs,asset.id,asset.history[0].time]);
 return <div ref={container} className="chart" aria-label={`${asset.id} simulated price chart with entry, stop and profit targets`} role="img"/>;
}
function Field({label,value,min,max,step=1,suffix='',onChange,hint}){
 return <label className="field"><span>{label}<b className="font-mono">{value}{suffix}</b></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/>{hint&&<small>{hint}</small>}</label>;
}
function App(){
 const [workspaceView,setWorkspaceView]=useState('trading');
 const [workspaceTarget,setWorkspaceTarget]=useState(null);
 function navigateWorkspace(target){
   const view=/research|live-dashboard/.test(target)?'research':/soak|paper-baseline/.test(target)?'sessions':'trading';
   setWorkspaceView(view);
   setWorkspaceTarget(target);
 }
 useEffect(()=>{
   const followHash=()=>navigateWorkspace(window.location.hash.slice(1)||'workspace');
   followHash();
   window.addEventListener('hashchange',followHash);
   const followLink=e=>{
     const link=e.target.closest?.('a[href^="#"]');
     if(link)navigateWorkspace(link.getAttribute('href').slice(1));
   };
   document.addEventListener('click',followLink);
   return()=>{window.removeEventListener('hashchange',followHash);document.removeEventListener('click',followLink);};
 },[]);
 useEffect(()=>{
   if(!workspaceTarget)return;
   const target=document.getElementById(workspaceTarget);
   const disclosure=target?.closest('details');
   if(disclosure)disclosure.open=true;
   if(target?.tagName==='DETAILS')target.open=true;
   if(['workspace','research','live-dashboard','soak-disclosure','soak-telemetry-panel'].includes(workspaceTarget))window.scrollTo({top:0,behavior:'instant'});
   else target?.scrollIntoView({block:'start'});
   setWorkspaceTarget(null);
 },[workspaceTarget,workspaceView]);
 const [s,dispatch]=useReducer(reducer,undefined,init),[selected,setSelected]=useState('SOL'),[tab,setTab]=useState('manual'),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[help,setHelp]=useState(false),[storageError,setStorageError]=useState(false);
 const [positionViewMode, setPositionViewMode] = useState('standard');
 const [soakData,setSoakData]=useState(null);
 const [alerts, setAlerts] = useState([]);
 const [showAlertCenter, setShowAlertCenter] = useState(false);
 const [showCommandPalette, setShowCommandPalette] = useState(false);
 const [provenanceTarget, setProvenanceTarget] = useState(null);
 const [showMethodology, setShowMethodology] = useState(false);
 const [layout, setLayout] = useState(() => loadSavedLayout());

 useEffect(() => {
   saveLayout(layout);
 }, [layout]);

 useEffect(()=>{let active=true;const load=async()=>{try{const res=await fetch('/api/soak');if(res.ok&&active)setSoakData(await res.json());}catch{}};load();const interval=setInterval(load,5000);return()=>{active=false;clearInterval(interval);};},[]);
 useEffect(() => {
   const handleKeyDown = (e) => {
     if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
       e.preventDefault();
       setShowCommandPalette(prev => !prev);
       return;
     }
     if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
     if (e.key === '/') {
       e.preventDefault();
       setShowCommandPalette(true);
       return;
     }
     if (e.key === 'u' || e.key === 'U') {
       setLayout(prev => ({ ...prev, timeMode: prev.timeMode === 'utc' ? 'local' : 'utc' }));
       return;
     }
     if (e.key === '1') { navigateWorkspace('workspace'); }
     else if (e.key === '2') { navigateWorkspace('positions'); }
     else if (e.key === '3') {
       const soakDisc = document.getElementById('soak-disclosure');
       if (soakDisc) { soakDisc.open = true; navigateWorkspace('soak-disclosure'); }
     }
     else if (e.key === '4') {
       setTab('automation');
       navigateWorkspace('execution');
     }
     else if (e.key === 'a' || e.key === 'A') {
       setShowAlertCenter(prev => !prev);
     }
     else if (e.key === 'p' || e.key === 'P') {
       openProvenanceForSelected();
     }
     else if (e.key === 'm' || e.key === 'M') {
       setShowMethodology(prev => !prev);
     }
     else if (e.key === 'o' || e.key === 'O') {
       setLayout(prev => ({ ...prev, layoutMode: prev.layoutMode === 'emergency' ? 'standard' : 'emergency' }));
     }
     else if (e.key === 'd' || e.key === 'D' || e.key === 'e' || e.key === 'E') {
       const soakDisc = document.getElementById('soak-disclosure');
       if (soakDisc) { soakDisc.open = true; navigateWorkspace('soak-disclosure'); }
     }
     else if (e.key === 'w' || e.key === 'W' || e.key === 'b' || e.key === 'B') {
       const disc = document.getElementById('paper-baseline-disclosure');
       if (disc) { disc.open = true; navigateWorkspace('paper-baseline-disclosure'); }
     }
     else if (e.key === 'Escape') {
       setHelp(false);
       setShowAlertCenter(false);
       setShowCommandPalette(false);
       setProvenanceTarget(null);
       setShowMethodology(false);
     }
   };
   window.addEventListener('keydown', handleKeyDown);
   return () => window.removeEventListener('keydown', handleKeyDown);
 }, [selected, s.config, s.logs, soakData]);
 const executionEngine=useMemo(()=>{const e=new SimulatedEngine(7,100_000n,10_000_000n);try{const raw=sessionStorage.getItem('sylph-paper-engine-v1');if(raw)e.hydrateState(JSON.parse(raw));}catch{}return e;},[]);
 const [driftMap, setDriftMap] = useState(() => new Map());
 useEffect(() => {
   executionEngine.setDriftListener((d) => {
     setDriftMap(prev => new Map(prev).set(d.poolAddress, d));
   });
 }, [executionEngine]);
 const solPriceForExecution=s.assets[0]?.price||111.18;
 const execution=useExecution(executionEngine,dispatch,solPriceForExecution,s);
 const [submitting,setSubmitting]=useState(false);
 const showHarness=new URLSearchParams(window.location.search).get('profile')==='1';
 const recorder=useMemo(()=>new SessionRecorder(),[]);
 const liveBasket=useLiveBasket();
 useEffect(()=>{dispatch({type:'SYNC_ASSETS',assets:liveBasket.assets,at:liveBasket.at,now:Date.now()});setSelected(id=>liveBasket.assets.some(a=>a.id===id)?id:liveBasket.assets[0]?.id||'loading');},[liveBasket.at]);
 useEffect(()=>{if(s.executionMode==='external'){if(!recorder.recording)recorder.start(s.now);s.assets.forEach(a=>recorder.push(a,s.now));}else recorder.stop();syncAssetsToEngine(executionEngine,s.assets,solPriceForExecution,s.now);},[executionEngine,s.assets,s.now,s.executionMode,solPriceForExecution]);
 const autoStatus=useAutoSimulateExternal({state:s,execution,solPriceUsd:solPriceForExecution});
 const current=useRef(s);current.current=s;
 const m=metrics(s),asset=liveBasket.assets.find(a=>a.id===selected)||liveBasket.assets[0]||{id:'loading',symbol:'Loading',name:'Waiting for live basket',price:0,liquidity:null,history:[{time:Math.floor(Date.now()/1000),value:0}],start:1,volume:null,rsi:null,velocity:null,fast:null,slow:null},position=s.positions.find(p=>p.asset===selected),sol=s.assets[0]?.price||111.18;
 const poolStates = executionEngine.statesByPool.get(asset.id);
 const activePoolState = poolStates?.at(-1);
 const dualSnapshotDrift = useMemo(() => {
   return evaluateDualSnapshotDrift(poolStates);
 }, [poolStates, poolStates?.length, asset.id, liveBasket.at, s.now]);
 const decisionAsset = useMemo(() => {
   if (!activePoolState) return { ...asset, drift: dualSnapshotDrift || asset.drift };
   return {
     ...asset,
     reserves: activePoolState.reserves,
     migrated: activePoolState.migrated || asset.migrated,
     drift: dualSnapshotDrift || asset.drift,
   };
 }, [asset, activePoolState, dualSnapshotDrift]);
 const candidate = useMemo(() => {
   const live = soakData?.liveEngine?.candidates || [];
   const sample = soakData?.session?.candidatesSample || [];
   const all = [...live, ...sample];
   return all.find(c => c.mint === selected || c.mint === asset.id || c.mint === asset.mint) || null;
 }, [soakData, selected, asset]);
 const driftTelemetry = driftMap.get(asset.id) || candidate?.drift || dualSnapshotDrift || null;
 const isFeedStale = Boolean(liveBasket.error) || (liveBasket.at ? Date.now() - liveBasket.at > 5000 : false);
 useEffect(() => {
    const rpcGateEvidence = readSoakGateEvidence(soakData);
    const feedAge = liveBasket.at ? Math.max(0, Date.now() - liveBasket.at) : null;
    const raw = extractSystemAlerts({
      ...rpcGateEvidence,
      halted: s.halted,
      haltReason: s.haltReason,
      feedFresh: !liveBasket.error && liveBasket.assets.length > 0 && liveBasket.at > 0,
      feedAgeMs: feedAge,
      creatorSell: asset.spike > 0,
      curveComplete: Boolean(position && (asset.complete || asset.migrated)),
      blockedExits: soakData?.session?.blockedExits || [],
    });
    setAlerts(prev => groupAlerts(raw, prev));
  }, [soakData, s.halted, s.haltReason, liveBasket.at, liveBasket.error, asset.spike, asset.complete, asset.migrated]);
  const handlePanicAll=async()=>{
    const typed = window.prompt('DANGER: Panic liquidation of all active paper positions. Type CLOSE to confirm:');
    if (typed !== 'CLOSE') return;
    try {
      if (typeof fetch === 'function') {
        fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId: `cmd_panic_${Date.now()}`,
            type: 'EMERGENCY_STOP',
            timestamp: Date.now(),
            initiator: 'ui_panic_all',
            payload: { reason: 'Operator manual panic liquidation' },
          }),
        }).catch(() => {});
      }
    } catch {}
    if(s.executionMode==='external'){
      dispatch({type:'PAUSE'});
      await Promise.allSettled(s.positions.map(p=>execution.panicCloseUsd(p.asset,p.asset,p.qty,9)));
    }
    dispatch({type:'PANIC',now:Date.now()});
  };
  const handleManualBuy=async()=>{
    if(submitting)return;
    if(isFeedStale){alert('Execution Locked: Market data feed is stale (>5s lag). Reconnect to cluster before placing orders.');return;}
    setSubmitting(true);
    try{await order(selected,'buy');}
    finally{setSubmitting(false);}
  };
  const order=(id,side)=>{
    if(side==='sell'){
      const pos=s.positions.find(p=>p.asset===id);
      if(!pos)return null;
      if(s.executionMode==='external'){
        const a=s.assets.find(x=>x.id===id);
        return execution.panicCloseUsd(id,id,pos.qty,a?.tokenDecimals??9);
      }
      return dispatch({type:'ORDER',asset:id,side:'sell',now:Date.now()});
    }
    if(s.executionMode==='external'){
      const a=s.assets.find(x=>x.id===id);
      if(!a)return undefined;
      return execution.submitUsdOrder({tokenMint:id,poolAddress:id,side:'BUY',usdAmount:s.config.size*solPriceForExecution,maxSlippageBps:s.config.slippage*100});
    }
    return dispatch({type:'ORDER',asset:id,side:'buy',now:Date.now()});
  };
 const config=(key,value)=>dispatch({type:'CONFIG',key,value});
 useEffect(()=>{const timer=setInterval(()=>dispatch({type:'TICK',now:Date.now()}),250);return()=>clearInterval(timer);},[]);
 const due=s.pending.length?Math.min(...s.pending.map(o=>o.due)):null;
 useEffect(()=>{if(due===null)return;const timer=setTimeout(()=>dispatch({type:'SETTLE',now:Date.now()}),Math.max(0,due-Date.now()));return()=>clearTimeout(timer);},[due]);
 useEffect(()=>{const save=()=>{try{sessionStorage.setItem(STORAGE,JSON.stringify(current.current));sessionStorage.setItem('sylph-paper-engine-v1',JSON.stringify(executionEngine.exportState()));setStorageError(false);}catch{setStorageError(true);}};/* Storage is synchronous: checkpoint less often to reduce main-thread stalls. */ const timer=setInterval(save,5000);window.addEventListener('pagehide',save);return()=>{clearInterval(timer);window.removeEventListener('pagehide',save);};},[]);
 const quote=executionQuote({...asset,liquidity:asset.liquidity||1},'buy',s.config.size*sol,s.config,sol);
 const pending=s.pending.some(o=>o.asset===selected)||execution.pendingAssets.includes(selected),canBuy=!pending&&!position&&m.available>=s.config.size*sol+quote.fee&&s.positions.length+s.pending.filter(o=>o.side==='buy').length<s.config.maxPositions;
 const logs=useMemo(()=>s.logs.filter(l=>filter==='all'||l.status===filter),[s.logs,filter]);
 const exportLog=()=>{const header=['at','source','asset','side','status','reason','price','qty','slippage','fee','pnl','latency'];const escape=x=>'"'+String(x??'').replaceAll('"','""')+'"';const csv=[header.join(','),...s.logs.map(l=>header.map(k=>escape(k==='at'?new Date(l.at).toISOString():l[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='sylph-paper-audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

  const handleExportIncidentReport = () => {
    const report = generateIncidentReport({
      state: s,
      liveBasket,
      soakData,
      alerts,
      generatedAt: Date.now(),
    });
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sylph-incident-report-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function openProvenanceForSelected(override = null) {
    const activeAsset = override?.asset || liveBasket.assets.find(a => a.id === selected) || liveBasket.assets[0];
    // Session samples are historical analytics and cannot be current authority.
    const cand = override?.candidate || candidate;
    setProvenanceTarget({
      asset: activeAsset,
      candidate: cand,
      snapshot: cand,
      limits: {
        buy: BigInt(Math.floor((s.config?.size || 0.1) * 1e9)).toString(),
        reserve: '50000000',
        exposure: '500000000',
        slippage: (s.config?.slippage || 12) * 100,
      },
      rejectionReason: override?.rejectionReason || null,
    });
  }

  const handleExecuteCommand = (cmd) => {
    if (cmd.actionType === 'TOGGLE_ALERTS') {
      setShowAlertCenter(prev => !prev);
    } else if (cmd.actionType === 'TOGGLE_TIME_MODE') {
      setLayout(prev => ({ ...prev, timeMode: prev.timeMode === 'utc' ? 'local' : 'utc' }));
    } else if (cmd.actionType === 'SET_LAYOUT') {
      setLayout(prev => ({ ...prev, layoutMode: cmd.payload }));
    } else if (cmd.actionType === 'EXPORT_INCIDENT_REPORT') {
      handleExportIncidentReport();
    } else if (cmd.actionType === 'EXPORT_AUDIT_CSV') {
      exportLog();
    } else if (cmd.actionType === 'PANIC_CLOSE') {
      handlePanicAll();
    } else if (cmd.actionType === 'RESET_SIMULATION') {
      const typed = window.prompt('DANGER: This will purge all simulated positions and audit history. Type RESET to confirm:');
      if (typed === 'RESET') {
        dispatch({ type: 'RESET', now: Date.now() });
        executionEngine.clearOverlay();
        executionEngine.adverseSelection.reset();
        sessionStorage.removeItem('sylph-paper-engine-v1');
      }
    } else if (cmd.actionType === 'NAVIGATE_SOAK') {
      const soakDisc = document.getElementById('soak-disclosure');
      if (soakDisc) { soakDisc.open = true; navigateWorkspace('soak-disclosure'); }
    } else if (cmd.actionType === 'OPEN_SESSION_COMPARE') {
      const soakDisc = document.getElementById('soak-disclosure');
      if (soakDisc) { soakDisc.open = true; navigateWorkspace('soak-disclosure'); }
    } else if (cmd.actionType === 'INSPECT_PROVENANCE') {
      openProvenanceForSelected();
    } else if (cmd.actionType === 'VIEW_COUNTERFACTUAL_METHODOLOGY') {
      setShowMethodology(true);
    } else if (cmd.actionType === 'NAVIGATE_MODEL_SHADOW' || cmd.actionType === 'NAVIGATE_ARTIFACT_MANIFEST') {
      const soakDisc = document.getElementById('soak-disclosure');
      if (soakDisc) { soakDisc.open = true; navigateWorkspace('soak-disclosure'); }
    } else if (cmd.actionType === 'NAVIGATE_WATERFALL' || cmd.actionType === 'NAVIGATE_PAPER_BASELINE') {
      const disc = document.getElementById('paper-baseline-disclosure');
      if (disc) { disc.open = true; disc.scrollIntoView({ behavior: 'smooth' }); }
    } else if (cmd.actionType === 'SELECT_TOKEN') {
      setSelected(cmd.payload); navigateWorkspace('workspace');
    }
  };

  const feedFreshness = getFreshnessBadge(liveBasket.at ? Math.max(0, Date.now() - liveBasket.at) : null, Boolean(liveBasket.error));

  return <div className={`app-shell layout-${layout.layoutMode}`}>
  <a href="#workspace" className="skip-link">Skip to terminal</a>
  <aside className="rail"><a href="#workspace" className="wordmark" aria-label="Sylph Fusion — workspace"><span className="brand-mark"><img src="/sylph-fusion.svg" alt="" width="40" height="40"/></span><span className="brand-name">Sylph Fusion<small>RESEARCH · EXECUTION</small></span></a><div className="rail-caption">WORKSPACE</div><nav aria-label="Main navigation"><a href="#live-dashboard" className={workspaceView==='research'?'active':''} onClick={()=>{const panel=document.getElementById('research');if(panel)panel.open=true;}}><Radar size={17}/>Market research</a><a href="#soak-telemetry-panel" className={workspaceView==='sessions'?'active':''} onClick={()=>{const panel=document.getElementById('soak-disclosure');if(panel)panel.open=true;}}><Gauge size={17}/>Soak telemetry</a><a href="#workspace" className={workspaceView==='trading'?'active':''}><Radar size={17}/>Terminal <span className="key">01</span></a><a href="#positions"><Layers size={17}/>Positions <span className="count">{s.positions.length}</span></a><a href="#audit"><Activity size={17}/>Execution log</a><button onClick={()=>{setTab('automation');navigateWorkspace('execution');}}><Settings2 size={17}/>Automation</button></nav><div className="rail-note"><FlaskConical size={18}/><strong>A real edge starts<br/>with a paper trail.</strong><p>Live market insights.<br/>Practice with paper funds.</p><span className="pill">ZERO REAL FUNDS</span></div><button className="help-button" onClick={()=>setHelp(true)}><CircleHelp size={16}/> Simulator guide <ArrowUpRight size={14}/></button><div className="rail-footer"><span className="dot"/> LOCAL SIMULATOR <span>v1.0</span></div></aside>
  <main data-workspace={workspaceView}>
   <OperatorStatusStrip
     mode={s.executionMode === 'external' ? 'paper' : 'paper'}
     feedAgeMs={liveBasket.at ? Math.max(0, Date.now() - liveBasket.at) : null}
     feedFresh={!liveBasket.error && liveBasket.assets.length > 0}
     rpcDropRate={soakData?.session?.rpcHealth?.rateLimitPct ?? 0}
     rpcDropsCount={soakData?.session?.rpcHealth?.failedRpcCount ?? 0}
     halted={s.halted}
     haltReason={s.haltReason}
     running={s.running}
     pendingCount={s.pending.length + execution.pendingAssets.length}
     pendingAgeMs={due ? Math.max(0, Date.now() - (due - 300)) : 0}
     gatePassed={soakData?.session?.rpcHealth?.gatePassed ?? false}
     notice={s.notice}
     candidates={soakData?.session?.candidatesSample || soakData?.liveEngine?.candidates || []}
     outcomes={soakData?.session?.outcomes || []}
   />
    <nav className="workspace-switcher" aria-label="Workspace views">
      <a href="#workspace" aria-current={workspaceView==='trading'?'page':undefined}><ChartNoAxesCombined size={16}/>Trading</a>
      <a href="#research" aria-current={workspaceView==='research'?'page':undefined}><Radar size={16}/>Research</a>
      <a href="#soak-disclosure" aria-current={workspaceView==='sessions'?'page':undefined}><Gauge size={16}/>Session Analysis</a>
    </nav>
    <header className="topbar">
      <div className="breadcrumb">
        Workspace <ChevronRight size={14}/><strong>{workspaceView==='trading'?'Trading':workspaceView==='research'?'Research':'Session Analysis'}</strong>
        <span className="simulation-badge"><FlaskConical size={12}/> PAPER</span>
      </div>
      <div className="top-right">
        <button
          className="cmd-trigger-btn"
          onClick={() => setShowCommandPalette(true)}
          title="Command Palette (Ctrl+K or /)"
          aria-label="Open Command Palette"
        >
          <Command size={13}/> Quick actions <kbd>⌘K</kbd>
        </button>
        <select
          className="mode-toggle"
          style={{ width: 'auto', padding: '4px 8px' }}
          value={layout.layoutMode}
          onChange={e => setLayout(prev => ({ ...prev, layoutMode: e.target.value }))}
          aria-label="Operator Layout Mode"
          title="Operator layout density"
        >
          <option value="standard">Standard layout</option>
          <option value="compact">Compact density</option>
          <option value="telemetry">Telemetry focus</option>
          <option value="emergency">Emergency operator</option>
        </select>
        <button
          className="mode-toggle"
          disabled={s.running||execution.pendingAssets.length>0||s.pending.length>0}
          onClick={()=>dispatch({type:'SET_EXECUTION_MODE',mode:s.executionMode==='external'?'legacy':'external'})}
        >
          {s.executionMode==='external'?'AMM PAPER':'LEGACY PAPER'}
        </button>
        <span className={`freshness-badge badge-${feedFreshness.status}`} title={`Feed lag: ${feedFreshness.ageFormatted}`}>
          <span className="dot"/>{feedFreshness.label} {feedFreshness.ageFormatted}
        </span>
        <button
          className={`time-toggle-btn ${layout.timeMode === 'utc' ? 'is-utc' : ''}`}
          onClick={() => setLayout(prev => ({ ...prev, timeMode: prev.timeMode === 'utc' ? 'local' : 'utc' }))}
          title={`Time: ${layout.timeMode.toUpperCase()} (Click or press 'U' to toggle)`}
          aria-label="Toggle UTC / Local time"
        >
          <span className="font-mono">{formatTime(s.now, layout.timeMode)}</span>
        </button>
        <button
          className={`icon-button alert-bell-btn ${getUnacknowledgedCount(alerts) > 0 ? 'has-alerts' : ''}`}
          aria-label={`Alert Center: ${getUnacknowledgedCount(alerts)} unacknowledged incidents (Key: A)`}
          title="Alert Center (Shortcut: A)"
          onClick={() => setShowAlertCenter(true)}
        >
          <Bell size={16} />
          {getUnacknowledgedCount(alerts) > 0 && (
            <span className="bell-badge font-mono animate-pulse">{getUnacknowledgedCount(alerts)}</span>
          )}
        </button>
        <button className="icon-button" aria-label="Simulator guide" onClick={()=>setHelp(true)}><CircleHelp size={17}/></button>
      </div>
    </header>
   <RiskBanners
     showSessionGate={false}
     showPaused={false}
     gatePassed={soakData?.session?.rpcHealth?.gatePassed ?? false}
     rpcDropRate={soakData?.session?.rpcHealth?.rateLimitPct ?? 0}
     rpcDropsCount={soakData?.session?.rpcHealth?.failedRpcCount ?? 0}
     halted={s.halted}
     haltReason={s.haltReason}
     operatorPaused={!s.running && !s.halted}
     feedAgeMs={liveBasket.at ? Math.max(0, Date.now() - liveBasket.at) : null}
     feedFresh={!liveBasket.error && liveBasket.assets.length > 0 && liveBasket.at > 0}
     creatorSell={candidate?.devSold === true}
     curveComplete={asset.complete || asset.migrated || false}
     onPanicClose={handlePanicAll}
     onResume={() => s.executionMode === 'external' ? dispatch({type:'START', now:Date.now()}) : dispatch({type:'START', now:Date.now()})}
   />
   {showHarness&&<ProfilerBurstHarness onTick={(tick)=>dispatch({type:"TICK",now:tick.timestamp})} heldMint={s.positions[0]?.asset} activeMint={asset.id}/>}
   {layout.layoutMode === 'emergency' ? (
     <OperatorEmergencyView
       state={s}
       liveBasket={liveBasket}
       soakData={soakData}
       execution={execution}
       solPriceUsd={solPriceForExecution}
       onPanicCloseAll={handlePanicAll}
       onPauseAutomation={() => dispatch({type:'PAUSE', now:Date.now()})}
       onRequestReconciliation={null}
       onExitEmergencyMode={() => setLayout(prev => ({ ...prev, layoutMode: 'standard' }))}
     />
   ) : (
     <>
       <details className="research-disclosure" id="soak-disclosure" open><summary><span><Gauge size={18}/><b>Soak telemetry &amp; baseline gate</b><small>Rejection taxonomy, RPC health, exit blocking, checkpoints</small></span><ChevronRight size={18}/></summary><SoakTelemetry/></details>
       <details className="research-disclosure" id="paper-baseline-disclosure">
         <summary>
           <span>
             <Scale size={18}/>
             <b>Capital Allocation Waterfall &amp; Paper vs Baseline Benchmark</b>
             <small>Risk budget waterfall, net-of-friction P&amp;L, drawdown headroom, and filter alpha</small>
           </span>
           <ChevronRight size={18}/>
         </summary>
         <div className="waterfall-baseline-wrapper">
           <RiskBudgetWaterfall
             cash={BigInt(Math.floor((s.cash / sol) * 1e9)).toString()}
             positions={s.positions.map(p => ({
               cost: BigInt(Math.floor((p.cost / sol) * 1e9)).toString(),
               qty: p.qty,
               entry: p.entry,
               asset: p.asset,
             }))}
             pending={s.pending[0] ? {
               side: s.pending[0].side,
               mint: s.pending[0].asset,
               requested: BigInt(Math.floor(s.config.size * 1e9)).toString(),
             } : null}
             limits={{
               buy: BigInt(Math.floor(s.config.size * 1e9)).toString(),
               reserve: '50000000',
               exposure: '500000000',
               positions: s.config.maxPositions,
               riskBps: '500',
             }}
             solPriceUsd={solPriceForExecution}
             halted={s.halted}
             operatorPaused={!s.running && !s.halted}
           />
           <PaperVsBaselineComparison
             paperSession={soakData?.session}
             outcomes={soakData?.session?.outcomes || []}
             candidates={soakData?.session?.candidatesSample || soakData?.liveEngine?.candidates || []}
             fills={soakData?.session?.fills || []}
             solPriceUsd={solPriceForExecution}
             runtimeConfig={soakData?.runtimeConfig}
             onOpenMethodology={() => setShowMethodology(true)}
           />
         </div>
       </details>
       <details className="research-disclosure" id="research" open><summary><span><Radar size={18}/><b>Market research</b><small>Live feeds, token checks & discovery</small></span><ChevronRight size={18}/></summary><LiveDashboard/><Astra/></details>
       <section className="metric-bar" aria-label="Portfolio summary"><Metric label="PAPER BALANCE" value={usd(s.cash)} detail={`${(s.cash/sol).toFixed(3)} SOL equivalent`} icon={<Wallet size={15}/>}/><Metric label="PORTFOLIO VALUE" value={usd(m.equity)} detail={`${usd(m.exposure)} in positions`} icon={<Layers size={15}/>}/><Metric label="REALIZED P&L" value={`${s.realized>=0?'+':''}${usd(s.realized)}`} detail={`${s.trades} executed fills`} tone={cn(s.realized)} icon={<ChartNoAxesCombined size={15}/>}/><Metric label="TOTAL RETURN" value={pct((m.equity/s.initial-1)*100)} detail="Since this session started" tone={cn(m.equity-s.initial)} icon={<ArrowUpRight size={15}/>}/><div className="metric bot-metric"><span className="metric-label"><Sparkles size={15}/>AUTO-SIMULATE</span><strong className={s.running?'positive':''}><span className={`dot ${s.running?'':'paused'}`}/>{s.running?(execution.pendingAssets.length?'Confirming':'Watching'):'Paused'}</strong><small>{s.running?autoStatus:'Enable in the Automation tab'}</small></div></section>
       <div className="workspace" id="workspace">
        <section className="panel watchlist"><div className="panel-heading"><h2><Radar size={15}/>Markets</h2><span className="count">{liveBasket.assets.length}</span></div><div className="watch-tools"><span className="eyebrow">LIVE AUTOMATION BASKET</span><input aria-label="Filter pairs" placeholder="Search tokens…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="watch-labels"><span>ASSET / PRICE</span><span>5M CHANGE</span></div><p className="live-note">{liveBasket.error||"Observed rank by 1h volume · not a verified global ranking"}</p><div className="token-list">{liveBasket.assets.filter(a=>(a.symbol+' '+a.name).toLowerCase().includes(search.toLowerCase())).map(a=><button key={a.id} className={`token-row ${a.id===selected?'selected':''}`} onClick={()=>setSelected(a.id)} aria-pressed={a.id===selected}><span className="token-top"><span className="token-icon" style={{'--token-color':a.color}}>{a.symbol.slice(0,1)}</span><span><b>{a.symbol}<small>/ USDC</small></b><em>{a.name}</em></span><span className={cn(a.price-a.start)}>{a.change5m==null?'—':pct(a.change5m)}</span></span><span className="token-bottom"><b>{price(a.price)}</b><MiniChart history={a.history} color={a.price>=a.start?'#14F195':'#FF3B69'}/></span>{a.spike>0&&<span className="spike-label"><Zap size={10}/> VOLATILITY SPIKE</span>}</button>)}</div><div className="market-summary"><div><span>Reported liquidity</span><b>{asset.liquidity==null?'Unknown':usd(asset.liquidity,0)}</b></div><div><span>Trailing 1h volume</span><b className={asset.volume>3?'positive':''}>{asset.volume1h==null?'Unknown':usd(asset.volume1h,0)}</b></div><div><span>Basket refresh</span><b>2 seconds</b></div></div><div className="model-note"><ShieldCheck size={15}/><span>Live observed pool data. Unverified entries blocked.</span></div>{s.executionMode==="external"&&<OverlayDepthGauge asset={asset} engine={executionEngine} solPriceUsd={solPriceForExecution}/>}</section>
        <section className="panel analysis"><div className="asset-heading"><div className="asset-title"><span className="token-icon large" style={{'--token-color':asset.color}}>{asset.symbol?.[0]}</span><div><h2>{asset.symbol}<span>/ USDC</span></h2><small>{asset.name} <span className="separator">·</span> Live observed pool</small></div></div><div className="quote-heading"><strong>{price(asset.price)}</strong><small className={cn(asset.price-asset.start)}>{pct((asset.price/asset.start-1)*100)} <span>session</span></small></div></div><div className="chart-toolbar"><div><span className="chip active">1s</span><span className="chart-style"><ChartNoAxesCombined size={14}/> Area</span></div><span className="chart-live"><span className="dot"/> LIVE OBSERVATIONS</span></div><Chart asset={asset} position={position} config={s.config} logs={s.logs}/><div className="chart-legend"><span><i className="cyan"/>Entry</span><span><i className="rose"/>Trailing / stop</span><span><i className="purple"/>Take profit targets</span><small>Drag to pan · Scroll to zoom</small></div><TokenDecisionCard asset={decisionAsset} candidate={candidate} driftTelemetry={driftTelemetry} solPriceUsd={solPriceForExecution} rejectionReason={s.logs.find(l => (l.asset === asset.id || l.mint === asset.id) && l.status === 'rejected')?.reason} onInspectProvenance={openProvenanceForSelected} /><ResearchDock/><div className="signal-grid"><Signal label="RSI · 14" value={asset.rsi==null?'Unknown':asset.rsi.toFixed(1)} detail={asset.rsi==null?'Insufficient live history':asset.rsi<35?'Oversold zone':asset.rsi>70?'Overbought zone':'Neutral zone'}/><Signal label="VELOCITY · 4s" value={asset.velocity==null?'Unknown':pct(asset.velocity)} detail={asset.velocity>s.config.velocity?'Above trigger':'Below trigger'} tone={cn(asset.velocity)}/><Signal label="MA · 5 / 20" value={asset.fast==null?'Unknown':asset.fast>asset.slow?'Bullish':'Bearish'} detail="Requires live tick history" tone={asset.fast>asset.slow?'positive':'negative'}/></div><div className="strategy-banner"><span className="strategy-icon"><Sparkles size={17}/></span><div><b>{s.config.strategy==='breakout'?'Breakout momentum':'Dip recovery'}<span className="strategy-tag">{s.running?'ARMED':'STANDBY'}</span></b><p>{s.config.strategy==='breakout'?`Velocity > ${s.config.velocity}% / sec and volume ≥ ${s.config.volume}×`:`RSI crosses ${s.config.rsi} from below with MA5 above MA20`}</p></div><button aria-label="Configure strategy" onClick={()=>setTab('automation')}><ChevronRight size={18}/></button></div></section>
        <section className="panel execution" id="execution"><div className="panel-heading"><h2><Zap size={15}/>Execution</h2><span className="pill">PAPER ONLY</span></div><div className="execution-tabs" role="tablist" aria-label="Execution mode"><button role="tab" aria-selected={tab==='manual'} onClick={()=>setTab('manual')} className={tab==='manual'?'active':''}>Manual trade</button><button role="tab" aria-selected={tab==='automation'} onClick={()=>setTab('automation')} className={tab==='automation'?'active':''}><Sparkles size={13}/>Automation</button></div><div className="execution-body" role="tabpanel" aria-label={tab==='manual'?'Manual trade':'Automation configuration'}>
        {tab==='manual'?<><div className="trade-direction"><span>BUY {asset.symbol}</span><small>Market order</small></div><label className="size-input"><span>AMOUNT</span><div><input aria-label="Order size in SOL" type="number" min="0.1" max="5" step="0.1" value={s.config.size} onChange={e=>config('size',e.target.value)}/><b>SOL</b></div><small>≈ {usd(s.config.size*sol)} <span>Available {(m.available/sol).toFixed(3)} SOL</span></small></label><div className="quick-sizes">{[.1,.25,.5,1].map(v=><button key={v} aria-pressed={s.config.size===v} onClick={()=>config('size',v)} className={s.config.size===v?'active':''}>{v} SOL</button>)}</div><Field label="Max slippage" value={s.config.slippage} min={.1} max={25} step={.1} suffix="%" onChange={v=>config('slippage',v)}/><label className="select-field"><span>Priority fee <small>µ-lamports / CU</small></span><select aria-label="Priority fee" value={s.config.priority} onChange={e=>config('priority',e.target.value)}><option value={0}>0 · Standard</option><option value={50000}>50,000 · Fast</option><option value={250000}>250,000 · Turbo</option><option value={1000000}>1,000,000 · Maximum</option></select></label><label className="select-field"><span>Jito tip <small>SOL</small></span><select aria-label="Jito tip" value={s.config.tip} onChange={e=>config('tip',e.target.value)}>{[0,.0001,.001,.01].map(v=><option key={v} value={v}>{v.toFixed(4)} SOL</option>)}</select></label><div className="order-estimate"><div><span>Est. output</span><b>{quote.price>0 && Number.isFinite(quote.price)?`${(s.config.size*sol/quote.price).toLocaleString('en-US',{maximumFractionDigits:3})} ${asset.symbol}`:'—'}</b></div><div><span>Pool impact + DEX fee</span><b className={Number.isFinite(quote.impact) && quote.impact>s.config.slippage?'negative':''}>{Number.isFinite(quote.impact) ? `${quote.impact.toFixed(2)}%` : '—'}</b></div><div><span>Network + tip</span><b>{Number.isFinite(quote.fee) ? `${(quote.fee/sol).toFixed(6)} SOL` : '—'}</b></div><div><span>Confirmation</span><b>{s.executionMode==='external' ? (isFeedStale ? 'Unavailable · Stale' : '400–800 ms (simulated)') : (isFeedStale ? 'Unavailable · Stale' : '100–400 ms (simulated)')}</b></div></div><button className={`buy-button ${pending?'pending':''}`} disabled={!canBuy||submitting} onClick={handleManualBuy}>{pending||submitting?<><Activity size={17}/>Confirming order…</>:<><Zap size={17}/>{position?'Position already open':`Buy ${asset.symbol}`}<ArrowUpRight size={17}/></>}</button><p className="execution-note">{s.astraGate!==false?'Astra requires a verified eligible basket and complete signals before entry.':position?'One position per asset. Manage exits below.':s.positions.length>=s.config.maxPositions?'Position limit reached. Close a position first.':'Size presets configure your next order. Buy submits it.'}</p></>:<><div className="automation-status"><span className={`dot ${s.running?'':'paused'}`}/><b>{s.running?autoStatus:'Ready to start paper automation'}</b></div><label className="select-field"><span>Entry strategy</span><select aria-label="Entry strategy" value={s.config.strategy} onChange={e=>config('strategy',e.target.value)}><option value="breakout">Volume + velocity breakout</option><option value="dip">RSI + MA dip recovery</option></select></label><div className="tp-inputs">{['tp1','tp2','tp3'].map((key,i)=><label key={key}>TP {i+1} %<input aria-label={`Take profit tier ${i+1}`} type="number" min="1" max="1000" value={s.config[key]} onChange={e=>config(key,e.target.value)}/><small>{i===2?'Remainder':'25% of entry'}</small></label>)}</div><Field label="Stop loss" value={s.config.stop} min={5} max={8} suffix="%" onChange={v=>config('stop',v)}/><Field label="Trailing stop" value={s.config.trailing} min={5} max={8} suffix="%" onChange={v=>config('trailing',v)}/><Field label="Max slippage" value={s.config.slippage} min={.1} max={25} step={.1} suffix="%" onChange={v=>config('slippage',v)}/><Field label="Bot interval" value={s.config.interval} min={250} max={5000} step={250} suffix=" ms" onChange={v=>config('interval',v)}/>{s.config.strategy==='breakout'?<div className="config-pair"><label>Velocity % / sec<input aria-label="Velocity threshold" type="number" min=".1" max="10" step=".1" value={s.config.velocity} onChange={e=>config('velocity',e.target.value)}/></label><label>Volume ×<input aria-label="Volume threshold" type="number" min="1" max="8" step=".1" value={s.config.volume} onChange={e=>config('volume',e.target.value)}/></label></div>:<Field label="RSI recovery threshold" value={s.config.rsi} min={10} max={60} onChange={v=>config('rsi',v)}/  >}<div className="automation-summary"><span>Entry size <b>{s.config.size} SOL</b></span><span>Max positions <select aria-label="Maximum positions" value={s.config.maxPositions} onChange={e=>config('maxPositions',e.target.value)}>{[1,2,3,4,5].map(v=><option key={v}>{v}</option>)}</select></span></div><button className={s.running?'danger w-full':'buy-button'} onClick={()=>{if(s.running)dispatch({type:'PAUSE'});else if(!s.pending.length){dispatch({type:'SET_EXECUTION_MODE',mode:'external'});dispatch({type:'START',now:Date.now()});}}} disabled={!s.running&&s.pending.length>0}>{s.running?<><CircleStop size={16}/>Pause Auto-Simulate</>:<><Play size={16}/>Auto-Simulate ON</>}</button><p className="execution-note">Paper trades open when your signal qualifies. Pausing keeps positions open; use Panic close all to exit. Waiting for a signal is normal.</p></>}
        </div></section>
       </div>
       <div className="status-notice" role="status"><Activity size={14}/><span>{s.notice}</span>{s.pending.length>0&&<b>{s.pending.length} pending</b>}{storageError&&<span className="negative">Session storage unavailable</span>}</div>
       <div className="bottom-grid"><section id="positions" className="panel positions-panel"><div className="panel-heading"><h2><Layers size={15}/>Active positions <span className="count">{s.positions.length}</span></h2><div className="pos-heading-tools"><div className="position-view-toggle"><button className={`toggle-tab ${positionViewMode==='standard'?'active':''}`} onClick={()=>setPositionViewMode('standard')}>Table</button><button className={`toggle-tab ${positionViewMode==='risk'?'active':''}`} onClick={()=>setPositionViewMode('risk')}>Risk panel</button></div><span className={cn(m.unrealized)}>{signed(m.unrealized)} USD unrealized</span></div></div>
       {positionViewMode === 'risk' ? (
         <PositionRiskPanel
           positions={s.positions}
           solPriceUsd={solPriceForExecution}
           mode="paper"
           canExecuteClose={true}
           onPanicClose={(id) => order(id, 'sell')}
         />
       ) : (
         <div className="table-scroll"><table><thead><tr>{['TOKEN / SIZE','ENTRY / MARK','UNREALIZED PNL','TRAIL / TP','DURATION',''].map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{s.positions.map(p=>{const a=s.assets.find(a=>a.id===p.asset);const markPrice=Number.isFinite(a?.price)&&a.price>0?a.price:p.entry;const gain=p.qty*markPrice-p.cost;return <tr key={p.asset}><td><button className="position-token" onClick={()=>setSelected(p.asset)}>{p.asset}<ArrowUpRight size={12}/></button><small>{p.qty.toLocaleString('en-US',{maximumFractionDigits:3})} units</small></td><td><b>{price(p.entry)}</b><small>{price(markPrice)}</small></td><td className={cn(gain)}><b>{signed(gain)} USD</b><small className={cn(gain)}>{pct(gain/p.cost*100)}</small></td><td><b>{price(p.stop)}</b><small>{p.tiers.length} / 3 targets filled</small></td><td>{duration(s.now,p.opened)}<small>{p.source}</small></td><td><button className="close-button" disabled={s.pending.some(o=>o.asset===p.asset)||execution.pendingAssets.includes(p.asset)} onClick={()=>order(p.asset,'sell')}>{s.pending.some(o=>o.asset===p.asset)||execution.pendingAssets.includes(p.asset)?'Confirming…':'Close 100%'}<X size={12}/></button></td></tr>;})}</tbody></table></div>
       )}
       {s.positions.length===0&&<div className="empty-state"><Layers size={25}/><strong>Your positions start here</strong><p>Place a paper order or arm a strategy to watch it work.</p></div>}<div className="positions-footer"><span><ShieldCheck size={13}/> Funds reserved for pending orders: {usd(m.reserved)}</span><span>Execution costs paid: {usd(s.fees,4)}</span></div></section><section id="audit" className="panel audit-panel"><div className="panel-heading"><h2><Activity size={15}/>Execution tape</h2><button className="icon-button" onClick={exportLog} aria-label="Export execution audit CSV"><Download size={15}/></button></div><div className="tape-tabs">{['all','filled','rejected'].map(f=><button key={f} onClick={()=>setFilter(f)} aria-pressed={filter===f} className={filter===f?'active':''}>{f}</button>)}<span>Latest 300 events</span></div><AuditTape logs={logs} filter={filter}/></section></div>
     </>
   )}
   <footer><span><span className="dot"/> Observed prices · simulated fills <span className="separator">/</span> Session saved in this tab</span><button onClick={()=>{const typed = window.prompt('DANGER: This will purge all simulated positions and audit history. Type RESET to confirm:'); if(typed==='RESET'){dispatch({type:'RESET',now:Date.now()});executionEngine.clearOverlay();executionEngine.adverseSelection.reset();sessionStorage.removeItem('sylph-paper-engine-v1');}}}><RotateCcw size={12}/>Reset simulation</button><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a></footer>
  </main>
   <CommandPalette
     isOpen={showCommandPalette}
     onClose={() => setShowCommandPalette(false)}
     onExecuteAction={handleExecuteCommand}
     tokens={liveBasket.assets}
     sessions={soakData?.sessions || []}
     timeMode={layout.timeMode}
     layoutMode={layout.layoutMode}
     alertCount={getUnacknowledgedCount(alerts)}
   />
   <AlertCenter
     isOpen={showAlertCenter}
     onClose={() => setShowAlertCenter(false)}
     alerts={alerts}
     onAcknowledge={(id) => setAlerts(prev => acknowledgeAlert(id, prev))}
     onAcknowledgeAll={() => setAlerts(prev => acknowledgeAllAlerts(prev))}
   />
   <DecisionProvenanceDrawer
     isOpen={Boolean(provenanceTarget)}
     onClose={() => setProvenanceTarget(null)}
     candidate={provenanceTarget?.candidate}
     snapshot={provenanceTarget?.snapshot}
     limits={provenanceTarget?.limits}
     policyContext={provenanceTarget?.policyContext}
     rejectionReason={provenanceTarget?.rejectionReason}
   />
    <CounterfactualMethodologyDrawer
      isOpen={showMethodology}
      onClose={() => setShowMethodology(false)}
      config={soakData?.runtimeConfig || soakData?.liveEngine?.config || s?.config}
      policy={soakData?.session?.policy}
      state={s}
    />
  {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><section role="dialog" aria-modal="true" aria-label="Simulator guide" className="help-modal" onClick={e=>e.stopPropagation()}><button autoFocus className="icon-button" aria-label="Close simulator guide" onClick={()=>setHelp(false)}><X size={18}/></button><div className="eyebrow">KNOW YOUR SIMULATION</div><h2>Build discipline before exposure.</h2><p>Every price is generated locally using geometric Brownian motion with temporary volatility spikes. Micro-cap volatility is accelerated for strategy testing.</p><h3>Accounting</h3><p>You start with 150 virtual USDC (1 SOL at the seed price of $150). SOL amounts are converted at the current simulated quote. Equity and PnL are measured in USDC; the wallet shows a changing SOL equivalent.</p><h3>Execution</h3><p>Constant-product pool impact, a 0.3% DEX fee, a 5,000-lamport base fee, 200,000 compute units, your priority fee, and Jito tip determine fills. Pending orders reserve funds. Slippage rejection charges the simulated network fee. No real network is used.</p><h3>Automation & emergency exits</h3><p>TP tiers sell 25%, 25%, then the remainder of the original position. Stops only ratchet upward. Both emergency controls cancel pending orders and close at the current executable pool price, including fees, bypassing latency and the slippage cap. Automation stays off after a reload.</p><h3>Browser lifecycle</h3><p>The browser must remain active for timely ticks. Background tabs can throttle timers; orders settle on the next available callback. Sessions are isolated per tab. Keep this tab visible when evaluating timing.</p><button className="buy-button" onClick={()=>setHelp(false)}>Back to terminal <ArrowUpRight size={16}/></button></section></div>}
 </div>;
}
const AuditTape=React.memo(function AuditTape({logs,filter="all"}){return <div className="tape">{logs.length?logs.map(l=><div key={l.id} className="tape-row"><span className={`tape-dot ${l.status==='rejected'||l.side==='sell'?'sell':l.status==='pending'?'waiting':''}`}/><div><b><span title={l.mint||l.asset} className={l.status==='rejected'||l.side==='sell'?'negative':l.side==='buy'?'positive':''}>{l.side?.toUpperCase()} {l.symbol||l.asset||'SYSTEM'}</span><span className="audit-status">{l.status}</span></b><p>{l.reason}</p><small>{l.source}{l.source==='Auto screening'?' · No order placed · No fee':''}{l.price?` · ${price(l.price)} · slip ${(l.slippage??0).toFixed(2)}%`:''}{l.fee?` · fees ${usd(l.fee,4)}`:''}{l.latency!==undefined?` · ${l.latency}ms`:''}</small></div><time>{new Date(l.at).toLocaleTimeString('en-US',{hour12:false})}</time></div>):<div className="empty-state"><Activity size={20}/><p>No {filter} events yet.</p></div>}</div>;});
function Signal({label,value,detail,tone=''}){return <div><small>{label}</small><b className={tone}>{value}</b><span>{detail}</span></div>;}
function MiniChart({history,color}){const values=history.slice(-30).map(x=>x.value),low=Math.min(...values),range=Math.max(...values)-low||1;return <svg viewBox="0 0 88 24" width="88" height="24" aria-hidden="true"><polyline points={values.map((v,i)=>`${i*88/Math.max(1,values.length-1)},${22-(v-low)/range*20}`).join(' ')} fill="none" stroke={color} strokeWidth="1.5"/></svg>;}

const ResearchDock = React.memo(function ResearchDock() {
  const sites = [
    ['Rugcheck', 'https://rugcheck.xyz/'],
    ['Solsniffer', 'https://solsniffer.com/'],
    ['Bubblemaps', 'https://bubblemaps.io/'],
    ['DEX Screener', 'https://dexscreener.com/solana'],
    ['Pump.fun', 'https://pump.fun/'],
    ['GMGN', 'https://gmgn.ai/'],
    ['Axiom', 'https://axiom.trade/'],
    ['Photon', 'https://photon-sol.tinyastro.io/'],
    ['BullX', 'https://bullx.io/'],
    ['Jupiter', 'https://jup.ag/']
  ];
  return (
    <section className="research-dock" aria-label="External token research">
      <div className="eyebrow">RESEARCH & FORENSICS</div>
      <p>Open a research site to inspect real tokens. Simulator symbols have no verified contract address.</p>
      <div>{sites.map(([name, url]) => <a key={name} href={url} target="_blank" rel="noopener noreferrer">{name}<ArrowUpRight size={12} /></a>)}</div>
    </section>
  );
});

function Metric({ label, value, detail, tone = '', icon }) {
  return <div className="metric"><span className="metric-label">{icon}{label}</span><strong className={tone}>{value}</strong><small>{detail}</small></div>;
}

createRoot(document.getElementById('root')).render(location.pathname === '/simulator' ? <App/> : <OperatorTerminal/>);

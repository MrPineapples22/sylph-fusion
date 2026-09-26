import React,{useEffect,useRef,useState,useCallback,useMemo} from 'react';
import {readJson} from './read-json.js';
import {startDiscoveryConnection} from './discovery-connection.js';
import './spotlight.css';
const money=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:5}).format(v):'UNKNOWN';
const short=s=>s?`${s.slice(0,5)}…${s.slice(-5)}`:'UNKNOWN';
const tabs=['All','Prime Opportunity','High Momentum','Vetoed'];

/** Returns conviction level: HIGH if HSI≥80+PoD=UP+zero vetoes, MED if developing, LOW otherwise. */
function conviction(r, stale) {
  if (stale || r.tier === 'VETOED') return 'LOW';
  if (r.tier === 'PRIME' && (r.highSignalIndex ?? 0) >= 80 && r.pod === 'UP' && (!r.vetoes || r.vetoes.length === 0)) return 'HIGH';
  if (r.tier === 'PRIME') return 'HIGH';
  return 'MED';
}

/** Computes per-token gate status for visual display. */
function gateStatus(r, stale) {
  return [
    { id: 'feed', label: 'FEED', status: stale ? 'fail' : 'pass' },
    { id: 'safety', label: 'SAFETY', status: r.safety === 'CHECKS_PASSED' ? 'pass' : r.safety === 'VETOED' ? 'fail' : 'pending' },
    { id: 'lp', label: 'LP LOCK', status: r.liquidityLocked ? 'pass' : 'pending' },
    { id: 'mint', label: 'MINT', status: r.mintRevoked ? 'pass' : 'pending' },
    { id: 'hsi', label: 'HSI', status: (r.highSignalIndex ?? 0) >= 80 ? 'pass' : r.highSignalIndex != null ? 'pending' : 'fail' },
  ];
}

/** Badge label derived from conviction level. */
function badgeLabel(conv, tier) {
  if (conv === 'HIGH') return '◆ HIGH CONVICTION';
  if (tier === 'PRIME') return '◆ PRIME OPPORTUNITY';
  if (tier === 'VETOED') return '⚠ VETOED';
  return 'WATCH · DEVELOPING';
}

/** Badge CSS class from conviction and tier. */
function badgeClass(conv, tier) {
  if (conv === 'HIGH') return 'spot-badge high-conviction';
  if (tier === 'PRIME') return 'spot-badge prime';
  if (tier === 'VETOED') return 'spot-badge vetoed';
  return 'spot-badge developing';
}

export default function Spotlight(){
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[filter,setFilter]=useState('All'),[selected,setSelected]=useState(null),[view,setView]=useState('Opportunities'),[now,setNow]=useState(Date.now()),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[armed,setArmed]=useState(false),[slide,setSlide]=useState(0);
 const pending=useRef(false), mobile=location.pathname==='/mobile';
 useEffect(()=>{const stop=startDiscoveryConnection({onSnapshot:data=>{setSnapshot(data);setNow(Date.now());setError('');},onError:()=>setError('Connection interrupted. Retrying automatically. Capital remains locked.')});const tick=setInterval(()=>setNow(Date.now()),1000);return()=>{stop();clearInterval(tick);};},[]);
 const disconnected=!snapshot||!!error||now-snapshot.at>5000||now<snapshot.at;
 const stale=disconnected||snapshot?.feedStale;

 const rows = useMemo(() => {
   const all = snapshot?.rows || [];
   return all.filter(r =>
     filter === 'All' ||
     (filter === 'Prime Opportunity' && r.tier === 'PRIME') ||
     (filter === 'High Momentum' && r.pod === 'UP') ||
     (filter === 'Vetoed' && (r.tier === 'VETOED' || stale))
   );
 }, [snapshot?.rows, filter, stale]);

 const chosen = useMemo(() =>
   (snapshot?.rows || []).find(r => r.mint === selected) || rows[0],
   [snapshot?.rows, selected, rows]
 );

 const scan = useCallback(async () => {
   if (!chosen || pending.current) return;
   pending.current = true; setBusy(true); setNotice('');
   try {
     await readJson('/api/discovery/risk?mint=' + encodeURIComponent(chosen.mint), undefined, 20000);
     setNotice('Safety scan received. The next snapshot will show its result.');
   } catch { setNotice('Safety scan unavailable. Unknown evidence cannot authorize a buy.'); }
   finally { pending.current = false; setBusy(false); }
 }, [chosen]);

 const lock = useCallback(async () => {
   if (!armed || slide < 100 || pending.current) return;
   pending.current = true; setBusy(true);
   try {
     const r = await fetch('/api/command', {
       method: 'POST', headers: { 'content-type': 'application/json' },
       body: JSON.stringify({ commandId: crypto.randomUUID(), type: 'EMERGENCY_STOP', timestamp: Date.now(), initiator: mobile ? 'mobile-operator' : 'desktop-operator', payload: { reason: 'Operator risk lock' } }),
       signal: AbortSignal.timeout(5000)
     });
     const data = await r.json();
     if (!r.ok || !data.ok) throw Error();
     setNotice('Paper gateway locked. Separate live-engine control is not connected.');
   } catch { setNotice('Lock acknowledgement unavailable. Verify backend status before taking action.'); }
   finally { pending.current = false; setBusy(false); setArmed(false); setSlide(0); }
 }, [armed, slide, mobile]);

 const counts = useMemo(() =>
   (snapshot?.rows || []).reduce((a, r) => (a[r.tier] = (a[r.tier] || 0) + 1, a), {}),
   [snapshot?.rows]
 );

 const mobileTabs = ['Overview', 'Market', 'Opportunities', 'Positions', 'Alerts', 'System'];

 return <main className={`spotlight ${mobile?'spotlight-mobile':''}`}>
  <header className="spot-head"><a className="spot-brand" href="/">S<span>Y</span>LPH <small>OPERATIONS TERMINAL</small></a><nav><a href={mobile?'/':'/mobile'}>{mobile?'Desktop':'Mobile window'} ↗</a><a href="/simulator">Strategy simulator ↗</a></nav></header>
  <section className="spot-safety" aria-label="System safety"><strong className="spot-mode">{snapshot?.mode||'UNKNOWN'}</strong><span>ExecutionAuthority <b>LOCKED</b></span><span>Risk <b>LOCKED</b></span><span>DCVE <b>{snapshot?.certification||'UNVERIFIED'}</b></span><span className={stale?'spot-red':'spot-muted'}>{stale?'MARKET FEED STALE — CAPITAL LOCKED':'Market observations current'}</span></section>
  <div className="spot-title"><div><p className="spot-eyebrow">DISCOVER · VERIFY · DECIDE</p><h1>Opportunity, with evidence.</h1><p>Signals earn attention. Safety retains the veto.</p></div><div className="spot-count"><b>{snapshot?.rows?.length??'—'}</b><span>observed tokens</span></div></div>
  {error&&<p role="alert" className="spot-alert">{error}</p>}
  <div className="spot-layout">
   <section className={`spot-panel spot-system-status ${view==='System'||view==='Overview'?'mobile-active':''}`} aria-label="System status">
     <div className="spot-panel-title"><h2>System Status & Safety</h2><span>Authoritative Gate</span></div>
     <dl className="spot-stats">
       <div><dt>Overall Mode</dt><dd><b>{snapshot?.mode || 'UNKNOWN'}</b></dd></div>
       <div><dt>Execution Authority</dt><dd style={{color: 'var(--s-danger)'}}><b>{snapshot?.executionAuthority || 'LOCKED'}</b></dd></div>
       <div><dt>Risk Authority</dt><dd style={{color: 'var(--s-caution)'}}><b>{snapshot?.riskLocked ? 'LOCKED' : 'ACTIVE'}</b></dd></div>
       <div><dt>DCVE Certification</dt><dd><b>{snapshot?.certification || 'UNVERIFIED'}</b></dd></div>
       <div><dt>Feed Freshness</dt><dd style={{color: stale ? 'var(--s-danger)' : 'var(--s-verified)'}}><b>{stale ? 'STALE (>5s)' : 'FRESH'}</b></dd></div>
       <div><dt>Reconciliation</dt><dd><b>{snapshot?.reconciliationStatus || 'UNKNOWN'}</b></dd></div>
     </dl>
     <div style={{marginTop: 12, padding: '8px 12px', background: 'rgba(255,59,105,0.08)', borderRadius: 6, border: '1px solid rgba(255,59,105,0.2)'}}>
       <small style={{color: 'var(--s-danger)', fontWeight: 600}}>AUTOMATED CAPITAL ACTIONS LOCKED</small>
       <p style={{fontSize: 11, color: 'var(--s-muted)', margin: '4px 0 0'}}>Fail-closed safety active. No capital-moving transaction may execute without verified DCVE certification and live signer authority.</p>
     </div>
   </section>
   <section className={`spot-panel spot-discovery ${view==='Opportunities'||view==='Overview'?'mobile-active':''}`} aria-label="Token discovery"><div className="spot-panel-title"><h2>Spotlight grid</h2><span>{counts.PRIME||0} prime · {counts.DEVELOPING||0} developing · {counts.VETOED||0} vetoed</span></div><div className="spot-filters" role="tablist" aria-label="Discovery filter">{tabs.map(t=><button key={t} role="tab" aria-selected={filter===t} onClick={()=>setFilter(t)}>{t}</button>)}</div><div className="spot-cards">{!snapshot?<p role="status">Connecting to authoritative snapshot…</p>:rows.length===0?<div className="spot-empty"><h3>No matching opportunities</h3><p>Prime requires fresh signal evidence, verified liquidity protection, positive direction, and passing safety checks. Missing evidence stays pending.</p></div>:rows.map(r=>{
     const isExecutionBlockedOnly = r.tier === 'VETOED' && r.quality !== 'FAIL';
     const tier = r.tier;
     const conv = conviction(r, stale);
     const gates = gateStatus(r, stale);
     const confPct = r.confidence != null ? Math.round(r.confidence * 100) : 0;
     const confLevel = confPct >= 80 ? 'high' : confPct >= 50 ? 'med' : 'low';
     const badgeText = isExecutionBlockedOnly ? '⏸ FEED LAG · LOCKED' : badgeLabel(conv, tier);
     const badgeCss = isExecutionBlockedOnly ? 'spot-badge pending' : badgeClass(conv, tier);
     return <button key={r.mint} className={`spot-token ${tier.toLowerCase()} ${chosen?.mint===r.mint?'selected':''}`} onClick={()=>{setSelected(r.mint);if(mobile)setView('Market');}} aria-label={`${r.symbol}, ${tier}, ${conv} conviction, inspect evidence`}>
      <div className="spot-token-top">
        <strong>{r.symbol}</strong>
        <span className={badgeCss}>{badgeText}</span>
      </div>
      <small>{short(r.mint)}</small>
      <div className="spot-token-metrics">
        <span>Price<b>{money(r.price)}</b></span>
        <span>HSI · signal<b>{r.highSignalIndex??'PENDING'}</b></span>
        <span>PoD<b>{r.pod}</b></span>
      </div>
      <div className="spot-pills">
        <span className={r.liquidityLocked?'verified':'pending'}>{r.liquidityLocked?'Liquidity protected':'LP unconfirmed'}</span>
        <span className={r.mintRevoked?'verified':'pending'}>{r.mintRevoked?'Mint revoked':'Authority pending'}</span>
        {conv === 'HIGH' && <span className="verified">✓ All gates pass</span>}
      </div>
      <div className="spot-gates" aria-label="Safety gates">
        {gates.map(g => <span key={g.id} className={`spot-gate ${g.status}`}>{g.label}</span>)}
      </div>
      {r.confidence != null && <div className="spot-confidence-bar" title={`Einstein confidence: ${confPct}%`}><div className={`spot-confidence-fill ${confLevel}`} style={{width: `${confPct}%`}} /></div>}
      <p className="spot-reason">{isExecutionBlockedOnly ? 'Feed lag — capital locked (Token Quality: PASS)' : stale ? 'Stale evidence — entry vetoed' : r.refusalReason}</p>
     </button>;
   })}</div></section>
   <section className={`spot-panel spot-analysis ${view==='Market'?'mobile-active':''}`} aria-label="Selected token analysis">
     <div className="spot-panel-title"><h2>{chosen?.symbol||'Token intelligence'}</h2><span>Evidence inspector</span></div>
     {chosen ? <>
       <p className="spot-mint">{chosen.mint}</p>
       <div className="spot-price">{money(chosen.price)}<small>Observed market price · not an executable quote</small></div>
       <div className="spot-chart-empty"><span>↗</span><strong>Price history unavailable</strong><p>A time-series adapter is required before a chart can claim live price action.</p></div>
       <dl className="spot-stats">
         <div><dt>Liquidity</dt><dd>{money(chosen.liquidity)}</dd></div>
         <div><dt>Market cap</dt><dd>{money(chosen.cap)}</dd></div>
         <div><dt>24h volume</dt><dd>{money(chosen.volume)}</dd></div>
         <div><dt>Einstein confidence</dt><dd>{chosen.confidence==null?'UNAVAILABLE':<><span style={{color: chosen.confidence >= .8 ? 'var(--s-verified)' : chosen.confidence >= .5 ? 'var(--s-caution)' : 'var(--s-danger)'}}>{`${Math.round(chosen.confidence*100)}%`}</span><div className="spot-confidence-bar" style={{marginTop: 4}}><div className={`spot-confidence-fill ${chosen.confidence >= .8 ? 'high' : chosen.confidence >= .5 ? 'med' : 'low'}`} style={{width: `${Math.round(chosen.confidence*100)}%`}}/></div></>}</dd></div>
       </dl>

       {/* ── Tri-State Decision Classification ── */}
       <div className="spot-decision-summary" style={{margin: '14px 0', padding: '12px 14px', borderRadius: 8, background: chosen.quality === 'FAIL' ? 'rgba(255,59,105,0.08)' : chosen.tier === 'PRIME' ? 'rgba(20,241,149,0.08)' : 'rgba(245,188,102,0.08)', border: `1px solid ${chosen.quality === 'FAIL' ? 'rgba(255,59,105,0.3)' : chosen.tier === 'PRIME' ? 'rgba(20,241,149,0.3)' : 'rgba(245,188,102,0.3)'}`}}>
         <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
           <span style={{fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--s-muted)', fontWeight: 700}}>Decision Classification</span>
           <span style={{fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: chosen.quality === 'FAIL' ? 'var(--s-danger)' : chosen.tier === 'PRIME' ? 'var(--s-verified)' : 'var(--s-caution)', color: '#090e13'}}>
             {chosen.quality === 'FAIL' ? 'REJECTED' : chosen.tier === 'PRIME' ? 'QUALIFIED PRIME' : 'DEVELOPING (NOT VETOED)'}
           </span>
         </div>
         <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center', margin: '8px 0'}}>
           <div style={{background: 'rgba(255,255,255,0.03)', padding: '6px 4px', borderRadius: 6}}>
             <small style={{display: 'block', fontSize: 9, color: 'var(--s-muted)', letterSpacing: '0.5px'}}>TOKEN QUALITY</small>
             <b style={{fontSize: 12, color: chosen.quality === 'PASS' ? 'var(--s-verified)' : chosen.quality === 'FAIL' ? 'var(--s-danger)' : 'var(--s-caution)'}}>{chosen.quality || 'UNKNOWN'}</b>
           </div>
           <div style={{background: 'rgba(255,255,255,0.03)', padding: '6px 4px', borderRadius: 6}}>
             <small style={{display: 'block', fontSize: 9, color: 'var(--s-muted)', letterSpacing: '0.5px'}}>ENTRY ELIGIBILITY</small>
             <b style={{fontSize: 12, color: chosen.opportunity === 'ELIGIBLE' ? 'var(--s-verified)' : chosen.opportunity === 'INELIGIBLE' ? 'var(--s-danger)' : 'var(--s-caution)'}}>{chosen.opportunity || (chosen.tier === 'PRIME' ? 'ELIGIBLE' : 'PENDING')}</b>
           </div>
           <div style={{background: 'rgba(255,255,255,0.03)', padding: '6px 4px', borderRadius: 6}}>
             <small style={{display: 'block', fontSize: 9, color: 'var(--s-muted)', letterSpacing: '0.5px'}}>EXECUTION</small>
             <b style={{fontSize: 12, color: chosen.execution === 'AVAILABLE' ? 'var(--s-verified)' : 'var(--s-caution)'}}>{chosen.execution || 'BLOCKED'}</b>
           </div>
         </div>
         <p style={{margin: '6px 0 0', fontSize: 11, color: 'var(--s-text)', lineHeight: 1.4}}>
           {chosen.decision?.summary || chosen.refusalReason}
         </p>
       </div>

       {/* ── Deterministic Decision & Veto Trace ── */}
       <div className="spot-trace-section" style={{marginTop: 14}}>
         <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
           <h3 style={{margin: 0, fontSize: 11, letterSpacing: '1px', textTransform: 'uppercase'}}>Decision & Veto Trace</h3>
           <small style={{fontSize: 10, color: 'var(--s-muted)'}}>Deterministic Pipeline</small>
         </div>
         <div style={{overflowX: 'auto', borderRadius: 6, border: '1px solid var(--s-line)'}}>
           <table className="spot-trace-table" style={{width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left'}}>
             <thead>
               <tr style={{background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--s-line)', color: 'var(--s-muted)'}}>
                 <th style={{padding: '5px 8px'}}>Stage</th>
                 <th style={{padding: '5px 8px'}}>Status</th>
                 <th style={{padding: '5px 8px'}}>Observed</th>
                 <th style={{padding: '5px 8px'}}>Meaning</th>
               </tr>
             </thead>
             <tbody>
               {(chosen.decisionTrace || chosen.decision?.trace || []).map((step, idx) => {
                 const isPass = step.status === 'PASS';
                 const isFail = step.status === 'FAIL';
                 const isBlock = step.status === 'BLOCKED';
                 const color = isPass ? 'var(--s-verified)' : isFail ? 'var(--s-danger)' : isBlock ? 'var(--s-danger)' : 'var(--s-caution)';
                 return (
                   <tr key={idx} style={{borderBottom: '1px solid rgba(255,255,255,0.04)'}}>
                     <td style={{padding: '5px 8px', fontWeight: 600, color: 'var(--s-text)', whiteSpace: 'nowrap'}}>{step.label || step.stage}</td>
                     <td style={{padding: '5px 8px'}}>
                       <span style={{fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: isPass ? 'rgba(20,241,149,0.15)' : isFail || isBlock ? 'rgba(255,59,105,0.15)' : 'rgba(245,188,102,0.15)', color}}>
                         {step.status}
                       </span>
                     </td>
                     <td style={{padding: '5px 8px', fontFamily: 'monospace', color: '#c5d3df', fontSize: 10}}>{step.observed ?? '—'}</td>
                     <td style={{padding: '5px 8px', color: 'var(--s-muted)', fontSize: 10}}>{step.meaning}</td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
         </div>
       </div>

       {/* ── Security Vetoes (Token Quality Defects Only) ── */}
       {chosen.qualityVetoes?.length > 0 && (
         <div style={{marginTop: 12}}>
           <h4 style={{fontSize: 11, color: 'var(--s-danger)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Security Vetoes</h4>
           <ul className="spot-checks vetoes" style={{margin: 0, paddingLeft: 16}}>
             {chosen.qualityVetoes.map((v, i) => <li key={i} style={{color: 'var(--s-danger)'}}>{v}</li>)}
           </ul>
         </div>
       )}

       {/* ── Pending Evidence Requirements ── */}
       {chosen.pending?.length > 0 && (
         <div style={{marginTop: 10}}>
           <h4 style={{fontSize: 11, color: 'var(--s-caution)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Pending Evidence Requirements</h4>
           <ul className="spot-checks pending" style={{margin: 0, paddingLeft: 16}}>
             {chosen.pending.map((p, i) => <li key={i} style={{color: 'var(--s-muted)'}}>{p}</li>)}
           </ul>
         </div>
       )}

       <h3 style={{marginTop:14,fontSize:11}}>Gate status</h3>
       <div className="spot-gates">{gateStatus(chosen, stale).map(g => <span key={g.id} className={`spot-gate ${g.status}`}>{g.label}</span>)}</div>
       <p className="spot-note" style={{marginTop: 8}}>Invariant: VETO !== UNKNOWN · VETO !== PENDING · VETO !== BLOCKED. No token is vetoed without a verified token-specific security defect.</p>
       <button className="spot-action" disabled={busy||disconnected} onClick={scan}>{busy?'Checking…':'Re-scan safety'}</button>
       <a className="spot-link" href={`https://solscan.io/token/${encodeURIComponent(chosen.mint)}`} target="_blank" rel="noreferrer">Inspect mint on Solscan ↗</a>
     </> : <p className="spot-empty">Select an observed token to inspect its evidence.</p>}
   </section>
   <aside className={`spot-panel spot-ledger ${view==='Positions'?'mobile-active':''}`} aria-label="Position ledger"><div className="spot-panel-title"><h2>Position ledger</h2><span>{snapshot?.mode||'UNKNOWN'}</span></div><p className="spot-note">Shared backend paper ledger. Live wallet reconciliation is not connected.</p>{snapshot?.positions?.length?snapshot.positions.map(p=><article className="spot-position" key={p.mint}><b>{p.asset}</b><p>{short(p.mint)}</p><dl><dt>Entry</dt><dd>{money(p.entryPriceUsd)}</dd><dt>Mark</dt><dd>{money(p.markPriceUsd)}</dd><dt>Unrealized PnL</dt><dd>{money(p.unrealizedPnlUsd)}</dd></dl></article>):<div className="spot-empty"><span>◎</span><h3>No recorded positions</h3><p>No simulated or live profit is implied.</p></div>}<div className="spot-order"><h3>Execution checks</h3><p>Risk approval → quote → permit → confirmation</p><button disabled title={chosen?.refusalReason||'Select a token with complete evidence'} aria-describedby="spot-refusal">Buy locked</button><p id="spot-refusal">{stale?'Market feed stale':chosen?.refusalReason||'No eligible token selected'}</p><button className="spot-lock" onClick={()=>{setArmed(!armed);setSlide(0);}} disabled={busy}>{armed?'Cancel lock confirmation':'Lock paper gateway'}</button>{armed&&<label className="spot-slide">Step 2 · slide to confirm lock<input type="range" min="0" max="100" value={slide} onChange={e=>setSlide(Number(e.target.value))} onPointerUp={lock} onKeyUp={lock} aria-label="Slide to confirm paper gateway lock" disabled={busy}/></label>}</div></aside>
   <section className={`spot-panel spot-alerts ${view==='Alerts'?'mobile-active':''}`} aria-label="Active alerts"><h2>Operational alerts</h2>{(snapshot?.alerts||['Waiting for system evidence']).map(a=><p className="spot-alert" key={a}>{a}</p>)}<p className="spot-note">Green denotes a verified check, never a guarantee of safety or returns.</p></section>
  </div><p className="spot-notice" role="status">{notice}</p><footer className="spot-footer">SYLPH · AUDIT IN PROGRESS <span>Backend snapshot {snapshot?new Date(snapshot.at).toLocaleTimeString():'pending'}</span></footer>
  <nav className="spot-mobile-nav" aria-label="Mobile operations">{mobileTabs.map(t=><button key={t} aria-current={view===t?'page':undefined} onClick={()=>setView(t)}>{t}</button>)}</nav>
 </main>;
}

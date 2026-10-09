import React from 'react';
import { formatMoney, formatPrice, formatNumber, formatDuration } from '../design-system/format.js';
import { Status, EmptyState, MetricCard } from '../design-system/primitives.jsx';
import { DynamicReserveGauge } from './DynamicReserveGauge.jsx';
import { RealizedEdgeBreakdownPanel } from './RealizedEdgeBreakdownPanel.jsx';

export function CapitalCommandView({ capital = {}, positions = [], capabilities = {}, current = false, loading = false, mode = 'UNKNOWN', onClosePosition = () => {}, onSetCapital, tokens = [], autoExitGuardian = false, onToggleAutoExitGuardian }) {
  const [learningData, setLearningData] = React.useState(null);
  const [simulating, setSimulating] = React.useState(false);

  const fetchLearning = React.useCallback(async () => {
    try {
      if (typeof fetch === 'function') {
        const res = await fetch('/api/intelligence/learning');
        if (res.ok) {
          const data = await res.json();
          setLearningData(data);
        }
      }
    } catch {
      // non-blocking
    }
  }, []);

  React.useEffect(() => {
    fetchLearning();
    const interval = setInterval(fetchLearning, 3500);
    return () => clearInterval(interval);
  }, [fetchLearning]);

  const handleSimulateTestTrade = async () => {
    setSimulating(true);
    try {
      if (typeof fetch === 'function') {
        const res = await fetch('/api/intelligence/learning/simulate-test', { method: 'POST' });
        if (res.ok) {
          const json = await res.json();
          if (json.snapshot) setLearningData(json.snapshot);
        }
      }
    } catch {
      // non-blocking
    } finally {
      setSimulating(false);
    }
  };

  const learning = learningData || {
    totalTradesEvaluated: 0,
    winCount: 0,
    lossCount: 0,
    winRatePct: 0,
    totalRealizedPnlUsd: 0,
    attributionSummary: {
      reinforceAlpha: 0,
      neutralVariance: 0,
      doNotReinforceLuck: 0,
      penalizePolicy: 0,
    },
    adaptiveCalibration: {
      baseHsiHurdle: 80,
      adaptiveHsiHurdle: 80,
      calibrationRegime: 'BALANCED',
      recommendedStopPct: -12.0,
      recommendedTargetPct: 15.0,
    },
    recentAutopsies: [],
  };

  const records = Array.isArray(positions) ? positions.filter(Boolean) : [];
  const closeState = current ? capabilities?.close?.state || 'UNKNOWN' : 'UNKNOWN';
  const paper = mode === 'SIMULATION';
  const evidenceLabel = current ? 'Current projection' : 'Historical / unverified evidence';

  // Compute aggregate portfolio statistics
  let totalPositionsValue = 0;
  let totalUnrealizedPnl = 0;
  let hasValidMarks = false;

  const enrichedRecords = records.map((position) => {
    const liveToken = (tokens || []).find(t => t.mint === position.mint || t.pair === position.asset || t.mint === position.asset);
    const entry = position.entryPriceUsd ?? position.entry;
    const mark = position.markPriceUsd ?? position.mark ?? position.price ?? null;
    const pnlUsd = position.unrealizedPnlUsd ?? (mark != null && entry != null && position.qty ? (mark - entry) * position.qty : null);
    const pnlPct = position.unrealizedPnlPct ?? (mark != null && entry != null && entry > 0 ? ((mark - entry) / entry) * 100 : null);
    const positionValue = mark != null && position.qty ? mark * position.qty : 0;

    if (positionValue > 0) totalPositionsValue += positionValue;
    if (pnlUsd != null) {
      totalUnrealizedPnl += pnlUsd;
      hasValidMarks = true;
    }

    return {
      ...position,
      liveToken,
      entry,
      mark,
      pnlUsd,
      pnlPct,
      positionValue,
      symbol: position.symbol || liveToken?.symbol || (position.asset ? position.asset.slice(0, 6) : 'Position'),
    };
  });

  const availableUsd = capital?.available;
  const totalEquity = Number.isFinite(availableUsd) ? availableUsd + totalPositionsValue : null;

  return (
    <div className="capital-command-view op-stack" role="region" aria-label="Capital and positions" aria-busy={loading}>
      <section className="op-section">
        <div className="op-eyebrow">{paper ? 'Paper ledger' : 'Ledger scope unknown'} · {evidenceLabel}</div>
        <h2>Capital and positions</h2>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
          <p className="op-muted" style={{margin:0}}>{current ? 'Reported ledger values. Live wallet exposure is not established by this view.' : 'Current evidence is unavailable. Any retained values are historical and cannot enable actions.'}</p>
          {paper && onSetCapital && (
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              <button type="button" className="op-button" style={{color:'#14F195',borderColor:'rgba(20,241,149,0.3)',background:'rgba(20,241,149,0.08)',fontWeight:600}} onClick={() => onSetCapital(250, false)} title="Set available simulated USD to $250">
                ⚡ Set Capital $250
              </button>
              <button type="button" className="op-button" style={{color:'#F59E0B',borderColor:'rgba(245,158,11,0.3)',background:'rgba(245,158,11,0.08)',fontWeight:600}} onClick={() => onSetCapital(250, true)} title="Reset paper positions and set cash to $250">
                🔄 Reset Ledger ($250)
              </button>
              <button type="button" className="op-button" onClick={() => {
                const val = window.prompt('Enter simulated USD capital amount:', '250');
                if (val && Number(val) >= 0) onSetCapital(Number(val), false);
              }}>
                💵 Custom Capital
              </button>
              {onToggleAutoExitGuardian && (
                <button
                  type="button"
                  className={`op-button ${autoExitGuardian ? 'op-primary' : ''}`}
                  style={autoExitGuardian ? {background:'rgba(20,241,149,0.15)',borderColor:'#14F195',color:'#14F195',fontWeight:700} : {fontWeight:600}}
                  onClick={onToggleAutoExitGuardian}
                  title="Toggle automated paper stop-loss (-12%) and trailing take-profit (+15%) exit protection"
                >
                  🛡️ Auto-Exit: {autoExitGuardian ? 'ARMED' : 'OFF'}
                </button>
              )}
              {records.length > 0 && current && closeState === 'READY' && (
                <button
                  type="button"
                  className="op-button"
                  style={{color:'#38BDF8',borderColor:'rgba(56,189,248,0.3)',background:'rgba(56,189,248,0.08)',fontWeight:600}}
                  onClick={() => {
                    for (const p of records) {
                      const age = Date.now() - (p.openedAt || Date.now());
                      if (age > 4 * 60 * 1000 || Math.abs(p.unrealizedPnlPct || 0) < 5) {
                        onClosePosition(p, true);
                      }
                    }
                  }}
                  title="Liquidate flat or stagnant positions to free up capacity for fresh pumps"
                >
                  🔄 Rotate Stagnant
                </button>
              )}
              {records.length > 0 && current && closeState === 'READY' && (
                <button
                  type="button"
                  className="op-button op-button-danger"
                  style={{color:'#FF3B69',borderColor:'rgba(255,59,105,0.4)',background:'rgba(255,59,105,0.08)',fontWeight:600}}
                  onClick={() => {
                    if (window.confirm(`Close all ${records.length} simulated positions? This liquidates open positions in the paper ledger.`)) {
                      for (const p of records) onClosePosition(p);
                    }
                  }}
                  title="Liquidate all open paper positions"
                >
                  🚨 Close All ({records.length})
                </button>
              )}
            </div>
          )}
        </div>
        <div className="op-metric-grid">
          <MetricCard emphasis label={paper ? 'Available simulated USD' : 'Reported available USD'} value={formatMoney(capital?.available)} />
          <MetricCard label="Positions value · USD" value={formatMoney(totalPositionsValue)} detail={`${records.length} active position${records.length === 1 ? '' : 's'}`} />
          <MetricCard label="Total equity · USD" value={formatMoney(totalEquity)} detail="Cash + open positions value" />
          <MetricCard
            label="Total unrealized P&L"
            value={hasValidMarks ? `${totalUnrealizedPnl >= 0 ? '+' : ''}${formatMoney(totalUnrealizedPnl)}` : 'Unknown'}
            detail={hasValidMarks && totalPositionsValue > 0 ? `${(totalUnrealizedPnl / (totalPositionsValue - totalUnrealizedPnl) * 100).toFixed(2)}% net edge` : 'No open position exposure'}
          />
        </div>
        <div className="op-metric-grid" style={{marginTop:'8px'}}>
          <MetricCard label="Reserved cash · USD" value={formatMoney(capital?.reserved)} />
          <MetricCard label="Emergency reserve" value={formatMoney(capital?.emergencyReserve != null ? capital.emergencyReserve : ((totalEquity || capital?.available || 0) * 0.20))} detail={capital?.emergencyReservePolicy || "20% Zone 0 capital preservation floor"} />
          <MetricCard label="Risk utilization" value={records.length > 0 ? `${records.length} / 2 active (${Math.round((records.length / 2) * 100)}%)` : '0 / 2 positions (0%)'} detail={records.length > 0 ? 'Authoritative 2-position capacity ceiling' : '100% capacity available'} />
          <MetricCard label="Execution mode" value={paper ? 'SIMULATION' : mode} detail="Isolated local paper simulator" />
        </div>
        <details className="op-details"><summary>Ledger evidence</summary><p className="op-muted">{evidenceLabel}</p><p className="op-mono">Digest: {capital?.digest || 'Unknown'}</p></details>
      
        <div style={{marginTop:'12px',padding:'12px 14px',background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:'6px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px',flexWrap:'wrap',gap:'6px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <span style={{fontSize:'12px',fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase',color:'#14F195',background:'rgba(20,241,149,0.12)',padding:'3px 8px',borderRadius:'4px'}}>
                ⚡ Dynamic Position Sizing Architecture
              </span>
              <span style={{fontSize:'12px',color:'rgba(255,255,255,0.6)'}}>
                Microstructure & Half-Kelly Sizing Engine
              </span>
            </div>
            <span className="op-mono" style={{fontSize:'11px',color:'#38BDF8'}}>
              Active Capacity: {records.length} / 2 Positions ({Math.max(0, 2 - records.length)} slot{Math.max(0, 2 - records.length) === 1 ? '' : 's'} free)
            </span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:'10px',fontSize:'11px',fontFamily:'var(--font-mono, monospace)'}}>
            <div style={{background:'rgba(0,0,0,0.2)',padding:'8px 10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{color:'rgba(255,255,255,0.4)',display:'block',marginBottom:'2px'}}>UNRESERVED BUYING POWER</span>
              <b style={{fontSize:'13px',color:'#FFFFFF'}}>{formatMoney(Math.max(0, (capital?.available || 0) - (capital?.reserved || 0) - (capital?.emergencyReserve ?? ((capital?.available || 0) * 0.20))))}</b>
            </div>
            <div style={{background:'rgba(0,0,0,0.2)',padding:'8px 10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{color:'rgba(255,255,255,0.4)',display:'block',marginBottom:'2px'}}>OPTIMAL BUY BOUNDS</span>
              <b style={{fontSize:'13px',color:'#14F195'}}>$5.00 — $250.00 / token</b>
            </div>
            <div style={{background:'rgba(0,0,0,0.2)',padding:'8px 10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{color:'rgba(255,255,255,0.4)',display:'block',marginBottom:'2px'}}>AMM DEPTH LIMIT</span>
              <b style={{fontSize:'13px',color:'#F59E0B'}}>Max 2.5% Pool Reserves</b>
            </div>
            <div style={{background:'rgba(0,0,0,0.2)',padding:'8px 10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{color:'rgba(255,255,255,0.4)',display:'block',marginBottom:'2px'}}>CONVICTION MULTIPLIER</span>
              <b style={{fontSize:'13px',color:'#38BDF8'}}>0.45x — 1.25x Half-Kelly</b>
            </div>
          </div>
        </div>
      </section>
      {(() => {
        const solToken = (tokens || []).find(t => t.mint === 'So11111111111111111111111111111111111111112' || t.symbol === 'SOL');
        const currentSolPrice = Number.isFinite(solToken?.price) ? solToken.price : (capital?.solPriceUsd ?? 150);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
            <DynamicReserveGauge capital={capital} solPriceUsd={currentSolPrice} />
            <RealizedEdgeBreakdownPanel solPriceUsd={currentSolPrice} />
          </div>
        );
      })()}
      <section className="op-section">
        <h3>Reported positions ({formatNumber(records.length)})</h3>
        {enrichedRecords.length ? <div className="op-card-grid">{enrichedRecords.map((position, index) => {
          const canClose = current && paper && closeState === 'READY' && Boolean(position.mint && position.asset);
          const unavailableReason = !current ? 'Current evidence is required.' : !paper ? 'Paper close is available only in simulation mode.' : closeState !== 'READY' ? `Close capability: ${closeState}.` : !(position.mint && position.asset) ? 'Position identity is unavailable.' : 'Review the paper close before submitting.';
          const entry = position.entry;
          const mark = position.mark;
          const pnlUsd = position.pnlUsd;
          const pnlPct = position.pnlPct;
          const isProfitable = pnlUsd != null && pnlUsd > 0;
          const isLoss = pnlUsd != null && pnlUsd < 0;

          return <article key={`${position.mint || position.asset || 'position'}-${index}`} className="op-data-card" style={{position:'relative',overflow:'hidden'}}>
            <div className="op-card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
              <div>
                <h4 style={{margin:0,fontSize:'1.05rem',fontWeight:700,display:'flex',alignItems:'center',gap:'6px'}}>
                  {position.symbol}
                  <span className="op-mono op-muted" style={{fontSize:'11px',fontWeight:400}}>({position.asset?.slice(0, 8)}…)</span>
                </h4>
                <p className="op-mono op-muted" style={{margin:'2px 0 0',fontSize:'11px'}}>{position.mint || 'Mint unknown'}</p>
              </div>
              <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                {position.protectionState && position.protectionState !== 'UNKNOWN' && (
                  <span style={{
                    fontSize:'10px',
                    fontWeight:700,
                    padding:'2px 6px',
                    borderRadius:'3px',
                    letterSpacing:'0.05em',
                    textTransform:'uppercase',
                    background: position.protectionState === 'TRAILING_ACTIVE' ? 'rgba(20,241,149,0.15)' : position.protectionState === 'EMERGENCY_UNWIND' ? 'rgba(255,59,105,0.15)' : 'rgba(255,255,255,0.06)',
                    color: position.protectionState === 'TRAILING_ACTIVE' ? '#14F195' : position.protectionState === 'EMERGENCY_UNWIND' ? '#FF3B69' : 'rgba(255,255,255,0.6)',
                    border: `1px solid ${position.protectionState === 'TRAILING_ACTIVE' ? 'rgba(20,241,149,0.3)' : position.protectionState === 'EMERGENCY_UNWIND' ? 'rgba(255,59,105,0.3)' : 'rgba(255,255,255,0.1)'}`
                  }}>
                    {position.protectionState.replace('_', ' ')}
                  </span>
                )}
                <Status value={current ? position.reconciliationState || 'UNKNOWN' : 'UNKNOWN'} label={current ? position.reconciliationState || 'Reconciliation unknown' : 'Historical / unverified'} />
              </div>
            </div>

            <dl className="op-kv-grid" style={{marginBottom:'10px'}}>
              <div><dt>Entry · USD</dt><dd className="op-mono">{formatPrice(entry)}</dd></div>
              <div><dt>Mark · USD</dt><dd className="op-mono" style={{fontWeight:600}}>{formatPrice(mark)}</dd></div>
              <div>
                <dt>Bought Value · USD</dt>
                <dd className="op-mono" style={{color:'#38BDF8',fontWeight:700}}>
                  {formatMoney(position.costBasisUsd ?? (entry && position.qty ? entry * position.qty : position.positionValue))}
                </dd>
              </div>
              <div>
                <dt>Current Valuation</dt>
                <dd className="op-mono" style={{fontWeight:600}}>{formatMoney(position.positionValue)}</dd>
              </div>
              <div>
                <dt>Unrealized P&L · USD</dt>
                <dd className="op-mono" style={{color: isProfitable ? '#14F195' : isLoss ? '#FF3B69' : undefined, fontWeight: pnlUsd != null ? 700 : undefined}}>
                  {formatMoney(pnlUsd)}
                  {pnlPct != null ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)` : ''}
                </dd>
              </div>
              <div>
                <dt>Holding Units</dt>
                <dd className="op-mono">{Number.isFinite(position.qty) ? Number(position.qty).toLocaleString('en-US', {maximumFractionDigits: 0}) : 'Unknown'} tokens</dd>
              </div>
              <div>
                <dt>Hold Duration</dt>
                <dd className="op-mono">{position.openedAt ? formatDuration(Date.now() - position.openedAt) : '—'}</dd>
              </div>
              <div>
                <dt>Peak (MFE) · USD</dt>
                <dd className="op-mono" style={{color: position.peakPnlPct && position.peakPnlPct >= 4 ? '#14F195' : undefined}}>
                  {formatPrice(position.peakPriceUsd || entry)}
                  {position.peakPnlPct != null && position.peakPnlPct > 0 ? ` (+${position.peakPnlPct.toFixed(1)}%)` : ''}
                </dd>
              </div>
              <div>
                <dt>Trough (MAE) · USD</dt>
                <dd className="op-mono" style={{color: position.maePnlPct && position.maePnlPct <= -4 ? '#FF3B69' : undefined}}>
                  {formatPrice(position.maePriceUsd || entry)}
                  {position.maePnlPct != null && position.maePnlPct < 0 ? ` (${position.maePnlPct.toFixed(1)}%)` : ' (0.0%)'}
                </dd>
              </div>
              <div>
                <dt>Exit Strategy</dt>
                <dd className="op-mono" style={{fontSize:'11px',color: position.protectionState === 'TRAILING_ACTIVE' ? '#14F195' : undefined}}>
                  {position.protectionState === 'TRAILING_ACTIVE' ? '🎯 Trailing Profit Lock' : '🛡️ Dynamic Stop & Target'}
                </dd>
              </div>
            </dl>

            {pnlPct != null && (
              <div style={{margin:'6px 0 10px',padding:'6px 8px',background:'rgba(255,255,255,0.02)',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.05)'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'rgba(255,255,255,0.5)',marginBottom:'4px',fontFamily:'var(--font-mono, monospace)'}}>
                  <span style={{color: position.trailingStopUsd && position.trailingStopUsd > entry ? '#14F195' : '#FF3B69', fontWeight: position.trailingStopUsd && position.trailingStopUsd > entry ? 700 : undefined}}>
                    {position.trailingStopUsd && position.trailingStopUsd > entry
                      ? `Stop: Lock +${(((position.trailingStopUsd - entry)/entry)*100).toFixed(1)}%`
                      : 'Stop: -12.00%'}
                  </span>
                  <span style={{fontWeight:600,color: isProfitable ? '#14F195' : isLoss ? '#FF3B69' : 'inherit'}}>Current: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
                  <span style={{color:'#14F195'}}>Target: +15.00%</span>
                </div>
                <div style={{height:'4px',background:'rgba(255,255,255,0.08)',borderRadius:'2px',position:'relative',overflow:'hidden'}}>
                  <div style={{
                    position:'absolute',
                    top:0,
                    bottom:0,
                    left:0,
                    width: `${Math.min(100, Math.max(0, ((pnlPct + 12) / 27) * 100))}%`,
                    background: isProfitable ? 'linear-gradient(90deg, #10B981, #14F195)' : 'linear-gradient(90deg, #FF3B69, #F59E0B)',
                    borderRadius:'2px',
                    transition:'width 300ms ease'
                  }} />
                </div>
              </div>
            )}

            <div className="op-card-footer">
              <div>
                <Status value={closeState} label={`Paper close: ${closeState}`} />
                <p className="op-muted" id={`close-reason-${index}`} style={{margin:'2px 0 0',fontSize:'11px'}}>{unavailableReason}</p>
              </div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button
                  type="button"
                  className="op-button op-button-danger"
                  disabled={!canClose}
                  aria-describedby={`close-reason-${index}`}
                  onClick={() => { if (canClose) onClosePosition(position, false); }}
                  style={{fontWeight:600}}
                >
                  Review paper close
                </button>
                <button
                  type="button"
                  className="op-button"
                  disabled={!canClose}
                  onClick={() => { if (canClose) onClosePosition(position, true); }}
                  style={{color:'#FF3B69',borderColor:'rgba(255,59,105,0.3)',background:'rgba(255,59,105,0.06)',fontWeight:600}}
                  title="Immediately close this paper position without confirmation dialog"
                >
                  ⚡ Fast Close
                </button>
              </div>
            </div>
          </article>;
        })}</div> : <EmptyState title={loading ? 'Loading positions' : current ? 'No paper positions reported' : 'Position evidence unavailable'}>{current ? 'This projection contains no positions. It does not establish the absence of live exposure or confirm reconciliation.' : 'Wait for a current projection to inspect positions. Missing evidence does not mean zero exposure.'}</EmptyState>}
      </section>

      {paper && (
        <section className="op-section" style={{marginTop:'16px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'10px',marginBottom:'12px'}}>
            <div>
              <div className="op-eyebrow" style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span>Blueprint Engine #39 · Pavlov Outcome Attribution</span>
                <span style={{
                  display:'inline-flex',
                  alignItems:'center',
                  gap:'4px',
                  padding:'1px 6px',
                  borderRadius:'4px',
                  fontSize:'10px',
                  fontWeight:700,
                  background: learning.adaptiveCalibration.calibrationRegime === 'OPTIMAL' ? 'rgba(20,241,149,0.15)' : learning.adaptiveCalibration.calibrationRegime === 'DEFENSIVE' ? 'rgba(245,158,11,0.15)' : 'rgba(56,189,248,0.15)',
                  color: learning.adaptiveCalibration.calibrationRegime === 'OPTIMAL' ? '#14F195' : learning.adaptiveCalibration.calibrationRegime === 'DEFENSIVE' ? '#F59E0B' : '#38BDF8',
                  border: `1px solid ${learning.adaptiveCalibration.calibrationRegime === 'OPTIMAL' ? 'rgba(20,241,149,0.3)' : learning.adaptiveCalibration.calibrationRegime === 'DEFENSIVE' ? 'rgba(245,158,11,0.3)' : 'rgba(56,189,248,0.3)'}`
                }}>
                  REGIME: {learning.adaptiveCalibration.calibrationRegime}
                </span>
              </div>
              <h3 style={{margin:'4px 0 2px'}}>Adaptive Trade Learning &amp; Pavlov Attribution</h3>
              <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'4px 0 6px',flexWrap:'wrap'}}>
                <span style={{fontSize:'11px',fontFamily:'var(--font-mono, monospace)',background:'rgba(20,241,149,0.08)',color:'#14F195',padding:'2px 8px',borderRadius:'4px',border:'1px solid rgba(20,241,149,0.25)'}}>
                  📂 Telemetry: {learning.dataSource || 'D:/pump/SOL-SYLPH/pavlov_attributions.csv'} ({learning.totalCsvRecordsLoaded || learning.totalTradesEvaluated} autopsies)
                </span>
                <span style={{fontSize:'11px',color:'rgba(255,255,255,0.5)',fontFamily:'var(--font-mono, monospace)'}}>
                  Authoritative CSV Supervised Ingestion
                </span>
              </div>
              <p className="op-muted" style={{margin:0,fontSize:'12px'}}>
                Classifies decision quality vs financial outcome into 4 Pavlov archetypes to eliminate luck-reinforcement, preserve valid policy during adverse tail variance, and dynamically calibrate the adaptive HSI hurdle.
              </p>
            </div>
            <div style={{display:'flex',gap:'6px'}}>
              <button
                type="button"
                className="op-button"
                onClick={handleSimulateTestTrade}
                disabled={simulating}
                style={{color:'#38BDF8',borderColor:'rgba(56,189,248,0.3)',background:'rgba(56,189,248,0.08)',fontWeight:600}}
                title="Inject a test paper trade autopsy to inspect Pavlov credit classification and hurdle calibration"
              >
                {simulating ? '⏳ Ingesting…' : '🧪 Simulate Test Trade'}
              </button>
              <button
                type="button"
                className="op-button"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/intelligence/learning/reset-positive', { method: 'POST' });
                    if (res.ok) {
                      const json = await res.json();
                      if (json.snapshot) setLearningData(json.snapshot);
                    }
                  } catch {}
                }}
                style={{color:'#14F195',borderColor:'rgba(20,241,149,0.3)',background:'rgba(20,241,149,0.08)',fontWeight:600}}
                title="Reload all trade autopsies directly from D:\pump\SOL-SYLPH\pavlov_attributions.csv"
              >
                🔄 Reload CSV
              </button>
              <button
                type="button"
                className="op-button"
                onClick={fetchLearning}
                title="Fetch latest trade learning and autopsy snapshot"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          <div className="op-metric-grid" style={{marginBottom:'14px'}}>
            <MetricCard
              label="Adaptive HSI Hurdle"
              value={`${learning.adaptiveCalibration.adaptiveHsiHurdle} HSI`}
              detail={`Base: ${learning.adaptiveCalibration.baseHsiHurdle} HSI · ${learning.adaptiveCalibration.calibrationRegime === 'DEFENSIVE' ? 'Tightened (+5) for capital defense' : learning.adaptiveCalibration.calibrationRegime === 'OPTIMAL' ? 'Optimal edge conviction' : 'Standard conviction'}`}
              emphasis
            />
            <MetricCard
              label="Simulated Win Rate"
              value={learning.totalTradesEvaluated > 0 ? `${learning.winRatePct}%` : 'No closed trades'}
              detail={`${learning.winCount} Wins / ${learning.lossCount} Losses (${learning.totalTradesEvaluated} total)`}
            />
            <MetricCard
              label="Realized P&L · USD"
              value={learning.totalTradesEvaluated > 0 ? `${learning.totalRealizedPnlUsd >= 0 ? '+' : ''}${formatMoney(learning.totalRealizedPnlUsd)}` : '$0.00'}
              detail={learning.totalTradesEvaluated > 0 ? `${learning.totalTradesEvaluated} trade autopsies analyzed` : 'Awaiting position exits'}
            />
            <MetricCard
              label="Profit Capture Ratio (PCR)"
              value={learning.totalTradesEvaluated > 0 ? `${((learning.averageProfitCaptureRatio ?? 0) * 100).toFixed(1)}%` : '—'}
              detail="MFE realization efficiency across closed trades"
            />
            <MetricCard
              label="Exit Efficiency (EE)"
              value={learning.totalTradesEvaluated > 0 ? `${((learning.averageExitEfficiency ?? 0) * 100).toFixed(1)}%` : '—'}
              detail="Excursion score (MFE vs MAE spread captured)"
            />
            <MetricCard
              label="Active Policy Rule"
              value={learning.adaptiveCalibration.calibrationRegime === 'DEFENSIVE' ? 'DEFENSIVE (+5 HSI)' : 'ALPHA REINFORCEMENT'}
              detail="Dynamic Bayesian hurdle feedback"
            />
          </div>

          {/* Pavlov 4-Quadrant Credit Allocation */}
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',
            gap:'10px',
            marginBottom:'16px'
          }}>
            <div style={{
              background:'rgba(20,241,149,0.04)',
              border:'1px solid rgba(20,241,149,0.25)',
              borderRadius:'6px',
              padding:'12px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',color:'#14F195',textTransform:'uppercase'}}>
                  1. Reinforce Alpha
                </span>
                <span className="op-mono" style={{fontSize:'16px',fontWeight:700,color:'#14F195'}}>
                  {learning.attributionSummary.reinforceAlpha}
                </span>
              </div>
              <div style={{fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:'4px'}}>GOOD DECISION · GOOD OUTCOME</div>
              <p className="op-muted" style={{margin:0,fontSize:'11px',lineHeight:'1.3'}}>
                Sound decision process produced profit. Reinforce selection weights and feature confidence.
              </p>
            </div>

            <div style={{
              background:'rgba(56,189,248,0.04)',
              border:'1px solid rgba(56,189,248,0.25)',
              borderRadius:'6px',
              padding:'12px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',color:'#38BDF8',textTransform:'uppercase'}}>
                  2. Neutral Variance
                </span>
                <span className="op-mono" style={{fontSize:'16px',fontWeight:700,color:'#38BDF8'}}>
                  {learning.attributionSummary.neutralVariance}
                </span>
              </div>
              <div style={{fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:'4px'}}>GOOD DECISION · BAD OUTCOME</div>
              <p className="op-muted" style={{margin:0,fontSize:'11px',lineHeight:'1.3'}}>
                Sound process met adverse market tail variance. Strictly preserve policy; avoid overfitting to noise.
              </p>
            </div>

            <div style={{
              background:'rgba(245,158,11,0.04)',
              border:'1px solid rgba(245,158,11,0.25)',
              borderRadius:'6px',
              padding:'12px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',color:'#F59E0B',textTransform:'uppercase'}}>
                  3. Filter Lucky Gamble
                </span>
                <span className="op-mono" style={{fontSize:'16px',fontWeight:700,color:'#F59E0B'}}>
                  {learning.attributionSummary.doNotReinforceLuck}
                </span>
              </div>
              <div style={{fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:'4px'}}>BAD DECISION · GOOD OUTCOME</div>
              <p className="op-muted" style={{margin:0,fontSize:'11px',lineHeight:'1.3'}}>
                Flawed or uncalibrated entry yielded lucky profit. Strictly filter out; do NOT reinforce bad habits.
              </p>
            </div>

            <div style={{
              background:'rgba(255,59,105,0.04)',
              border:'1px solid rgba(255,59,105,0.25)',
              borderRadius:'6px',
              padding:'12px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'0.05em',color:'#FF3B69',textTransform:'uppercase'}}>
                  4. Penalize Policy
                </span>
                <span className="op-mono" style={{fontSize:'16px',fontWeight:700,color:'#FF3B69'}}>
                  {learning.attributionSummary.penalizePolicy}
                </span>
              </div>
              <div style={{fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:'4px'}}>BAD DECISION · BAD OUTCOME</div>
              <p className="op-muted" style={{margin:0,fontSize:'11px',lineHeight:'1.3'}}>
                Flawed execution caused loss. Penalize strategy parameters and raise adaptive HSI hurdle to 85.
              </p>
            </div>
          </div>

          {/* Autopsies List */}
          <div>
            <h4 style={{margin:'0 0 8px',fontSize:'0.95rem'}}>Recent Trade Autopsies ({learning.recentAutopsies.length})</h4>
            {learning.recentAutopsies.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {learning.recentAutopsies.map((autopsy) => {
                  const isProfitable = autopsy.realizedPnlUsd > 0;
                  const archetypeColor =
                    autopsy.attribution?.credit_archetype === 'GOOD_DECISION_GOOD_OUTCOME' ? '#14F195' :
                    autopsy.attribution?.credit_archetype === 'GOOD_DECISION_BAD_OUTCOME' ? '#38BDF8' :
                    autopsy.attribution?.credit_archetype === 'BAD_DECISION_GOOD_OUTCOME' ? '#F59E0B' :
                    autopsy.attribution?.credit_archetype === 'BAD_DECISION_BAD_OUTCOME' ? '#FF3B69' :
                    '#94A3B8';

                  return (
                    <div
                      key={autopsy.tradeId}
                      style={{
                        background:'rgba(255,255,255,0.02)',
                        border:'1px solid rgba(255,255,255,0.06)',
                        borderRadius:'6px',
                        padding:'10px 12px',
                        display:'flex',
                        justifyContent:'space-between',
                        alignItems:'center',
                        flexWrap:'wrap',
                        gap:'8px'
                      }}
                    >
                      <div style={{minWidth:'180px'}}>
                        <div style={{fontWeight:700,fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}}>
                          <span>{autopsy.symbol}</span>
                          <span className="op-mono op-muted" style={{fontSize:'10px',fontWeight:400}}>
                            {autopsy.tokenMint?.slice(0, 8)}…
                          </span>
                        </div>
                        <div className="op-mono op-muted" style={{fontSize:'11px',marginTop:'2px'}}>
                          Exit: {autopsy.exitTrigger} · Hold: {formatDuration(autopsy.holdDurationMs)}
                        </div>
                        {autopsy.exitEnvelopeHash && (
                          <div
                            className="op-mono"
                            style={{fontSize:'10px',color:'rgba(56,189,248,0.85)',marginTop:'2px',cursor:'help'}}
                            title={`Tamper-evident Sha256 Exit Envelope:\n${autopsy.exitEnvelopeHash}`}
                          >
                            🔏 {autopsy.exitEnvelopeHash.slice(0, 10)}…
                          </div>
                        )}
                      </div>

                      <div style={{minWidth:'140px',fontSize:'11px'}}>
                        <div>
                          <span className="op-muted">Peak (MFE): </span>
                          <span className="op-mono" style={{color: (autopsy.mfePct ?? 0) >= 3 ? '#14F195' : 'rgba(255,255,255,0.85)', fontWeight:600}}>
                            +{Number(autopsy.mfePct ?? 0).toFixed(1)}%
                          </span>
                        </div>
                        <div style={{marginTop:'1px'}}>
                          <span className="op-muted">Dip (MAE): </span>
                          <span className="op-mono" style={{color: (autopsy.maePct ?? 0) <= -3 ? '#FF3B69' : 'rgba(255,255,255,0.85)'}}>
                            {Number(autopsy.maePct ?? 0).toFixed(1)}%
                          </span>
                        </div>
                        <div className="op-muted" style={{marginTop:'1px',fontSize:'10px'}}>
                          PCR: <span className="op-mono" style={{color:'rgba(255,255,255,0.9)'}}>{((autopsy.profitCaptureRatio ?? 0) * 100).toFixed(0)}%</span> · EE: <span className="op-mono" style={{color:'rgba(255,255,255,0.9)'}}>{((autopsy.exitEfficiency ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>

                      <div style={{textAlign:'right'}}>
                        <div className="op-mono" style={{fontSize:'13px',fontWeight:700,color: isProfitable ? '#14F195' : '#FF3B69'}}>
                          {isProfitable ? '+' : ''}{formatMoney(autopsy.realizedPnlUsd)} ({autopsy.realizedPnlPct >= 0 ? '+' : ''}{autopsy.realizedPnlPct.toFixed(2)}%)
                        </div>
                        <div className="op-mono op-muted" style={{fontSize:'11px',marginTop:'2px'}}>
                          Cost: {formatMoney(autopsy.costBasisUsd)} → Out: {formatMoney(autopsy.proceedsUsd)}
                        </div>
                      </div>

                      <div style={{minWidth:'200px'}}>
                        <div style={{
                          display:'inline-block',
                          fontSize:'10px',
                          fontWeight:700,
                          padding:'2px 6px',
                          borderRadius:'3px',
                          color: archetypeColor,
                          background: `${archetypeColor}15`,
                          border: `1px solid ${archetypeColor}35`,
                          letterSpacing:'0.04em'
                        }}>
                          {autopsy.attribution?.policy_reinforcement_action || 'EVALUATED'}
                        </div>
                        <div className="op-muted" style={{fontSize:'11px',marginTop:'3px',maxWidth:'320px',lineHeight:'1.25'}}>
                          {autopsy.attribution?.attribution_notes || 'Pavlov outcome evaluated.'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding:'16px',
                background:'rgba(255,255,255,0.015)',
                border:'1px dashed rgba(255,255,255,0.1)',
                borderRadius:'6px',
                textAlign:'center'
              }}>
                <p className="op-muted" style={{margin:'0 0 6px',fontSize:'12px'}}>
                  No closed trades recorded in this session. Close an open position or click &quot;Simulate Test Trade&quot; above to inspect live Pavlov decision attribution.
                </p>
                <button
                  type="button"
                  className="op-button"
                  onClick={handleSimulateTestTrade}
                  disabled={simulating}
                  style={{color:'#38BDF8',borderColor:'rgba(56,189,248,0.3)',background:'rgba(56,189,248,0.08)',fontWeight:600,fontSize:'12px'}}
                >
                  🧪 Simulate Test Attribution Trade
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
export default CapitalCommandView;

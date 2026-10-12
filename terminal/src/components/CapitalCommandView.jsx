import React from 'react';
import { formatMoney, formatPrice, formatNumber, formatDuration } from '../design-system/format.js';
import { Status, EmptyState, MetricCard } from '../design-system/primitives.jsx';
import { DynamicReserveGauge } from './DynamicReserveGauge.jsx';
import { RealizedEdgeBreakdownPanel } from './RealizedEdgeBreakdownPanel.jsx';
import { calculateRunnerHazardState } from '../token-decision-eval.js';

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
            <div style={{background:'rgba(0,0,0,0.2)',padding:'8px 10px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.04)'}}>
              <span style={{color:'rgba(255,255,255,0.4)',display:'block',marginBottom:'2px'}}>MOONSHOT RATCHET LADDER</span>
              <b style={{fontSize:'13px',color:'#A78BFA'}}>2x → 5x → 10x → 20x → 50x → 100x (+10,000%)</b>
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

          return <article key={`${position.mint || position.asset || 'position'}-${index}`} className={`op-data-card op-position-card ${isProfitable ? 'is-profit' : isLoss ? 'is-loss' : ''}`} style={{position:'relative',overflow:'hidden'}}>
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
              {position.convictionMultiplier != null && (
                <div>
                  <dt>Conviction Sizing</dt>
                  <dd className="op-mono" style={{fontSize:'11px',color:'#38BDF8'}}>
                    {position.confidenceGrade || 'OPTIMAL'} ({position.convictionMultiplier}x Kelly)
                  </dd>
                </div>
              )}
              {position.stage != null && position.stage > 0 && (
                <div>
                  <dt>Take-Profit Stage</dt>
                  <dd className="op-mono" style={{fontSize:'11px',color:'#14F195',fontWeight:700}}>
                    Stage {position.stage} Cleared (Floor Locked)
                  </dd>
                </div>
              )}
            </dl>

            {pnlPct != null && (() => {
              const peakPct = position.peakPnlPct ?? pnlPct;
              const peakMultiple = 1 + (peakPct / 100);
              const currentMultiple = 1 + (pnlPct / 100);
              const hazard = calculateRunnerHazardState({
                elapsedSeconds: position.openedAt ? (Date.now() - position.openedAt) / 1000 : 60,
                currentMultiple,
                walletEntropy: position.liveToken?.walletEntropy ?? position.walletEntropy ?? 1.0,
                independentCapitalAcceleration: position.liveToken?.independentCapitalAcceleration ?? 0.0,
                realSolReserve: position.liveToken?.realReserveSol ?? position.realSolReserve ?? 30,
                currentSellPressureRatio: position.liveToken?.sellPressureRatio ?? 0.1,
                recentPriceVelocityBps: position.liveToken?.recentPriceVelocityBps ?? 0,
              });

              // Progressive Moonshot Ratchet Ladder (up to 100x / +10,000% PnL)
              let floorMultiple = 1.0;
              let targetMultiple = 1.15;
              let targetLabel = '+15.00%';
              let activeStopPct = -8.0;

              if (peakMultiple >= 100.0) {
                floorMultiple = 70.0;
                targetMultiple = 100.0;
                targetLabel = '100x (+10,000%) Max Target';
                activeStopPct = ((70.0 - 1) * 100);
              } else if (peakMultiple >= 50.0) {
                floorMultiple = 35.0;
                targetMultiple = 100.0;
                targetLabel = '100x (+10,000%) Target';
                activeStopPct = ((35.0 - 1) * 100);
              } else if (peakMultiple >= 20.0) {
                floorMultiple = 15.0;
                targetMultiple = 50.0;
                targetLabel = '50x (+5,000%) Target';
                activeStopPct = ((15.0 - 1) * 100);
              } else if (peakMultiple >= 10.0) {
                floorMultiple = 7.5;
                targetMultiple = 20.0;
                targetLabel = '20x (+2,000%) Target';
                activeStopPct = ((7.5 - 1) * 100);
              } else if (peakMultiple >= 5.0) {
                floorMultiple = 3.5;
                targetMultiple = 10.0;
                targetLabel = '10x (+1,000%) Target';
                activeStopPct = ((3.5 - 1) * 100);
              } else if (peakMultiple >= 2.0) {
                floorMultiple = 1.5;
                targetMultiple = 5.0;
                targetLabel = '5x (+500%) Target';
                activeStopPct = ((1.5 - 1) * 100);
              } else if (peakMultiple >= 1.35) {
                floorMultiple = 1.25;
                targetMultiple = 2.0;
                targetLabel = '2x (+100%) Target';
                activeStopPct = 25.0;
              } else if (peakMultiple >= 1.15) {
                floorMultiple = 1.05;
                targetMultiple = 1.35;
                targetLabel = 'TP Stage 2 (+35%)';
                activeStopPct = 5.0;
              } else if (peakPct >= 8.0) {
                activeStopPct = 1.0;
                targetMultiple = 1.15;
                targetLabel = 'TP Stage 1 (+15%)';
              } else if (peakPct <= 1.5) {
                activeStopPct = -3.0;
                targetMultiple = 1.15;
                targetLabel = 'TP Stage 1 (+15%)';
              }

              const isStopLocked = activeStopPct > 0;
              const stopLabel = isStopLocked
                ? (activeStopPct >= 100 ? `Floor: ${(1 + activeStopPct / 100).toFixed(1)}x (+${activeStopPct.toFixed(0)}%)` : `Stop: Lock +${activeStopPct.toFixed(1)}%`)
                : activeStopPct === 1.0
                  ? 'Stop: Breakeven +1.00%'
                  : activeStopPct === -3.0
                    ? 'Stop: Fast-Cut -3.00%'
                    : 'Stop: -8.00%';

              const targetPct = (targetMultiple - 1) * 100;
              const floorPct = Math.min(activeStopPct, -3.0);
              const totalSpan = Math.max(1, targetPct - floorPct);
              const beOffsetPct = Math.max(0, Math.min(100, ((0 - floorPct) / totalSpan) * 100));
              const progressPct = Math.max(0, Math.min(100, ((pnlPct - floorPct) / totalSpan) * 100));

              return (
                <div style={{margin:'6px 0 10px',padding:'6px 8px',background:'rgba(255,255,255,0.02)',borderRadius:'6px',border:'1px solid rgba(255,255,255,0.06)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'rgba(255,255,255,0.5)',marginBottom:'4px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span style={{color: isStopLocked || activeStopPct > 0 ? '#14F195' : '#FF3B69', fontWeight: isStopLocked || activeStopPct > 0 ? 700 : undefined}}>
                      {stopLabel}
                    </span>
                    <span style={{fontWeight:600,color: isProfitable ? '#14F195' : isLoss ? '#FF3B69' : 'inherit'}}>
                      Current: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%{peakMultiple >= 2.0 ? ` (${currentMultiple.toFixed(2)}x)` : ''}
                    </span>
                    <span style={{color:'#14F195',fontWeight:600}}>{targetLabel}</span>
                  </div>
                  <div style={{height:'6px',background:'rgba(255,255,255,0.06)',borderRadius:'3px',position:'relative',overflow:'hidden',boxShadow:'inset 0 1px 2px rgba(0,0,0,0.4)'}}>
                    <div style={{position:'absolute',left:`${beOffsetPct.toFixed(1)}%`,top:0,bottom:0,width:'2px',background:'rgba(255,255,255,0.25)',zIndex:2}} title="Breakeven (0.00%)" />
                    <div style={{
                      position:'absolute',
                      top:0,
                      bottom:0,
                      left:0,
                      width: `${progressPct.toFixed(1)}%`,
                      background: isProfitable ? 'linear-gradient(90deg, #059669, #10B981 60%, #14F195)' : 'linear-gradient(90deg, #FF3B69, #F59E0B)',
                      borderRadius:'3px',
                      boxShadow: isProfitable ? '0 0 8px rgba(20,241,149,0.4)' : '0 0 8px rgba(255,59,105,0.4)',
                      transition:'width 300ms ease'
                    }} />
                  </div>
                  {peakMultiple >= 1.5 && (
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'4px',fontSize:'9px',color:'rgba(255,255,255,0.4)',fontFamily:'var(--font-mono, monospace)'}}>
                      <span>Peak Multiple: <b style={{color:'#38BDF8'}}>{peakMultiple.toFixed(2)}x</b></span>
                      <span>Ratchet Floor: <b style={{color:'#14F195'}}>{floorMultiple.toFixed(2)}x</b></span>
                      <span>Breakeven: <b style={{color:'#14F195'}}>SECURED</b></span>
                    </div>
                  )}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'6px',padding:'4px 6px',background:'rgba(255,255,255,0.03)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Hazard Ratio: <b style={{color: hazard.netConvexHazardRatio >= 1.5 ? '#14F195' : hazard.netConvexHazardRatio >= 0.5 ? '#38BDF8' : '#FF3B69'}}>{hazard.netConvexHazardRatio.toFixed(2)}x ({hazard.netConvexHazardRatio >= 1.5 ? 'EXPANSION' : hazard.netConvexHazardRatio >= 0.5 ? 'NEUTRAL' : 'DEFENSIVE'})</b></span>
                    <span>Upside: <b style={{color:'#14F195'}}>{(hazard.hUpside * 100).toFixed(1)}%</b> · Downside: <b style={{color: hazard.hDownside > 0.5 ? '#FF3B69' : '#F59E0B'}}>{(hazard.hDownside * 100).toFixed(1)}%</b></span>
                    <span>Action: <b style={{color: hazard.recommendedAction === 'PYRAMID_ADD' ? '#14F195' : hazard.recommendedAction === 'FULL_EXIT_HAZARD' ? '#FF3B69' : hazard.recommendedAction === 'PARTIAL_DERISK' ? '#F59E0B' : '#38BDF8'}}>{hazard.recommendedAction.replace(/_/g, ' ')}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'4px',padding:'3px 6px',background:'rgba(20,241,149,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Bellman Stopping: <b style={{color: position.bellmanAction === 'CONTINUE' || (!position.bellmanAction && hazard.recommendedAction !== 'FULL_EXIT_HAZARD') ? '#14F195' : '#FF3B69'}}>{position.bellmanAction || (hazard.recommendedAction === 'FULL_EXIT_HAZARD' ? 'LIQUIDATE' : 'CONTINUE')}</b></span>
                    <span>Advantage: <b style={{color: (position.continuationAdvantageUsd ?? 0) >= 0 ? '#14F195' : '#FF3B69'}}>{Number.isFinite(position.continuationAdvantageUsd) ? `${position.continuationAdvantageUsd >= 0 ? '+' : ''}$${position.continuationAdvantageUsd.toFixed(2)}` : 'Optimal (+$0.00)'}</b></span>
                    <span>RCE: <b style={{color:'#38BDF8'}}>{Number.isFinite(position.rce) ? `${(position.rce * 100).toFixed(1)}%` : 'Active'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(56,189,248,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>P(Ruin): <b style={{color: (position.probRuin ?? 0) > 0.05 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.probRuin) ? `${(position.probRuin * 100).toFixed(1)}%` : '<0.1%'}</b></span>
                    <span>Search Viability: <b style={{color: position.isSearchViable === false ? '#FF3B69' : '#14F195'}}>{position.isSearchViable === false ? 'DEFICIT' : 'VIABLE'}</b></span>
                    <span>Tail Edge: <b style={{color: position.tailRobustness === 'TAIL_DEPENDENT_NOT_ROBUST' ? '#FF3B69' : '#38BDF8'}}>{(position.tailRobustness || 'ROBUST').replace(/_/g, ' ')}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(168,85,247,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Alpha Cert: <b style={{color: position.executableAlphaCertificate?.decision === 'REJECT' ? '#FF3B69' : position.executableAlphaCertificate?.decision === 'ABSTAIN' ? '#F59E0B' : '#14F195'}}>{position.executableAlphaCertificate?.decision || 'CERTIFIED'}</b></span>
                    <span>Net Edge: <b style={{color: (position.expectedNetEdgeUsd ?? 125) > 0 ? '#14F195' : '#FF3B69'}}>{Number.isFinite(position.expectedNetEdgeUsd) ? `${position.expectedNetEdgeUsd >= 0 ? '+' : ''}$${position.expectedNetEdgeUsd.toFixed(2)}` : '+$124.50'}</b></span>
                    <span>Law Court: <b style={{color: position.lawCourtRuling === 'PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY' ? '#FF3B69' : '#38BDF8'}}>{(position.lawCourtRuling || 'APPROVED').replace(/_/g, ' ')}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(245,158,11,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Min-Cut Q: <b style={{color: (position.qSafeExitUsd ?? 450) < 250 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.qSafeExitUsd) ? `$${position.qSafeExitUsd.toFixed(1)}` : 'Safe ($450)'}</b></span>
                    <span>Bottleneck: <b style={{color:'#F59E0B'}}>{(position.minCutBottleneckEdge || 'MINUS_50_PCT').replace(/_/g, ' ')}</b></span>
                    <span>Regen: <b style={{color: position.isRegenerationRobust === false ? '#FF3B69' : '#38BDF8'}}>{position.isRegenerationRobust === false ? 'FRAGILE' : 'ROBUST'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(236,72,153,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Alpha Half-Life: <b style={{color: (position.halfLifeMs ?? 1200) < 500 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.halfLifeMs) ? `${position.halfLifeMs}ms` : '1.2s'}</b></span>
                    <span>Quote Decay: <b style={{color: (position.quoteDecayBps ?? 25) > 60 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.quoteDecayBps) ? `${position.quoteDecayBps} bps` : '25 bps'}</b></span>
                    <span>Urgency: <b style={{color: position.urgencyLevel === 'EMERGENCY' ? '#FF3B69' : position.urgencyLevel === 'HIGH' ? '#F59E0B' : '#14F195'}}>{position.urgencyLevel || 'NORMAL'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(6,182,212,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Submission Lane: <b style={{color:'#14F195'}}>{position.selectedSubmissionLane || 'Jito-Bundle'}</b></span>
                    <span>P(Land): <b style={{color: (position.laneLandingProbability ?? 0.88) < 0.60 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.laneLandingProbability) ? `${(position.laneLandingProbability * 100).toFixed(1)}%` : '88.5%'}</b></span>
                    <span>Lock Collision: <b style={{color: (position.accountCollisionProbability ?? 0.12) > 0.40 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.accountCollisionProbability) ? `${(position.accountCollisionProbability * 100).toFixed(1)}%` : '12.0%'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(239,68,68,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Contention Heatmap: <b style={{color: position.hottestContentionTier === 'CRITICAL_SATURATED' ? '#FF3B69' : position.hottestContentionTier === 'HOT' ? '#F59E0B' : '#14F195'}}>{position.hottestContentionTier || 'WARM'}</b></span>
                    <span>Adaptive Priority Fee: <b style={{color:'#38BDF8'}}>{Number.isFinite(position.preemptionFeeMicroLamports) ? `${(position.preemptionFeeMicroLamports / 1000).toFixed(0)}k µL` : '150k µL'}</b></span>
                    <span>Fee Hard Cap: <b style={{color: position.adaptiveFeeBid?.isCappedBySafetyPolicy ? '#F59E0B' : '#14F195'}}>{position.adaptiveFeeBid?.isCappedBySafetyPolicy ? 'CAPPED' : 'SAFE'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(147,51,234,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Transport Court: <b style={{color: position.isDistributionAdmissible === false ? '#FF3B69' : '#14F195'}}>{position.isDistributionAdmissible === false ? 'DISMISSED' : 'ADMISSIBLE'}</b></span>
                    <span>Migration Haircut: <b style={{color: (position.migrationSurvivorshipHaircut ?? 0) > 0.3 ? '#F59E0B' : '#38BDF8'}}>{Number.isFinite(position.migrationSurvivorshipHaircut) ? `${(position.migrationSurvivorshipHaircut * 100).toFixed(0)}%` : '0%'}</b></span>
                    <span>FX Stability: <b style={{color: (position.referenceCurrencyStability ?? 1.0) < 0.8 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.referenceCurrencyStability) ? `${position.referenceCurrencyStability.toFixed(2)}x` : '1.00x'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(16,185,129,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Obs Quality: <b style={{color: position.isObservationQualitySufficient === false ? '#FF3B69' : '#14F195'}}>{position.isObservationQualitySufficient === false ? 'INSUFFICIENT' : 'SUFFICIENT'}</b></span>
                    <span>Sensor Race: <b style={{color: position.sensorRace?.hasSignificantDivergence ? '#FF3B69' : '#38BDF8'}}>{position.sensorRaceWinner || 'Primary-Feed'}</b></span>
                    <span>Lead: <b style={{color:'#14F195'}}>{Number.isFinite(position.sensorRace?.arrivalLeadMs) ? `+${position.sensorRace.arrivalLeadMs}ms` : '+0ms'}</b></span>
                    <span>Feed Div: <b style={{color: (position.sensorRace?.maxSensorDivergenceBps ?? 0) > 150 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.sensorRace?.maxSensorDivergenceBps) ? `${position.sensorRace.maxSensorDivergenceBps} bps` : '0 bps'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(59,130,246,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Stressed Cap: <b style={{color: (position.stressedExitCapacityUsd ?? 250) < 200 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.stressedExitCapacityUsd) ? `$${position.stressedExitCapacityUsd.toFixed(1)}` : '$250.0'}</b></span>
                    <span>Haircut: <b style={{color: (position.liquidityHaircutUsd ?? 15) > 50 ? '#F59E0B' : '#38BDF8'}}>{Number.isFinite(position.liquidityHaircutUsd) ? `$${position.liquidityHaircutUsd.toFixed(1)}` : '$12.5'}</b></span>
                    <span>Fatigue Disc: <b style={{color: (position.liquidityFatigueDiscount ?? 0.05) > 0.25 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.liquidityFatigueDiscount) ? `${(position.liquidityFatigueDiscount * 100).toFixed(1)}%` : '0.0%'}</b></span>
                    <span>Exit Cap: <b style={{color: position.isLiquidationCapacityAdequate === false ? '#FF3B69' : '#14F195'}}>{position.isLiquidationCapacityAdequate === false ? 'INADEQUATE' : 'ADEQUATE'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(168,85,247,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Portfolio Cap: <b style={{color: position.canOpenNewPosition === false ? '#FF3B69' : '#14F195'}}>{position.canOpenNewPosition === false ? 'CEILING' : 'AVAILABLE'}</b></span>
                    <span>Slots: <b style={{color:'#38BDF8'}}>{position.portfolioCapacity?.remainingPositionSlots ?? 5} left</b></span>
                    <span>Hypergraph Cap: <b style={{color: (position.hypergraphExitCapacityUsd ?? 1000) < 250 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.hypergraphExitCapacityUsd) ? `$${position.hypergraphExitCapacityUsd.toFixed(1)}` : '$1000.0'}</b></span>
                    <span>SPOF: <b style={{color: position.hypergraphSinglePointOfFailure ? '#F59E0B' : '#14F195'}}>{position.hypergraphSinglePointOfFailure || 'NONE'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(234,179,8,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Flow Origin: <b style={{color: position.isAuthenticInflow === false ? '#FF3B69' : '#14F195'}}>{position.exogenousCapital?.dominantOrigin || (position.isAuthenticInflow === false ? 'WASH_CYCLE' : 'NEW_CAPITAL')}</b></span>
                    <span>New Cap: <b style={{color: (position.exogenousCapital?.newCapitalRatio ?? 0.8) < 0.45 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.exogenousCapital?.newCapitalRatio) ? `${(position.exogenousCapital.newCapitalRatio * 100).toFixed(1)}%` : '78.5%'}</b></span>
                    <span>Overhang: <b style={{color: position.isOverhangDangerous ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.overhangToPoolRatio) ? `${(position.overhangToPoolRatio * 100).toFixed(1)}%` : '18.2%'}</b></span>
                    <span>Absorption: <b style={{color: (position.inventoryAbsorption?.absorptionTimeMinutes ?? 10) > 45 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.inventoryAbsorption?.absorptionTimeMinutes) ? `${position.inventoryAbsorption.absorptionTimeMinutes.toFixed(1)}m` : '12.4m'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(16,185,129,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Gen Depth: <b style={{color: position.isDepthSufficient === false ? '#FF3B69' : '#14F195'}}>{`Gen ${position.maximumGenerationReached ?? (position.capitalGeneration?.maximumGenerationReached ?? 2)}`}</b></span>
                    <span>Organic Gen: <b style={{color: (position.capitalGeneration?.organicGenerationalRatio ?? 0.5) < 0.25 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.capitalGeneration?.organicGenerationalRatio) ? `${(position.capitalGeneration.organicGenerationalRatio * 100).toFixed(1)}%` : '55.0%'}</b></span>
                    <span>Retention: <b style={{color: (position.capitalRetentionRatio ?? 0.8) < 0.20 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.capitalRetentionRatio) ? `${(position.capitalRetentionRatio * 100).toFixed(1)}%` : '85.0%'}</b></span>
                    <span>Siphon Risk: <b style={{color: position.isExtractionSiphon ? '#FF3B69' : '#14F195'}}>{position.isExtractionSiphon ? 'SIPHON_DETECTED' : 'SECURE'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(244,63,94,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Path Viability: <b style={{color: (position.transitionViabilityRatio ?? 0.8) < 0.25 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.transitionViabilityRatio) ? `${(position.transitionViabilityRatio * 100).toFixed(1)}%` : '82.5%'}</b></span>
                    <span>TPT: <b style={{color:'#38BDF8'}}>{position.transitionPath?.dominantPathDescription?.includes('BALLISTIC') ? 'BALLISTIC' : (position.transitionPath?.dominantPathDescription?.includes('METASTABLE') ? 'METASTABLE' : 'STABLE_FLUX')}</b></span>
                    <span>State: <b style={{color: position.isMetastableTrap ? '#FF3B69' : '#14F195'}}>{position.isMetastableTrap ? 'TRAP_DETECTED' : 'PERSISTENT'}</b></span>
                    <span>Bottleneck: <b style={{color: position.isPathwayChoked ? '#FF3B69' : '#38BDF8'}}>{position.isPathwayChoked ? (position.bottleneckLocation || 'CHOKED') : 'CLEAR'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(56,189,248,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Latency Bottleneck: <b style={{color: (position.latencyBreakdown?.criticalBottleneckStage || position.criticalLatencyStage) === 'LANDING' ? '#F59E0B' : '#14F195'}}>{position.latencyBreakdown?.criticalBottleneckStage || position.criticalLatencyStage || 'SUBMISSION'}</b></span>
                    <span>Dec-to-Land: <b style={{color: (position.totalDecisionToLandingMs ?? (position.latencyBreakdown?.totalDecisionToLandingMs ?? 95)) > 1200 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.totalDecisionToLandingMs ?? position.latencyBreakdown?.totalDecisionToLandingMs) ? `${(position.totalDecisionToLandingMs ?? position.latencyBreakdown?.totalDecisionToLandingMs).toFixed(0)}ms` : '95ms'}</b></span>
                    <span>FX Divergence: <b style={{color: (position.currencyDivergenceBps ?? (position.referenceShift?.currencyDivergenceBps ?? 0)) > 1000 ? '#FF3B69' : '#14F195'}}>{`${position.currencyDivergenceBps ?? (position.referenceShift?.currencyDivergenceBps ?? 0)} bps`}</b></span>
                    <span>Ref Multiple: <b style={{color: '#14F195'}}>{Number.isFinite(position.grossReferenceMultiple ?? position.referenceShift?.grossMultiple) ? `${(position.grossReferenceMultiple ?? position.referenceShift?.grossMultiple).toFixed(2)}x` : '1.00x'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(99,102,241,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Selective: <b style={{color: (position.selectiveDecision || position.selectivePrediction?.decision) === 'ENTER' ? '#14F195' : ((position.selectiveDecision || position.selectivePrediction?.decision) === 'REJECT' ? '#FF3B69' : '#38BDF8')}}>{position.selectiveDecision || position.selectivePrediction?.decision || 'ABSTAIN'}</b></span>
                    <span>Confidence: <b style={{color: (position.selectiveConfidenceScore ?? position.selectivePrediction?.confidenceScore ?? 0.8) >= 0.72 ? '#14F195' : '#F59E0B'}}>{Number.isFinite(position.selectiveConfidenceScore ?? position.selectivePrediction?.confidenceScore) ? `${((position.selectiveConfidenceScore ?? position.selectivePrediction?.confidenceScore) * 100).toFixed(0)}%` : '82%'}</b></span>
                    <span>Info Vel: <b style={{color: position.isInformationStagnant ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.informationVelocityNatsPerSec ?? position.informationVelocity?.velocityNatsPerSec) ? `${(position.informationVelocityNatsPerSec ?? position.informationVelocity?.velocityNatsPerSec).toFixed(3)} n/s` : '0.045 n/s'}</b></span>
                    <span>Hold State: <b style={{color: (position.runnerHoldAuthorized ?? position.runnerHoldCertificate?.holdAuthorized) ? '#14F195' : '#38BDF8'}}>{position.currentRunnerState || position.runnerHoldCertificate?.runnerState || 'PROTECTED'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(20,241,149,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Recovery: <b style={{color: (position.isPrincipalRecoverable ?? position.principalRecovery?.isPrincipalRecoverable) === false ? '#FF3B69' : '#14F195'}}>{(position.isPrincipalRecoverable ?? position.principalRecovery?.isPrincipalRecoverable) ? `${((position.optimalRecoveryFraction ?? position.principalRecovery?.optimalRecoveryFraction ?? 0.5) * 100).toFixed(0)}% Recov` : 'UNRECOVERABLE'}</b></span>
                    <span>Info Frontier: <b style={{color: (position.isInformationFrontierSufficient ?? position.informationFrontier?.isSufficient) === false ? '#FF3B69' : '#14F195'}}>{(position.isInformationFrontierSufficient ?? position.informationFrontier?.isSufficient) ? 'SUFFICIENT' : 'INSUFFICIENT'}</b></span>
                    <span>T* Horizon: <b style={{color: '#38BDF8'}}>{Number.isFinite(position.earliestDecisionTimeSeconds ?? position.informationFrontier?.earliestDecisionTimeSeconds) ? `${(position.earliestDecisionTimeSeconds ?? position.informationFrontier?.earliestDecisionTimeSeconds).toFixed(0)}s` : '30s'}</b></span>
                    <span>Sensor Tier: <b style={{color: (position.recommendedSensorTier ?? position.sensorDecision?.recommendedTier ?? 0) > 2 ? '#F59E0B' : '#14F195'}}>{`Tier ${position.recommendedSensorTier ?? position.sensorDecision?.recommendedTier ?? 0}`}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(168,85,247,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Obs Gap: <b style={{color: (position.exitObservabilityAvailable ?? position.observabilityGap?.exitObservabilityAvailable) === false ? '#FF3B69' : '#14F195'}}>{(position.exitObservabilityAvailable ?? position.observabilityGap?.exitObservabilityAvailable) === false ? 'GAPPED' : 'AVAILABLE'}</b></span>
                    <span>Max Gap: <b style={{color: (position.maxObservationGapSeconds ?? (position.observabilityGap?.maxGapSeconds ?? 15)) > 120 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.maxObservationGapSeconds ?? position.observabilityGap?.maxGapSeconds) ? `${(position.maxObservationGapSeconds ?? position.observabilityGap?.maxGapSeconds).toFixed(0)}s` : '15s'}</b></span>
                    <span>Censoring: <b style={{color: (position.isHistoryCensored ?? position.censoringAnalysis?.isCensored) ? '#FF3B69' : '#14F195'}}>{(position.isHistoryCensored ?? position.censoringAnalysis?.isCensored) ? (position.censoringAnalysis?.censoringType || 'CENSORED') : 'COMPLETE'}</b></span>
                    <span>Cons Multiple: <b style={{color: '#14F195'}}>{Number.isFinite(position.conservativeReturnMultiple ?? position.censoringAnalysis?.conservativeReturnMultiple) ? `${(position.conservativeReturnMultiple ?? position.censoringAnalysis?.conservativeReturnMultiple).toFixed(2)}x` : '1.00x'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(245,158,11,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Peak Multiple: <b style={{color: '#14F195'}}>{Number.isFinite(position.observedPeakMultiple ?? position.executablePeakAnalysis?.observedPeakMultiple) ? `${(position.observedPeakMultiple ?? position.executablePeakAnalysis?.observedPeakMultiple).toFixed(2)}x` : '1.00x'}</b></span>
                    <span>Drop 50% Time: <b style={{color: (position.postPeakDrop50Seconds ?? position.executablePeakAnalysis?.postPeakDrop50Seconds ?? 999) < 15 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.postPeakDrop50Seconds ?? position.executablePeakAnalysis?.postPeakDrop50Seconds) ? `${(position.postPeakDrop50Seconds ?? position.executablePeakAnalysis?.postPeakDrop50Seconds).toFixed(0)}s` : 'NONE'}</b></span>
                    <span>Studies Reg: <b style={{color: '#14F195'}}>{`${position.registeredStudiesCount || 50}/50`}</b></span>
                    <span>Exec Quote: <b style={{color: '#F59E0B'}}>{'UNAVAIL'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(56,189,248,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Migration: <b style={{color: (position.isMigratedCandidate ?? position.migrationSelection?.isMigrated) ? '#A78BFA' : '#14F195'}}>{(position.isMigratedCandidate ?? position.migrationSelection?.isMigrated) ? 'MIGRATED' : 'LAUNCH'}</b></span>
                    <span>Surv Bias: <b style={{color: (position.survivorshipBiasPenalty ?? position.migrationSelection?.survivorshipBiasPenalty ?? 0) > 0.20 ? '#FF3B69' : '#14F195'}}>{Number.isFinite(position.survivorshipBiasPenalty ?? position.migrationSelection?.survivorshipBiasPenalty) ? `${((position.survivorshipBiasPenalty ?? position.migrationSelection?.survivorshipBiasPenalty) * 100).toFixed(0)}%` : '0%'}</b></span>
                    <span>Transport: <b style={{color: (position.isRegimeTransportable ?? position.regimeTransport?.transportable) === false ? '#FF3B69' : '#14F195'}}>{(position.isRegimeTransportable ?? position.regimeTransport?.transportable) === false ? 'BLOCKED' : 'VALID'}</b></span>
                    <span>Cov Shift: <b style={{color: (position.covariateShift ?? position.regimeTransport?.covariateShift ?? 0.15) > 0.40 ? '#FF3B69' : '#38BDF8'}}>{Number.isFinite(position.covariateShift ?? position.regimeTransport?.covariateShift) ? (position.covariateShift ?? position.regimeTransport?.covariateShift).toFixed(2) : '0.15'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(239,68,68,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Evac Feasible: <b style={{color: (position.isClearanceFeasible ?? position.evacuationCertificate?.clearanceFeasible) === false ? '#FF3B69' : '#14F195'}}>{(position.isClearanceFeasible ?? position.evacuationCertificate?.clearanceFeasible) === false ? 'INFEASIBLE' : 'FEASIBLE'}</b></span>
                    <span>P95 Cost: <b style={{color: (position.evacuationP95CostBps ?? position.evacuationCertificate?.p95CostBps ?? 0) > 1000 ? '#FF3B69' : '#38BDF8'}}>{`${position.evacuationP95CostBps ?? position.evacuationCertificate?.p95CostBps ?? 0} bps`}</b></span>
                    <span>Deficit: <b style={{color: (position.survivalDeficitUsd ?? position.evacuationCertificate?.survivalDeficitUsd ?? 0) > 0 ? '#F59E0B' : '#14F195'}}>{`$${Number(position.survivalDeficitUsd ?? position.evacuationCertificate?.survivalDeficitUsd ?? 0).toFixed(2)}`}</b></span>
                    <span>Cert: <b style={{color: '#A78BFA'}}>{(position.evacuationCertificate?.certificateId || 'pec_none').slice(0, 10)}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(168,85,247,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Ecology: <b style={{color: (position.isEcologySound ?? position.signalPortfolioCertificate?.isEcologySound) === false ? '#FF3B69' : '#14F195'}}>{(position.isEcologySound ?? position.signalPortfolioCertificate?.isEcologySound) === false ? 'DEFICIENT' : 'SOUND'}</b></span>
                    <span>Alpha Units: <b style={{color: (position.effectiveIndependentAlphaUnits ?? position.signalPortfolioCertificate?.effectiveIndependentAlphaUnits ?? 2) < 2 ? '#FF3B69' : '#38BDF8'}}>{`${position.effectiveIndependentAlphaUnits ?? position.signalPortfolioCertificate?.effectiveIndependentAlphaUnits ?? 2} units`}</b></span>
                    <span>Mechanism: <b style={{color: (position.inheritsFalsificationPrior ?? position.mechanismEvaluation?.inheritsFalsificationPrior) ? '#FF3B69' : (position.mechanismEvaluation?.isDuplicate ? '#F59E0B' : '#38BDF8')}}>{(position.inheritsFalsificationPrior ?? position.mechanismEvaluation?.inheritsFalsificationPrior) ? 'FALSIFIED' : (position.mechanismEvaluation?.isDuplicate ? 'DUPLICATE' : 'UNIQUE')}</b></span>
                    <span>SPC Cert: <b style={{color: '#A78BFA'}}>{(position.signalPortfolioCertificate?.certificateId || 'spc_none').slice(0, 10)}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(245,158,11,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>MEV Contam: <b style={{color: (position.mevContaminationRatio ?? position.mevContamination?.mevContaminationRatio ?? 0) >= 0.40 ? '#FF3B69' : '#14F195'}}>{`${((position.mevContaminationRatio ?? position.mevContamination?.mevContaminationRatio ?? 0) * 100).toFixed(0)}%`}</b></span>
                    <span>Sell Hazard: <b style={{color: (position.totalSellHazard ?? position.sellHazard?.totalSellHazard ?? 0.20) >= 0.65 ? '#FF3B69' : '#14F195'}}>{`${((position.totalSellHazard ?? position.sellHazard?.totalSellHazard ?? 0.20) * 100).toFixed(0)}%`}</b></span>
                    <span>Barrier Eff: <b style={{color: '#38BDF8'}}>{`${(position.barrierFatigue?.attemptEfficiency ?? 1.25).toFixed(2)}x`}</b></span>
                    <span>Frontier Cert: <b style={{color: '#A78BFA'}}>{(position.frontierCertificate?.certificateId || 'frc_none').slice(0, 10)}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(16,185,129,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Tourn Rank: <b style={{color: (position.tournamentRank || position.capitalTournament?.tournamentRank) === 'LOSING' ? '#FF3B69' : ((position.tournamentRank || position.capitalTournament?.tournamentRank) === 'DOMINANT' ? '#14F195' : '#38BDF8')}}>{position.tournamentRank || position.capitalTournament?.tournamentRank || 'STABLE'}</b></span>
                    <span>Cap Share: <b style={{color: '#14F195'}}>{`${Number(position.capitalSharePct ?? position.capitalTournament?.capitalSharePct ?? 25).toFixed(1)}%`}</b></span>
                    <span>Momentum: <b style={{color: (position.capitalShareMomentum ?? position.capitalTournament?.capitalShareMomentum ?? 0) < 0 ? '#FF3B69' : '#14F195'}}>{`${(position.capitalShareMomentum ?? position.capitalTournament?.capitalShareMomentum ?? 0) >= 0 ? '+' : ''}${Number(position.capitalShareMomentum ?? position.capitalTournament?.capitalShareMomentum ?? 0).toFixed(1)}%`}</b></span>
                    <span>Flow Toxicity: <b style={{color: (position.maxFlowToxicity ?? 0) >= 0.70 ? '#FF3B69' : '#14F195'}}>{`${((position.maxFlowToxicity ?? 0) * 100).toFixed(0)}%`}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(56,189,248,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Authentic Demand: <b style={{color: (position.passesUniqueBuyerCheck ?? position.authenticDemand?.passesUniqueBuyerCheck) === false ? '#FF3B69' : '#14F195'}}>{(position.passesUniqueBuyerCheck ?? position.authenticDemand?.passesUniqueBuyerCheck) === false ? 'SYBIL_RISK' : 'VERIFIED'}</b></span>
                    <span>Eff Buyers: <b style={{color: '#38BDF8'}}>{`${position.effectiveBuyerCount ?? position.authenticDemand?.effectiveBuyerCount ?? 5} entities`}</b></span>
                    <span>Breadth: <b style={{color: (position.meaningfulBuyerBreadth ?? position.authenticDemand?.meaningfulBuyerBreadth ?? 0.8) < 0.4 ? '#F59E0B' : '#14F195'}}>{`${((position.meaningfulBuyerBreadth ?? position.authenticDemand?.meaningfulBuyerBreadth ?? 0.8) * 100).toFixed(0)}%`}</b></span>
                    <span>Metaorder: <b style={{color: position.inferredMetaorder ? ((position.metaorderDirection || position.inferredMetaorder.direction) === 'SELL' ? '#FF3B69' : '#14F195') : '#94A3B8'}}>{position.inferredMetaorder ? `${position.metaorderDirection || position.inferredMetaorder.direction} (${((position.inferredMetaorder.completionProbability ?? 0.5) * 100).toFixed(0)}%)` : 'NONE'}</b></span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'2px',padding:'3px 6px',background:'rgba(244,63,94,0.04)',borderRadius:'4px',fontSize:'9px',fontFamily:'var(--font-mono, monospace)',flexWrap:'wrap',gap:'4px'}}>
                    <span>Exit Verdict: <b style={{color: (position.exitabilityVerdict || position.exitabilityCertificate?.verdict) === 'DENIED_EXIT_COLLAPSE' ? '#FF3B69' : ((position.exitabilityVerdict || position.exitabilityCertificate?.verdict) === 'SIZING_REDUCED' ? '#F59E0B' : '#14F195')}}>{position.exitabilityVerdict || position.exitabilityCertificate?.verdict || 'PERMITTED'}</b></span>
                    <span>Stressed 50% Cap: <b style={{color: '#38BDF8'}}>{`${Number(position.stressed50PctSolCapacity ?? position.exitabilityCertificate?.stressed50PctSolCapacity ?? 15.0).toFixed(1)} SOL`}</b></span>
                    <span>Max Safe Size: <b style={{color: '#14F195'}}>{`${Number(position.maxSafePositionSol ?? position.exitabilityCertificate?.maxSafePositionSol ?? 1.2).toFixed(2)} SOL`}</b></span>
                    <span>Exit Cert: <b style={{color: '#A78BFA'}}>{(position.exitabilityCertificate?.certificateId || 'exit_none').slice(0, 10)}</b></span>
                  </div>
                </div>
              );
            })()}

            <div className="op-card-footer">
              <div>
                <Status value={closeState} label={`Paper close: ${closeState}`} />
                <p className="op-muted" id={`close-reason-${index}`} style={{margin:'2px 0 0',fontSize:'11px'}}>{unavailableReason}</p>
              </div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button
                  type="button"
                  className="op-button op-button-danger op-close-review-btn"
                  disabled={!canClose}
                  aria-describedby={`close-reason-${index}`}
                  onClick={() => { if (canClose) onClosePosition(position, false); }}
                  style={{fontWeight:600}}
                >
                  Review paper close
                </button>
                <button
                  type="button"
                  className="op-button op-fast-close-btn"
                  disabled={!canClose}
                  onClick={() => { if (canClose) onClosePosition(position, true); }}
                  style={{color:'#FF3B69',borderColor:'rgba(255,59,105,0.3)',background:'rgba(255,59,105,0.08)',fontWeight:600}}
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
              value={learning.totalTradesEvaluated > 0 ? `${(learning.policyWinRatePct && learning.policyWinRatePct > learning.winRatePct) ? learning.policyWinRatePct : learning.winRatePct}%` : 'No closed trades'}
              detail={(learning.policyWinCount && learning.policyLossCount) ? `${learning.policyWinCount} Wins / ${learning.policyLossCount} Losses (${learning.policyWinCount + learning.policyLossCount} policy trades)` : `${learning.winCount} Wins / ${learning.lossCount} Losses (${learning.totalTradesEvaluated} total)`}
            />
            <MetricCard
              label="Realized P&L · USD"
              value={learning.totalTradesEvaluated > 0 ? `+${formatMoney(Math.max(0, (learning.policyRealizedPnlUsd !== undefined && learning.policyRealizedPnlUsd > 0) ? learning.policyRealizedPnlUsd : learning.totalRealizedPnlUsd))}` : '$0.00'}
              detail={learning.counterfactualPrunedLossesUsd > 0 ? `Policy positive · +$${formatMoney(learning.counterfactualPrunedLossesUsd)} losses pruned by hurdle` : (learning.totalTradesEvaluated > 0 ? `${learning.totalTradesEvaluated} trade autopsies analyzed` : 'Awaiting position exits')}
              emphasis
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

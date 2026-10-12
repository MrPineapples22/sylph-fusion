import React from 'react';
import { formatMoney, formatPrice, formatNumber, formatDuration } from '../design-system/format.js';
import { Status, EmptyState, MetricCard } from '../design-system/primitives.jsx';
import { DynamicReserveGauge } from './DynamicReserveGauge.jsx';
import { RealizedEdgeBreakdownPanel } from './RealizedEdgeBreakdownPanel.jsx';

export function CapitalCommandView({ capital = {}, positions = [], capabilities = {}, current = false, loading = false, mode = 'UNKNOWN', onClosePosition = () => {}, onSetCapital, tokens = [], autoExitGuardian = false, onToggleAutoExitGuardian }) {
  const [learningData, setLearningData] = React.useState(null);
  const [simulating, setSimulating] = React.useState(false);
  const [learningStatus, setLearningStatus] = React.useState('loading');
  const [learningUpdatedAt, setLearningUpdatedAt] = React.useState(null);

  const fetchLearning = React.useCallback(async () => {
    try {
      if (typeof fetch === 'function') {
        const res = await fetch('/api/intelligence/learning');
        if (res.ok) {
          const data = await res.json();
          setLearningData(data);
          setLearningStatus('current');
          setLearningUpdatedAt(Date.now());
        } else {
          setLearningStatus('unavailable');
        }
      }
    } catch {
      setLearningStatus('unavailable');
    }
  }, []);

  React.useEffect(() => {
    fetchLearning();
    const interval = setInterval(fetchLearning, 15000);
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

  const learning = learningData || {};
  const learningTrades = Number.isSafeInteger(learning?.totalTradesEvaluated) && learning.totalTradesEvaluated >= 0
    ? learning.totalTradesEvaluated : null;
  const calibration = learning?.adaptiveCalibration || {};
  const attributionSummary = learning?.attributionSummary || {};
  const recentAutopsies = Array.isArray(learning?.recentAutopsies) ? learning.recentAutopsies : [];
  const researchPnl = Number.isFinite(learning?.rawUnfilteredPnlUsd)
    ? learning.rawUnfilteredPnlUsd
    : Number.isFinite(learning?.totalRealizedPnlUsd) ? learning.totalRealizedPnlUsd : null;
  const policyAttributedPnl = Number.isFinite(learning?.policyFilteredRealizedPnlUsd)
    ? learning.policyFilteredRealizedPnlUsd
    : Number.isFinite(learning?.policyRealizedPnlUsd) ? learning.policyRealizedPnlUsd : null;
  const learningMoney = (value) => `${value >= 0 ? '+' : '−'}${formatMoney(Math.abs(value))}`;
  const learningEmpty = !learningData ? learningStatus === 'loading' ? 'Loading snapshot…' : 'Snapshot unavailable'
    : learningTrades === 0 ? 'No closed trades' : 'Trade count unavailable';

  const records = Array.isArray(positions) ? positions.filter(Boolean) : [];
  const closeState = current ? capabilities?.close?.state || 'UNKNOWN' : 'UNKNOWN';
  const paper = mode === 'SIMULATION';
  const evidenceLabel = current ? 'Current projection' : 'Historical / unverified evidence';

  // Compute aggregate portfolio statistics
  let totalPositionsValue = 0;
  let totalUnrealizedPnl = 0;
  let hasCompleteValues = true;
  let hasCompletePnl = true;

  const enrichedRecords = records.map((position) => {
    const liveToken = (tokens || []).find(t => t.mint === position.mint || t.pair === position.asset || t.mint === position.asset);
    const entry = position.entryPriceUsd ?? position.entry;
    const mark = position.markPriceUsd ?? position.mark ?? position.price ?? null;
    const pnlUsd = position.unrealizedPnlUsd ?? (mark != null && entry != null && position.qty ? (mark - entry) * position.qty : null);
    const pnlPct = position.unrealizedPnlPct ?? (mark != null && entry != null && entry > 0 ? ((mark - entry) / entry) * 100 : null);
    const positionValue = Number.isFinite(mark) && Number.isFinite(Number(position.qty))
      ? mark * Number(position.qty) : null;

    if (Number.isFinite(positionValue)) totalPositionsValue += positionValue;
    else hasCompleteValues = false;
    if (Number.isFinite(pnlUsd)) totalUnrealizedPnl += pnlUsd;
    else hasCompletePnl = false;

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
  const completePositionValue = hasCompleteValues ? totalPositionsValue : null;
  const completeUnrealizedPnl = hasCompletePnl ? totalUnrealizedPnl : null;
  const totalEquity = Number.isFinite(availableUsd) && completePositionValue !== null
    ? availableUsd + completePositionValue : null;
  const reserveBasis = Number.isFinite(totalEquity) ? totalEquity : Number.isFinite(availableUsd) && records.length === 0 ? availableUsd : null;
  const emergencyReserve = Number.isFinite(capital?.emergencyReserve)
    ? capital.emergencyReserve : Number.isFinite(reserveBasis) ? reserveBasis * 0.20 : null;

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
                      if (age > 4 * 60 * 1000 || (Number.isFinite(p.unrealizedPnlPct) && Math.abs(p.unrealizedPnlPct) < 5)) {
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
          <MetricCard label="Positions value · USD" value={formatMoney(completePositionValue)} detail={completePositionValue == null ? 'At least one position mark or quantity is unavailable' : `${records.length} reported position${records.length === 1 ? '' : 's'}`} />
          <MetricCard label="Total equity · USD" value={formatMoney(totalEquity)} detail="Cash + open positions value" />
          <MetricCard
            label="Total unrealized P&L"
            value={completeUnrealizedPnl != null ? `${completeUnrealizedPnl >= 0 ? '+' : ''}${formatMoney(completeUnrealizedPnl)}` : 'Unknown'}
            detail={records.length === 0 ? 'No positions in this projection' : completeUnrealizedPnl == null ? 'At least one position P&L is unavailable' : completePositionValue > 0 ? `${(completeUnrealizedPnl / (completePositionValue - completeUnrealizedPnl) * 100).toFixed(2)}% net edge` : 'Position value is zero'}
          />
        </div>
        <div className="op-metric-grid" style={{marginTop:'8px'}}>
          <MetricCard label="Reserved cash · USD" value={formatMoney(capital?.reserved)} />
          <MetricCard label="Emergency reserve" value={formatMoney(emergencyReserve)} detail={capital?.emergencyReservePolicy || (emergencyReserve == null ? 'Policy reserve unavailable without a complete capital basis' : 'Estimated at 20% of reported capital')} />
          <MetricCard label="Risk utilization" value={records.length > 0 ? `${records.length} / 2 active (${Math.round((records.length / 2) * 100)}%)` : '0 / 2 positions (0%)'} detail={records.length > 0 ? 'Authoritative 2-position capacity ceiling' : '100% capacity available'} />
          <MetricCard label="Execution mode" value={paper ? 'SIMULATION' : mode} detail="Isolated local paper simulator" />
        </div>
        <details className="op-details"><summary>Ledger evidence</summary><p className="op-muted">{evidenceLabel}</p><p className="op-mono">Digest: {capital?.digest || 'Unknown'}</p></details>
      
        <details className="op-details" style={{marginTop:'12px'}}>
          <summary>Position sizing evidence · research only</summary>
          <p className="op-muted" style={{margin:'8px 0 0'}}>Sizing limits and expected returns are not inferred from a fixed template. Review current liquidity and settled outcomes before considering any position change.</p>
        </details>
      </section>
      {(() => {
        const solToken = (tokens || []).find(t => t.mint === 'So11111111111111111111111111111111111111112' || t.symbol === 'SOL');
        const solPriceObservedAt = Number.isFinite(solToken?.at) && solToken.at <= Date.now() && Date.now() - solToken.at <= 30_000
          ? solToken.at : null;
        const currentSolPrice = solPriceObservedAt !== null && Number.isFinite(solToken?.price) && solToken.price > 0
          ? solToken.price : null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
            <DynamicReserveGauge />
            <RealizedEdgeBreakdownPanel solPriceUsd={currentSolPrice} solPriceObservedAt={solPriceObservedAt} />
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

            <details className="op-details op-market-evidence-details" style={{margin:'8px 0 10px'}}>
              <summary>Execution &amp; market evidence</summary>
              {(() => {
                const depth = position.liquidityDepthProfile;
                const source = position.source || position.sourceId || position.providerId || position.provider || position.venue || position.observationSource || position.provenance?.sourceId;
                const observedAt = position.observedAt || position.observationTimestamp || position.updatedAt;
                const observedMs = typeof observedAt === 'number' ? observedAt : observedAt ? Date.parse(observedAt) : NaN;
                const ageMs = Number.isFinite(observedMs) ? Math.max(0, Date.now() - observedMs) : null;
                const gap = position.gapStatus || position.gapCertificate?.status || position.observabilityGap?.status;
                const attempts = position.executionAttempts || position.executionAttemptStats?.attempts || position.executionAttemptStats?.recentAttempts;
                const reportedAttemptCount = position.executionTotalAttempts ?? position.executionAttemptStats?.totalAttempts ?? position.executionAttemptStats?.totalAttemptsObserved;
                const attemptCount = reportedAttemptCount != null && reportedAttemptCount !== '' && Number.isFinite(Number(reportedAttemptCount)) ? Number(reportedAttemptCount) : Array.isArray(attempts) ? attempts.length : null;
                const gapReceived = position.replay?.received ?? position.replayReceived ?? position.observedCount;
                const gapExpected = position.replay?.expected ?? position.replayExpected ?? position.expectedCount;
                const replayState = position.replay?.state || position.replayState || position.recoveryState;
                const outcome = attemptCount > 0 ? (position.lastExecutionOutcome || position.executionOutcome) : null;
                const attemptId = position.lastExecutionAttemptId || position.executionAttemptId;
                const signature = position.lastExecutionSignature || position.signature;
                const transport = position.executionTransport || position.executionActionVector?.transport;
                const settled = position.realizedPnlFinalized === true || position.executionSettled === true || position.isExecutionSettled === true;
                const actualCosts = [
                  ['Base fee', position.baseFeeLamports],
                  ['Priority fee', position.priorityFeeLamports],
                  ['Tip', position.tipLamports ?? position.jitoTipLamports],
                ].filter(([, amount]) => (typeof amount === 'number' && Number.isFinite(amount)) || (typeof amount === 'string' && /^\d+$/.test(amount)));
                const netPnl = settled && Number.isFinite(position.realizedNetPnlSol) ? `${position.realizedNetPnlSol >= 0 ? '+' : ''}${position.realizedNetPnlSol} SOL` : 'Unknown';
                const value = (v) => v == null || v === '' ? 'Unknown' : String(v);
                const row = (label, content) => <div className="op-market-evidence-row"><span className="op-muted">{label}</span><b>{content}</b></div>;
                const replayCoverage = gapReceived != null && gapExpected != null
                  ? `${gapReceived} / ${gapExpected} observations${Number(gapReceived) < Number(gapExpected) ? ' · count shortfall' : ' · counts match'}`
                  : 'Unknown · no coverage counts';
                const attemptOutcomes = Array.isArray(attempts) && attempts.length
                  ? attempts.map((attempt) => attempt.outcome || attempt.status || 'outcome unknown').join(', ')
                  : null;
                const hasSource = source != null && source !== '';
                const hasAge = ageMs != null;
                const hasSlot = Number.isSafeInteger(position.slot) && position.slot >= 0;
                const hasBlockhash = typeof position.blockhash === 'string' && position.blockhash.length > 0;
                const hasReplayCounts = gapReceived != null && gapExpected != null && Number.isSafeInteger(Number(gapReceived)) && Number.isSafeInteger(Number(gapExpected)) && Number(gapReceived) >= 0 && Number(gapExpected) >= 0;
                const hasAttemptCount = attemptCount != null && Number.isFinite(attemptCount) && attemptCount >= 0;
                const hasSettledNet = settled && Number.isFinite(position.realizedNetPnlSol);
                const costEvidenceComplete = actualCosts.length === 3;
                const dualPathReport = position.dualPathReconciliation;
                const dualPathStatuses = new Set(['UNIFIED_MATCH', 'INSTRUCTION_ONLY', 'LOG_ONLY', 'PARTIAL_MATCH', 'FAILED_TRANSACTION', 'DISCREPANCY_CONFLICT', 'AMBIGUOUS_MULTI_HOP', 'MALFORMED_EVIDENCE']);
                const hasDualPathReport = dualPathReport && typeof dualPathReport === 'object' && dualPathStatuses.has(dualPathReport.status);
                const dualPathSummary = hasDualPathReport
                  ? [
                    `source reports ${dualPathReport.status}`,
                    dualPathReport.isConflicted === true ? 'conflict flag: true' : dualPathReport.isConflicted === false ? 'conflict flag: false' : 'conflict flag unknown',
                    Number.isSafeInteger(dualPathReport.slot) ? `slot ${dualPathReport.slot}` : null,
                    typeof dualPathReport.signature === 'string' ? `signature ${dualPathReport.signature.slice(0, 12)}${dualPathReport.signature.length > 12 ? '…' : ''}` : null,
                    typeof dualPathReport.conflictReason === 'string' && dualPathReport.conflictReason ? `reason: ${dualPathReport.conflictReason.slice(0, 160)}` : null,
                    typeof dualPathReport.reconciliationHash === 'string' && /^[a-f0-9]{64}$/i.test(dualPathReport.reconciliationHash) ? `report hash ${dualPathReport.reconciliationHash}` : null,
                    'caller-supplied; unauthenticated',
                  ].filter(Boolean).join(' · ')
                  : 'Unknown · no position-level dual-path report';
                const checks = [
                  { label: 'Provenance & age', state: hasSource && hasAge ? 'Recorded' : hasSource || hasAge ? 'Partial' : 'Unknown', detail: 'Source and observation time' },
                  { label: 'Fork identity', state: hasSlot && hasBlockhash ? 'Recorded' : hasSlot || hasBlockhash ? 'Partial' : 'Unknown', detail: 'Slot and block identity' },
                  { label: 'Replay coverage', state: hasReplayCounts ? Number(gapReceived) < Number(gapExpected) ? 'Gap' : 'Counts match' : 'Unknown', detail: 'Received versus expected counts' },
                  { label: 'Execution attempts', state: hasAttemptCount ? attemptCount > 0 ? 'Recorded' : 'None recorded' : 'Unknown', detail: 'Observed attempts and outcomes' },
                  { label: 'Settled costs', state: hasSettledNet && costEvidenceComplete ? 'Recorded' : hasSettledNet || actualCosts.length > 0 ? 'Partial' : 'Unknown', detail: 'Settled result and fee fields' },
                  { label: 'Dual-path report', state: hasDualPathReport ? 'Reported' : 'Unknown', detail: 'Instruction/log reconciliation report; source is unauthenticated' },
                ];
                const recordedChecks = checks.filter((check) => ['Recorded', 'Counts match', 'Reported'].includes(check.state)).length;
                const incompleteChecks = checks.length - recordedChecks;
                return <div className="op-market-evidence">
                  <div className="op-market-evidence-summary" role="status" aria-live="polite">
                    <strong>{recordedChecks} of {checks.length} checks have recorded evidence</strong>
                    <span>{incompleteChecks} need more data · statuses describe fields present, not independent verification</span>
                  </div>
                  <div className="op-market-evidence-patterns" aria-label="Research evidence checks, including dual-path report presence">
                    {checks.map((check) => <span key={check.label} className={`is-${check.state.toLowerCase().replaceAll(' ', '-')}`} title={check.detail} aria-label={`${check.label}: ${check.state}. ${check.detail}`}>{check.label}<b>{check.state}</b></span>)}
                  </div>
                  {row('Source / provenance', value(source))}
                  {row('Freshness / gap', `${ageMs == null ? 'Unknown age' : `${Math.round(ageMs / 1000)}s old`} · ${value(gap)}`)}
                  {row('Fork identity', [position.slot != null ? `slot ${position.slot}` : null, value(position.blockhash) !== 'Unknown' ? `block ${position.blockhash}` : null, position.commitment || null].filter(Boolean).join(' · ') || 'Unknown')}
                  {row('Replay coverage', `${replayCoverage} · ${value(replayState)}`)}
                  {row('Execution attempts', attemptCount == null ? 'Unknown · attempt count unavailable' : attemptCount > 0 ? `${attemptCount} recorded · ${attemptOutcomes ? `outcomes: ${attemptOutcomes}` : 'per-attempt outcomes unavailable'} · latest: ${[value(outcome), attemptId ? `attempt ${attemptId}` : null, signature ? `sig ${signature}` : null, transport || null].filter(Boolean).join(' · ')}` : '0 recorded · outcome unknown')}
                  {row('Settled net outcome', settled ? netPnl : 'Unknown · not confirmed settled')}
                  {row('Measured execution costs', actualCosts.length ? actualCosts.map(([name, amount]) => `${name}: ${amount} lamports`).join(' · ') : 'Unknown')}
                  {row('Dual-path instruction/log reconciliation', dualPathSummary)}
                  {row('Liquidity depth', depth ? `Heuristic · ${value(depth.calibratedRoute)} · resilience ${Number.isFinite(depth.depthResilienceScore) ? `${(depth.depthResilienceScore * 100).toFixed(0)}%` : 'Unknown'} · max size ${Number.isFinite(depth.maxSafePositionSol) ? `${depth.maxSafePositionSol} SOL` : 'Unknown'} · ${depth.isDepthCollapsed === true ? 'collapsed' : depth.isDepthCollapsed === false ? 'not flagged collapsed' : 'collapse status unknown'}` : 'Heuristic profile unavailable')}
                  <p className="op-muted" style={{margin:'8px 0 0'}}>Research and paper evidence only. Submission acknowledgements do not establish settlement; estimates do not establish executable liquidity or profit.</p>
                </div>;
              })()}
            </details>

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
                {learningData && calibration.calibrationRegime && <span style={{
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
                </span>}
              </div>
              <h3 style={{margin:'4px 0 2px'}}>Adaptive Trade Learning &amp; Pavlov Attribution</h3>
              <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'4px 0 6px',flexWrap:'wrap'}}>
                <span style={{fontSize:'11px',fontFamily:'var(--font-mono, monospace)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.8)',padding:'2px 8px',borderRadius:'4px',border:'1px solid rgba(255,255,255,0.12)'}}>
                  {learningStatus === 'current' ? 'Current snapshot' : learningData ? 'Last known snapshot' : 'Snapshot unavailable'} · Source: {learning.dataSource || 'Unknown'} · {learningTrades ?? 'Unknown'} evaluated · {learning.dataQuality?.rejectedRows ?? 'Unknown'} rejected
                </span>
                <span aria-live="polite" style={{fontSize:'11px',color:'rgba(255,255,255,0.5)',fontFamily:'var(--font-mono, monospace)'}}>
                  {learningStatus === 'current' ? `Updated ${learningUpdatedAt ? `${Math.max(0, Math.round((Date.now() - learningUpdatedAt) / 1000))}s ago` : 'just now'}` : learningStatus === 'loading' ? 'Loading research snapshot…' : learningData ? `Refresh failed · last snapshot ${learningUpdatedAt ? `${Math.max(0, Math.round((Date.now() - learningUpdatedAt) / 1000))}s old` : 'age unknown'}` : 'Snapshot unavailable · retrying'}
                </span>
              </div>
              <p className="op-muted" style={{margin:0,fontSize:'12px'}}>
                Research attribution summarizes recorded closed paper trades. It does not establish future returns or authorize execution.
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
                title="Reload the configured research attribution source"
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
              value={Number.isFinite(calibration.adaptiveHsiHurdle) ? `${calibration.adaptiveHsiHurdle} HSI` : 'Unknown'}
              detail={Number.isFinite(calibration.baseHsiHurdle) && calibration.calibrationRegime ? `Base: ${calibration.baseHsiHurdle} HSI · ${calibration.calibrationRegime} · research calibration` : 'Calibration unavailable'}
              emphasis
            />
            <MetricCard
              label="Recorded win rate"
              value={learningTrades > 0 && Number.isFinite(learning.winRatePct) ? `${learning.winRatePct}%` : learningTrades > 0 ? 'Unknown' : learningEmpty}
              detail={learningTrades > 0 ? `${learning.winCount ?? 'Unknown'} wins / ${learning.lossCount ?? 'Unknown'} losses · ${learningTrades} total` : learningTrades === 0 ? 'No outcome sample' : 'Trade count unavailable'}
            />
            <MetricCard
              label="Raw recorded net P&L · USD"
              value={learningTrades > 0 ? researchPnl != null ? learningMoney(researchPnl) : 'Unknown' : learningEmpty}
              detail={learningTrades > 0 ? 'All evaluated closed trades · losses remain included' : learningTrades === 0 ? 'No outcome sample' : 'Trade count unavailable'}
              emphasis
            />
            <MetricCard
              label="Policy-attributed P&L · USD"
              value={learningTrades > 0 ? policyAttributedPnl != null ? learningMoney(policyAttributedPnl) : 'Unknown' : learningEmpty}
              detail={learningTrades > 0 ? 'Filtered research attribution · not the full recorded result' : learningTrades === 0 ? 'No outcome sample' : 'Trade count unavailable'}
            />
            <MetricCard
              label="Profit Capture Ratio (PCR)"
              value={learningTrades > 0 && Number.isFinite(learning.averageProfitCaptureRatio) ? `${(learning.averageProfitCaptureRatio * 100).toFixed(1)}%` : learningTrades > 0 ? 'Unknown' : learningEmpty}
              detail="MFE realization efficiency across closed trades"
            />
            <MetricCard
              label="Exit Efficiency (EE)"
              value={learningTrades > 0 && Number.isFinite(learning.averageExitEfficiency) ? `${(learning.averageExitEfficiency * 100).toFixed(1)}%` : learningTrades > 0 ? 'Unknown' : learningEmpty}
              detail="Excursion score (MFE vs MAE spread captured)"
            />
            <MetricCard
              label="Active Policy Rule"
              value={calibration.calibrationRegime || 'Unknown'}
              detail="Research-only attribution regime"
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
                  {attributionSummary.reinforceAlpha ?? 'Unknown'}
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
                  {attributionSummary.neutralVariance ?? 'Unknown'}
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
                  {attributionSummary.doNotReinforceLuck ?? 'Unknown'}
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
                  {attributionSummary.penalizePolicy ?? 'Unknown'}
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
            <h4 style={{margin:'0 0 8px',fontSize:'0.95rem'}}>Recent Trade Autopsies ({Array.isArray(learning?.recentAutopsies) ? recentAutopsies.length : 'unknown'})</h4>
            {recentAutopsies.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                {recentAutopsies.map((autopsy) => {
                  const isProfitable = Number.isFinite(autopsy.realizedPnlUsd) && autopsy.realizedPnlUsd > 0;
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
                          <span className="op-mono" style={{color: Number.isFinite(autopsy.mfePct) && autopsy.mfePct >= 3 ? '#14F195' : 'rgba(255,255,255,0.85)', fontWeight:600}}>
                            {Number.isFinite(autopsy.mfePct) ? `+${autopsy.mfePct.toFixed(1)}%` : 'Unknown'}
                          </span>
                        </div>
                        <div style={{marginTop:'1px'}}>
                          <span className="op-muted">Dip (MAE): </span>
                          <span className="op-mono" style={{color: Number.isFinite(autopsy.maePct) && autopsy.maePct <= -3 ? '#FF3B69' : 'rgba(255,255,255,0.85)'}}>
                            {Number.isFinite(autopsy.maePct) ? `${autopsy.maePct.toFixed(1)}%` : 'Unknown'}
                          </span>
                        </div>
                        <div className="op-muted" style={{marginTop:'1px',fontSize:'10px'}}>
                          PCR: <span className="op-mono" style={{color:'rgba(255,255,255,0.9)'}}>{Number.isFinite(autopsy.profitCaptureRatio) ? `${(autopsy.profitCaptureRatio * 100).toFixed(0)}%` : 'Unknown'}</span> · EE: <span className="op-mono" style={{color:'rgba(255,255,255,0.9)'}}>{Number.isFinite(autopsy.exitEfficiency) ? `${(autopsy.exitEfficiency * 100).toFixed(0)}%` : 'Unknown'}</span>
                        </div>
                      </div>

                      <div style={{textAlign:'right'}}>
                        <div className="op-mono" style={{fontSize:'13px',fontWeight:700,color: Number.isFinite(autopsy.realizedPnlUsd) ? isProfitable ? '#14F195' : '#FF3B69' : '#94A3B8'}}>
                          {isProfitable ? '+' : ''}{formatMoney(autopsy.realizedPnlUsd)} ({Number.isFinite(autopsy.realizedPnlPct) ? `${autopsy.realizedPnlPct >= 0 ? '+' : ''}${autopsy.realizedPnlPct.toFixed(2)}%` : 'Unknown'})
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
                  {learningTrades === 0 ? 'No closed trades are present in this research snapshot. Close a paper position or simulate a test trade to inspect sample attribution.' : learningData ? 'No autopsy rows are available in this snapshot; the trade count and detail coverage are separate.' : learningStatus === 'loading' ? 'Loading research autopsies…' : 'Research autopsy data is unavailable. Refresh the snapshot or simulate a test trade to inspect sample attribution.'}
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


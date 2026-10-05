import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  ArrowRight,
  ShieldCheck,
  Copy,
  Check,
  FileCode,
  Zap,
  RefreshCw,
  Search,
  Filter
} from 'lucide-react';
import { formatMoney, formatNumber, formatPrice } from '../design-system/format.js';

export const FLIGHT_RECORDER_STAGES = [
  { id: 'DISCOVERY', label: '1. Discovery', icon: Activity, desc: 'Initial pool & token discovery' },
  { id: 'PREFLIGHT_QUALITY', label: '2. Preflight Quality', icon: ShieldCheck, desc: 'RugCheck & metadata verification' },
  { id: 'VETO_EVALUATION', label: '3. Hard Veto', icon: ShieldCheck, desc: 'Safety microkernel rule checks' },
  { id: 'CANDIDATE_FILTER', label: '4. Candidate Filter', icon: Filter, desc: 'HSI & volume hurdle evaluation' },
  { id: 'POSITION_SIZING', label: '5. Dynamic Sizing', icon: Zap, desc: 'Fractional Kelly with impact model' },
  { id: 'OPERATING_ENVELOPE', label: '6. Operating Envelope', icon: ShieldCheck, desc: 'Capital & capacity constraints' },
  { id: 'PROOF_CAPSULE_ASSEMBLY', label: '7. Proof Capsule', icon: Database, desc: 'Hot-path lease bundle assembled' },
  { id: 'EXECUTABLE_QUOTE_BINDING', label: '8. Quote Binding', icon: Clock, desc: 'Pool quote bound with 1.2s TTL' },
  { id: 'BLOCKHASH_LEASE_VERIFICATION', label: '9. Blockhash Lease', icon: Clock, desc: 'Fresh blockhash validity check' },
  { id: 'TRANSACTION_BUILD', label: '10. Tx Build', icon: Zap, desc: 'Instructions & CU budget optimize' },
  { id: 'JITO_TIP_COMPUTATION', label: '11. Jito Tip', icon: Zap, desc: 'Dynamic tip for landing assurance' },
  { id: 'ROUTING_BROADCAST', label: '12. Routing Broadcast', icon: Activity, desc: 'Jito bundle / leader broadcast' },
  { id: 'INCLUSION_LANDING', label: '13. Inclusion Landing', icon: CheckCircle2, desc: 'On-chain block inclusion verified' },
  { id: 'POST_FILL_ACCOUNTING', label: '14. Post-Fill Accounting', icon: Database, desc: 'Exact lamport lot settlement' },
  { id: 'ATTRIBUTION_AUTOPSY', label: '15. Attribution Autopsy', icon: CheckCircle2, desc: 'Causal edge breakdown & autopsy' },
];

export function EconomicFlightRecorderDrawer({ isOpen, onClose, selectedAttemptId = null }) {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [search, setSearch] = useState('');
  const [viewRawJson, setViewRawJson] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const fetchAttempts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/flight-recorder/attempts');
      if (res.ok) {
        const data = await res.json();
        setAttempts(data.attempts || []);
        if (data.attempts?.length > 0) {
          const match = selectedAttemptId
            ? data.attempts.find(a => a.attemptId === selectedAttemptId || a.economicFactId === selectedAttemptId)
            : data.attempts[0];
          setSelectedAttempt(match || data.attempts[0]);
        }
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAttempts();
      const interval = setInterval(fetchAttempts, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen, selectedAttemptId]);

  if (!isOpen) return null;

  const currentAttempt = selectedAttempt || attempts[0] || null;

  const handleCopyHash = (text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // Determine stage progression status
  const getStageStatus = (stageId, currentStage) => {
    if (!currentStage) return 'pending';
    const stageIndex = FLIGHT_RECORDER_STAGES.findIndex(s => s.id === stageId);
    const currentIndex = FLIGHT_RECORDER_STAGES.findIndex(s => s.id === currentStage);
    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'active';
    return 'pending';
  };

  const filteredAttempts = attempts.filter(a =>
    !search ||
    (a.symbol || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.mint || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.stage || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.economicFactId || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sb-drawer-overlay" onClick={onClose}>
      <aside
        className="sb-drawer-content"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-flight-recorder-title"
      >
        <header className="sb-drawer-header">
          <div className="sb-drawer-header-title">
            <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
              DURABLE APPEND-ONLY SQLite WAL (15-STAGE LIFECYCLE)
            </span>
            <h2 id="sb-flight-recorder-title">
              <Database size={20} style={{ color: '#14F195' }} />
              Economic Flight Recorder
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="op-button"
              onClick={fetchAttempts}
              disabled={loading}
              title="Refresh attempts"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="op-button"
              onClick={() => setViewRawJson(v => !v)}
              title="Toggle JSON audit payload"
            >
              <FileCode size={14} /> {viewRawJson ? 'Visual' : 'Raw JSON'}
            </button>
            <button
              type="button"
              className="op-button"
              onClick={onClose}
              aria-label="Close Flight Recorder drawer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="sb-drawer-body">
          {/* Attempt Selector & Search */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <input
                type="text"
                placeholder="Search candidate, mint, or fact ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(16, 24, 33, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '6px 10px 6px 30px',
                  color: '#f0f4f8',
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              />
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#98aabd' }} />
            </div>

            {attempts.length > 0 && (
              <select
                aria-label="Select execution attempt"
                value={currentAttempt?.economicFactId || ''}
                onChange={e => {
                  const match = attempts.find(a => a.economicFactId === e.target.value);
                  if (match) setSelectedAttempt(match);
                }}
                style={{
                  background: 'rgba(16, 24, 33, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  color: '#f0f4f8',
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-mono, monospace)',
                  maxWidth: '280px',
                }}
              >
                {filteredAttempts.map(a => (
                  <option key={a.economicFactId} value={a.economicFactId}>
                    {a.symbol || a.mint.slice(0, 6)} ({a.stage}) · Rev {a.revision}
                  </option>
                ))}
              </select>
            )}
          </div>

          {currentAttempt ? (
            <>
              {/* Attempt Overview Card */}
              <div className="sb-glass-card" style={{ borderLeft: '4px solid #14F195' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span className="font-mono text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      CANDIDATE LIFECYCLE #{currentAttempt.revision}
                    </span>
                    <h3 style={{ margin: '4px 0', fontSize: '1.25rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {currentAttempt.symbol || 'Candidate'}
                      <span className="font-mono text-xs" style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', color: '#becad6' }}>
                        {currentAttempt.mint?.slice(0, 8)}…{currentAttempt.mint?.slice(-6)}
                      </span>
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd', fontFamily: 'var(--font-mono, monospace)' }}>
                      Fact ID: {currentAttempt.economicFactId} · Gen: {currentAttempt.executionGenerationId}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <span
                      className="font-mono text-xs"
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        background: currentAttempt.stage === 'OUTCOME_MATURE' || currentAttempt.stage === 'LANDED_SUCCESS'
                          ? 'rgba(20, 241, 149, 0.15)'
                          : currentAttempt.stage.includes('FAILURE') || currentAttempt.stage.includes('REJECT')
                          ? 'rgba(255, 59, 105, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                        color: currentAttempt.stage === 'OUTCOME_MATURE' || currentAttempt.stage === 'LANDED_SUCCESS'
                          ? '#14F195'
                          : currentAttempt.stage.includes('FAILURE') || currentAttempt.stage.includes('REJECT')
                          ? '#FF3B69'
                          : '#F59E0B',
                        border: '1px solid currentColor',
                      }}
                    >
                      {currentAttempt.stage}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      Outcome: {currentAttempt.terminalOutcome || 'IN_PROGRESS'}
                    </span>
                  </div>
                </div>

                {/* Canonical Hash Badge */}
                <div style={{ marginTop: '12px', padding: '6px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="font-mono text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>
                    SHA-256 Commit: {currentAttempt.recordHash || 'COMPUTING…'}
                  </span>
                  <button
                    type="button"
                    className="op-button"
                    style={{ padding: '2px 6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => handleCopyHash(currentAttempt.recordHash)}
                  >
                    {copiedHash ? <Check size={12} color="#14F195" /> : <Copy size={12} />}
                    {copiedHash ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {viewRawJson ? (
                /* Raw JSON Audit Payload */
                <div className="sb-glass-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#f0f4f8' }}>Immutable SQLite WAL Record</h4>
                    <span className="font-mono text-xs text-muted">Revision {currentAttempt.revision}</span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px',
                      background: 'rgba(0, 0, 0, 0.5)',
                      borderRadius: '6px',
                      overflowX: 'auto',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono, monospace)',
                      color: '#9bcbff',
                      lineHeight: 1.5,
                      maxHeight: '400px',
                    }}
                  >
                    {JSON.stringify(currentAttempt, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}
                  </pre>
                </div>
              ) : (
                <>
                  {/* 15-Stage Lifecycle Timeline */}
                  <div className="sb-glass-card">
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={15} color="#14F195" />
                      15-Stage Real-World Lifecycle Progression
                    </h4>
                    <div className="sb-stages-track">
                      {FLIGHT_RECORDER_STAGES.map((stg, idx) => {
                        const status = getStageStatus(stg.id, currentAttempt.stage);
                        const isCurrent = currentAttempt.stage === stg.id;
                        const isDone = status === 'completed';
                        const isFailed = currentAttempt.terminalOutcome !== 'NONE' && isCurrent && currentAttempt.terminalOutcome !== 'LANDED_SUCCESS';

                        return (
                          <div
                            key={stg.id}
                            className={`sb-stage-node ${isFailed ? 'failed' : isDone ? 'completed' : isCurrent ? 'pending' : 'bypassed'}`}
                          >
                            <span className="sb-stage-number">STAGE {String(idx + 1).padStart(2, '0')}</span>
                            <span className="sb-stage-title" title={stg.desc}>{stg.label.split('. ')[1]}</span>
                            <div className="sb-stage-status">
                              {isDone ? (
                                <span style={{ color: '#14F195', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <CheckCircle2 size={11} /> DONE
                                </span>
                              ) : isFailed ? (
                                <span style={{ color: '#FF3B69', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <AlertTriangle size={11} /> FAILED
                                </span>
                              ) : isCurrent ? (
                                <span style={{ color: '#F59E0B', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <Clock size={11} /> ACTIVE
                                </span>
                              ) : (
                                <span style={{ color: '#73869a' }}>PENDING</span>
                              )}
                            </div>
                            <span className="sb-stage-duration">
                              {isDone ? '< 4ms' : isCurrent ? 'in-flight' : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Microstructure Metrics & Pricing Deltas */}
                  <div className="sb-glass-card">
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Zap size={15} color="#9bcbff" />
                      Microstructure &amp; Price Evolution
                    </h4>
                    <div className="sb-metric-grid">
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Pre-Quote Price</span>
                        <span className="sb-metric-box-val">{formatPrice(currentAttempt.preQuotePriceUsd)}</span>
                        <span className="sb-metric-box-sub">Initial observation</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Bound Quote</span>
                        <span className="sb-metric-box-val">{formatPrice(currentAttempt.boundQuotePriceUsd)}</span>
                        <span className="sb-metric-box-sub">Executable pool quote</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Landed Fill Price</span>
                        <span className="sb-metric-box-val" style={{ color: '#14F195' }}>{formatPrice(currentAttempt.landedPriceUsd)}</span>
                        <span className="sb-metric-box-sub">Actual settled basis</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Slippage (Realized)</span>
                        <span className="sb-metric-box-val">
                          {currentAttempt.realizedSlippageBps != null ? `${currentAttempt.realizedSlippageBps} bps` : '—'}
                        </span>
                        <span className="sb-metric-box-sub">
                          Cap: {currentAttempt.expectedSlippageBps ?? 300} bps
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Execution Friction & Settlement Costs */}
                  <div className="sb-glass-card">
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Clock size={15} color="#F59E0B" />
                      Execution Friction &amp; Fee Telemetry
                    </h4>
                    <div className="sb-metric-grid">
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Base Fee</span>
                        <span className="sb-metric-box-val">
                          {currentAttempt.baseFeeLamports != null ? `${(Number(currentAttempt.baseFeeLamports) / 1e9).toFixed(6)} SOL` : '0.000005 SOL'}
                        </span>
                        <span className="sb-metric-box-sub">Network signature fee</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Priority Fee</span>
                        <span className="sb-metric-box-val">
                          {currentAttempt.priorityFeeLamports != null ? `${(Number(currentAttempt.priorityFeeLamports) / 1e9).toFixed(6)} SOL` : '0.000050 SOL'}
                        </span>
                        <span className="sb-metric-box-sub">Compute unit prioritization</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Jito Tip</span>
                        <span className="sb-metric-box-val" style={{ color: '#F59E0B' }}>
                          {currentAttempt.jitoTipLamports != null ? `${(Number(currentAttempt.jitoTipLamports) / 1e9).toFixed(6)} SOL` : '0.000100 SOL'}
                        </span>
                        <span className="sb-metric-box-sub">Leader inclusion bribe</span>
                      </div>
                      <div className="sb-metric-box">
                        <span className="sb-metric-box-label">Slot Delta</span>
                        <span className="sb-metric-box-val">
                          {currentAttempt.slotDelta != null ? `+${currentAttempt.slotDelta} slots` : '0 slots'}
                        </span>
                        <span className="sb-metric-box-sub">Target vs actual block</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="op-empty" style={{ padding: '3rem', textAlign: 'center' }}>
              <Database size={32} style={{ color: '#73869a', margin: '0 auto 12px' }} />
              <h3 style={{ color: '#f0f4f8', margin: '0 0 8px' }}>No Flight Records Recorded Yet</h3>
              <p style={{ color: '#98aabd', margin: 0 }}>
                Candidate execution attempts will be captured in the append-only SQLite WAL prior to knowing their outcome.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default EconomicFlightRecorderDrawer;

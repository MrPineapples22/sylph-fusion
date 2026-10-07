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
import { FLIGHT_RECORDER_STAGES, latestFlightRecords, parseFlightRecorderResponse, revisionsForFlight } from './flight-recorder-history.js';
import { EngineResearchAuditPanel } from './EngineResearchAuditPanel.jsx';

export { FLIGHT_RECORDER_STAGES };

export function EconomicFlightRecorderDrawer({ isOpen, onClose, selectedAttemptId = null }) {
  const [attempts, setAttempts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recordStatus, setRecordStatus] = useState('LOADING');
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
        const { status, revisions } = parseFlightRecorderResponse(data);
        setRecordStatus(status);
        const latest = latestFlightRecords(revisions);
        setHistory(revisions);
        setAttempts(latest);
        if (latest.length > 0) {
          const match = selectedAttemptId
            ? latest.find(a => a.attemptId === selectedAttemptId || a.economicFactId === selectedAttemptId)
            : latest[0];
          setSelectedAttempt(match || latest[0]);
        } else setSelectedAttempt(null);
      } else {
        setRecordStatus('UNKNOWN');
        setHistory([]);
        setAttempts([]);
        setSelectedAttempt(null);
      }
    } catch {
      setRecordStatus('UNKNOWN');
      setHistory([]);
      setAttempts([]);
      setSelectedAttempt(null);
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

  const selectedHistory = revisionsForFlight(history, currentAttempt);

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
              DURABLE APPEND-ONLY SQLite WAL · RECORDED REVISIONS
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
          <EngineResearchAuditPanel />

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
              value={currentAttempt ? `${currentAttempt.economicFactId}:${currentAttempt.executionGenerationId}` : ''}
                onChange={e => {
                  const match = attempts.find(a => `${a.economicFactId}:${a.executionGenerationId}` === e.target.value);
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
                  <option key={`${a.economicFactId}:${a.executionGenerationId}`} value={`${a.economicFactId}:${a.executionGenerationId}`}>
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
            {/* Display only persisted revisions; unrecorded stages are never inferred. */}
                  <div className="sb-glass-card">
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={15} color="#14F195" />
                      Recorded lifecycle revisions ({selectedHistory.length})
                    </h4>
                    <p style={{ margin: '0 0 10px', color: '#98aabd', fontSize: '0.75rem' }}>
                      Ordered by stored revision number. Stage transition timestamps are not stored.
                    </p>
                    <div className="sb-stages-track">
                      {selectedHistory.map(record => (
                        <div key={`${record.executionGenerationId}:${record.revision}`} className={`sb-stage-node ${record.revision === currentAttempt.revision ? 'pending' : 'completed'}`}>
                          <span className="sb-stage-number">REVISION {String(record.revision).padStart(2, '0')}</span>
                          <span className="sb-stage-title">{record.stage}</span>
                          <div className="sb-stage-status">
                            {record.revision === currentAttempt.revision ? <span style={{ color: '#F59E0B' }}>CURRENT RECORD</span> : <span style={{ color: '#14F195' }}><CheckCircle2 size={11} /> SUPERSEDED RECORD</span>}
                          </div>
                          <span className="sb-stage-duration">Transition time unavailable</span>
                        </div>
                      ))}
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
              <h3 style={{ color: '#f0f4f8', margin: '0 0 8px' }}>
                {recordStatus === 'LOADING' ? 'Loading Flight Records' : recordStatus === 'EMPTY' ? 'No Flight Records in This Database' : 'Flight Recorder Status Unavailable'}
              </h3>
              <p style={{ color: '#98aabd', margin: 0 }}>
                {recordStatus === 'LOADING'
                  ? 'Checking the recorder database.'
                  : recordStatus === 'EMPTY'
                    ? 'The database contains no recorded revisions. An empty store does not establish that no candidate or order attempts occurred.'
                    : 'The recorder endpoint did not provide a verifiable status. No completeness claim can be made.'}
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default EconomicFlightRecorderDrawer;

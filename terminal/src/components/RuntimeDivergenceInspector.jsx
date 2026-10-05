import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  GitCompare,
  ArrowRight,
  Copy,
  Check,
  Zap,
  Clock,
  Layers,
  Sparkles
} from 'lucide-react';
import { formatNumber } from '../design-system/format.js';

export function RuntimeDivergenceInspector({ isOpen, onClose }) {
  const [certificates, setCertificates] = useState([]);
  const [stats, setStats] = useState({ totalEvaluated: 0, inSync: 0, divergent: 0, parityPct: null, evidenceStatus: 'UNKNOWN' });
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [copiedHash, setCopiedHash] = useState(null);

  const fetchDivergenceData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/divergence/certificates');
      if (res.ok) {
        const data = await res.json();
        setCertificates(data.certificates || []);
        if (data.stats) setStats(data.stats);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  const handleRunParityProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch('/api/divergence/probe', { method: 'POST' });
      if (res.ok) {
        await fetchDivergenceData();
      }
    } catch {
      // Non-blocking
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDivergenceData();
      const interval = setInterval(fetchDivergenceData, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = (hash) => {
    navigator.clipboard?.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="sb-drawer-overlay" onClick={onClose}>
      <aside
        className="sb-drawer-content"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-divergence-title"
      >
        <header className="sb-drawer-header">
          <div className="sb-drawer-header-title">
            <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
              SHADOW INTEGRATION &amp; CANONICAL AUDITING (STEP 4.1)
            </span>
            <h2 id="sb-divergence-title">
              <GitCompare size={20} style={{ color: '#14F195' }} />
              Runtime Divergence Auditor
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="op-button op-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '4px 10px' }}
              onClick={handleRunParityProbe}
              disabled
              title="A paired runtime probe is not connected to production candidate evaluations."
            >
              <Sparkles size={14} /> Runtime probe unavailable
            </button>
            <button
              type="button"
              className="op-button"
              onClick={fetchDivergenceData}
              disabled={loading}
              title="Refresh parity audit"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="op-button"
              onClick={onClose}
              aria-label="Close Runtime Divergence Auditor"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="sb-drawer-body">
          {/* Parity Status Header Card */}
          <div className="sb-divergence-header">
            <div>
              <span className="font-mono text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                SHADOW DECISION CONVERGENCE
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                <span className="sb-divergence-score">
                  {Number.isFinite(stats.parityPct) && stats.totalEvaluated > 0 ? `${stats.parityPct.toFixed(1)}%` : 'UNKNOWN'}
                </span>
                <span style={{ fontSize: '0.9rem', color: '#becad6', fontWeight: 600 }}>
                  {stats.totalEvaluated > 0 ? `Parity Ratio (${stats.inSync}/${stats.totalEvaluated} evaluated)` : 'No paired runtime evaluations available'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#98aabd' }}>
                Legacy Runtime (<code>src/fusion.ts</code>) vs. Unified Pipeline (<code>src/platform/pipeline/unified-pipeline-unit.ts</code>)
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span
                className="font-mono text-xs"
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: stats.totalEvaluated === 0 ? 'rgba(245,158,11,0.15)' : stats.divergent === 0 ? 'rgba(20, 241, 149, 0.15)' : 'rgba(255, 59, 105, 0.15)',
                  color: stats.totalEvaluated === 0 ? '#F59E0B' : stats.divergent === 0 ? '#14F195' : '#FF3B69',
                  border: '1px solid currentColor',
                }}
              >
                {stats.totalEvaluated === 0 ? <AlertTriangle size={12} /> : stats.divergent === 0 ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {stats.totalEvaluated === 0 ? 'STATUS UNKNOWN' : stats.divergent === 0 ? 'ZERO DIVERGENCES OBSERVED' : `${stats.divergent} DIVERGENCES`}
              </span>
              <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#98aabd', fontFamily: 'var(--font-mono, monospace)' }}>
                Hash verification: not supplied by this projection
              </div>
            </div>
          </div>

          {/* Architectural Invariants Callout */}
          <div className="sb-glass-card" style={{ borderLeft: '3px solid #9bcbff', padding: '1rem' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={16} color="#9bcbff" />
              Verification Requirements
            </h4>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.75rem', color: '#becad6', lineHeight: 1.6 }}>
              <li><strong>Authority separation:</strong> The audit must compare decisions without granting trade authority.</li>
              <li><strong>Matched inputs:</strong> Both runtimes need the same source-bound candidate and state evidence.</li>
              <li><strong>Discrepancy coverage:</strong> Decision, edge, safety, and exit differences must be recorded and verifiable.</li>
            </ul>
          </div>

          {/* Divergence Certificates Stream */}
          <div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={16} color="#14F195" />
              Audit Stream &amp; Emitted Certificates
            </h3>

            {certificates.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {certificates.map(cert => (
                  <article key={cert.certificateId} className="sb-glass-card" style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                      <div>
                        <span className="font-mono text-xs text-muted">
                          CERTIFICATE #{cert.certificateId}
                        </span>
                        <h4 style={{ margin: '2px 0', fontSize: '0.95rem', color: '#f0f4f8' }}>
                          Candidate {cert.mint?.slice(0, 8)}…{cert.mint?.slice(-6)}
                        </h4>
                        <span className="font-mono text-xs text-muted">
                          Evaluated: {new Date(cert.evaluatedAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <span
                        className="font-mono text-xs"
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          background: cert.hasDivergence ? 'rgba(255, 59, 105, 0.15)' : 'rgba(20, 241, 149, 0.15)',
                          color: cert.hasDivergence ? '#FF3B69' : '#14F195',
                          border: '1px solid currentColor',
                        }}
                      >
                        {cert.hasDivergence ? 'DRIFT DETECTED' : 'PARITY VERIFIED'}
                      </span>
                    </div>

                    {/* Side-by-Side Comparison */}
                    <div className="sb-divergence-split">
                      <div className="sb-decision-card">
                        <div className="sb-decision-title" style={{ color: '#9bcbff' }}>
                          <span>Legacy Runtime</span>
                          <span className="font-mono text-xs">fusion.ts</span>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Decision Pass:</span>
                          <b style={{ color: cert.oldDecision.pass ? '#14F195' : '#FF3B69' }}>
                            {cert.oldDecision.pass ? 'PASS' : 'FAIL'}
                          </b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Calculated Edge:</span>
                          <b className="font-mono">{cert.oldDecision.edgeBps} bps</b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Safety Gate:</span>
                          <b style={{ color: cert.oldDecision.safetyPassed ? '#14F195' : '#FF3B69' }}>
                            {cert.oldDecision.safetyPassed ? 'PASSED' : 'VETOED'}
                          </b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Exit Reason:</span>
                          <span className="font-mono text-xs">{cert.oldDecision.exitReason || 'NONE'}</span>
                        </div>
                      </div>

                      <div className="sb-decision-card">
                        <div className="sb-decision-title" style={{ color: '#14F195' }}>
                          <span>Unified Pipeline</span>
                          <span className="font-mono text-xs">unified-unit.ts</span>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Decision Pass:</span>
                          <b style={{ color: cert.newDecision.pass ? '#14F195' : '#FF3B69' }}>
                            {cert.newDecision.pass ? 'PASS' : 'FAIL'}
                          </b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Calculated Edge:</span>
                          <b className="font-mono">{cert.newDecision.edgeBps} bps</b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Safety Gate:</span>
                          <b style={{ color: cert.newDecision.safetyPassed ? '#14F195' : '#FF3B69' }}>
                            {cert.newDecision.safetyPassed ? 'PASSED' : 'VETOED'}
                          </b>
                        </div>
                        <div className="sb-decision-row">
                          <span className="text-muted">Exit Reason:</span>
                          <span className="font-mono text-xs">{cert.newDecision.exitReason || 'NONE'}</span>
                        </div>
                      </div>
                    </div>

                    {cert.hasDivergence && cert.divergenceReasons?.length > 0 && (
                      <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(255,59,105,0.08)', borderRadius: '4px', border: '1px solid rgba(255,59,105,0.2)' }}>
                        <b style={{ fontSize: '0.75rem', color: '#FF3B69' }}>Divergence Discrepancies:</b>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '1.25rem', fontSize: '0.75rem', color: '#f0f4f8' }}>
                          {cert.divergenceReasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Preimage Hash Verification */}
                    <div style={{ marginTop: '10px', padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="font-mono text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>
                        Preimage Hash: {cert.certificateHash}
                      </span>
                      <button
                        type="button"
                        className="op-button"
                        style={{ padding: '2px 6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleCopy(cert.certificateHash)}
                      >
                        {copiedHash === cert.certificateHash ? <Check size={12} color="#14F195" /> : <Copy size={12} />}
                        {copiedHash === cert.certificateHash ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="op-empty" style={{ padding: '2rem', textAlign: 'center' }}>
                <AlertTriangle size={32} style={{ color: '#F59E0B', margin: '0 auto 10px' }} />
                <h4 style={{ color: '#f0f4f8', margin: '0 0 6px' }}>Runtime parity is unknown</h4>
                <p style={{ color: '#98aabd', margin: 0, fontSize: '0.8rem' }}>
                  No paired runtime evaluations are available. An empty divergence list does not prove parity.
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default RuntimeDivergenceInspector;

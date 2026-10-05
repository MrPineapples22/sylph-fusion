import React, { useState, useEffect } from 'react';
import {
  X,
  Scale,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Layers,
  Database,
  Copy,
  Check,
  Zap,
} from 'lucide-react';
import { formatNumber } from '../design-system/format.js';

export function AdversarialCouncilDrawer({
  isOpen,
  onClose,
  selectedFactId = null,
  initialData = null,
}) {
  const [data, setData] = useState(initialData);
  const [capacity, setCapacity] = useState(initialData?.capacity || null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchCouncilState = async () => {
    if (typeof fetch === 'undefined') return;
    setLoading(true);
    try {
      const [verdictRes, capRes] = await Promise.all([
        fetch('/api/council/verdicts'),
        fetch('/api/council/capacity'),
      ]);
      if (verdictRes.ok) {
        const json = await verdictRes.json();
        setData(json);
      }
      if (capRes.ok) {
        const json = await capRes.json();
        setCapacity(json);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (!initialData) {
        fetchCouncilState();
      }
      const interval = setInterval(fetchCouncilState, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, selectedFactId]);

  if (!isOpen) return null;

  const verdict = data?.latestVerdict || data?.verdicts?.[0] || initialData?.latestVerdict || null;
  const status = verdict?.status || 'UNKNOWN';
  const isApproved = verdict?.approved === true;
  const rejectionReasons = verdict?.rejectionReasons || [];
  const prover = verdict?.prover || null;
  const skepticChecks = verdict?.skepticChecks || [];

  const copyHash = (hash) => {
    if (!hash || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor = status === 'SUFFICIENT' ? '#14F195'
    : status === 'CONTRADICTORY' ? '#FF3B69'
    : status === 'INSUFFICIENT' ? '#F59E0B'
    : status === 'DEGRADED' ? '#EAB308'
    : '#98aabd';
  const decisionLabel = status === 'UNKNOWN'
    ? 'EVALUATION UNAVAILABLE'
    : isApproved ? 'COUNCIL SUFFICIENT' : 'NOT SUFFICIENT';

  return (
    <div className="sb-drawer-overlay" onClick={onClose}>
      <aside
        className="sb-drawer-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-council-title"
      >
        <header className="sb-drawer-header">
          <div className="sb-drawer-header-title">
            <span className="font-mono text-xs text-muted" style={{ color: '#9bcbff', fontWeight: 600 }}>
              SECTION 30-34 · PROVER VS SKEPTIC &amp; WORKLOAD DEDUPLICATION
            </span>
            <h2 id="sb-council-title">
              <Scale size={20} style={{ color: '#9bcbff' }} />
              Adversarial Evidence Council
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="op-button"
              onClick={fetchCouncilState}
              disabled={loading}
              title="Refresh Dialectic Council State"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="op-button"
              onClick={onClose}
              aria-label="Close Dialectic Council Drawer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="sb-drawer-body">
          {/* Verdict Status Card */}
          <div
            className="sb-glass-card"
            style={{
              borderLeft: `4px solid ${statusColor}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <span className="font-mono text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DIALECTIC COUNCIL VERDICT
              </span>
              <h3 style={{ margin: '2px 0', fontSize: '1.25rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: statusColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isApproved ? <CheckCircle2 size={20} /> : status === 'UNKNOWN' ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
                  {status}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#becad6', fontWeight: 400 }}>
                  ({decisionLabel})
                </span>
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd' }}>
                Economic Fact ID: {verdict?.economicFactId || selectedFactId || 'Unknown'}
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                <span className="font-mono text-xs text-muted">Verdict Hash:</span>
                <button
                  type="button"
                  className="op-button"
                  style={{ padding: '2px 6px', fontSize: '10px' }}
                  onClick={() => copyHash(verdict?.councilVerdictHash)}
                  title="Copy Canonical SHA-256 Hash"
                >
                  {copied ? <Check size={11} color="#14F195" /> : <Copy size={11} />}
                  {verdict?.councilVerdictHash ? `${verdict.councilVerdictHash.slice(0, 10)}…` : 'Unavailable'}
                </button>
              </div>
              <div style={{ marginTop: '4px', fontSize: '0.7rem', color: '#98aabd' }}>
                Evaluated: {verdict?.evaluatedAt ? new Date(verdict.evaluatedAt).toLocaleTimeString() : 'Unavailable'}
              </div>
            </div>
          </div>

          {/* Epistemic Doctrine Alert */}
          <div className="sb-glass-card" style={{ padding: '0.85rem 1rem', borderLeft: '3px solid #9bcbff' }}>
            <b style={{ fontSize: '0.8rem', color: '#9bcbff' }}>Section 30 Epistemic Rules:</b>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#becad6', lineHeight: 1.5 }}>
              Prover asks: <em>&ldquo;What certified evidence supports this opportunity?&rdquo;</em> Skeptic asks: <em>&ldquo;What certified evidence could falsify it?&rdquo;</em>
              <br />
              <strong>Invariant:</strong> No majority vote may convert missing evidence into truth. <code>UNKNOWN != FALSE</code>. Order: <code>RISK_APPROVED &rarr; RESOURCE_ADMITTED &rarr; CAPITAL_RESERVED</code>.
            </p>
          </div>

          {/* Rejection / Veto Reasons if any */}
          {rejectionReasons.length > 0 && (
            <div style={{ background: 'rgba(255, 59, 105, 0.1)', border: '1px solid rgba(255, 59, 105, 0.3)', borderRadius: '6px', padding: '0.75rem 1rem' }}>
              <b style={{ color: '#FF3B69', fontSize: '0.8rem' }}>Rejection &amp; Veto Findings:</b>
              <ul style={{ margin: '4px 0 0 1rem', padding: 0, fontSize: '0.75rem', color: '#fca5a5' }}>
                {rejectionReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Side-by-Side Dialectic Grid */}
          <div className="sb-dialectic-grid">
            {/* Prover Card */}
            <div className="sb-prover-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#14F195', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={16} /> Prover Affirmative Evidence
                </h4>
                <span className="font-mono text-xs" style={{ color: prover?.temporalValidityVerified ? '#14F195' : '#FF3B69' }}>
                  {prover?.temporalValidityVerified ? 'TEMPORAL VALID' : 'STALE / UNVERIFIED'}
                </span>
              </div>

              {prover ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="sb-field-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Opportunity:</span>
                    <b className="font-mono">{prover.opportunityId}</b>
                  </div>
                  <div className="sb-field-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Token Mint:</span>
                    <b className="font-mono">{prover.tokenMint ? `${prover.tokenMint.slice(0, 12)}…` : 'Unknown'}</b>
                  </div>
                  <div className="sb-field-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Quote Price:</span>
                    <b className="font-mono">{(Number(prover.quotePriceLamports || 0) / 1e9).toFixed(6)} SOL</b>
                  </div>
                  <div className="sb-field-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span className="text-muted">Curve Liquidity Depth:</span>
                    <b className="font-mono">{(Number(prover.liquidityLamports || 0) / 1e9).toFixed(2)} SOL</b>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                      <span className="text-muted">Authenticity Score:</span>
                      <b className="font-mono" style={{ color: (prover.authenticityScore || 0) >= 80 ? '#14F195' : '#F59E0B' }}>
                        {prover.authenticityScore || 0} / 100
                      </b>
                    </div>
                    <div style={{ height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(0, prover.authenticityScore || 0))}%`,
                          background: (prover.authenticityScore || 0) >= 80 ? '#14F195' : '#F59E0B',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="op-empty" style={{ padding: '1rem', fontSize: '0.75rem' }}>
                  No Prover affirmative evidence submitted for this fact.
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.7rem', color: '#98aabd' }}>
                Prover Root: {verdict?.proverRoot ? `${verdict.proverRoot.slice(0, 16)}…` : 'None'}
              </div>
            </div>

            {/* Skeptic Card */}
            <div className="sb-skeptic-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#FF3B69', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={16} /> Skeptic Falsification Probes
                </h4>
                <span className="font-mono text-xs text-muted">
                  {skepticChecks.filter((c) => c.passed).length} / {skepticChecks.length} Passed
                </span>
              </div>

              <div className="sb-probe-list">
                {skepticChecks.length > 0 ? (
                  skepticChecks.map((check) => (
                    <div
                      key={check.checkName}
                      className={`sb-probe-item ${check.passed ? 'passed' : 'failed'}`}
                    >
                      <div>
                        <b style={{ color: check.passed ? '#becad6' : '#FF3B69' }}>{check.checkName}</b>
                        {check.reason && (
                          <div style={{ fontSize: '0.7rem', color: '#fca5a5', marginTop: '2px' }}>
                            {check.reason}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '9px',
                            padding: '2px 5px',
                            borderRadius: '3px',
                            background: check.severity === 'FATAL_VETO' ? 'rgba(255,59,105,0.2)' : 'rgba(245,158,11,0.2)',
                            color: check.severity === 'FATAL_VETO' ? '#FF3B69' : '#F59E0B',
                          }}
                        >
                          {check.severity}
                        </span>
                        <span style={{ fontWeight: 700, color: check.passed ? '#14F195' : '#FF3B69' }}>
                          {check.passed ? 'PASS' : 'VETO'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="op-empty" style={{ padding: '1rem', fontSize: '0.75rem' }}>
                    No Skeptic falsification checks registered.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.7rem', color: '#98aabd' }}>
                Skeptic Root: {verdict?.skepticRoot ? `${verdict.skepticRoot.slice(0, 16)}…` : 'None'}
              </div>
            </div>
          </div>

          {/* Section 33 & 34: Operational Capacity & Resource Admission */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={15} color="#9bcbff" />
              Resource Admission &amp; Operational Capacity (Prompt 33 &amp; 34)
            </h4>

            <div className="sb-capacity-grid">
              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>RPC Capacity</span>
                <b className="font-mono" style={{ color: capacity?.rpcCapacityAvailablePct == null ? '#98aabd' : capacity.rpcCapacityAvailablePct >= 30 ? '#14F195' : '#FF3B69', fontSize: '1rem' }}>
                  {capacity?.rpcCapacityAvailablePct == null ? 'UNKNOWN' : `${capacity.rpcCapacityAvailablePct}%`}
                </b>
              </div>

              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>Stream Feed</span>
                <b className="font-mono" style={{ color: capacity?.streamFeedHealthy == null ? '#98aabd' : capacity.streamFeedHealthy ? '#14F195' : '#FF3B69', fontSize: '0.85rem' }}>
                  {capacity?.streamFeedHealthy == null ? 'UNKNOWN' : capacity.streamFeedHealthy ? 'HEALTHY' : 'UNHEALTHY'}
                </b>
              </div>

              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>Archive Quorum</span>
                <b className="font-mono" style={{ color: capacity?.archiveQuorumAvailable == null ? '#98aabd' : capacity.archiveQuorumAvailable ? '#14F195' : '#FF3B69', fontSize: '0.85rem' }}>
                  {capacity?.archiveQuorumAvailable == null ? 'UNKNOWN' : capacity.archiveQuorumAvailable ? 'AVAILABLE' : 'OFFLINE'}
                </b>
              </div>

              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>Verification Queue</span>
                <b className="font-mono" style={{ fontSize: '1rem' }}>
                  {capacity?.verificationQueueDepth ?? 'UNKNOWN'} <span style={{ fontSize: '0.7rem', color: '#98aabd' }}> / 20</span>
                </b>
              </div>

              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>Active Liabilities</span>
                <b className="font-mono" style={{ fontSize: '1rem' }}>
                  {capacity?.activeUnresolvedLiabilities ?? 'UNKNOWN'} <span style={{ fontSize: '0.7rem', color: '#98aabd' }}> / 5</span>
                </b>
              </div>

              <div className="sb-capacity-card">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>Memory Pressure</span>
                <b className="font-mono" style={{ color: capacity?.memoryPressurePct == null ? '#98aabd' : capacity.memoryPressurePct < 80 ? '#14F195' : '#FF3B69', fontSize: '1rem' }}>
                  {capacity?.memoryPressurePct == null ? 'UNKNOWN' : `${capacity.memoryPressurePct}%`}
                </b>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default AdversarialCouncilDrawer;

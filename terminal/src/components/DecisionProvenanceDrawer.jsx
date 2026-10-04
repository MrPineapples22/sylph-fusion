import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Database,
  Copy,
  Check,
  Cpu,
  Layers,
  Activity,
  Fingerprint,
  Lock,
  AlertTriangle,
  FileCode,
  CheckCircle2,
  XCircle,
  MinusCircle,
  HelpCircle,
} from 'lucide-react';
import { evaluateDecisionProvenance } from '../decision-provenance-eval.js';

export function DecisionProvenanceDrawer({
  isOpen = false,
  onClose = () => {},
  candidate = null,
  snapshot = null,
  limits = {},
  policyContext = null,
  rejectionReason = null,
}) {
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const provenance = evaluateDecisionProvenance({
    candidate,
    snapshot,
    limits,
    policyContext,
    rejectionReason,
  });

  const handleCopySeal = () => {
    if (provenance.seal?.sealHash) {
      navigator.clipboard.writeText(provenance.seal.sealHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handleCopySnapshotJson = () => {
    const exportData = snapshot || provenance;
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const getDispositionBadge = (disp) => {
    switch (disp) {
      case 'cleared':
        return <span className="badge badge-success font-mono">CLEARED (APPROVED)</span>;
      case 'rejected':
        return <span className="badge badge-danger font-mono">REJECTED</span>;
      case 'modelUnavailable':
        return <span className="badge badge-warn font-mono">MODEL UNAVAILABLE (TIMEOUT)</span>;
      case 'notEvaluated':
        return <span className="badge badge-muted font-mono">NOT EVALUATED (CAPPED)</span>;
      default:
        return <span className="badge badge-info font-mono">{String(disp).toUpperCase()}</span>;
    }
  };

  return (
    <div
      className="provenance-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Decision Provenance Inspector"
    >
      <div
        className="provenance-drawer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="provenance-header">
          <div className="provenance-title-row">
            <div className="provenance-title-group">
              <span className="eyebrow flex items-center gap-1">
                <Fingerprint size={12} className="text-accent" />
                DECISION PROVENANCE &amp; FORENSIC AUDIT
              </span>
              <h3>
                {provenance.mint.slice(0, 10)}…{provenance.mint.slice(-6)}
              </h3>
            </div>
            <div className="provenance-actions">
              {getDispositionBadge(provenance.disposition)}
              <button
                type="button"
                className="btn-icon"
                onClick={onClose}
                aria-label="Close Provenance Drawer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Subheader Metadata Strip */}
          <div className="provenance-meta-strip font-mono text-xs">
            <div className="meta-chip">
              <span className="text-muted">SLOT:</span>
              <b>{provenance.slot || 'N/A'}</b>
            </div>
            <div className="meta-chip">
              <span className="text-muted">SCHEMA:</span>
              <b>v{provenance.schemaVersion}</b>
            </div>
            <div className="meta-chip">
              <span className="text-muted">OBSERVED:</span>
              <span>{provenance.timestamps.observedUtc.slice(11, 23)}Z</span>
            </div>
            <div className="meta-chip">
              <span className="text-muted">DECISION:</span>
              <span>{provenance.timestamps.decisionUtc.slice(11, 23)}Z</span>
            </div>
            <div className="meta-chip">
              <span className="text-muted">LATENCY:</span>
              <span className="text-accent">+{provenance.decisionLatencyMs}ms</span>
            </div>
          </div>
        </header>

        {/* Drawer Body Scroll */}
        <div className="provenance-body">
          {/* 1. Cryptographic Seal & Immutability Verification */}
          <section className="provenance-section">
            <div className="section-title">
              <Lock size={14} className="text-accent" />
              <h4>CRYPTOGRAPHIC SEAL INTEGRITY</h4>
            </div>
            <div className="seal-verification-card">
              <div className="seal-header">
                <div className="flex items-center gap-2">
                  {provenance.seal.verified ? (
                    <ShieldCheck size={18} className="text-good" />
                  ) : (
                    <ShieldAlert size={18} className="text-warn" />
                  )}
                  <span className="font-semibold text-sm">
                    {provenance.seal.reason}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm font-mono flex items-center gap-1"
                  onClick={handleCopySeal}
                  title="Copy SHA-256 seal hash"
                >
                  {copiedHash ? <Check size={12} className="text-good" /> : <Copy size={12} />}
                  <span>{copiedHash ? 'Copied' : 'Copy Seal'}</span>
                </button>
              </div>
              <div className="seal-hash-display font-mono text-xs text-muted">
                <span>{provenance.seal.sealHash}</span>
              </div>
              <div className="seal-properties font-mono text-xs">
                <span className={provenance.provenanceSeal.verifiedMonotonic ? 'text-good' : 'text-danger'}>
                  {provenance.provenanceSeal.verifiedMonotonic ? '✔ Monotonic Clock' : '✖ Inverted Clock'}
                </span>
                <span className="text-muted">•</span>
                <span className={provenance.provenanceSeal.verifiedSlot ? 'text-good' : 'text-warn'}>
                  {provenance.provenanceSeal.verifiedSlot ? '✔ Slot-Bounded' : '⚠ Unanchored Slot'}
                </span>
                <span className="text-muted">•</span>
                <span className={provenance.provenanceSeal.privacyPreserved ? 'text-good' : 'text-warn'}>
                  {provenance.provenanceSeal.privacyPreserved ? '✔ Privacy Hashed' : 'ℹ Raw Identifier'}
                </span>
              </div>
            </div>
          </section>

          {/* 2. Full Gate Pipeline Trace */}
          <section className="provenance-section">
            <div className="section-title">
              <Layers size={14} className="text-accent" />
              <h4>POINT-IN-TIME GATE SEQUENCE</h4>
            </div>
            <div className="gate-pipeline-list">
              {provenance.gates.map((gate, idx) => {
                const isFailed = gate.status === 'failed';
                const isPassed = gate.status === 'passed';
                const isSkipped = gate.status === 'skipped';

                return (
                  <div
                    key={gate.id}
                    className={`gate-trace-item ${isFailed ? 'gate-failed' : isPassed ? 'gate-passed' : 'gate-skipped'}`}
                  >
                    <div className="gate-status-col">
                      {isPassed && <CheckCircle2 size={16} className="text-good" />}
                      {isFailed && <XCircle size={16} className="text-danger" />}
                      {isSkipped && <MinusCircle size={16} className="text-muted" />}
                    </div>
                    <div className="gate-content-col">
                      <div className="gate-header-row">
                        <span className="gate-name font-mono">{gate.label}</span>
                        <span className={`gate-pill font-mono text-xs ${isPassed ? 'good' : isFailed ? 'bad' : 'muted'}`}>
                          {gate.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="gate-summary text-xs">
                        {gate.summary}
                      </div>
                      <div className="gate-details font-mono text-xs text-muted">
                        {gate.details}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Model Gate Telemetry (Fail-Closed & Timeout Proof) */}
          <section className="provenance-section">
            <div className="section-title">
              <Cpu size={14} className="text-accent" />
              <h4>MODEL GATE &amp; INFERENCE STATUS</h4>
            </div>
            <div className="model-gate-card">
              <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                <div className="model-stat-box">
                  <span className="stat-label">STATUS</span>
                  <b className={provenance.modelEvaluation.status === 'CLEARED' ? 'text-good' : provenance.modelEvaluation.status === 'UNAVAILABLE' ? 'text-warn' : 'text-muted'}>
                    {provenance.modelEvaluation.status}
                  </b>
                </div>
                <div className="model-stat-box">
                  <span className="stat-label">LATENCY</span>
                  <b className={provenance.modelEvaluation.inferenceLatencyMs > provenance.modelEvaluation.timeoutCapMs ? 'text-danger' : 'text-good'}>
                    {provenance.modelEvaluation.inferenceLatencyMs === null ? 'Not recorded' : `${provenance.modelEvaluation.inferenceLatencyMs.toFixed(1)} ms`}
                  </b>
                  <small className="text-muted">cap: {provenance.modelEvaluation.timeoutCapMs} ms</small>
                </div>
                <div className="model-stat-box">
                  <span className="stat-label">MODEL SCORE</span>
                  <b>{provenance.modelEvaluation.score !== null ? provenance.modelEvaluation.score.toFixed(2) : 'N/A'}</b>
                  <small className="text-muted">threshold: 0.70</small>
                </div>
              </div>
              <div className="model-reason-note text-xs font-mono text-muted mt-2">
                <span>{provenance.modelEvaluation.reason}</span>
              </div>
            </div>
          </section>

          {/* 4. Microstructure & Curve Snapshots */}
          <section className="provenance-section">
            <div className="section-title">
              <Activity size={14} className="text-accent" />
              <h4>DECISION-TIME FEATURE TELEMETRY</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Microstructure */}
              <div className="telemetry-card font-mono text-xs">
                <span className="card-subhead">MICROSTRUCTURE SNAPSHOT</span>
                <div className="telemetry-row">
                  <span className="text-muted">Unique Buyers (5m):</span>
                  <b>{Number.isSafeInteger(provenance.microstructure.buyerCount5m) ? provenance.microstructure.buyerCount5m : 'Unavailable'}</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Buy/Sell Tx Ratio:</span>
                  <b>{Number.isFinite(provenance.microstructure.buySellRatio) ? `${provenance.microstructure.buySellRatio}x` : 'Unavailable'}</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Buyer Arrival Velocity:</span>
                  <b>{Number.isFinite(provenance.microstructure.buyerArrivalVelocityPerSec) ? `${provenance.microstructure.buyerArrivalVelocityPerSec}/s` : 'Unavailable'}</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Creator Wallet:</span>
                  <span className="text-accent" title={provenance.microstructure.creatorWalletHashed}>
                    {provenance.microstructure.creatorWalletHashed.slice(0, 12)}…
                  </span>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Creator Balance:</span>
                  <b>{provenance.microstructure.creatorCurrentBalancePct}%</b>
                </div>
              </div>

              {/* Curve State */}
              <div className="telemetry-card font-mono text-xs">
                <span className="card-subhead">CURVE &amp; TRANSPORT STATE</span>
                <div className="telemetry-row">
                  <span className="text-muted">Token Age:</span>
                  <b>{provenance.curveState.tokenAgeSeconds}s</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Real SOL Reserves:</span>
                  <b>{provenance.curveState.realSolReserves} SOL</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Curve Completion:</span>
                  <b>{provenance.curveState.curveCompletionPct}%</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Reserve Drift:</span>
                  <b className={Number(provenance.curveState.reserveDriftPct) > 2.0 ? 'text-danger' : 'text-good'}>
                    {provenance.curveState.reserveDriftPct}%
                  </b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">RPC Latency:</span>
                  <b>{provenance.transport.leadingRpcLatencyMs}ms</b>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Distribution Provenance & Macro Yield Benchmark */}
          <section className="provenance-section">
            <div className="section-title">
              <ShieldCheck size={14} className="text-accent" />
              <h4>DISTRIBUTION PROVENANCE &amp; MACRO YIELD BENCHMARK</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Distribution Provenance (Streamflow) */}
              <div className="telemetry-card font-mono text-xs">
                <span className="card-subhead">STREAMFLOW DISTRIBUTION PROVENANCE</span>
                <div className="telemetry-row">
                  <span className="text-muted">Organic Buyer Ratio:</span>
                  <b className={(provenance.distribution?.organicBuyerRatio ?? 1.0) >= 0.8 ? 'text-good' : (provenance.distribution?.organicBuyerRatio ?? 1.0) >= 0.5 ? 'text-warn' : 'text-danger'}>
                    {provenance.distribution ? `${(provenance.distribution.organicBuyerRatio * 100).toFixed(1)}%` : '100.0%'}
                  </b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Streamflow Vesting Wallets:</span>
                  <b className={(provenance.distribution?.streamflowVestingCount ?? 0) > 0 ? 'text-warn' : 'text-good'}>
                    {provenance.distribution?.streamflowVestingCount ?? 0}
                  </b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Airdrop / Batch Sends:</span>
                  <b>{(provenance.distribution?.airdropRecipientCount ?? 0) + (provenance.distribution?.batchDistributionCount ?? 0)}</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Sybil Risk Status:</span>
                  <span className={provenance.distribution?.isSybilRiskElevated ? 'text-danger font-bold' : 'text-good'}>
                    {provenance.distribution?.isSybilRiskElevated ? 'ELEVATED DISTRIBUTION RISK' : 'ORGANIC BUY FLOW'}
                  </span>
                </div>
              </div>

              {/* Macro Yield Benchmark (Exponent & Lulo) */}
              <div className="telemetry-card font-mono text-xs">
                <span className="card-subhead">MACRO YIELD OPPORTUNITY COST</span>
                <div className="telemetry-row">
                  <span className="text-muted">Lulo Protected APY:</span>
                  <b className="text-good">{provenance.yieldBenchmark?.luloProtectedApyPct ?? 8.2}%</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Exponent PT Yield APY:</span>
                  <b className="text-good">{provenance.yieldBenchmark?.exponentPtYieldApyPct ?? 9.5}%</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Meme Hurdle (4x):</span>
                  <b className="text-accent">{provenance.yieldBenchmark?.hurdleRateAnnualizedPct ?? 35.4}% APR</b>
                </div>
                <div className="telemetry-row">
                  <span className="text-muted">Risk/Reward Verdict:</span>
                  <span className={provenance.yieldBenchmark?.isMemeRiskWorthwhile ? 'text-good font-bold' : 'text-warn font-bold'}>
                    {provenance.yieldBenchmark?.isMemeRiskWorthwhile ? 'EXPANSION PERMITTED' : 'PREFER SAFE YIELD'}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Policy & Execution Envelope */}
          <section className="provenance-section">
            <div className="section-title">
              <Database size={14} className="text-accent" />
              <h4>POLICY &amp; SIZING ENVELOPE</h4>
            </div>
            <div className="policy-grid font-mono text-xs">
              <div className="policy-item">
                <span className="text-muted">POLICY VERSION:</span>
                <b>{provenance.policy.policyVersion}</b>
              </div>
              <div className="policy-item">
                <span className="text-muted">TARGET SIZE:</span>
                <b>{provenance.policy.targetSizeSol} SOL</b>
              </div>
              <div className="policy-item">
                <span className="text-muted">MAX SLIPPAGE:</span>
                <b>{provenance.policy.maxSlippageBps} bps</b>
              </div>
              <div className="policy-item">
                <span className="text-muted">PRIORITY MULTIPLIER:</span>
                <b>{provenance.policy.priorityFeeMultiplier}x</b>
              </div>
              <div className="policy-item col-span-2">
                <span className="text-muted">EXIT LADDER HASH:</span>
                <span className="text-muted truncate">{provenance.policy.exitLadderConfigHash}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="provenance-footer">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm font-mono flex items-center gap-1"
              onClick={handleCopySnapshotJson}
            >
              {copiedJson ? <Check size={14} className="text-good" /> : <FileCode size={14} />}
              <span>{copiedJson ? 'Snapshot Copied' : 'Export Snapshot JSON'}</span>
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

export default DecisionProvenanceDrawer;

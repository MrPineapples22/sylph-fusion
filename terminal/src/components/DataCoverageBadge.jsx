import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertOctagon,
  Database,
  CheckCircle2,
  Clock,
  FileQuestion,
  Server,
  X,
  ChevronRight,
  Info,
} from 'lucide-react';
import { evaluateDataCoverage, HEALTH_TIERS } from '../data-coverage-eval.js';

export function DataCoverageBadge({
  candidates = [],
  outcomes = [],
  rpcStats = null,
  compact = false,
}) {
  const [showModal, setShowModal] = useState(false);

  const coverage = evaluateDataCoverage({
    candidates,
    outcomes,
    rpcStats,
  });

  const {
    totalCandidates,
    counts,
    percentages,
    confidenceScore,
    healthTier,
    statusMessage,
    diagnostics,
  } = coverage;

  const tierBadgeClass = healthTier === HEALTH_TIERS.EXCELLENT
    ? 'tier-excellent'
    : healthTier === HEALTH_TIERS.DEGRADED
    ? 'tier-degraded'
    : 'tier-critical';

  const tierIcon = healthTier === HEALTH_TIERS.EXCELLENT
    ? <ShieldCheck size={13} className="text-good" />
    : healthTier === HEALTH_TIERS.DEGRADED
    ? <ShieldAlert size={13} className="text-warn" />
    : <AlertOctagon size={13} className="text-danger" />;

  return (
    <>
      <button
        type="button"
        className={`data-coverage-badge ${tierBadgeClass}`}
        onClick={() => setShowModal(true)}
        title="Candidate Telemetry & Coverage Diagnostics (Operational Heuristic - Click for breakdown)"
        aria-label={`Coverage Diagnostic: ${confidenceScore}% (${healthTier}) - ${counts.resolved} Resolved, ${counts.censored} Censored, ${counts.missing} Missing, ${counts.infraFailed} Infra-Failed`}
      >
        {tierIcon}
        <span className="badge-score font-mono">{confidenceScore}%</span>
        {!compact && <span className="badge-text">COVERAGE DIAGNOSTIC</span>}
        <span className="badge-mini-counts font-mono">
          ({counts.resolved} Res / {counts.censored} Cens / {counts.infraFailed} Infra{counts.missing > 0 ? ` / ${counts.missing} Miss` : ''})
        </span>
      </button>

      {showModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="coverage-modal-title"
        >
          <div
            className="coverage-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="coverage-modal-header">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-accent" />
                <div>
                  <span className="eyebrow">TELEMETRY COMPLETENESS &amp; VALIDATION</span>
                  <h3 id="coverage-modal-title">Candidate Telemetry &amp; Coverage Diagnostics</h3>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowModal(false)}
                aria-label="Close coverage diagnostics"
              >
                <X size={18} />
              </button>
            </header>

            <div className="coverage-modal-body">
              {/* Top Summary Banner */}
              <div className={`coverage-tier-banner ${tierBadgeClass}`}>
                <div className="tier-score-box">
                  <span className="font-mono score-number">{confidenceScore}%</span>
                  <span className="score-sub">COVERAGE DIAGNOSTIC</span>
                </div>
                <div className="tier-info">
                  <div className="flex items-center gap-2">
                    <b>TIER: {healthTier}</b>
                    <span className="text-xs font-mono">
                      ({totalCandidates} Candidates: {counts.resolved} Resolved &bull; {counts.censored} Censored &bull; {counts.missing} Missing &bull; {counts.infraFailed} Infra)
                    </span>
                  </div>
                  <p className="text-xs mt-1">{statusMessage}</p>
                </div>
              </div>

              {/* Explicit Heuristic Notice */}
              <div className="callout callout-info">
                <div className="callout-icon">
                  <Info size={15} className="text-accent" />
                </div>
                <div className="callout-body">
                  <b>HEURISTIC METRIC SPECIFICATION</b>
                  <p>
                    This score is an operational coverage diagnostic heuristic (Resolved &times; 1.0 + Censored &times; 0.85 &minus; Infra &times; 0.35 &minus; Missing &times; 1.0), <strong>not a statistical confidence interval</strong>. It measures dataset completeness, feature snapshot sealing, and infrastructure reliability for the candidate sample.
                  </p>
                </div>
              </div>

              {/* 4 Category Breakdown Cards */}
              <div className="coverage-category-grid font-mono">
                {/* 1. Resolved */}
                <div className="category-card cat-resolved">
                  <div className="cat-header">
                    <CheckCircle2 size={15} className="text-good" />
                    <span>RESOLVED OUTCOMES</span>
                  </div>
                  <div className="cat-metric text-good">
                    <b>{counts.resolved}</b>
                    <small>({percentages.resolvedPct}%)</small>
                  </div>
                  <p className="cat-desc">
                    Tokens that reached a verified exit ladder tier, stop loss fill, or completed observation.
                  </p>
                </div>

                {/* 2. Censored */}
                <div className="category-card cat-censored">
                  <div className="cat-header">
                    <Clock size={15} className="text-cyan" />
                    <span>RIGHT-CENSORED</span>
                  </div>
                  <div className="cat-metric text-cyan">
                    <b>{counts.censored}</b>
                    <small>({percentages.censoredPct}%)</small>
                  </div>
                  <p className="cat-desc">
                    Active tokens at session halt or observation cutoff. Preserved without assumed loss.
                  </p>
                </div>

                {/* 3. Missing */}
                <div className={`category-card cat-missing ${counts.missing > 0 ? 'alert' : ''}`}>
                  <div className="cat-header">
                    <FileQuestion size={15} className={counts.missing > 0 ? 'text-danger' : 'text-muted'} />
                    <span>MISSING / MALFORMED</span>
                  </div>
                  <div className={`cat-metric ${counts.missing > 0 ? 'text-danger' : 'text-muted'}`}>
                    <b>{counts.missing}</b>
                    <small>({percentages.missingPct}%)</small>
                  </div>
                  <p className="cat-desc">
                    Incomplete features, clock non-monotonicity, or unsealed snapshots violating audit integrity.
                  </p>
                </div>

                {/* 4. Infra-Failed */}
                <div className={`category-card cat-infra ${counts.infraFailed > 0 ? 'alert' : ''}`}>
                  <div className="cat-header">
                    <Server size={15} className={counts.infraFailed > 0 ? 'text-warn' : 'text-muted'} />
                    <span>INFRASTRUCTURE FAILED</span>
                  </div>
                  <div className={`cat-metric ${counts.infraFailed > 0 ? 'text-warn' : 'text-muted'}`}>
                    <b>{counts.infraFailed}</b>
                    <small>({percentages.infraFailedPct}%)</small>
                  </div>
                  <p className="cat-desc">
                    Rejections caused strictly by RPC 429 throttling, drop rate limits, or model timeouts.
                  </p>
                </div>
              </div>

              {/* Detailed Diagnostics Breakdown */}
              <div className="coverage-diagnostics-section font-mono text-xs">
                <h4>DIAGNOSTIC EVENT REASONS</h4>
                <div className="diagnostics-columns">
                  <div>
                    <span className="diag-heading">INFRASTRUCTURE BOTTLENECKS:</span>
                    <ul>
                      <li>RPC 429 Rate Limits: <b>{diagnostics.infraReasons.rpcThrottled}</b></li>
                      <li>Model Fail-Closed Timeouts (&gt;10ms): <b>{diagnostics.infraReasons.modelUnavailable}</b></li>
                      <li>Transport Drops / Cluster Lag: <b>{diagnostics.infraReasons.transportTimeout}</b></li>
                      <li>Stale Market Feed (&gt;5s): <b>{diagnostics.infraReasons.feedStale}</b></li>
                    </ul>
                  </div>
                  <div>
                    <span className="diag-heading">FEATURE INTEGRITY:</span>
                    <ul>
                      <li>Clock Non-Monotonicity: <b>{diagnostics.missingReasons.clockInconsistency}</b></li>
                      <li>Missing Microstructure Features: <b>{diagnostics.missingReasons.missingMicrostructure}</b></li>
                      <li>Missing Curve State Reserves: <b>{diagnostics.missingReasons.missingCurveState}</b></li>
                      <li>Unsealed Feature Snapshots: <b>{diagnostics.missingReasons.unsealedFeatureSnapshot}</b></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <footer className="coverage-modal-footer">
              <small className="text-muted flex items-center gap-1">
                <Info size={12} /> Minimum 95% confidence with zero missing fields required for training-ready dataset.
              </small>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

export default DataCoverageBadge;

import React, { useState } from 'react';
import {
  GitCompare,
  CheckCircle2,
  AlertOctagon,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Sparkles,
  Zap,
  Filter,
  ArrowRight,
  Info,
  Fingerprint,
} from 'lucide-react';
import { evaluateModelDisagreement, DISAGREEMENT_TYPES } from '../model-disagreement-eval.js';

export function ModelDisagreementView({
  candidates = [],
  shadowThreshold = 0.70,
  latencyCapMs = 10.0,
  onInspectProvenance = null,
}) {
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'disagreements' | 'agreements' | 'unavailable'

  const evalResult = evaluateModelDisagreement({
    candidates,
    shadowThreshold,
    latencyCapMs,
  });

  const {
    totalEvaluated,
    quadrants,
    agreementRatePct,
    disagreementRatePct,
    latencyStats,
    featureCompletenessPct,
    comparisons,
  } = evalResult;

  const filteredCandidates = comparisons.filter(c => {
    if (filterMode === 'disagreements') {
      return c.disagreementType === DISAGREEMENT_TYPES.ML_FILTERED ||
             c.disagreementType === DISAGREEMENT_TYPES.ML_OPPORTUNITY;
    }
    if (filterMode === 'agreements') {
      return c.disagreementType === DISAGREEMENT_TYPES.MUTUAL_PASS ||
             c.disagreementType === DISAGREEMENT_TYPES.MUTUAL_REJECT;
    }
    if (filterMode === 'unavailable') {
      return c.disagreementType === DISAGREEMENT_TYPES.MODEL_UNAVAILABLE;
    }
    return true;
  });

  return (
    <article className="soak-card model-shadow-card" id="model-shadow-panel">
      {/* Header */}
      <header className="soak-card-header">
        <div>
          <span className="eyebrow flex items-center gap-1">
            <Sparkles size={12} className="text-accent" />
            SHADOW EVALUATION &amp; DISAGREEMENT ANALYSIS
          </span>
          <h3>Model Shadow vs Deterministic Strategy</h3>
        </div>
        <div className="shadow-header-meta font-mono text-xs flex items-center gap-2">
          <span className="pill pill-session">
            THRESHOLD: &ge;{(shadowThreshold * 100).toFixed(0)}%
          </span>
          <span className="pill pill-time">
            DEADLINE CAP: {latencyCapMs}ms
          </span>
        </div>
      </header>

      {/* Shadow Mode Safety Banner */}
      <div className="callout callout-info shadow-safety-banner">
        <div className="callout-icon">
          <Info size={16} className="text-accent" />
        </div>
        <div className="callout-body">
          <b>SHADOW-MODE ONLY &bull; ZERO LIVE OR PAPER EXECUTION PRIVILEGES</b>
          <p>
            Machine learning inference scores candidate tokens in parallel without exercising any influence over orders, position sizing, or stop triggers. Timed-out or failed inferences strictly trigger fail-closed rejection (<code>modelUnavailable</code>).
          </p>
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="shadow-kpi-grid font-mono">
        <div className="shadow-kpi">
          <span className="kpi-label">TOTAL EVALUATED</span>
          <b className="kpi-val">{totalEvaluated}</b>
          <small className="text-muted">Candidates logged</small>
        </div>
        <div className="shadow-kpi">
          <span className="kpi-label">AGREEMENT RATE</span>
          <b className="kpi-val text-good">{agreementRatePct}%</b>
          <small className="text-muted">Mutual confirmation</small>
        </div>
        <div className="shadow-kpi">
          <span className="kpi-label">DISAGREEMENT RATE</span>
          <b className={`kpi-val ${disagreementRatePct > 20 ? 'text-warn' : 'text-cyan'}`}>
            {disagreementRatePct}%
          </b>
          <small className="text-muted">Divergent signals</small>
        </div>
        <div className="shadow-kpi">
          <span className="kpi-label">P95 INFERENCE LATENCY</span>
          <b className={`kpi-val ${latencyStats.p95Ms > latencyCapMs ? 'text-danger' : 'text-good'}`}>
            {latencyStats.p95Ms}ms
          </b>
          <small className={latencyStats.deadlineBreaches > 0 ? 'text-danger' : 'text-muted'}>
            {latencyStats.deadlineBreaches} cap breaches (&gt;{latencyCapMs}ms)
          </small>
        </div>
        <div className="shadow-kpi">
          <span className="kpi-label">FEATURE COMPLETENESS</span>
          <b className="kpi-val text-good">{featureCompletenessPct}%</b>
          <small className="text-muted">Required inputs present</small>
        </div>
      </div>

      {/* 4-Quadrant Disagreement Matrix */}
      <div className="quadrant-matrix-section">
        <h4 className="font-mono text-xs text-muted mb-2">DECISION DISAGREEMENT QUADRANTS</h4>
        <div className="quadrant-grid font-mono text-xs">
          {/* 1. Mutual Pass */}
          <div className="quad-card quad-mutual-pass">
            <div className="quad-header">
              <CheckCircle2 size={15} className="text-good" />
              <span>{quadrants.mutualPass.label}</span>
            </div>
            <div className="quad-val text-good">
              <b>{quadrants.mutualPass.count}</b>
              <small>({quadrants.mutualPass.pct}%)</small>
            </div>
            <p>{quadrants.mutualPass.desc}</p>
          </div>

          {/* 2. Mutual Reject */}
          <div className="quad-card quad-mutual-reject">
            <div className="quad-header">
              <ShieldCheck size={15} className="text-muted" />
              <span>{quadrants.mutualReject.label}</span>
            </div>
            <div className="quad-val text-muted">
              <b>{quadrants.mutualReject.count}</b>
              <small>({quadrants.mutualReject.pct}%)</small>
            </div>
            <p>{quadrants.mutualReject.desc}</p>
          </div>

          {/* 3. ML Filtered */}
          <div className="quad-card quad-ml-filtered">
            <div className="quad-header">
              <ShieldAlert size={15} className="text-warn" />
              <span>{quadrants.mlFiltered.label}</span>
            </div>
            <div className="quad-val text-warn">
              <b>{quadrants.mlFiltered.count}</b>
              <small>({quadrants.mlFiltered.pct}%)</small>
            </div>
            <p>{quadrants.mlFiltered.desc}</p>
          </div>

          {/* 4. ML Opportunity */}
          <div className="quad-card quad-ml-opp">
            <div className="quad-header">
              <Zap size={15} className="text-accent" />
              <span>{quadrants.mlOpportunity.label}</span>
            </div>
            <div className="quad-val text-accent">
              <b>{quadrants.mlOpportunity.count}</b>
              <small>({quadrants.mlOpportunity.pct}%)</small>
            </div>
            <p>{quadrants.mlOpportunity.desc}</p>
          </div>

          {/* 5. Fail-Closed Model Unavailable */}
          <div className={`quad-card quad-unavailable ${quadrants.modelUnavailable.count > 0 ? 'alert' : ''}`}>
            <div className="quad-header">
              <AlertOctagon size={15} className={quadrants.modelUnavailable.count > 0 ? 'text-danger' : 'text-muted'} />
              <span>{quadrants.modelUnavailable.label}</span>
            </div>
            <div className={`quad-val ${quadrants.modelUnavailable.count > 0 ? 'text-danger' : 'text-muted'}`}>
              <b>{quadrants.modelUnavailable.count}</b>
              <small>({quadrants.modelUnavailable.pct}%)</small>
            </div>
            <p>{quadrants.modelUnavailable.desc}</p>
          </div>
        </div>
      </div>

      {/* Candidate-by-Candidate Disagreement Table */}
      <div className="shadow-table-section mt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-mono text-xs text-muted">EVALUATED CANDIDATE TAPE ({filteredCandidates.length})</h4>
          <div className="tape-filter-tabs font-mono text-xs flex gap-1">
            <button
              type="button"
              className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All ({comparisons.length})
            </button>
            <button
              type="button"
              className={`filter-btn ${filterMode === 'disagreements' ? 'active' : ''}`}
              onClick={() => setFilterMode('disagreements')}
            >
              Disagreements ({quadrants.mlFiltered.count + quadrants.mlOpportunity.count})
            </button>
            <button
              type="button"
              className={`filter-btn ${filterMode === 'agreements' ? 'active' : ''}`}
              onClick={() => setFilterMode('agreements')}
            >
              Agreements ({quadrants.mutualPass.count + quadrants.mutualReject.count})
            </button>
            <button
              type="button"
              className={`filter-btn ${filterMode === 'unavailable' ? 'active' : ''}`}
              onClick={() => setFilterMode('unavailable')}
            >
              Unavailable ({quadrants.modelUnavailable.count})
            </button>
          </div>
        </div>

        <div className="table-scroll font-mono text-xs">
          <table>
            <thead>
              <tr>
                <th>TOKEN / MINT</th>
                <th>SLOT</th>
                <th>DETERMINISTIC VERDICT</th>
                <th>SHADOW ML SCORE</th>
                <th>LATENCY</th>
                <th>DISAGREEMENT CLASSIFICATION</th>
                <th>FINAL ACTION</th>
                <th>PROVENANCE</th>
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.map((c) => {
                const isPass = c.deterministicVerdict === 'PASS';
                const isMlPass = c.mlStatus === 'PASS';
                const isTimeout = c.disagreementType === DISAGREEMENT_TYPES.MODEL_UNAVAILABLE;

                return (
                  <tr key={c.candidateId}>
                    <td>
                      <b title={c.mint}>{c.mint ? `${c.mint.slice(0, 6)}...${c.mint.slice(-4)}` : c.candidateId}</b>
                    </td>
                    <td>{c.slot}</td>
                    <td>
                      <span className={`badge ${isPass ? 'badge-success' : 'badge-danger'}`}>
                        {c.deterministicVerdict}
                      </span>
                    </td>
                    <td>
                      <b className={isTimeout ? 'text-danger' : isMlPass ? 'text-good' : 'text-muted'}>
                        {c.mlScore === null ? 'Not recorded' : isTimeout ? 'UNAVAILABLE' : `${(c.mlScore * 100).toFixed(1)}%`}
                      </b>
                    </td>
                    <td>
                      <span className={c.latencyBreached ? 'text-danger font-bold' : 'text-muted'}>
                        {c.latencyMs === null ? 'Not recorded' : `${c.latencyMs}ms`} {c.latencyBreached && '!'}
                      </span>
                    </td>
                    <td>
                      <span className="classification-tag">
                        {c.disagreementType.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <code className="text-muted">{c.finalDisposition}</code>
                    </td>
                    <td>
                      {onInspectProvenance && (
                        <button
                          type="button"
                          className="btn-mini flex items-center gap-1"
                          onClick={() => onInspectProvenance({ candidate: c })}
                          title="Inspect snapshot provenance and feature seal"
                        >
                          <Fingerprint size={11} /> Trace
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredCandidates.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    No candidates found matching filter '{filterMode}'.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="soak-card-footer">
        <small>
          Shadow evaluation strictly requires reproducible feature snapshots and 10ms cooperative AbortSignal compliance before entering live evaluation pipelines.
        </small>
      </footer>
    </article>
  );
}

export default ModelDisagreementView;

import React, { useState, useEffect } from 'react';
import {
  GitCompare,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  Server,
  Filter,
  CheckCircle2,
  RefreshCw,
  Clock,
  Zap,
  ArrowRight,
  Layers
} from 'lucide-react';

export function SessionComparison({ availableSessions = [], defaultSessionA = '', defaultSessionB = '' }) {
  const [sessionA, setSessionA] = useState(defaultSessionA || availableSessions[0] || '');
  const [sessionB, setSessionB] = useState(defaultSessionB || availableSessions[1] || availableSessions[0] || '');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionA && availableSessions.length > 0) setSessionA(availableSessions[0]);
    if (!sessionB && availableSessions.length > 1) setSessionB(availableSessions[1]);
  }, [availableSessions]);

  useEffect(() => {
    if (!sessionA || !sessionB) return;
    let active = true;
    const fetchComparison = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/soak/compare?sessionA=${encodeURIComponent(sessionA)}&sessionB=${encodeURIComponent(sessionB)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) setComparison(data);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchComparison();
    return () => { active = false; };
  }, [sessionA, sessionB]);

  if (availableSessions.length < 2 && !comparison) {
    return (
      <article className="soak-card comparison-card" id="session-comparison-panel">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">A/B BENCHMARK ANALYSIS</span>
            <h3>Session Comparison Mode</h3>
          </div>
        </header>
        <div className="empty-substate" role="status">
          <GitCompare size={24} className="text-warn" />
          <div>
            <b>Requires at least two soak sessions for comparative analysis</b>
            <p>
              Run multiple soak sessions (e.g. baseline smoke run vs private RPC run) to compare quality scores, funnel attrition, and rejection taxonomy shifts side by side.
            </p>
          </div>
        </div>
      </article>
    );
  }

  const sA = comparison?.sessionA;
  const sB = comparison?.sessionB;
  const deltas = comparison?.summaryDeltas;

  return (
    <article className="soak-card comparison-card" id="session-comparison-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">A/B BENCHMARK ANALYSIS</span>
          <h3>Session Comparison Mode</h3>
        </div>
        <div className="comparison-selectors">
          <div className="compare-select-wrap">
            <small>SESSION A (BASELINE):</small>
            <select
              value={sessionA}
              onChange={e => setSessionA(e.target.value)}
              className="session-select font-mono"
            >
              {availableSessions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <span className="vs-tag font-mono">VS</span>

          <div className="compare-select-wrap">
            <small>SESSION B (CANDIDATE):</small>
            <select
              value={sessionB}
              onChange={e => setSessionB(e.target.value)}
              className="session-select font-mono"
            >
              {availableSessions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {error && (
        <div className="soak-error-banner" role="alert">
          <ShieldAlert size={14} />
          <span>Comparison error: {error}</span>
        </div>
      )}

      {loading && (
        <div className="comparison-loading font-mono">
          <RefreshCw size={14} className="animate-spin" />
          <span>Computing comparative differential...</span>
        </div>
      )}

      {comparison && (
        <div className="comparison-body">
          {/* Top-level Delta Metric Cards */}
          <div className="comparison-metrics-grid">
            {/* 1. Quality Score */}
            <div className="compare-metric-card">
              <span className="metric-label">QUALITY SCORE</span>
              <div className="compare-vals font-mono">
                <span className="val-a">{sA?.score?.toFixed(1) ?? '0.0'}</span>
                <ArrowRight size={12} className="text-muted" />
                <span className="val-b">{sB?.score?.toFixed(1) ?? '0.0'}</span>
              </div>
              <div className="delta-row font-mono">
                <span className={`delta-tag ${deltas?.scoreDelta >= 0 ? 'good' : 'bad'}`}>
                  {deltas?.scoreDelta >= 0 ? '+' : ''}{deltas?.scoreDelta ?? 0} pts
                </span>
                <small>0–100 scale</small>
              </div>
            </div>

            {/* 2. RPC Candidate Drop Rate */}
            <div className="compare-metric-card">
              <span className="metric-label">RPC CANDIDATE DROP RATE</span>
              <div className="compare-vals font-mono">
                <span className="val-a">{sA?.rpcDropRate?.toFixed(1) ?? '0.0'}%</span>
                <ArrowRight size={12} className="text-muted" />
                <span className="val-b">{sB?.rpcDropRate?.toFixed(1) ?? '0.0'}%</span>
              </div>
              <div className="delta-row font-mono">
                <span className={`delta-tag ${deltas?.rpcDropRateDelta <= 0 ? 'good' : 'bad'}`}>
                  {deltas?.rpcDropRateDelta >= 0 ? '+' : ''}{deltas?.rpcDropRateDelta ?? 0}%
                </span>
                <small>&lt;5% required for gate</small>
              </div>
            </div>

            {/* 3. HTTP 429 Drops */}
            <div className="compare-metric-card">
              <span className="metric-label">HTTP 429 THROTTLE DROPS</span>
              <div className="compare-vals font-mono">
                <span className="val-a">{sA?.rpcDropsCount ?? 0}</span>
                <ArrowRight size={12} className="text-muted" />
                <span className="val-b">{sB?.rpcDropsCount ?? 0}</span>
              </div>
              <div className="delta-row font-mono">
                <span className={`delta-tag ${deltas?.rpcDropsDelta <= 0 ? 'good' : 'bad'}`}>
                  {deltas?.rpcDropsDelta >= 0 ? '+' : ''}{deltas?.rpcDropsDelta ?? 0} drops
                </span>
                <small>Cluster throttling</small>
              </div>
            </div>

            {/* 4. 24h Soak Clearance */}
            <div className="compare-metric-card">
              <span className="metric-label">24H BASELINE GATE</span>
              <div className="compare-vals font-mono text-xs">
                <span className={sA?.gatePassed ? 'text-good' : 'text-danger'}>
                  {sA?.gatePassed ? 'PASSED' : 'BLOCKED'}
                </span>
                <ArrowRight size={12} className="text-muted" />
                <span className={sB?.gatePassed ? 'text-good' : 'text-danger'}>
                  {sB?.gatePassed ? 'PASSED' : 'BLOCKED'}
                </span>
              </div>
              <div className="delta-row font-mono">
                <small>{sB?.gatePassed ? 'Ready for 24h soak' : 'Throttled by RPC limits'}</small>
              </div>
            </div>
          </div>

          {/* Funnel Pass-Through Comparison Table */}
          <div className="compare-section">
            <div className="compare-section-header">
              <Filter size={14} />
              <h4>CANDIDATE FUNNEL PASS-THROUGH COMPARISON</h4>
              <small>Gate-by-gate pass count and retention percentage</small>
            </div>
            <div className="table-scroll">
              <table className="compare-table font-mono">
                <thead>
                  <tr>
                    <th>GATE</th>
                    <th>SESSION A (COUNT / %)</th>
                    <th>SESSION B (COUNT / %)</th>
                    <th>COUNT DELTA</th>
                    <th>CONVERSION DIFF</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparison.funnelComparison || []).map((fc) => {
                    const countDiff = fc.delta;
                    const pctDiff = Math.round((fc.pctB - fc.pctA) * 10) / 10;
                    return (
                      <tr key={fc.gate}>
                        <td><b>{fc.gate}</b></td>
                        <td>{fc.countA} ({fc.pctA}%)</td>
                        <td>{fc.countB} ({fc.pctB}%)</td>
                        <td className={countDiff >= 0 ? 'text-good' : 'text-danger'}>
                          {countDiff >= 0 ? '+' : ''}{countDiff}
                        </td>
                        <td className={pctDiff >= 0 ? 'text-good' : 'text-danger'}>
                          {pctDiff >= 0 ? '+' : ''}{pctDiff}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rejection Taxonomy Shift Table */}
          <div className="compare-section">
            <div className="compare-section-header">
              <Server size={14} />
              <h4>REJECTION TAXONOMY SHIFT</h4>
              <small>Categorical distribution shift between sessions</small>
            </div>
            <div className="table-scroll">
              <table className="compare-table font-mono">
                <thead>
                  <tr>
                    <th>REJECTION REASON</th>
                    <th>CATEGORY</th>
                    <th>SESSION A</th>
                    <th>SESSION B</th>
                    <th>COUNT DELTA</th>
                    <th>SHARE DIFF</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparison.rejectionDiff || []).map((rd) => {
                    const isRpc = rd.category === 'rpc';
                    return (
                      <tr key={rd.reason}>
                        <td>{rd.reason}</td>
                        <td><span className="category-tag">{rd.category.toUpperCase()}</span></td>
                        <td>{rd.countA} ({rd.pctA}%)</td>
                        <td>{rd.countB} ({rd.pctB}%)</td>
                        <td className={isRpc ? (rd.deltaCount <= 0 ? 'text-good' : 'text-danger') : 'text-muted'}>
                          {rd.deltaCount >= 0 ? '+' : ''}{rd.deltaCount}
                        </td>
                        <td className={isRpc ? (rd.deltaPct <= 0 ? 'text-good' : 'text-danger') : 'text-muted'}>
                          {rd.deltaPct >= 0 ? '+' : ''}{rd.deltaPct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="soak-card-footer">
        <small>
          A/B session benchmarking isolates network variance from strategy efficiency. Clearing the 24-hour baseline requires the RPC drop rate to fall below 5%.
        </small>
      </div>
    </article>
  );
}

export default SessionComparison;

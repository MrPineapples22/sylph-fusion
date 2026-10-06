import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap,
  Radio,
  FileSpreadsheet,
  Download,
  FileText,
  Sliders,
  ChevronDown,
  Filter,
  RotateCcw,
  GitCompare,
  Sparkles,
  FileCode,
} from 'lucide-react';
import { CandidateFunnel } from './CandidateFunnel.jsx';
import { OrderLifecycleTimeline } from './OrderLifecycleTimeline.jsx';
import { RpcComparisonPanel } from './RpcComparisonPanel.jsx';
import { SessionReplayViewer } from './SessionReplayViewer.jsx';
import { SessionComparison } from './SessionComparison.jsx';
import { ModelDisagreementView } from './ModelDisagreementView.jsx';
import { ArtifactManifestPanel } from './ArtifactManifestPanel.jsx';
import { getSoakSessionGateLabel, readSoakQualityScore, readSoakSessionEvidence } from '../soak-session-evidence.js';

const CATEGORY_COLORS = {
  rpc: '#FF3B69',
  curve: '#9945FF',
  safety: '#FFB800',
  liquidity: '#00C2FF',
  other: '#A6B1C4'
};

const CATEGORY_LABELS = {
  rpc: 'NETWORK / RPC',
  curve: 'CURVE STATE',
  safety: 'SAFETY GATE',
  liquidity: 'LIQUIDITY FLOOR',
  other: 'OTHER'
};

export function SoakTelemetry() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [selectedSession, setSelectedSession] = useState('');
  const [activeView, setActiveView] = useState('overview');

  const fetchTelemetry = useCallback(async (signal, sessionParam = null) => {
    try {
      const activeSession = sessionParam !== null ? sessionParam : selectedSession;
      const url = activeSession ? `/api/soak?session=${encodeURIComponent(activeSession)}` : '/api/soak';
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.session?.sessionDir && !selectedSession) {
        setSelectedSession(json.session.sessionDir);
      }
      setLastRefreshed(new Date());
      setError(null);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedSession]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTelemetry(controller.signal);
    const interval = setInterval(() => {
      fetchTelemetry(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchTelemetry]);

  const handleSessionChange = (newSession) => {
    setSelectedSession(newSession);
    fetchTelemetry(null, newSession);
  };

  const session = data?.session;
  const rpcHealth = readSoakSessionEvidence(session?.rpcHealth);
  const taxonomy = session?.rejections?.taxonomy || [];
  const totalRejections = Number.isSafeInteger(session?.rejections?.total) && session.rejections.total >= 0
    ? session.rejections.total
    : null;
  const blockedExits = session?.blockedExits;
  const fills = session?.fills;
  const latestCheckpoint = session?.latestCheckpoint;
  const qualityScore = readSoakQualityScore(session?.baselineQualityScore);
  const availableSessions = session?.availableSessions || [];

  const handleExport = (format) => {
    if (!session?.sessionDir) return;
    const url = `/api/soak/export?session=${encodeURIComponent(session.sessionDir)}&format=${format}`;
    window.location.href = url;
  };

  return (
    <section className="soak-telemetry" id="soak-telemetry-panel">
      {/* Top Header Bar */}
      <div className="soak-header">
        <div className="soak-title-wrap">
          <h2>
            <Server size={17} />
            Soak Telemetry &amp; Baseline Quality Gate
          </h2>
          <div className="soak-badges">
            <span className={`pill ${data?.engineRunning ? 'pill-active' : 'pill-idle'}`}>
              <Radio size={11} className={data?.engineRunning ? 'animate-pulse' : ''} />
              {data?.engineRunning ? 'ENGINE RUNNING (PORT 8787)' : 'SESSION LOG READER'}
            </span>
            {session?.sessionDir && (
              <span className="pill pill-session font-mono">
                <Database size={11} />
                {session.sessionDir}
              </span>
            )}
            {session?.runtimeSeconds != null && (
              <span className="pill pill-time font-mono">
                <Clock size={11} />
                {Math.floor(session.runtimeSeconds / 60)}m {session.runtimeSeconds % 60}s runtime
              </span>
            )}
          </div>
        </div>
        <div className="soak-actions">
          {lastRefreshed && (
            <small className="soak-poll-time">
              Updated {lastRefreshed.toLocaleTimeString('en-US', { hour12: false })}
            </small>
          )}
          <button
            className="icon-button"
            aria-label="Refresh soak telemetry"
            disabled={loading}
            onClick={() => fetchTelemetry()}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="soak-error-banner" role="alert">
          <AlertTriangle size={15} />
          <span>Telemetry fetch error: {error}</span>
        </div>
      )}

      {/* Soak Session Controls Bar */}
      <div className="session-controls-bar" aria-label="Session selector & export toolbar">
        <div className="session-selector-wrap">
          <label htmlFor="soak-session-select">
            <Sliders size={13} />
            <span>SESSION RUN:</span>
          </label>
          <select
            id="soak-session-select"
            value={selectedSession || session?.sessionDir || ''}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="session-select font-mono"
          >
            {availableSessions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Baseline Quality Score Badge */}
        <div className="score-badge-wrap">
          <span className="score-label">QUALITY SCORE:</span>
          <b
            className={`font-mono score-val ${
              qualityScore === null ? 'score-unknown' : qualityScore >= 80 ? 'score-high' : qualityScore >= 50 ? 'score-mid' : 'score-low'
            }`}
          >
            {qualityScore === null ? 'Unknown' : `${qualityScore.toFixed(1)} / 100`}
          </b>
        </div>

        {/* Session-scoped historical gate result; it is not live run permission. */}
        <div className="clearance-badge-wrap">
          <span className="clearance-label">SESSION GATE RESULT:</span>
          <span
            className={`soak-clearance-pill ${
              rpcHealth?.gatePassed === true ? 'clearance-approved' : rpcHealth?.gatePassed === false ? 'clearance-blocked' : 'clearance-unverified'
            }`}
          >
            {rpcHealth?.gatePassed === true ? (
              <>
                <CheckCircle2 size={12} /> PASSED · SESSION RESULT
              </>
            ) : rpcHealth?.gatePassed === false ? (
              <>
                <ShieldAlert size={12} /> BLOCKED · SESSION RESULT
              </>
            ) : (
              <><ShieldAlert size={12} /> UNVERIFIED</>
            )}
          </span>
        </div>

        {/* Export Action Buttons */}
        <div className="session-export-actions">
          <button
            className="export-btn"
            onClick={() => handleExport('jsonl')}
            title="Download session JSONL log (read-only export)"
          >
            <Download size={13} /> JSONL
          </button>
          <button
            className="export-btn"
            onClick={() => handleExport('csv')}
            title="Download tabular fills CSV (read-only export)"
          >
            <FileSpreadsheet size={13} /> CSV
          </button>
          <button
            className="export-btn"
            onClick={() => handleExport('summary')}
            title="Download structured JSON summary report"
          >
            <FileText size={13} /> Summary
          </button>
        </div>
      </div>

      {/* Quality Gate Status Alert */}
      {(
        <div
          className={`gate-alert ${rpcHealth?.gatePassed === true ? 'gate-passed' : rpcHealth?.gatePassed === false ? 'gate-blocked' : 'gate-unverified'}`}
          role="region"
          aria-label="Selected session quality gate result"
        >
          <div className="gate-alert-icon">
            {rpcHealth?.gatePassed === true ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}
          </div>
          <div className="gate-alert-content">
            <div className="gate-alert-title">
              <b>{rpcHealth?.gatePassed === true ? 'SESSION GATE RESULT: PASSED' : rpcHealth?.gatePassed === false ? 'SESSION GATE RESULT: BLOCKED' : 'SESSION GATE RESULT: UNVERIFIED'}</b>
              <span className="gate-metric font-mono">
                {rpcHealth?.rateLimitPct ?? 'Unknown'}{rpcHealth?.rateLimitPct != null ? '%' : ''} Rate-Limit Rejections ({rpcHealth?.failedRpcCount ?? 'Unknown'} / {totalRejections ?? 'Unknown'})
              </span>
            </div>
            <p>{rpcHealth?.alert || 'This selected session has no explicit gate explanation. Session history is not live run permission.'}</p>
          </div>
        </div>
      )}

      {/* Operational View Sub-Tabs */}
      <div className="soak-subtabs-row" role="tablist" aria-label="Soak operational telemetry views">
        <button
          role="tab"
          aria-selected={activeView === 'overview'}
          className={`subtab-btn ${activeView === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveView('overview')}
        >
          <Layers size={13} /> Overview &amp; Taxonomy
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'funnel'}
          className={`subtab-btn ${activeView === 'funnel' ? 'active' : ''}`}
          onClick={() => setActiveView('funnel')}
        >
          <Filter size={13} /> Candidate Funnel
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'timeline'}
          className={`subtab-btn ${activeView === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveView('timeline')}
        >
          <Clock size={13} /> Order Lifecycle
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'rpc'}
          className={`subtab-btn ${activeView === 'rpc' ? 'active' : ''}`}
          onClick={() => setActiveView('rpc')}
        >
          <Server size={13} /> RPC Comparison
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'replay'}
          className={`subtab-btn ${activeView === 'replay' ? 'active' : ''}`}
          onClick={() => setActiveView('replay')}
        >
          <RotateCcw size={13} /> Session Replay
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'compare'}
          className={`subtab-btn ${activeView === 'compare' ? 'active' : ''}`}
          onClick={() => setActiveView('compare')}
        >
          <GitCompare size={13} /> Compare Sessions
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'shadow'}
          className={`subtab-btn ${activeView === 'shadow' ? 'active' : ''}`}
          onClick={() => setActiveView('shadow')}
        >
          <Sparkles size={13} /> Model Shadow
        </button>
        <button
          role="tab"
          aria-selected={activeView === 'manifest'}
          className={`subtab-btn ${activeView === 'manifest' ? 'active' : ''}`}
          onClick={() => setActiveView('manifest')}
        >
          <FileCode size={13} /> Artifact Manifest
        </button>
      </div>

      {(() => {
        const isDisconnected = Boolean(error) || (!loading && !data);
        if (activeView === 'funnel') {
          return (
            <CandidateFunnel
              funnelData={session?.funnel || data?.liveEngine?.funnel}
              liveCandidates={session?.candidatesSample || data?.liveEngine?.candidates || []}
              isDisconnected={isDisconnected}
            />
          );
        }
        if (activeView === 'timeline') {
          return (
            <OrderLifecycleTimeline
              orders={session?.fills?.recent || []}
              pendingOrder={data?.liveEngine?.pending}
              isDisconnected={isDisconnected}
            />
          );
        }
        if (activeView === 'rpc') {
          return (
            <RpcComparisonPanel
              rpcEndpoints={data?.liveEngine?.rpcEndpoints}
              rpcHealth={rpcHealth}
              onRefresh={() => fetchTelemetry()}
              isDisconnected={isDisconnected}
            />
          );
        }
        return null;
      })()}

      {activeView === 'replay' && (
        <SessionReplayViewer
          currentSession={selectedSession || session?.sessionDir}
          availableSessions={availableSessions}
        />
      )}

      {activeView === 'compare' && (
        <SessionComparison
          availableSessions={availableSessions}
          defaultSessionA={selectedSession || availableSessions[0]}
          defaultSessionB={availableSessions[1] || availableSessions[0]}
        />
      )}

      {activeView === 'shadow' && (
        <ModelDisagreementView
          candidates={session?.candidatesSample || data?.liveEngine?.candidates || []}
          shadowThreshold={0.70}
          latencyCapMs={10.0}
        />
      )}

      {activeView === 'manifest' && (
        <ArtifactManifestPanel
          session={session}
          config={data?.liveEngine?.config}
          candidates={session?.candidatesSample || data?.liveEngine?.candidates || []}
          fills={session?.fills?.recent || []}
        />
      )}

      {activeView === 'overview' && (
      /* Main Grid: Rejection Taxonomy & RPC / System Metrics */
      <div className="soak-grid">
        {/* Rejection Taxonomy Card */}
        <article className="soak-card taxonomy-card">
          <header className="soak-card-header">
            <div>
              <span className="eyebrow">EMPIRICAL CANDIDATE REJECTIONS</span>
              <h3>Structured Rejection Taxonomy</h3>
            </div>
            <span className="count font-mono">{totalRejections} rejected</span>
          </header>

          {/* Proportional distribution bar */}
          {totalRejections > 0 && (
            <div className="taxonomy-bar-wrap" aria-label="Rejection distribution chart">
              <div className="taxonomy-bar">
                {taxonomy.map((item) => (
                  <div
                    key={item.reason}
                    className="taxonomy-bar-segment"
                    style={{
                      width: `${item.pct}%`,
                      backgroundColor: CATEGORY_COLORS[item.category] || '#999'
                    }}
                    title={`${item.reason}: ${item.count} (${item.pct}%)`}
                  />
                ))}
              </div>
              <div className="taxonomy-legend">
                {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                  const matching = taxonomy.filter((t) => t.category === cat);
                  const sumPct = matching.reduce((acc, x) => acc + x.pct, 0);
                  if (sumPct === 0) return null;
                  return (
                    <span key={cat} className="taxonomy-legend-item">
                      <span
                        className="legend-swatch"
                        style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                      />
                      <span className="legend-label">{label}</span>
                      <b className="font-mono">{sumPct.toFixed(1)}%</b>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Itemized table */}
          <div className="table-scroll soak-table-wrap">
            <table className="soak-table">
              <thead>
                <tr>
                  <th>REJECTION REASON</th>
                  <th>CATEGORY</th>
                  <th className="text-right">COUNT</th>
                  <th className="text-right">SHARE</th>
                </tr>
              </thead>
              <tbody>
                {taxonomy.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No candidate rejections recorded yet.
                    </td>
                  </tr>
                ) : (
                  taxonomy.map((row) => (
                    <tr key={row.reason}>
                      <td>
                        <b className="font-mono text-sm">{row.reason}</b>
                      </td>
                      <td>
                        <span
                          className="category-pill font-mono"
                          style={{
                            color: CATEGORY_COLORS[row.category],
                            borderColor: `${CATEGORY_COLORS[row.category]}33`,
                            backgroundColor: `${CATEGORY_COLORS[row.category]}14`
                          }}
                        >
                          {CATEGORY_LABELS[row.category] || row.category.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-right font-mono">{row.count}</td>
                      <td className="text-right font-mono">{row.pct.toFixed(1)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        {/* Right Column: RPC Health & Blocked Exits & Fills */}
        <div className="soak-side-col">
          {/* RPC Health Card */}
          <article className="soak-card rpc-card">
            <header className="soak-card-header">
              <div>
                <span className="eyebrow">CLUSTER CONNECTIVITY</span>
                <h3>RPC Rate-Limit Health</h3>
              </div>
              <span
                className={`tag font-mono ${
                  rpcHealth?.failedRpcCount > 0 ? 'tag-warn' : rpcHealth?.failedRpcCount === 0 ? 'tag-good' : 'tag-unverified'
                }`}
              >
                {rpcHealth?.failedRpcCount > 0 ? 'RATE LIMITED' : rpcHealth?.failedRpcCount === 0 ? 'NO RECORDED DROPS' : 'UNAVAILABLE'}
              </span>
            </header>
            <div className="rpc-stats-grid">
              <div className="rpc-stat">
                <small>429 Drops</small>
                <b className={rpcHealth?.failedRpcCount > 0 ? 'negative' : rpcHealth?.failedRpcCount === 0 ? 'positive' : 'text-muted'}>
                  {rpcHealth?.failedRpcCount ?? 'Unknown'}
                </b>
              </div>
              <div className="rpc-stat">
                <small>Drop Rate</small>
                <b className={rpcHealth?.rateLimitPct >= 5 ? 'negative' : rpcHealth?.rateLimitPct !== null && rpcHealth?.rateLimitPct !== undefined ? 'positive' : 'text-muted'}>
                  {rpcHealth?.rateLimitPct ?? 'Unknown'}{rpcHealth?.rateLimitPct != null ? '%' : ''}
                </b>
              </div>
              <div className="rpc-stat">
                <small>24h Gate</small>
                <b className={rpcHealth?.gatePassed === true ? 'positive' : rpcHealth?.gatePassed === false ? 'negative' : 'text-muted'}>
                  {getSoakSessionGateLabel(rpcHealth?.gatePassed)}
                </b>
              </div>
            </div>
            <div className="soak-card-footer">
              <small>
                Public endpoints hit 429 throttling during candidate bursts. Configure private RPC/WSS
                in <code>.env</code>.
              </small>
            </div>
          </article>

          {/* Blocked Exits Monitor */}
          <article className="soak-card blocked-exits-card">
            <header className="soak-card-header">
              <div>
                <span className="eyebrow">CONCURRENCY LATENCY</span>
                <h3>Pending-Order Exit Blocking</h3>
              </div>
              <span className="count font-mono">
                {blockedExits?.totalBlocked ?? 0} events
              </span>
            </header>
            {blockedExits?.totalBlocked === 0 ? (
              <div className="empty-substate">
                <CheckCircle2 size={16} className="positive" />
                <span>Zero exit-blocking delays recorded during this run.</span>
              </div>
            ) : (
              <div className="table-scroll soak-table-wrap">
                <table className="soak-table">
                  <thead>
                    <tr>
                      <th>ASSET</th>
                      <th>REASON</th>
                      <th>PENDING SIDE</th>
                      <th className="text-right">DURATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(blockedExits?.recent || []).map((e, idx) => (
                      <tr key={`${e.mint}-${idx}`}>
                        <td className="font-mono">{e.mint?.slice(0, 6)}…</td>
                        <td>{e.reason}</td>
                        <td className="font-mono">{e.pendingSide?.toUpperCase()}</td>
                        <td className="text-right font-mono">{e.pendingAgeMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          {/* Checkpoint & Timestamps Overview */}
          <article className="soak-card checkpoint-card">
            <header className="soak-card-header">
              <div>
                <span className="eyebrow">SESSION RECORD</span>
                <h3>Fills &amp; Checkpoint Status</h3>
              </div>
              <span className="tag font-mono">
                {fills?.count ?? 0} FILLS
              </span>
            </header>
            <div className="checkpoint-details">
              <div className="checkpoint-row">
                <span>Recorded Fills:</span>
                <b className="font-mono">{fills?.count ?? 0}</b>
              </div>
              {session?.startTime && (
                <div className="checkpoint-row">
                  <span>Start Time (Local):</span>
                  <b className="font-mono">{new Date(session.startTime).toLocaleTimeString()}</b>
                </div>
              )}
              {session?.endTime && (
                <div className="checkpoint-row">
                  <span>End Time (Local):</span>
                  <b className="font-mono">{new Date(session.endTime).toLocaleTimeString()}</b>
                </div>
              )}
              {latestCheckpoint && (
                <>
                  <div className="checkpoint-row">
                    <span>Uptime:</span>
                    <b className="font-mono">{latestCheckpoint.uptimeHours}h</b>
                  </div>
                  <div className="checkpoint-row">
                    <span>Feed Health:</span>
                    <b className={latestCheckpoint.feedHealthy ? 'positive' : 'negative'}>
                      {latestCheckpoint.feedHealthy ? 'HEALTHY' : 'DEGRADED'}
                    </b>
                  </div>
                  <div className="checkpoint-row">
                    <span>Realized PnL:</span>
                    <b className="font-mono">{latestCheckpoint.realizedPnl} lamports</b>
                  </div>
                </>
              )}
            </div>
          </article>
        </div>
      </div>
      )}
    </section>
  );
}

export default SoakTelemetry;

import React from 'react';
import {
  Server,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Zap,
  RefreshCw
} from 'lucide-react';

export function RpcComparisonPanel({ rpcEndpoints = [], rpcHealth = null, onRefresh = null, isDisconnected = false }) {
  const endpoints = Array.isArray(rpcEndpoints) ? rpcEndpoints : [];
  const isUnavailable = isDisconnected || endpoints.length === 0;

  if (isUnavailable) {
    return (
      <article className="soak-card rpc-comparison-card" id="rpc-comparison-panel">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">CLUSTER CONNECTIVITY & REDUNDANCY</span>
            <h3>RPC Endpoint Comparison Panel</h3>
          </div>
          <div className="rpc-header-actions">
            <span className="pill pill-danger font-mono" role="status">
              <ShieldAlert size={11} /> TELEMETRY UNAVAILABLE
            </span>
            {onRefresh && (
              <button className="icon-button" onClick={onRefresh} title="Probe RPC endpoints">
                <RefreshCw size={13} />
              </button>
            )}
          </div>
        </header>

        <p className="rpc-panel-note">
          Compares real-time response latency, slot drift, and rate limiting across the configured RPC pool. The 24-hour soak requires &lt;5% candidate drops.
        </p>

        <div className="rpc-empty-state" role="status">
          <Server size={24} className="text-warn" />
          <b>Telemetry unavailable — Backend RPC pool disconnected</b>
          <p>
            No real-time RPC metrics received from the engine or session reader. Verify backend connectivity on port 8787 or select an active session.
          </p>
        </div>

        <div className="soak-card-footer">
          <small>
            Redundancy rule: Dedicated/private RPC endpoints with WebSocket feeds are required before launching the 24-hour baseline.
          </small>
        </div>
      </article>
    );
  }

  const maxSlot = Math.max(...endpoints.map(e => e.currentSlot || 0), 0);
  const localThrottleCounts = endpoints.map(endpoint =>
    Number.isSafeInteger(endpoint.localRateLimitDenials) && endpoint.localRateLimitDenials >= 0
      ? endpoint.localRateLimitDenials
      : null);
  const knownLocalThrottleTotal = localThrottleCounts.reduce((total, count) => total + (count ?? 0), 0);
  const unknownLocalThrottleEndpoints = localThrottleCounts.filter(count => count === null).length;
  const gatePassed = typeof rpcHealth?.gatePassed === 'boolean' ? rpcHealth.gatePassed : null;

  return (
    <article className="soak-card rpc-comparison-card" id="rpc-comparison-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">CLUSTER CONNECTIVITY & REDUNDANCY</span>
          <h3>RPC Endpoint Comparison Panel</h3>
        </div>
        <div className="rpc-header-actions">
          {isDisconnected && (
            <span className="pill pill-danger font-mono" role="status">
              <ShieldAlert size={11} /> STALE TELEMETRY (DISCONNECTED)
            </span>
          )}
          <span className={`pill font-mono ${gatePassed === true ? 'pill-active' : 'pill-danger'}`}>
            {gatePassed === true ? (
              <><ShieldCheck size={11} /> 24H GATE: PASSED</>
            ) : gatePassed === false ? (
              <><ShieldAlert size={11} /> 24H GATE: BLOCKED</>
            ) : (
              <><ShieldAlert size={11} /> 24H GATE: UNVERIFIED</>
            )}
          </span>
          {onRefresh && (
            <button className="icon-button" onClick={onRefresh} title="Probe RPC endpoints">
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </header>

      <p className="rpc-panel-note">
        Compares real-time response latency, slot drift, and rate limiting across the configured RPC pool. The 24-hour soak requires &lt;5% candidate drops.
      </p>
      {(knownLocalThrottleTotal > 0 || unknownLocalThrottleEndpoints > 0) && (
        <p className="rpc-panel-note" role="status">
          {unknownLocalThrottleEndpoints === 0
            ? `${knownLocalThrottleTotal.toLocaleString()} local request throttles since process start.`
            : knownLocalThrottleTotal > 0
              ? `At least ${knownLocalThrottleTotal.toLocaleString()} local request throttles since process start; telemetry is unavailable for ${unknownLocalThrottleEndpoints} endpoint${unknownLocalThrottleEndpoints === 1 ? '' : 's'}.`
              : `Local request-throttle telemetry is unavailable for ${unknownLocalThrottleEndpoints} endpoint${unknownLocalThrottleEndpoints === 1 ? '' : 's'}.`}
          {' '}These are separate from provider HTTP 429s and the 24-hour candidate-drop rate.
        </p>
      )}

      {/* Comparison Grid */}
      <div className="rpc-comparison-grid">
        {endpoints.map((ep, i) => {
          const slotLag = maxSlot > 0 && ep.currentSlot > 0 ? maxSlot - ep.currentSlot : 0;
          const localThrottleCount = localThrottleCounts[i];
          const statusClass = ep.status === 'active'
            ? 'status-active'
            : ep.status === 'rate_limited'
            ? 'status-limited'
            : ep.status === 'error'
            ? 'status-error'
            : 'status-standby';

          const latencyTone = ep.latencyMs < 100
            ? 'tone-good'
            : ep.latencyMs < 250
            ? 'tone-mid'
            : 'tone-bad';

          const timeSinceSuccess = ep.lastSuccessAt
            ? `${Math.max(0, Math.round((Date.now() - ep.lastSuccessAt) / 1000))}s ago`
            : 'Never';

          return (
            <div key={ep.index ?? i} className={`rpc-endpoint-card ${ep.active ? 'active-border' : ''}`}>
              <div className="rpc-card-top">
                <div className="rpc-title-wrap">
                  <div className="rpc-title-row">
                    <Server size={14} />
                    <b>ENDPOINT #{i + 1}</b>
                    {ep.active && <span className="primary-tag">PRIMARY</span>}
                  </div>
                  <span className="rpc-url font-mono" title={ep.url}>{ep.url}</span>
                </div>
                <span className={`rpc-status-tag font-mono ${statusClass}`}>
                  {ep.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              <div className="rpc-metrics-row">
                <div className="rpc-metric-box">
                  <small>CURRENT SLOT</small>
                  <b className="font-mono">{ep.currentSlot > 0 ? ep.currentSlot.toLocaleString() : 'Pending'}</b>
                  <span className={`slot-lag font-mono ${slotLag > 10 ? 'text-warn' : 'text-muted'}`}>
                    {slotLag === 0 ? '+0 slots (Leader)' : `-${slotLag} slots lag`}
                  </span>
                </div>

                <div className="rpc-metric-box">
                  <small>ROUND-TRIP LATENCY</small>
                  <b className={`font-mono ${latencyTone}`}>{ep.latencyMs ?? 0} ms</b>
                  <div className="latency-bar-track">
                    <div
                      className="latency-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(10, ((ep.latencyMs ?? 100) / 500) * 100))}%`,
                        backgroundColor: ep.latencyMs < 150 ? '#14F195' : ep.latencyMs < 300 ? '#FFB800' : '#FF3B69'
                      }}
                    />
                  </div>
                </div>

                <div className="rpc-metric-box">
                  <small>HTTP 429 RATE LIMITS</small>
                  <b className={`font-mono ${(ep.http429Count ?? 0) > 0 ? 'text-danger' : 'text-good'}`}>
                    {ep.http429Count ?? 0}
                  </b>
                  <span className="error-count-sub font-mono">Errors: {ep.errorCount ?? 0}</span>
                  <span className="error-count-sub font-mono">
                    Local throttles (process total): {localThrottleCount === null ? 'Unknown' : localThrottleCount.toLocaleString()}
                  </span>
                </div>

                <div className="rpc-metric-box">
                  <small>LAST SUCCESSFUL REQ</small>
                  <b className="font-mono">{timeSinceSuccess}</b>
                  <span className="req-health font-mono">
                    {ep.status === 'rate_limited'
                      ? 'Rate-limited'
                      : ep.status === 'error'
                        ? 'Provider errors'
                        : ep.status === 'stale'
                          ? 'Stale slot'
                          : ep.status === 'standby'
                            ? 'Standby'
                            : ep.status === 'active'
                              ? 'Operational'
                              : 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="soak-card-footer">
        <small>
          Redundancy rule: Public RPC endpoints (e.g. `api.mainnet-beta.solana.com`) fail rate-limit quality gates. Dedicated/private RPC endpoints with WebSocket feeds are required before launching the 24-hour baseline.
        </small>
      </div>
    </article>
  );
}

export default RpcComparisonPanel;

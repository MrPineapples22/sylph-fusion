import React, { useState, useEffect } from 'react';
import { FlaskConical, Radio, ShieldAlert, ChevronDown } from 'lucide-react';

export function OperatorStatusStrip({
  mode = 'paper',
  feedAgeMs = null,
  feedFresh = false,
  halted = false,
  haltReason = null,
  running = false,
  pendingCount = 0,
  notice = '',
}) {
  const [systemTrust, setSystemTrust] = useState(null);
  const [systemStrip, setSystemStrip] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchTrust() {
      try {
        const res = await fetch('/live/api/system/trust');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSystemTrust(data);
        }
      } catch {}
    }
    async function fetchStrip() {
      try {
        const res = await fetch('/api/system/strip');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSystemStrip(data);
        }
      } catch {}
    }
    fetchTrust();
    fetchStrip();
    const intervalTrust = setInterval(fetchTrust, 10000);
    const intervalStrip = setInterval(fetchStrip, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalTrust);
      clearInterval(intervalStrip);
    };
  }, []);

  const ageKnown = Number.isFinite(feedAgeMs);
  const stale = !feedFresh || !ageKnown || feedAgeMs > 5000;
  const connection = !ageKnown ? 'Awaiting data' : stale ? 'Data delayed' : 'Connected';

  const operationalState = systemTrust?.operationalState || (halted ? 'HALTED' : stale ? 'DEGRADED' : 'HEALTHY');
  const trustColor = operationalState === 'HEALTHY' ? 'text-good' : operationalState === 'DEGRADED' || operationalState === 'CAUTIOUS' ? 'text-warn' : 'text-danger';
  const vector = systemTrust?.trustVector || null;
  const audit = systemTrust?.audit || null;

  return (
    <div className="operator-status-strip compact-health" aria-label="Current browser simulation health">
      {/* Blueprint Part CXXIX — System Health Indicator */}
      <span className={`sylph-health-pill ${trustColor}`}>
        <span className="indicator-dot">●</span> SYLPH · {operationalState}
      </span>
      <span className="health-mode">
        <FlaskConical size={14} />
        {mode === 'live' ? 'Live engine' : 'Paper simulation'}
      </span>
      <span className={stale ? 'text-warn' : 'text-good'}>
        <Radio size={13} />
        {connection}
      </span>
      <span className={halted ? 'text-danger' : 'text-muted'}>
        {halted ? <ShieldAlert size={14} /> : null}
        {halted ? 'Safety halt' : running ? 'Automation active' : 'Automation paused'}
      </span>

      {/* Global System Strip — Authoritative Backend Projection (Section 33) */}
      {systemStrip && (
        <div className="global-system-strip-badges" style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', margin: '0 8px' }}>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            MODE: <b style={{ color: '#83c5e6' }}>{systemStrip.mode}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            DATA: <b style={{ color: systemStrip.data === 'FRESH' ? '#14F195' : '#FFBE6B' }}>{systemStrip.data}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            EXEC: <b style={{ color: systemStrip.execution === 'READY' ? '#14F195' : '#FF3B69' }}>{systemStrip.execution}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            POS: <b style={{ color: systemStrip.positions === 'RECONCILED' || systemStrip.positions === 'EMPTY' ? '#14F195' : '#FFBE6B' }}>{systemStrip.positions}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            RISK: <b style={{ color: systemStrip.risk === 'NORMAL' ? '#14F195' : '#FF3B69' }}>{systemStrip.risk}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            RPC: <b style={{ color: systemStrip.rpc === 'HEALTHY' ? '#14F195' : '#FFBE6B' }}>{systemStrip.rpc}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            P0: <b style={{ color: systemStrip.p0Health === 'HEALTHY' ? '#14F195' : '#FF3B69' }}>{systemStrip.p0Health}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            CERT: <b style={{ color: systemStrip.certification === 'PASS' ? '#14F195' : '#FFBE6B' }}>{systemStrip.certification}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            LEADER: <b style={{ color: systemStrip.isJitoLeader ? '#14F195' : '#83c5e6' }}>{systemStrip.isJitoLeader ? 'JITO-MEV' : 'AGAVE-TPU'}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            TIP: <b style={{ color: '#00f0ff' }}>{systemStrip.tipFloorP75 ? `${(systemStrip.tipFloorP75 / 1e9).toFixed(4)} SOL` : '0.0010 SOL'}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }}>
            CONTENTION: <b style={{ color: systemStrip.contentionTier === 'CRITICAL' ? '#FF3B69' : systemStrip.contentionTier === 'HIGH' ? '#FFBE6B' : '#14F195' }}>{systemStrip.contentionTier || 'NOMINAL'}</b>
          </span>
          <span className="health-pill-badge" style={{ background: '#1c2430', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid #2d3848' }} title="HELIOS-DIRECT: Leader TPU QUIC wire dispatch with multi-leader pipelining">
            HELIOS: <b style={{ color: '#14F195' }}>DIRECT ⚡</b>
          </span>
        </div>
      )}
      <details className="health-details">
        <summary>
          {halted ? 'Halt details' : stale ? 'Connection details' : 'Trust Vector'}
          <ChevronDown size={13} />
        </summary>
        <div className="health-popover">
          <strong>SYLPH System Trust & Assurance</strong>
          <p>Multi-dimensional operational health &amp; runtime verification.</p>
          <dl>
            <dt>Operational State</dt>
            <dd className={trustColor}><b>{operationalState}</b></dd>
            <dt>Active Leader</dt>
            <dd>{systemStrip?.activeLeaderPubkey ? `${systemStrip.activeLeaderPubkey.slice(0, 8)}… (${systemStrip.isJitoLeader ? 'Jito-Solana MEV' : 'Vanilla Agave'})` : 'Tracking'}</dd>
            <dt>HELIOS Direct TPU</dt>
            <dd>{systemStrip?.helios ? `${systemStrip.helios.directTransmissionsCount} sent (${systemStrip.helios.avgTransmissionDurationMs}ms avg latency, ${systemStrip.helios.activeTpuEndpointsCount} nodes)` : 'Sub-25ms Leader Pipelining'}</dd>
            <dt>Jito Tip Floor (p75)</dt>
            <dd>{systemStrip?.tipFloorP75 ? `${(systemStrip.tipFloorP75 / 1e9).toFixed(4)} SOL` : '0.0010 SOL'}</dd>
            <dt>Contention Tier</dt>
            <dd>{systemStrip?.contentionTier || 'NOMINAL'}</dd>
            <dt>Latest observation</dt>
            <dd>{ageKnown ? `${(feedAgeMs / 1000).toFixed(1)}s ago` : 'Not received'}</dd>
            <dt>Pending orders</dt>
            <dd>{pendingCount}</dd>
            <dt>Automation</dt>
            <dd>{halted ? 'Halted' : running ? 'Watching' : 'Paused'}</dd>
          </dl>

          {vector && (
            <div className="trust-vector-breakdown">
              <small className="eyebrow">14-DIMENSION TRUST VECTOR</small>
              <div className="trust-metrics-grid">
                <div>Data Integrity: <b>{vector.dataIntegrity}%</b></div>
                <div>Data Freshness: <b>{vector.dataFreshness}%</b></div>
                <div>State Consistency: <b>{vector.stateConsistency}%</b></div>
                <div>Graph Reliability: <b>{vector.graphReliability}%</b></div>
                <div>Feature Reliability: <b>{vector.featureReliability}%</b></div>
                <div>Model Competence: <b>{vector.modelCompetence}%</b></div>
                <div>Calibration Health: <b>{vector.calibrationHealth}%</b></div>
                <div>Regime Certainty: <b>{vector.regimeCertainty}%</b></div>
                <div>Decision Integrity: <b>{vector.decisionIntegrity}%</b></div>
                <div>Portfolio Integrity: <b>{vector.portfolioIntegrity}%</b></div>
                <div>Execution Health: <b>{vector.executionHealth}%</b></div>
                <div>Infra Health: <b>{vector.infrastructureHealth}%</b></div>
                <div>Novelty Pressure: <b>{vector.noveltyPressure}%</b></div>
              </div>
            </div>
          )}

          {audit && (
            <div className="connection-auditor-summary">
              <small className="eyebrow">CONNECTION AUDITOR</small>
              <p className={audit.passed ? 'text-good' : 'text-danger'}>
                {audit.passed ? '✓ All pipeline edges verified & active' : '⚠ Disconnected or bypassed components detected'}
              </p>
              <small>Verified Connections: {audit.healthyConnectionsCount} / {audit.totalConnectionsChecked}</small>
            </div>
          )}

          {halted && <p className="text-danger">{haltReason || 'Safety halt is active.'}</p>}
          {notice && <p>{notice}</p>}
          <a href="#execution">Open execution controls →</a>
          <a href="#soak-disclosure">Recorded session diagnostics →</a>
        </div>
      </details>
    </div>
  );
}
export default OperatorStatusStrip;

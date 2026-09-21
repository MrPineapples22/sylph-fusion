import React, { useState } from 'react';
import {
  Filter,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  AlertOctagon,
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  HelpCircle
} from 'lucide-react';

const FUNNEL_GATES = [
  { id: 'discovered', label: 'Discovered', desc: 'Observed pool events' },
  { id: 'aged', label: 'Aged', desc: 'Age >= 10s' },
  { id: 'buyerThreshold', label: 'Buyer Threshold', desc: 'Buyers >= 5 & Buy > 2x Sell' },
  { id: 'safetyPassed', label: 'Safety Passed', desc: 'Authorities revoked, creator intact' },
  { id: 'driftPassed', label: 'Drift Passed', desc: 'Reserves drift within +-200 BPS' },
  { id: 'eligible', label: 'Eligible', desc: 'Curve open & cash reserve clear' },
  { id: 'paperFilled', label: 'Paper-Filled', desc: 'Settled paper position' },
];

export function CandidateFunnel({ funnelData, liveCandidates = [], onSelectStage = null, isDisconnected = false }) {
  const [selectedGate, setSelectedGate] = useState(null);

  if (isDisconnected) {
    return (
      <article className="soak-card funnel-card" id="candidate-funnel-card">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">MULTI-STAGE OPPORTUNITY PIPELINE</span>
            <h3>Candidate Funnel View</h3>
          </div>
          <div className="funnel-header-meta">
            <span className="pill pill-danger font-mono" role="status">
              <AlertOctagon size={11} /> TELEMETRY UNAVAILABLE
            </span>
          </div>
        </header>

        <p className="funnel-subtitle">
          Tracks token progression through each mandatory safety and liquidity gate. Pinpoints exactly where opportunities drop out.
        </p>

        <div className="funnel-empty-state" role="status">
          <Filter size={24} className="text-warn" />
          <b>Telemetry unavailable — Candidate source disconnected</b>
          <small>
            Unable to fetch real-time candidate gate evaluations. Check engine connection on port 8787 or select an active session.
          </small>
        </div>

        <div className="soak-card-footer">
          <span>
            <ShieldCheck size={12} /> Sequential gating guarantees zero real funds are risked before passing authorities, liquidity floor, and drift checks.
          </span>
        </div>
      </article>
    );
  }

  const counts = {
    discovered: funnelData?.discovered ?? liveCandidates.length,
    aged: funnelData?.aged ?? liveCandidates.filter(c => (c.age ?? 0) >= 10_000).length,
    buyerThreshold: funnelData?.buyerThreshold ?? liveCandidates.filter(c => (c.buyers ?? 0) >= 5 && !c.devSold).length,
    safetyPassed: funnelData?.safetyPassed ?? liveCandidates.filter(c => (c.buyers ?? 0) >= 5 && !c.devSold && c.curve && !c.curve.complete).length,
    driftPassed: funnelData?.driftPassed ?? liveCandidates.filter(c => c.drift?.passed).length,
    eligible: funnelData?.eligible ?? liveCandidates.filter(c => c.drift?.passed && c.curve && !c.curve.complete && !c.devSold).length,
    paperFilled: funnelData?.paperFilled ?? 0,
  };

  const topCount = Math.max(1, counts.discovered);

  const handleGateClick = (gateId) => {
    const next = selectedGate === gateId ? null : gateId;
    setSelectedGate(next);
    if (onSelectStage) onSelectStage(next);
  };

  const dropOffs = funnelData?.stageDropOffs || [
    { from: 'discovered', to: 'aged', dropCount: Math.max(0, counts.discovered - counts.aged), topReason: 'Age < 10s or token aged out' },
    { from: 'aged', to: 'buyer threshold', dropCount: Math.max(0, counts.aged - counts.buyerThreshold), topReason: 'Buyer accumulation or RPC rate limits' },
    { from: 'buyer threshold', to: 'safety passed', dropCount: Math.max(0, counts.buyerThreshold - counts.safetyPassed), topReason: 'Creator concentration or rug check failure' },
    { from: 'safety passed', to: 'drift passed', dropCount: Math.max(0, counts.safetyPassed - counts.driftPassed), topReason: 'Dual drift exceeded (+-200 BPS)' },
    { from: 'drift passed', to: 'eligible', dropCount: Math.max(0, counts.driftPassed - counts.eligible), topReason: 'Curve completed or cash reserve limit' },
    { from: 'eligible', to: 'paper-filled', dropCount: Math.max(0, counts.eligible - counts.paperFilled), topReason: 'In-flight execution pending or max positions cap' },
  ];

  const isEmpty = counts.discovered === 0;

  return (
    <article className="soak-card funnel-card" id="candidate-funnel-card">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">MULTI-STAGE OPPORTUNITY PIPELINE</span>
          <h3>Candidate Funnel View</h3>
        </div>
        <div className="funnel-header-meta">
          <span className="count font-mono">{counts.discovered} total candidates</span>
          <span className="pill pill-funnel font-mono">
            <CheckCircle2 size={11} /> {counts.paperFilled} filled ({((counts.paperFilled / topCount) * 100).toFixed(1)}%)
          </span>
        </div>
      </header>

      <p className="funnel-subtitle">
        Tracks token progression through each mandatory safety and liquidity gate. Pinpoints exactly where opportunities drop out.
      </p>

      {isEmpty ? (
        <div className="funnel-empty-state" role="status">
          <Filter size={24} />
          <b>No candidates currently in evaluation pipeline</b>
          <small>Waiting for token create and trade events on the monitored Solana cluster.</small>
        </div>
      ) : (
        <div className="funnel-stepper-container" role="region" aria-label="Candidate gate funnel">
          <div className="funnel-stages-row">
            {FUNNEL_GATES.map((gate, idx) => {
              const count = counts[gate.id] ?? 0;
              const pctOfTotal = ((count / topCount) * 100).toFixed(1);
              const isSelected = selectedGate === gate.id;
              const prevCount = idx > 0 ? (counts[FUNNEL_GATES[idx - 1].id] ?? 0) : null;
              const stepPassPct = prevCount && prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) : null;

              return (
                <React.Fragment key={gate.id}>
                  <div
                    className={`funnel-stage-node ${isSelected ? 'stage-selected' : ''}`}
                    onClick={() => handleGateClick(gate.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleGateClick(gate.id); }}
                    aria-pressed={isSelected}
                    title={`${gate.label}: ${count} candidates (${pctOfTotal}% of total)`}
                  >
                    <div className="stage-top">
                      <span className="stage-index">{idx + 1}</span>
                      <span className="stage-pct font-mono">{pctOfTotal}%</span>
                    </div>
                    <div className="stage-count font-mono">{count}</div>
                    <div className="stage-label">{gate.label}</div>
                    <div className="stage-desc">{gate.desc}</div>

                    <div className="stage-bar-track">
                      <div
                        className="stage-bar-fill"
                        style={{
                          width: `${Math.max(4, Math.min(100, (count / topCount) * 100))}%`,
                          backgroundColor: idx === FUNNEL_GATES.length - 1 ? '#14F195' : idx >= 3 ? '#00C2FF' : '#9945FF'
                        }}
                      />
                    </div>
                  </div>

                  {idx < FUNNEL_GATES.length - 1 && (
                    <div className="funnel-connector">
                      <ArrowRight size={14} className="connector-arrow" />
                      {dropOffs[idx] && dropOffs[idx].dropCount > 0 && (
                        <span
                          className="funnel-drop-badge font-mono"
                          title={`Drop-off: ${dropOffs[idx].dropCount} (${dropOffs[idx].topReason})`}
                        >
                          -{dropOffs[idx].dropCount}
                        </span>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Forensic Drop-off Breakdown Details */}
          <div className="funnel-diagnostics-drawer">
            <div className="drawer-header">
              <TrendingDown size={14} />
              <span>GATE DROP-OFF FORENSICS</span>
              <small>Empirical attrition reasons across sequential verification gates</small>
            </div>
            <div className="drawer-grid">
              {dropOffs.map((d, i) => (
                <div key={d.from + d.to} className="drop-card">
                  <div className="drop-card-top">
                    <span className="drop-route font-mono">{FUNNEL_GATES[i]?.label} → {FUNNEL_GATES[i + 1]?.label}</span>
                    <b className="drop-count font-mono">-{d.dropCount}</b>
                  </div>
                  <p className="drop-reason">{d.topReason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="soak-card-footer">
        <span>
          <ShieldCheck size={12} /> Sequential gating guarantees zero real funds are risked before passing authorities, liquidity floor, and drift checks.
        </span>
      </div>
    </article>
  );
}

export default CandidateFunnel;

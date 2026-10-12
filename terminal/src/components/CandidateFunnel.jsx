import React, { useState } from 'react';
import {
  Filter,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  AlertOctagon,
  Zap,
  Clock,
  Layers,
  HelpCircle
} from 'lucide-react';

const FUNNEL_GATES = [
  { id: 'discovered', label: 'Discovered', desc: 'Observed pool events' },
  { id: 'aged', label: 'Aged', desc: 'Age >= 10s' },
  { id: 'buyerThreshold', label: 'Buyer Threshold', desc: 'Buyers >= 5 & Buy > 2x Sell' },
  { id: 'safetyPassed', label: 'Safety Reported', desc: 'Source-reported safety stage' },
  { id: 'driftPassed', label: 'Drift Passed', desc: 'Reserves drift within +-200 BPS' },
  { id: 'eligible', label: 'Eligibility Reported', desc: 'Source-reported eligibility stage' },
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
          <span>Telemetry status only. This funnel does not authorize trades or prove a live risk boundary.</span>
        </div>
      </article>
    );
  }

  const candidates = Array.isArray(liveCandidates) ? liveCandidates : [];
  const reportedCount = (key) => Number.isSafeInteger(funnelData?.[key]) && funnelData[key] >= 0 ? funnelData[key] : null;
  const countFromCandidates = (required, predicate) => {
    if (candidates.some((candidate) => !required(candidate))) return null;
    return candidates.filter(predicate).length;
  };
  const counts = {
    discovered: reportedCount('discovered') ?? candidates.length,
    aged: reportedCount('aged') ?? countFromCandidates((c) => Number.isFinite(c?.age), (c) => c.age >= 10_000),
    buyerThreshold: reportedCount('buyerThreshold') ?? countFromCandidates((c) => Number.isFinite(c?.buyers) && typeof c?.devSold === 'boolean', (c) => c.buyers >= 5 && !c.devSold),
    // Candidate-level buyer/migration hints do not establish safety approval or route eligibility.
    safetyPassed: reportedCount('safetyPassed'),
    driftPassed: reportedCount('driftPassed') ?? countFromCandidates((c) => typeof c?.drift?.passed === 'boolean', (c) => c.drift.passed),
    eligible: reportedCount('eligible'),
    paperFilled: reportedCount('paperFilled'),
  };

  const topCount = Math.max(1, counts.discovered);

  const handleGateClick = (gateId) => {
    const next = selectedGate === gateId ? null : gateId;
    setSelectedGate(next);
    if (onSelectStage) onSelectStage(next);
  };

  const stageDropOffs = Array.isArray(funnelData?.stageDropOffs) ? funnelData.stageDropOffs : null;
  const dropOffs = stageDropOffs || FUNNEL_GATES.slice(0, -1).map((gate, index) => {
    const fromCount = counts[gate.id];
    const toCount = counts[FUNNEL_GATES[index + 1].id];
    return {
      from: gate.id,
      to: FUNNEL_GATES[index + 1].id,
      dropCount: Number.isSafeInteger(fromCount) && Number.isSafeInteger(toCount) ? Math.max(0, fromCount - toCount) : null,
      topReason: 'No source-reported attrition reason.',
    };
  });

  const isEmpty = counts.discovered === 0;

  return (
    <article className="soak-card funnel-card" id="candidate-funnel-card">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">MULTI-STAGE OPPORTUNITY PIPELINE</span>
          <h3>Candidate Funnel View</h3>
        </div>
        <div className="funnel-header-meta">
          <span className="count font-mono">{counts.discovered} candidates in snapshot</span>
          <span className="pill pill-funnel font-mono">
            {counts.paperFilled == null ? <HelpCircle size={11} /> : <CheckCircle2 size={11} />} {counts.paperFilled == null ? '— paper fills' : `${counts.paperFilled} paper fills (${((counts.paperFilled / topCount) * 100).toFixed(1)}%)`}
          </span>
        </div>
      </header>

      <p className="funnel-subtitle">
        Shows source-reported gate totals and counts derived from complete candidate fields. Missing safety or eligibility totals remain unknown.
      </p>

      {isEmpty ? (
        <div className="funnel-empty-state" role="status">
          <Filter size={24} />
          <b>No candidates in the supplied snapshot</b>
          <small>This snapshot does not establish complete feed coverage or prove that no opportunities occurred.</small>
        </div>
      ) : (
        <div className="funnel-stepper-container" role="region" aria-label="Candidate gate funnel">
          <div className="funnel-stages-row">
            {FUNNEL_GATES.map((gate, idx) => {
              const count = counts[gate.id];
              const pctOfTotal = Number.isSafeInteger(count) ? `${((count / topCount) * 100).toFixed(1)}%` : '—';
              const isSelected = selectedGate === gate.id;
              const prevCount = idx > 0 ? counts[FUNNEL_GATES[idx - 1].id] : null;

              return (
                <React.Fragment key={gate.id}>
                  <div
                    className={`funnel-stage-node ${isSelected ? 'stage-selected' : ''}`}
                    onClick={() => handleGateClick(gate.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGateClick(gate.id); } }}
                    aria-pressed={isSelected}
                    title={`${gate.label}: ${count ?? 'unknown'} candidates (${pctOfTotal} of total)`}
                  >
                    <div className="stage-top">
                      <span className="stage-index">{idx + 1}</span>
                      <span className="stage-pct font-mono">{pctOfTotal}</span>
                    </div>
                    <div className="stage-count font-mono">{count ?? '—'}</div>
                    <div className="stage-label">{gate.label}</div>
                    <div className="stage-desc">{gate.desc}</div>

                    <div className="stage-bar-track">
                      <div
                        className="stage-bar-fill"
                        style={{
                          width: Number.isSafeInteger(count) ? `${Math.max(4, Math.min(100, (count / topCount) * 100))}%` : '0%',
                          backgroundColor: idx === FUNNEL_GATES.length - 1 ? '#14F195' : idx >= 3 ? '#00C2FF' : '#9945FF'
                        }}
                      />
                    </div>
                  </div>

                  {idx < FUNNEL_GATES.length - 1 && (
                    <div className="funnel-connector">
                      <ArrowRight size={14} className="connector-arrow" />
                      {dropOffs[idx] && Number.isSafeInteger(dropOffs[idx].dropCount) && dropOffs[idx].dropCount > 0 && (
                        <span
                          className="funnel-drop-badge font-mono"
                          title={`Count difference: ${dropOffs[idx].dropCount} (${dropOffs[idx].topReason || 'Reason unavailable'})`}
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
              <small>{stageDropOffs ? 'Source-reported attrition details' : 'Count differences only; causes were not supplied'}</small>
            </div>
            <div className="drawer-grid">
              {dropOffs.map((d, i) => (
                <div key={d.from + d.to} className="drop-card">
                  <div className="drop-card-top">
                    <span className="drop-route font-mono">{FUNNEL_GATES[i]?.label} → {FUNNEL_GATES[i + 1]?.label}</span>
                    <b className="drop-count font-mono">{Number.isSafeInteger(d.dropCount) ? `-${d.dropCount}` : '—'}</b>
                  </div>
                  <p className="drop-reason">{d.topReason || 'No source-reported attrition reason.'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="soak-card-footer">
          <span>Telemetry status only. This funnel does not authorize trades or prove a live risk boundary.</span>
      </div>
    </article>
  );
}

export default CandidateFunnel;

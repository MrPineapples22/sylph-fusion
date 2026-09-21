import React, { useState } from 'react';
import {
  AlertOctagon,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  Server,
  Radio,
  Layers,
  Clock,
  RotateCcw,
  ArrowUpRight,
  ArrowRight,
  X,
  Play,
  CircleStop,
  Sliders,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { evaluatePositionRiskAction } from '../operator-safety-eval.js';

export function OperatorEmergencyView({
  state,
  liveBasket,
  soakData,
  execution,
  solPriceUsd = 150,
  onPanicCloseAll,
  onPauseAutomation,
  onRequestReconciliation = null,
  onExitEmergencyMode,
}) {
  const [confirmPanic, setConfirmPanic] = useState(false);
  const [confirmHalt, setConfirmHalt] = useState(false);

  const isLive = state?.mode === 'live' || soakData?.liveEngine?.mode === 'live' || soakData?.session?.mode === 'live';
  const riskAction = evaluatePositionRiskAction({
    mode: isLive ? 'live' : 'paper',
    canExecuteClose: Boolean(execution?.panicCloseUsd && !isLive && onPanicCloseAll),
    onPanicClose: onPanicCloseAll,
  });

  const halted = state.halted;
  const haltReason = state.haltReason;
  const running = state.running;

  const positions = state.positions || [];
  const pending = state.pending || [];
  const inFlightCount = pending.length + (execution?.pendingAssets?.length || 0);

  const rpcHealth = soakData?.session?.rpcHealth;
  const rpcDropRate = rpcHealth?.rateLimitPct ?? null;
  const feedAgeMs = liveBasket?.at ? Math.max(0, Date.now() - liveBasket.at) : null;
  const isFeedStale = feedAgeMs === null || Boolean(liveBasket?.error) || feedAgeMs > 5000;

  // Calculate total portfolio risk exposure
  const totalCostUsd = positions.reduce((acc, p) => acc + (p.cost || 0), 0);
  const totalExposureSol = (totalCostUsd / solPriceUsd).toFixed(3);

  const handlePanicClick = () => {
    if (riskAction.showInformationalOnly) return;
    if (!confirmPanic) {
      setConfirmPanic(true);
      return;
    }
    setConfirmPanic(false);
    onPanicCloseAll();
  };

  const handleHaltClick = () => {
    if (halted || isLive || !running || !onPauseAutomation) return;
    if (!confirmHalt && !halted) {
      setConfirmHalt(true);
      return;
    }
    setConfirmHalt(false);
    onPauseAutomation();
  };

  return (
    <div className="emergency-cockpit" role="region" aria-label="Operator Emergency Cockpit">
      {/* Top Emergency Status Bar */}
      <div className={`emergency-top-bar ${halted ? 'is-halted' : isFeedStale ? 'is-stale' : 'is-active'}`}>
        <div className="emergency-brand flex items-center gap-2">
          <AlertOctagon size={22} className={halted ? 'text-danger' : 'text-warn'} />
          <div>
            <span className="eyebrow text-warn">HIGH-PRIORITY OPERATOR MODE</span>
            <h2 className="emergency-title">
              {halted ? 'SYSTEM SAFETY HALTED' : !running ? 'OPERATOR PAUSED' : 'SYSTEM ARMED & ACTIVE'}
            </h2>
          </div>
        </div>

        <div className="emergency-top-actions flex items-center gap-3">
          <button
            type="button"
            className="btn btn-secondary font-mono text-xs flex items-center gap-1"
            onClick={onExitEmergencyMode}
            title="Return to full analytical dashboard"
          >
            <ArrowRight size={13} /> Return to Analytical Cockpit
          </button>
        </div>
      </div>

      {/* Main 5-Quadrant Emergency Grid */}
      <div className="emergency-grid">
        {/* 1. Feed & Cluster Health */}
        <section className="emergency-card card-health">
          <header className="card-head">
            <Server size={16} className="text-accent" />
            <h3>1. Feed &amp; Cluster Health</h3>
          </header>
          <div className="health-metrics font-mono text-xs">
            <div className="health-row">
              <span>MARKET FEED:</span>
              <b className={isFeedStale ? 'text-danger' : 'text-good'}>
                {feedAgeMs === null ? 'UNAVAILABLE' : isFeedStale ? `STALE (${(feedAgeMs / 1000).toFixed(1)}s LAG)` : `LIVE (${feedAgeMs}ms)`}
              </b>
            </div>
            <div className="health-row">
              <span>RPC 429 DROP RATE:</span>
              <b className={rpcDropRate === null ? 'text-muted' : rpcDropRate >= 5.0 ? 'text-danger' : 'text-good'}>
                {rpcDropRate === null ? 'UNAVAILABLE' : `${rpcDropRate}% ${rpcDropRate >= 5 ? '(GATE BLOCKED)' : '(OK)'}`}
              </b>
            </div>
            <div className="health-row">
              <span>RESEARCH DATA:</span>
              <b className={liveBasket?.error ? 'text-danger' : 'text-good'}>
                {isFeedStale ? 'UNAVAILABLE / STALE' : 'RECEIVING'}
              </b>
            </div>
            <div className="health-row">
              <span>OBSERVED ASSETS:</span>
              <b>{liveBasket?.assets?.length || 0} tokens</b>
            </div>
          </div>
        </section>

        {/* 2. Halt State & Safety Status */}
        <section className={`emergency-card card-halt ${halted ? 'border-danger' : ''}`}>
          <header className="card-head">
            <ShieldAlert size={16} className={halted ? 'text-danger' : 'text-good'} />
            <h3>2. Safety Circuit State</h3>
          </header>
          <div className="halt-status-body font-mono text-xs">
            <div className="halt-badge-row">
              <span className={`status-pill ${halted ? 'pill-danger' : 'pill-active'}`}>
                {halted ? 'SAFETY HALTED' : running ? 'NORMAL EXECUTION' : 'PAUSED'}
              </span>
            </div>
            {halted ? (
              <div className="halt-detail text-danger mt-2">
                <strong>TRIGGER REASON:</strong>
                <p>{haltReason || 'Circuit breaker tripped on adverse risk event.'}</p>
              </div>
            ) : (
              <div className="halt-detail text-good mt-2">
                <p>No browser paper halt recorded. This does not verify backend risk limits or candidate reserve checks.</p>
              </div>
            )}
          </div>
        </section>

        {/* 3. Pending Order Lane */}
        <section className="emergency-card card-pending">
          <header className="card-head">
            <Clock size={16} className="text-cyan" />
            <h3>3. Pending Lane ({inFlightCount})</h3>
          </header>
          <div className="pending-lane-body font-mono text-xs">
            <div className="pending-stat">
              <span>IN-FLIGHT ORDERS:</span>
              <b className={inFlightCount > 0 ? 'text-warn' : 'text-muted'}>{inFlightCount}</b>
            </div>
            {pending.length > 0 ? (
              <ul className="pending-list mt-2">
                {pending.map((p, idx) => (
                  <li key={idx} className="flex justify-between items-center py-1 border-b">
                    <span>{p.side?.toUpperCase()} {p.asset}</span>
                    <span className="text-muted">Due in {Math.max(0, p.due - Date.now())}ms</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted mt-2">No pending orders held in queue.</p>
            )}
            {inFlightCount > 0 && onRequestReconciliation ? (
              <button
                type="button"
                className="btn btn-mini btn-secondary mt-2 w-full font-mono text-xs"
                onClick={onRequestReconciliation}
                title="Request engine-level asynchronous transaction reconciliation"
              >
                Request Engine Reconciliation
              </button>
            ) : null}
            <small className="text-muted mt-2 block leading-relaxed">
              Browser paper pending orders follow simulator settlement. Live engine orders require backend reconciliation of finalized settlement, failure or confirmed expiry; elapsed time alone is insufficient.
            </small>
          </div>
        </section>

        {/* 4. Active Positions Table */}
        <section className="emergency-card card-positions col-span-2">
          <header className="card-head flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-accent" />
              <h3>4. Active Exposure ({positions.length} Positions &bull; {totalExposureSol} SOL)</h3>
            </div>
            <span className="text-xs font-mono text-muted">Solana Quote: ${solPriceUsd}</span>
          </header>
          <div className="positions-table-wrap font-mono text-xs mt-2">
            {positions.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-muted text-left border-b">
                    <th>TOKEN</th>
                    <th>UNITS</th>
                    <th>ENTRY</th>
                    <th>MARK</th>
                    <th>STOP-LOSS</th>
                    <th>UNREALIZED P&amp;L</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const asset = liveBasket?.assets?.find(a => a.id === p.asset) || { price: p.entry };
                    const currentVal = (p.qty || 0) * (asset.price || p.entry);
                    const gainUsd = currentVal - (p.cost || 0);
                    const gainPct = p.cost > 0 ? (gainUsd / p.cost) * 100 : 0;

                    return (
                      <tr key={p.asset} className="border-b">
                        <td><b>{p.asset}</b></td>
                        <td>{Number(p.qty || 0).toLocaleString()}</td>
                        <td>${Number(p.entry || 0).toFixed(4)}</td>
                        <td>${Number(asset.price || 0).toFixed(4)}</td>
                        <td className="text-danger">${Number(p.stop || 0).toFixed(4)}</td>
                        <td className={gainUsd >= 0 ? 'text-good' : 'text-danger'}>
                          {gainUsd >= 0 ? '+' : ''}${gainUsd.toFixed(2)} ({gainPct.toFixed(1)}%)
                        </td>
                        <td>
                          {riskAction.showInformationalOnly ? (
                            <span
                              className="text-muted text-xs font-mono"
                              title="No live emergency close endpoint exists; exits are governed autonomously on-chain"
                            >
                              Autonomous
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-mini btn-danger"
                              onClick={() => execution?.panicCloseUsd && execution.panicCloseUsd(p.asset, p.asset, p.qty, 9)}
                              title="Close paper position immediately"
                            >
                              Close
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty-positions text-center text-muted py-6">
                <CheckCircle2 size={24} className="text-good mx-auto mb-1" />
                <p>No open positions in this browser paper portfolio.</p>
              </div>
            )}
          </div>
        </section>

        {/* 5. Emergency Risk Controls */}
        <section className="emergency-card card-actions col-span-2">
          <header className="card-head">
            <Zap size={16} className="text-warn" />
            <h3>5. Immediate Risk Controls</h3>
          </header>
          <div className="emergency-actions-grid font-mono text-xs mt-2">
            {/* Action 1: Panic Liquidate All */}
            <div className="action-box">
              {riskAction.showInformationalOnly ? (
                <>
                  <span className="action-title text-warn">EMERGENCY LIQUIDATION STATUS</span>
                  <div className="my-2">
                    <span className="pill pill-session font-mono text-xs text-warn flex items-center gap-1 w-fit">
                      <ShieldCheck size={11} /> {riskAction.infoBadgeText}
                    </span>
                  </div>
                  <p className="text-muted text-xs mb-2 leading-relaxed">
                    {riskAction.explanation}
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary w-full font-mono text-xs opacity-50 cursor-not-allowed"
                    disabled
                    title="Live emergency close is governed autonomously on-chain without client endpoints"
                  >
                    Live Emergency Close Unavailable (Autonomous Only)
                  </button>
                </>
              ) : (
                <>
                  <span className="action-title text-danger">PANIC CLOSE ALL POSITIONS (PAPER SIM)</span>
                  <p className="text-muted text-xs mb-2">
                    Liquidates all {positions.length} open paper simulation positions immediately at current market bids, bypassing slippage limits.
                  </p>
                  {confirmPanic ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-danger flex-1 font-bold animate-pulse"
                        onClick={handlePanicClick}
                      >
                        CONFIRM PAPER LIQUIDATION
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setConfirmPanic(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger w-full font-bold"
                      disabled={positions.length === 0}
                      onClick={handlePanicClick}
                    >
                      Panic Liquidate All ({positions.length} Paper Positions)
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Action 2: Safety Halt Circuit Breaker */}
            <div className="action-box">
              <span className="action-title text-warn">PAUSE PAPER AUTOMATION</span>
              <p className="text-muted text-xs mb-2">
                {halted
                  ? 'Safety halt is active. This control cannot clear it.'
                  : 'Pause browser paper screening. Existing positions and pending orders remain tracked. Backend engine controls are separate.'}
              </p>
              {confirmHalt ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-warn flex-1 font-bold"
                    onClick={handleHaltClick}
                  >
                    CONFIRM PAUSE
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirmHalt(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`btn w-full font-bold ${halted ? 'btn-primary' : 'btn-warn'}`}
                  onClick={handleHaltClick}
                  disabled={halted || isLive || !running || !onPauseAutomation}
                >
                  {halted ? 'Safety halt active' : isLive ? 'Live engine · informational only' : !running ? 'Paper automation paused' : 'Pause paper automation'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default OperatorEmergencyView;

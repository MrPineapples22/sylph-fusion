import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Layers,
  ArrowUpRight,
  Activity,
  UserCheck,
  UserX,
  Droplets,
  DollarSign
} from 'lucide-react';

import { evaluatePositionRiskAction } from '../operator-safety-eval.js';

export function PositionRiskPanel({
  positions = [],
  solPriceUsd = 150,
  onPanicClose = null,
  mode = 'paper',
  canExecuteClose = true,
}) {
  const riskAction = evaluatePositionRiskAction({ mode, canExecuteClose, onPanicClose });
  const { showInformationalOnly, buttonLabel, infoBadgeText, explanation } = riskAction;

  if (!positions || positions.length === 0) {
    return (
      <div className="position-risk-empty">
        <Layers size={22} />
        <b>No active positions · Risk limits armed</b>
        <small>Open positions will display real-time liquidation thresholds, creator balance checks, and reserve drift health.</small>
      </div>
    );
  }

  return (
    <div className="position-risk-grid" role="region" aria-label="Position risk panel">
      {positions.map((p) => {
        const costLamports = BigInt(p.cost || '0');
        const costSol = Number(costLamports) / 1e9;
        const costUsd = costSol * solPriceUsd;

        const currentValLamports = p.currentValue != null ? BigInt(p.currentValue) : null;
        const currentSol = currentValLamports != null ? Number(currentValLamports) / 1e9 : costSol;
        const currentUsd = currentSol * solPriceUsd;

        const unrealizedSol = currentSol - costSol;
        const unrealizedUsd = currentUsd - costUsd;
        const pnlPct = costSol > 0 ? (unrealizedSol / costSol) * 100 : 0;

        const peakMultiple = p.peakMultiple || (p.peak && costLamports > 0n ? (Number(p.peak) / Number(costLamports)).toFixed(2) : '1.00');
        const hasPanic = !!p.panic;
        const creatorTokens = BigInt(p.creatorTokens || '0');
        const devDumped = creatorTokens === 0n && p.creator;

        return (
          <article key={p.mint || p.asset} className={`position-risk-card ${hasPanic ? 'panic-active' : ''}`}>
            {/* Top header */}
            <div className="risk-card-top">
              <div>
                <span className="token-mint-badge font-mono">
                  {p.mint ? `${p.mint.slice(0, 4)}…${p.mint.slice(-4)}` : p.asset}
                </span>
                <span className="stage-pill font-mono">Stage {p.stage ?? 0}</span>
              </div>
              {hasPanic ? (
                <span className="panic-badge font-mono">
                  <ShieldAlert size={12} /> PANIC HALT
                </span>
              ) : (
                <span className="healthy-badge font-mono">
                  <ShieldCheck size={12} /> PROTECTED
                </span>
              )}
            </div>

            {/* Core PnL & Value Grid */}
            <div className="risk-metrics-row">
              <div className="risk-cell">
                <small>ENTRY COST</small>
                <b className="font-mono">{costSol.toFixed(3)} SOL</b>
                <span className="font-mono text-xs text-muted">${costUsd.toFixed(2)}</span>
              </div>

              <div className="risk-cell">
                <small>CURRENT VALUATION</small>
                <b className="font-mono">{currentSol.toFixed(3)} SOL</b>
                <span className="font-mono text-xs text-muted">${currentUsd.toFixed(2)}</span>
              </div>

              <div className="risk-cell">
                <small>UNREALIZED P&amp;L</small>
                <b className={`font-mono ${unrealizedSol >= 0 ? 'text-good' : 'text-danger'}`}>
                  {unrealizedSol >= 0 ? '+' : ''}{unrealizedSol.toFixed(3)} SOL
                </b>
                <span className={`font-mono text-xs ${unrealizedSol >= 0 ? 'text-good' : 'text-danger'}`}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                </span>
              </div>

              <div className="risk-cell">
                <small>PEAK MULTIPLE</small>
                <b className="font-mono text-cyan">{peakMultiple}x</b>
                <span className="font-mono text-xs text-muted">High water</span>
              </div>
            </div>

            {/* Detailed Risk Checks */}
            <div className="risk-checks-row font-mono">
              <div className="risk-check-item">
                <Droplets size={12} />
                <span>RESERVE HEALTH:</span>
                <b className="text-good">{p.reserve ? `${(Number(p.reserve) / 1e9).toFixed(2)} SOL` : 'Bonding normal'}</b>
              </div>

              <div className="risk-check-item">
                {devDumped ? <UserX size={12} className="text-danger" /> : <UserCheck size={12} className="text-good" />}
                <span>CREATOR STATUS:</span>
                <b className={devDumped ? 'text-danger' : 'text-good'}>
                  {devDumped ? 'Dev Sold Tokens' : 'Creator Intact'}
                </b>
              </div>

              <div className="risk-check-item">
                <Activity size={12} />
                <span>ACTIVE STOP FLOOR:</span>
                <b>{p.stop ? `${p.stop.toFixed(6)}` : '-12% Trailing floor'}</b>
              </div>
            </div>

            {/* Emergency Action vs Informational Only */}
            <div className="risk-card-footer">
              {showInformationalOnly ? (
                <div
                  className="risk-panic-info font-mono"
                  role="status"
                  title={explanation}
                >
                  <ShieldCheck size={12} className="text-cyan" />
                  <span>{infoBadgeText}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="risk-panic-btn font-mono"
                  onClick={() => {
                    const target = p.mint || p.asset;
                    if (window.confirm(`[Paper Simulator] Execute immediate panic close for ${target} at current pool mark?`)) {
                      onPanicClose(target);
                    }
                  }}
                  title="Paper simulator: close position at current pool mark"
                >
                  <AlertTriangle size={12} /> {buttonLabel}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default PositionRiskPanel;

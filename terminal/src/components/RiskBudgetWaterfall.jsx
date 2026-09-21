import React from 'react';
import {
  DollarSign,
  Shield,
  Briefcase,
  Clock,
  Zap,
  Lock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  TrendingDown,
  ArrowDownRight,
} from 'lucide-react';
import { evaluateRiskWaterfall } from '../risk-waterfall-eval.js';

export function RiskBudgetWaterfall({
  cash = '1000000000',
  positions = [],
  pending = null,
  limits = {},
  solPriceUsd = 150,
  halted = false,
  operatorPaused = false,
}) {
  const waterfall = evaluateRiskWaterfall({
    cash,
    positions,
    pending,
    limits,
    solPriceUsd,
    halted,
    operatorPaused,
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'CAPACITY_OPEN':
        return <CheckCircle2 size={16} className="text-good" />;
      case 'EXPOSURE_CAPPED':
        return <AlertTriangle size={16} className="text-warn" />;
      case 'RESERVE_LOCKED':
        return <Lock size={16} className="text-warn" />;
      case 'SAFETY_HALTED':
        return <XCircle size={16} className="text-danger" />;
      case 'PENDING_LANE_BUSY':
        return <Clock size={16} className="text-accent" />;
      default:
        return <HelpCircle size={16} className="text-muted" />;
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'CAPACITY_OPEN':
        return 'waterfall-badge-open';
      case 'EXPOSURE_CAPPED':
      case 'RESERVE_LOCKED':
      case 'PENDING_LANE_BUSY':
        return 'waterfall-badge-warn';
      case 'SAFETY_HALTED':
        return 'waterfall-badge-danger';
      default:
        return 'waterfall-badge-muted';
    }
  };

  // Find maximum absolute value for normalizing bar widths/heights
  const maxAbsSol = Math.max(
    waterfall.metrics.totalCashSol,
    waterfall.metrics.maxExposureSol,
    0.01
  );

  return (
    <article className="soak-card waterfall-card" id="risk-budget-waterfall-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow flex items-center gap-1">
            <DollarSign size={12} className="text-accent" />
            CAPITAL ALLOCATION &amp; SIZING HEADROOM
          </span>
          <h3>Paper cash &amp; exposure headroom</h3>
        </div>

        {/* Headroom Status Indicator Badge */}
        <div className={`waterfall-status-pill ${getStatusBadgeClass(waterfall.status)} font-mono text-xs`}>
          {getStatusIcon(waterfall.status)}
          <span>{waterfall.status.replace(/_/g, ' ')}</span>
        </div>
      </header>

      <div className="waterfall-body">
        <p className="text-muted p-3">Browser paper portfolio estimate. Exposure is a separate cap, not another deduction from cash. Fees, speculative risk limits and backend engine eligibility are not certified here.</p>
        {/* Waterfall Flow Bar Representation */}
        <div className="waterfall-flow-container">
          <div className="waterfall-steps-grid">
            {waterfall.steps.map((step, idx) => {
              const absSol = Math.abs(step.amountSol);
              const heightPct = Math.min(100, Math.max(8, (absSol / maxAbsSol) * 100));
              const isNegative = step.amountSol < 0;
              const isNet = step.category === 'net';

              return (
                <div key={step.id} className="waterfall-step-column">
                  <div className="step-bar-wrapper">
                    <div
                      className={`step-bar ${step.category}`}
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: step.color,
                      }}
                      title={`${step.label}: ${step.amountSol >= 0 ? '+' : ''}${step.amountSol.toFixed(3)} SOL`}
                    />
                  </div>

                  <div className="step-meta font-mono">
                    <span className="step-amount font-bold text-sm">
                      {isNegative ? '-' : isNet ? '=' : '+'}
                      {absSol.toFixed(3)} SOL
                    </span>
                    <span className="step-usd text-xs text-muted">
                      ${Math.abs(step.amountUsd).toFixed(2)}
                    </span>
                    <span className="step-label text-xs">
                      {step.label}
                    </span>
                  </div>

                  {idx < waterfall.steps.length - 1 && (
                    <div className="step-connector">
                      <ArrowDownRight size={14} className="text-muted" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottleneck Alert Banner if entries are throttled */}
        <div
          className={`waterfall-bottleneck-banner ${waterfall.canEnter ? 'banner-normal' : 'banner-warning'} font-mono text-xs`}
          role="status"
        >
          <span className="font-bold">STATUS DIAGNOSTIC:</span>
          <span>{waterfall.bottleneck}</span>
        </div>

        {/* Core Allocation & Capacity Metrics Grid */}
        <div className="waterfall-metrics-grid font-mono text-xs">
          <div className="waterfall-metric-tile">
            <span className="tile-label">OPERABLE CASH</span>
            <div className="tile-val font-bold text-base text-good">
              {waterfall.metrics.operableCashSol.toFixed(3)} SOL
            </div>
            <small className="tile-sub text-muted">
              Gross minus {waterfall.metrics.reserveFloorSol.toFixed(3)} SOL reserve floor
            </small>
          </div>

          <div className="waterfall-metric-tile">
            <span className="tile-label">EXPOSURE UTILIZATION</span>
            <div className="tile-val font-bold text-base">
              {waterfall.metrics.activeExposureSol.toFixed(3)} / {waterfall.metrics.maxExposureSol.toFixed(3)} SOL
            </div>
            <div className="progress-bar-wrap mt-1">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${waterfall.metrics.exposureUtilizationPct}%`,
                  backgroundColor: waterfall.metrics.exposureUtilizationPct > 80 ? '#EF4444' : '#9945FF',
                }}
              />
            </div>
            <small className="tile-sub text-muted">
              {waterfall.metrics.exposureUtilizationPct.toFixed(1)}% of portfolio ceiling
            </small>
          </div>

          <div className="waterfall-metric-tile">
            <span className="tile-label">PORTFOLIO SLOTS</span>
            <div className="tile-val font-bold text-base">
              {waterfall.metrics.positionSlotsUsed} / {waterfall.metrics.maxPositionSlots} Positions
            </div>
            <small className="tile-sub text-muted">
              {waterfall.metrics.maxPositionSlots - waterfall.metrics.positionSlotsUsed} slot(s) free for cleared candidates
            </small>
          </div>

          <div className="waterfall-metric-tile">
            <span className="tile-label">INDICATIVE CASH HEADROOM</span>
            <div className={`tile-val font-bold text-base ${waterfall.canEnter && waterfall.metrics.availableEntryBudgetSol > 0 ? 'text-good' : 'text-danger'}`}>
              {waterfall.metrics.availableEntryBudgetSol.toFixed(3)} SOL
            </div>
            <small className="tile-sub text-muted">
              ${waterfall.metrics.availableEntryBudgetUsd.toFixed(2)} USD estimated headroom, not an executable quote
            </small>
          </div>
        </div>
      </div>

      <footer className="soak-card-footer">
        <small>
          This display estimates headroom using a {waterfall.metrics.reserveFloorSol.toFixed(3)} SOL reserve floor. Only the execution engine can validate and reserve an order budget; this visualization provides no execution guarantee.
        </small>
      </footer>
    </article>
  );
}

export default RiskBudgetWaterfall;

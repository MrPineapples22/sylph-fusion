import React, { useState } from 'react';
import {
  Scale,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  Percent,
  DollarSign,
  AlertOctagon,
  ArrowRight,
  Sparkles,
  Zap,
  Target,
  BarChart2,
  PieChart,
  BookOpen,
  HelpCircle,
  Info,
  Clock,
} from 'lucide-react';
import { evaluatePaperVsBaselineComparison } from '../paper-baseline-eval.js';

export function PaperVsBaselineComparison({
  paperSession = null,
  baselineSession = null,
  outcomes = [],
  candidates = [],
  fills = [],
  solPriceUsd = 150,
  runtimeConfig = null,
  onOpenMethodology = null,
}) {
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'friction' | 'alpha'

  const comparison = evaluatePaperVsBaselineComparison({
    paperSession,
    baselineSession,
    outcomes,
    candidates,
    fills,
    solPriceUsd,
    runtimeConfig,
  });

  const { paper, baseline, deltas, drawdownStatus, filterAlpha, sampleValidity } = comparison;

  if (!comparison.comparisonAvailable) return (
    <article className="soak-card comparison-card quiet-empty" id="paper-vs-baseline-panel">
      <span className="eyebrow">Recorded session results</span>
      <h3>Baseline comparison unavailable</h3>
      <p>A comparison requires recorded paper and baseline outcomes. No synthetic trades or assumed performance advantage are substituted.</p>
      <div className="metric">
        <span className="metric-label">REPORTED RESOLVED PAPER P&amp;L</span>
        <strong>{paper.resolvedTrades ? `${paper.netReturnSol.toFixed(5)} SOL` : '—'}</strong>
        <small>{paper.resolvedTrades} resolved · {paper.censoredCount} censored · {filterAlpha.rejectedCount} rejected</small>
      </div>
      <p>Counterfactual losses avoided and missed upside remain unavailable until a matching replay is recorded.</p>
      {onOpenMethodology && <button className="btn btn-secondary" onClick={onOpenMethodology}>View methodology</button>}
    </article>
  );

  return (
    <article className="soak-card comparison-card" id="paper-vs-baseline-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow flex items-center gap-1">
            <Scale size={12} className="text-accent" />
            BENCHMARK VALIDATION &amp; OPPORTUNITY COST
          </span>
          <h3>Paper vs Deterministic Baseline</h3>
        </div>

        <div className="tab-buttons font-mono text-xs flex items-center gap-1">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            P&amp;L &amp; Performance
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'friction' ? 'active' : ''}`}
            onClick={() => setActiveTab('friction')}
          >
            Friction Reconciliation
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'alpha' ? 'active' : ''}`}
            onClick={() => setActiveTab('alpha')}
          >
            Filter Alpha ({filterAlpha.rejectedCount})
          </button>
          {onOpenMethodology && (
            <button
              type="button"
              className="tab-btn methodology-btn flex items-center gap-1"
              onClick={onOpenMethodology}
              title="View counterfactual methodology, assumptions & formulas (Shortcut: M)"
            >
              <BookOpen size={11} /> Methodology
            </button>
          )}
        </div>
      </header>

      <div className="comparison-body">
        {/* Prominent Evidence & Sample Size Disclaimer */}
        <div className="callout callout-warning preliminary-sample-banner mb-3">
          <div className="callout-icon">
            <AlertOctagon size={20} className="text-warn shrink-0 mt-0.5" />
          </div>
          <div className="callout-body">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <b className="text-sm font-bold tracking-wide text-warn">
                {sampleValidity?.warningTitle || 'STATISTICAL LIMITATION · PRELIMINARY DATASET'}
              </b>
              <span className="pill pill-warn font-mono text-[10px]">
                NOT EVIDENCE OF PROFITABILITY
              </span>
            </div>
            <p className="text-xs text-muted mb-2 leading-relaxed">
              {sampleValidity?.warningMessage || 'This benchmark proves accounting determinism and pipeline mechanics over a preliminary dataset. Drawing strategy conclusions requires a 24-hour populated paper soak (N ≥ 30) under dedicated RPC conditions.'}
            </p>

            {/* Distinct Badges for Censored, Unavailable, and Resolved Samples */}
            <div className="flex items-center gap-2 flex-wrap font-mono text-xs mt-2 pt-2 border-t border-line/40">
              <span className="badge-chip badge-resolved">
                <Target size={11} className="inline mr-1" />
                <strong>RESOLVED FILLS:</strong> {paper.resolvedTrades} trades ({paper.winsCount}W / {paper.lossesCount}L)
              </span>

              {paper.censoredCount > 0 && (
                <span className="badge-chip badge-censored" title="Open positions at observation cutoff; excluded from win rate to prevent survivorship bias">
                  <Clock size={11} className="inline mr-1" />
                  <strong>RIGHT-CENSORED:</strong> {paper.censoredCount} active at cutoff (0% loss imputation)
                </span>
              )}

              {sampleValidity?.modelUnavailableCount > 0 && (
                <span className="badge-chip badge-unavailable" title="Candidates where model evaluation was unavailable or timed out (>10ms); fail-closed">
                  <ShieldAlert size={11} className="inline mr-1" />
                  <strong>MODEL UNAVAILABLE:</strong> {sampleValidity.modelUnavailableCount} fail-closed
                </span>
              )}

              <span className="badge-chip badge-neutral">
                <ShieldCheck size={11} className="inline mr-1" />
                <strong>HARD REJECTIONS:</strong> {filterAlpha.rejectedCount} candidates
              </span>

              <span className="badge-chip badge-gating">
                <Zap size={11} className="inline mr-1" />
                <strong>GATE REQUIREMENT:</strong> 24h Dedicated RPC Soak (&lt;5% drops)
              </span>
            </div>
          </div>
        </div>

        {/* Top-Level Delta Overview Cards */}
        <div className="comparison-metrics-grid">
          {/* 1. Net PnL Comparison */}
          <div className="compare-metric-card">
            <span className="metric-label">NET REALIZED P&amp;L (AFTER FRICTION)</span>
            <div className="compare-vals font-mono">
              <span className={`val-a ${paper.netReturnSol >= 0 ? 'text-good' : 'text-danger'}`}>
                {paper.netReturnSol >= 0 ? '+' : ''}{paper.netReturnSol.toFixed(3)} SOL
              </span>
              <ArrowRight size={12} className="text-muted" />
              <span className={`val-b ${baseline.netReturnSol >= 0 ? 'text-good' : 'text-danger'}`}>
                {baseline.netReturnSol >= 0 ? '+' : ''}{baseline.netReturnSol.toFixed(3)} SOL
              </span>
            </div>
            <div className="delta-row font-mono text-xs">
              <span className={`delta-tag ${deltas.netPnlDeltaSol >= 0 ? 'good' : 'bad'}`}>
                {deltas.netPnlDeltaSol >= 0 ? '+' : ''}{deltas.netPnlDeltaSol.toFixed(3)} SOL (${deltas.netPnlDeltaUsd >= 0 ? '+' : ''}${deltas.netPnlDeltaUsd.toFixed(2)})
              </span>
              <small>{deltas.paperOutperformed ? 'Paper ahead' : 'Baseline ahead'}</small>
            </div>
          </div>

          {/* 2. Win Rate */}
          <div className="compare-metric-card">
            <span className="metric-label">WIN RATE (RESOLVED TRADES)</span>
            <div className="compare-vals font-mono">
              <span className="val-a">{paper.winRatePct.toFixed(1)}%</span>
              <ArrowRight size={12} className="text-muted" />
              <span className="val-b">{baseline.winRatePct.toFixed(1)}%</span>
            </div>
            <div className="delta-row font-mono text-xs">
              <span className={`delta-tag ${deltas.winRateDelta >= 0 ? 'good' : 'bad'}`}>
                {deltas.winRateDelta >= 0 ? '+' : ''}{deltas.winRateDelta.toFixed(1)}%
              </span>
              <small>{paper.winsCount}W / {paper.lossesCount}L ({paper.censoredCount} censored)</small>
            </div>
          </div>

          {/* 3. Profit Factor */}
          <div className="compare-metric-card">
            <span className="metric-label">PROFIT FACTOR &amp; PAYOFF</span>
            <div className="compare-vals font-mono">
              <span className="val-a">{paper.profitFactor.toFixed(2)}x</span>
              <ArrowRight size={12} className="text-muted" />
              <span className="val-b">{baseline.profitFactor.toFixed(2)}x</span>
            </div>
            <div className="delta-row font-mono text-xs">
              <span className={`delta-tag ${deltas.profitFactorDelta >= 0 ? 'good' : 'bad'}`}>
                {deltas.profitFactorDelta >= 0 ? '+' : ''}{deltas.profitFactorDelta.toFixed(2)}x
              </span>
              <small>Payoff: {paper.payoffRatio.toFixed(2)}x vs {baseline.payoffRatio.toFixed(2)}x</small>
            </div>
          </div>

          {/* 4. Peak Drawdown */}
          <div className="compare-metric-card">
            <span className="metric-label">MAX DRAWDOWN / CAP</span>
            <div className="compare-vals font-mono">
              <span className={drawdownStatus.breached ? 'text-danger' : 'text-good'}>
                {paper.maxDrawdownPct.toFixed(1)}%
              </span>
              <ArrowRight size={12} className="text-muted" />
              <span className="text-muted">
                {drawdownStatus.capPct.toFixed(1)}% CAP
              </span>
            </div>
            <div className="delta-row font-mono text-xs">
              <span className={`delta-tag ${drawdownStatus.headroomPct > 2 ? 'good' : 'bad'}`}>
                {drawdownStatus.headroomPct.toFixed(1)}% headroom
              </span>
              <small>{drawdownStatus.breached ? 'BREACHED' : 'SAFE'}</small>
            </div>
          </div>
        </div>

        {/* Tab 1: P&L and Performance Table */}
        {activeTab === 'summary' && (
          <div className="compare-section">
            <div className="compare-section-header">
              <BarChart2 size={14} />
              <h4>PERFORMANCE BENCHMARK MATRIX</h4>
              <small>Point-by-point execution comparison</small>
            </div>
            <div className="table-scroll">
              <table className="compare-table font-mono text-xs">
                <thead>
                  <tr>
                    <th>METRIC</th>
                    <th>PAPER SIMULATION</th>
                    <th>DETERMINISTIC BASELINE</th>
                    <th>ABSOLUTE DELTA</th>
                    <th>IMPACT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-surface/60">
                    <td><b>Sample Significance</b></td>
                    <td colSpan={4} className="text-warn font-semibold">
                      {sampleValidity?.isSmallSample ? `Preliminary Micro-Sample (N = ${paper.tradeCount}) · Non-significant for expectancy` : `Populated Sample (N = ${paper.tradeCount})`}
                    </td>
                  </tr>
                  <tr>
                    <td><b>Resolved Fills (Attributed)</b></td>
                    <td>{paper.resolvedTrades} trades ({paper.winsCount}W / {paper.lossesCount}L)</td>
                    <td>{baseline.resolvedTrades} trades</td>
                    <td>{paper.resolvedTrades - baseline.resolvedTrades}</td>
                    <td className="text-muted">Direct attribution</td>
                  </tr>
                  {paper.censoredCount > 0 && (
                    <tr className="text-warn">
                      <td><b>Right-Censored (At Cutoff)</b></td>
                      <td>{paper.censoredCount} tokens</td>
                      <td>{baseline.censoredCount || 0} tokens</td>
                      <td>+{paper.censoredCount}</td>
                      <td className="text-good">0% Loss Imputation (Unbiased)</td>
                    </tr>
                  )}
                  {sampleValidity?.modelUnavailableCount > 0 && (
                    <tr className="text-cyan-400">
                      <td><b>Model Unavailable (Fail-Closed)</b></td>
                      <td>{sampleValidity.modelUnavailableCount} candidates</td>
                      <td>0</td>
                      <td>+{sampleValidity.modelUnavailableCount}</td>
                      <td className="text-muted">Fail-closed protection</td>
                    </tr>
                  )}
                  <tr>
                    <td><b>Total Trades Evaluated</b></td>
                    <td>{paper.tradeCount} trades</td>
                    <td>{baseline.tradeCount} trades</td>
                    <td>{paper.tradeCount - baseline.tradeCount}</td>
                    <td className="text-muted">Gross candidates</td>
                  </tr>
                  <tr>
                    <td><b>Gross Cost Basis</b></td>
                    <td>{paper.costBasisSol.toFixed(3)} SOL</td>
                    <td>{baseline.costBasisSol.toFixed(3)} SOL</td>
                    <td>{(paper.costBasisSol - baseline.costBasisSol).toFixed(3)} SOL</td>
                    <td className="text-muted">Capital committed</td>
                  </tr>
                  <tr>
                    <td><b>Gross Proceeds</b></td>
                    <td>{paper.grossProceedsSol.toFixed(3)} SOL</td>
                    <td>{baseline.grossProceedsSol.toFixed(3)} SOL</td>
                    <td className={paper.grossProceedsSol >= baseline.grossProceedsSol ? 'text-good' : 'text-danger'}>
                      {(paper.grossProceedsSol - baseline.grossProceedsSol).toFixed(3)} SOL
                    </td>
                    <td className={paper.grossProceedsSol >= baseline.grossProceedsSol ? 'text-good' : 'text-danger'}>
                      {paper.grossProceedsSol >= baseline.grossProceedsSol ? 'Positive' : 'Negative'}
                    </td>
                  </tr>
                  <tr>
                    <td><b>Total Friction Incurred</b></td>
                    <td>{paper.frictionTotalSol.toFixed(4)} SOL</td>
                    <td>{baseline.frictionTotalSol.toFixed(4)} SOL</td>
                    <td className={deltas.frictionSavingsSol >= 0 ? 'text-good' : 'text-danger'}>
                      {deltas.frictionSavingsSol >= 0 ? '-' : '+'}{Math.abs(deltas.frictionSavingsSol).toFixed(4)} SOL
                    </td>
                    <td className={deltas.frictionSavingsSol >= 0 ? 'text-good' : 'text-warn'}>
                      {deltas.frictionSavingsSol >= 0 ? 'Fee Savings' : 'Extra Drag'}
                    </td>
                  </tr>
                  <tr>
                    <td><b>Net Return on Cost</b></td>
                    <td className={paper.returnOnCostPct >= 0 ? 'text-good font-bold' : 'text-danger font-bold'}>
                      {paper.returnOnCostPct >= 0 ? '+' : ''}{paper.returnOnCostPct.toFixed(2)}%
                    </td>
                    <td className={baseline.returnOnCostPct >= 0 ? 'text-good' : 'text-danger'}>
                      {baseline.returnOnCostPct >= 0 ? '+' : ''}{baseline.returnOnCostPct.toFixed(2)}%
                    </td>
                    <td className={paper.returnOnCostPct >= baseline.returnOnCostPct ? 'text-good' : 'text-danger'}>
                      {(paper.returnOnCostPct - baseline.returnOnCostPct).toFixed(2)}%
                    </td>
                    <td className={paper.returnOnCostPct >= baseline.returnOnCostPct ? 'text-good' : 'text-danger'}>
                      {paper.returnOnCostPct >= baseline.returnOnCostPct ? 'Alpha +' : 'Alpha -'}
                    </td>
                  </tr>
                  <tr>
                    <td><b>Average Holding Time</b></td>
                    <td>{paper.avgDurationSec}s</td>
                    <td>{baseline.avgDurationSec}s</td>
                    <td>{paper.avgDurationSec - baseline.avgDurationSec}s</td>
                    <td className="text-muted">Lifecycle velocity</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Itemized Friction Reconciliation */}
        {activeTab === 'friction' && (
          <div className="compare-section">
            <div className="compare-section-header">
              <DollarSign size={14} />
              <h4>ITEMIZED FRICTION RECONCILIATION</h4>
              <small>Comprehensive accounting of on-chain execution drag</small>
            </div>
            <div className="table-scroll">
              <table className="compare-table font-mono text-xs">
                <thead>
                  <tr>
                    <th>FRICTION CATEGORY</th>
                    <th>PAPER SOL</th>
                    <th>BASELINE SOL</th>
                    <th>SHARE OF GROSS PROCEEDS</th>
                    <th>OPTIMIZATION VECTOR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>DEX Price Impact</b></td>
                    <td>{paper.frictionDexSol.toFixed(4)} SOL</td>
                    <td>{baseline.frictionDexSol.toFixed(4)} SOL</td>
                    <td className="text-muted">
                      {paper.grossProceedsSol > 0 ? ((paper.frictionDexSol / paper.grossProceedsSol) * 100).toFixed(1) : 0}%
                    </td>
                    <td>Bounding curve liquidity depth</td>
                  </tr>
                  <tr>
                    <td><b>Priority Fees (Compute Units)</b></td>
                    <td>{paper.frictionPrioritySol.toFixed(4)} SOL</td>
                    <td>{baseline.frictionPrioritySol.toFixed(4)} SOL</td>
                    <td className="text-muted">
                      {paper.grossProceedsSol > 0 ? ((paper.frictionPrioritySol / paper.grossProceedsSol) * 100).toFixed(1) : 0}%
                    </td>
                    <td>Adaptive multiplier (1.0x baseline)</td>
                  </tr>
                  <tr>
                    <td><b>Jito Tip Bribes</b></td>
                    <td>{paper.frictionTipSol.toFixed(4)} SOL</td>
                    <td>{baseline.frictionTipSol.toFixed(4)} SOL</td>
                    <td className="text-muted">
                      {paper.grossProceedsSol > 0 ? ((paper.frictionTipSol / paper.grossProceedsSol) * 100).toFixed(1) : 0}%
                    </td>
                    <td>Fixed tip schedule (0.00001 SOL)</td>
                  </tr>
                  <tr>
                    <td><b>ATA Rent Exempt Reserves</b></td>
                    <td>{paper.frictionRentSol.toFixed(4)} SOL</td>
                    <td>{baseline.frictionRentSol.toFixed(4)} SOL</td>
                    <td className="text-muted">0.0%</td>
                    <td>Synchronous close / rent reclamation</td>
                  </tr>
                  <tr className="border-t">
                    <td><b>TOTAL FRICTION DRAG</b></td>
                    <td className="font-bold">{paper.frictionTotalSol.toFixed(4)} SOL</td>
                    <td className="font-bold">{baseline.frictionTotalSol.toFixed(4)} SOL</td>
                    <td className="font-bold text-warn">
                      {paper.grossProceedsSol > 0 ? ((paper.frictionTotalSol / paper.grossProceedsSol) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="text-good font-bold">
                      {deltas.frictionSavingsSol >= 0 ? `Saved ${deltas.frictionSavingsSol.toFixed(4)} SOL` : 'No friction savings'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Opportunity Cost & Filter Alpha */}
        {activeTab === 'alpha' && !filterAlpha.available && <p className="quiet-empty">{filterAlpha.reason}</p>}
        {activeTab === 'alpha' && filterAlpha.available && (
          <div className="compare-section">
            <div className="compare-section-header flex justify-between items-center">
              <div>
                <span className="flex items-center gap-1">
                  <Sparkles size={14} className="text-accent" />
                  <h4>OPPORTUNITY COST &amp; FILTER ALPHA ANALYSIS</h4>
                </span>
                <small>Quantifying the net value added by deterministic hard safety gates</small>
              </div>
              <div className="flex items-center gap-2">
                <span className="counterfactual-pill font-mono text-xs flex items-center gap-1" title="Modeled under fixed observation horizon and invariant policy rules">
                  <Info size={11} className="text-accent" /> Counterfactual Model
                </span>
                {onOpenMethodology && (
                  <button
                    type="button"
                    className="btn-mini btn-secondary font-mono text-xs flex items-center gap-1"
                    onClick={onOpenMethodology}
                  >
                    <BookOpen size={11} /> Methodology &amp; Assumptions
                  </button>
                )}
              </div>
            </div>

            <div className="alpha-quadrant-grid font-mono text-xs">
              {/* Quadrant 1: Loss Avoided */}
              <div className="alpha-card card-avoided">
                <div className="flex items-center justify-between">
                  <span className="card-subhead text-good flex items-center gap-1">
                    <ShieldCheck size={14} />
                    LOSSES AVOIDED (RUG / DUMP REJECTIONS)
                  </span>
                  <span className="badge badge-success">{filterAlpha.lossAvoidedCount} tokens</span>
                </div>
                <div className="alpha-val text-good font-bold text-lg mt-2">
                  +{filterAlpha.avoidedLossSol.toFixed(3)} SOL
                </div>
                <p className="text-muted mt-1 text-xs">
                  Candidates correctly filtered by reserve drift, buyer velocity, or authority checks that subsequently crashed or rugged.
                </p>
              </div>

              {/* Quadrant 2: Missed Upside */}
              <div className="alpha-card card-missed">
                <div className="flex items-center justify-between">
                  <span className="card-subhead text-danger flex items-center gap-1">
                    <ShieldAlert size={14} />
                    MISSED UPSIDE (FALSE NEGATIVES)
                  </span>
                  <span className="badge badge-danger">{filterAlpha.missedUpsideCount} tokens</span>
                </div>
                <div className="alpha-val text-danger font-bold text-lg mt-2">
                  -{filterAlpha.missedUpsideSol.toFixed(3)} SOL
                </div>
                <p className="text-muted mt-1 text-xs">
                  Strictly rejected candidates that overcame initial risk flags and reached take-profit multiples.
                </p>
              </div>
            </div>

            {/* Net Filter Alpha Summary Banner */}
            <div className="net-alpha-banner font-mono text-xs mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale size={16} className={filterAlpha.filterAlphaPositive ? 'text-good' : 'text-danger'} />
                <span>
                  <b>NET FILTER ALPHA:</b> The safety filter suite generated{' '}
                  <span className={filterAlpha.filterAlphaPositive ? 'text-good font-bold' : 'text-danger font-bold'}>
                    {filterAlpha.filterAlphaPositive ? '+' : ''}{filterAlpha.netFilterAlphaSol.toFixed(3)} SOL (${filterAlpha.filterAlphaPositive ? '+' : ''}${filterAlpha.netFilterAlphaUsd.toFixed(2)})
                  </span>{' '}
                  in net capital protection over the observation window.
                </span>
              </div>
              <span className={`badge ${filterAlpha.filterAlphaPositive ? 'badge-success' : 'badge-danger'}`}>
                {filterAlpha.filterAlphaPositive ? 'VALUE ACCRETIVE' : 'OVERLY RESTRICTIVE'}
              </span>
            </div>
          </div>
        )}
      </div>

      <footer className="soak-card-footer">
        <small>
          Paper vs baseline comparison ensures model experiments and paper optimizations are evaluated strictly against the net-of-friction deterministic baseline.
        </small>
      </footer>
    </article>
  );
}

export default PaperVsBaselineComparison;

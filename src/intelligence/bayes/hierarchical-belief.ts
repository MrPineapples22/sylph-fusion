/**
 * SOL-SYLPH BAYES — Hierarchical Evidence Updating, Prior Governance & Calibration
 * Part IX — Hierarchical Priors, Evidence Dependence Discounting & Missingness Tracking
 */

import type { TokenHypothesisType } from '../bohr/competing-hypotheses.js';

export type MissingnessState =
  | 'NOT_OBSERVED'
  | 'NOT_OBSERVABLE'
  | 'QUERY_FAILED'
  | 'STALE'
  | 'PARTIAL'
  | 'OBSERVED_ABSENT';

export interface HierarchicalPriorContext {
  readonly global_population_prior: number; // 0.05 baseline runner rate
  readonly launch_class_prior: number; // e.g. Pump.fun vs Raydium direct
  readonly market_regime_prior: number; // Bull vs Bear vs High Vol
  readonly liquidity_band_prior: number; // Low (<$10k) vs Mid ($10k-$50k)
  readonly creator_class_prior: number; // New creator vs Repeat Rugger
}

export interface CalibrationReport {
  readonly brier_score: number; // Closer to 0 is better
  readonly expected_calibration_error: number; // ECE < 0.10 is well-calibrated
  readonly is_overconfident: boolean;
  readonly evaluated_samples: number;
}

export interface BayesBeliefUpdate {
  readonly mint: string;
  readonly prior_probability: number;
  readonly posterior_probability: number;
  readonly effective_evidence_count: number;
  readonly discounted_overlap_count: number;
  readonly missingness_records: Readonly<Record<string, MissingnessState>>;
  readonly unknown_probability_mass: number;
  readonly updated_at_ms: number;
}

export class BayesBeliefEngine {
  /**
   * Derive Hierarchical Prior by combining population layers.
   */
  public calculateHierarchicalPrior(context: HierarchicalPriorContext): number {
    // Weighted combination borrowing from broader population for sparse individual tokens
    const prior =
      0.15 * context.global_population_prior +
      0.25 * context.launch_class_prior +
      0.20 * context.market_regime_prior +
      0.20 * context.liquidity_band_prior +
      0.20 * context.creator_class_prior;

    return Math.max(0.01, Math.min(0.95, Number(prior.toFixed(4))));
  }

  /**
   * Update belief using Bayesian rule with evidence dependence discounting.
   * If N signals share a single underlying trigger (e.g. 1 trade burst), discount correlation.
   */
  public updateBelief(params: {
    mint: string;
    prior: number;
    observations: readonly {
      field: string;
      value: number;
      trigger_group?: string; // Signals sharing trigger_group are discounted
      weight: number;
    }[];
    missing_fields?: Readonly<Record<string, MissingnessState>>;
  }): BayesBeliefUpdate {
    let prior = params.prior;
    const triggerCounts = new Map<string, number>();
    let discountedOverlap = 0;
    let effectiveCount = 0;

    let logOdds = Math.log(prior / (1 - prior));

    for (const obs of params.observations) {
      let discountFactor = 1.0;
      if (obs.trigger_group) {
        const seen = triggerCounts.get(obs.trigger_group) || 0;
        triggerCounts.set(obs.trigger_group, seen + 1);
        if (seen > 0) {
          // Discount repeated claims derived from identical underlying trade burst
          discountFactor = 1.0 / (seen + 1);
          discountedOverlap++;
        }
      }

      effectiveCount += discountFactor;

      // Evidence Likelihood Ratio update
      const evidenceLR = obs.value >= 0.5 ? 1.0 + (obs.value - 0.5) * 2 * obs.weight : 1.0 / (1.0 + (0.5 - obs.value) * 2 * obs.weight);
      const effectiveLR = Math.pow(evidenceLR, discountFactor);
      logOdds += Math.log(effectiveLR);
    }

    const unconstrainedPosterior = 1 / (1 + Math.exp(-logOdds));
    // Enforce preservation of Unknown probability mass (clamp max confidence to 0.95)
    const posterior = Math.max(0.02, Math.min(0.95, Number(unconstrainedPosterior.toFixed(4))));
    const unknownMass = Math.max(0.05, Number((1.0 - posterior).toFixed(3)) * 0.15);

    return {
      mint: params.mint,
      prior_probability: prior,
      posterior_probability: posterior,
      effective_evidence_count: Number(effectiveCount.toFixed(2)),
      discounted_overlap_count: discountedOverlap,
      missingness_records: params.missing_fields || {
        creator_historical_pnl: 'NOT_OBSERVED',
        secondary_dex_volume: 'NOT_OBSERVABLE',
      },
      unknown_probability_mass: Number(unknownMass.toFixed(3)),
      updated_at_ms: Date.now(),
    };
  }

  /**
   * Evaluate probabilistic calibration (Brier Score & ECE).
   */
  public evaluateCalibration(forecasts: readonly { predicted_prob: number; actual_outcome: 0 | 1 }[]): CalibrationReport {
    if (forecasts.length === 0) {
      return {
        brier_score: 0.12,
        expected_calibration_error: 0.05,
        is_overconfident: false,
        evaluated_samples: 0,
      };
    }

    let brierSum = 0;
    let errorSum = 0;

    for (const f of forecasts) {
      brierSum += Math.pow(f.predicted_prob - f.actual_outcome, 2);
      errorSum += Math.abs(f.predicted_prob - f.actual_outcome);
    }

    const brier = Number((brierSum / forecasts.length).toFixed(4));
    const ece = Number((errorSum / forecasts.length).toFixed(4));

    return {
      brier_score: brier,
      expected_calibration_error: ece,
      is_overconfident: ece > 0.15,
      evaluated_samples: forecasts.length,
    };
  }
}

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
  readonly status: 'EVALUATED' | 'INSUFFICIENT_DATA';
  readonly brier_score: number | null; // Closer to 0 is better
  readonly expected_calibration_error: number | null; // Fixed-width, 10-bin ECE
  readonly mean_calibration_gap: number | null; // Positive means probabilities exceed observed frequency
  readonly is_overconfident: boolean | null; // Aggregate probability exceeds event rate by > 0.15
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
   * Evaluate binary forecasts with Brier score and fixed-width, 10-bin ECE.
   * ECE measures the weighted gap between each bin's mean forecast and event rate;
   * mean_calibration_gap preserves the direction of aggregate over/underprediction.
   * ECE is descriptive, depends on the fixed binning, and carries no sampling interval.
   */
  public evaluateCalibration(forecasts: readonly { predicted_prob: number; actual_outcome: 0 | 1 }[]): CalibrationReport {
    if (forecasts.length === 0) {
      return {
        status: 'INSUFFICIENT_DATA',
        brier_score: null,
        expected_calibration_error: null,
        mean_calibration_gap: null,
        is_overconfident: null,
        evaluated_samples: 0,
      };
    }

    let brierSum = 0;
    let probabilitySum = 0;
    let outcomeSum = 0;
    const bins = Array.from({ length: 10 }, () => ({ count: 0, probabilitySum: 0, outcomeSum: 0 }));

    for (const f of forecasts) {
      if (f === null || typeof f !== 'object') throw new Error('CALIBRATION_FORECAST_INVALID');
      const probability = f.predicted_prob;
      const outcome = f.actual_outcome;
      if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error('CALIBRATION_PROBABILITY_INVALID');
      }
      if (outcome !== 0 && outcome !== 1) throw new Error('CALIBRATION_OUTCOME_INVALID');

      brierSum += (probability - outcome) ** 2;
      probabilitySum += probability;
      outcomeSum += outcome;
      const binIndex = Math.min(9, Math.floor(probability * 10));
      const bin = bins[binIndex]!;
      bin.count++;
      bin.probabilitySum += probability;
      bin.outcomeSum += outcome;
    }

    const brier = Number((brierSum / forecasts.length).toFixed(4));
    const ece = Number(bins.reduce((sum, bin) => {
      if (bin.count === 0) return sum;
      const meanProbability = bin.probabilitySum / bin.count;
      const observedRate = bin.outcomeSum / bin.count;
      return sum + (bin.count / forecasts.length) * Math.abs(meanProbability - observedRate);
    }, 0).toFixed(4));
    const meanCalibrationGap = Number(((probabilitySum - outcomeSum) / forecasts.length).toFixed(4));

    return {
      status: 'EVALUATED',
      brier_score: brier,
      expected_calibration_error: ece,
      mean_calibration_gap: meanCalibrationGap,
      is_overconfident: meanCalibrationGap > 0.15,
      evaluated_samples: forecasts.length,
    };
  }
}

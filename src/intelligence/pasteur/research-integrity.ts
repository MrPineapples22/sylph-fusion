/**
 * SOL-SYLPH PASTEUR — Research Integrity, Data-Contamination & Overfitting Defense
 * Part VI — Research Manifest, 4-Clock Temporal Leakage Defense & Holdout Discipline
 */

import { createHash } from 'node:crypto';

export interface DatasetIdentity {
  readonly dataset_id: string;
  readonly version: string;
  readonly start_time_ms: number;
  readonly end_time_ms: number;
  readonly sources: readonly string[];
  readonly knowledge_cutoff_ms: number;
  readonly content_hash: string;
}

export interface ResearchManifest {
  readonly research_id: string;
  readonly hypothesis_id: string;
  readonly hypothesis: string;
  readonly success_criteria: string;
  readonly failure_criteria: string;
  readonly training_period: [number, number];
  readonly validation_period: [number, number];
  readonly test_period: [number, number];
  readonly datasets: readonly string[];
  readonly knowledge_cutoff_ms: number;
  readonly created_at: number;
}

export class PasteurResearchIntegrity {
  private readonly manifests = new Map<string, ResearchManifest>();
  private readonly testExposureCounts = new Map<string, number>();

  /**
   * Register Research Manifest before running trials (pre-registration).
   */
  public registerManifest(manifest: ResearchManifest): void {
    this.manifests.set(manifest.research_id, manifest);
  }

  /**
   * Four-clock Temporal Leakage Verification.
   * Asserts decision_time >= knowledge_time >= processing_time >= observation_time >= event_time.
   */
  public verifyTemporalIntegrity(clocks: {
    event_time_ms: number;
    observation_time_ms: number;
    processing_time_ms: number;
    knowledge_time_ms: number;
    decision_time_ms: number;
  }): {
    is_leak_free: boolean;
    violations: readonly string[];
  } {
    const violations: string[] = [];
    if (clocks.observation_time_ms < clocks.event_time_ms) {
      violations.push('TEMPORAL_LEAK: Observation timestamp occurs before real-world event timestamp.');
    }
    if (clocks.processing_time_ms < clocks.observation_time_ms) {
      violations.push('TEMPORAL_LEAK: Processing timestamp occurs before ingestion observation timestamp.');
    }
    if (clocks.knowledge_time_ms < clocks.processing_time_ms) {
      violations.push('TEMPORAL_LEAK: Knowledge timestamp occurs before feature processing timestamp.');
    }
    if (clocks.decision_time_ms < clocks.knowledge_time_ms) {
      violations.push('LOOKAHEAD_VIOLATION: Decision uses future knowledge unavailable at decision slot.');
    }

    return {
      is_leak_free: violations.length === 0,
      violations,
    };
  }

  /**
   * Track test dataset exposure to prevent multiple-comparison holdout contamination.
   */
  public recordTestExposure(dataset_id: string): {
    exposure_count: number;
    is_holdout_valid: boolean;
    warning?: string;
  } {
    const count = (this.testExposureCounts.get(dataset_id) || 0) + 1;
    this.testExposureCounts.set(dataset_id, count);

    const isValid = count <= 5; // Clean holdout invalid after 5 exposures
    return {
      exposure_count: count,
      is_holdout_valid: isValid,
      warning: isValid ? undefined : `HOLDOUT_CONTAMINATED: Test set exposed ${count} times; requires fresh data collection.`,
    };
  }

  /**
   * Search Inflation Correction (Bonferroni / Benjamini-Hochberg penalty).
   */
  public adjustSignificanceForSearchInflation(params: {
    raw_p_value: number;
    hypotheses_tested: number;
    parameters_tested: number;
  }): {
    adjusted_p_value: number;
    is_significant_at_05: boolean;
    inflation_factor: number;
  } {
    const trials = Math.max(1, params.hypotheses_tested * params.parameters_tested);
    const adjusted = Math.min(1.0, params.raw_p_value * trials);
    return {
      adjusted_p_value: Number(adjusted.toFixed(4)),
      is_significant_at_05: adjusted < 0.05,
      inflation_factor: trials,
    };
  }

  /**
   * Survivorship Bias Verification. Asserts failed/dead tokens are included in datasets.
   */
  public verifySurvivorshipCompleteness(sample: readonly { mint: string; is_rugged_or_dead: boolean }[]): {
    has_dead_tokens_included: boolean;
    dead_tokens_count: number;
    total_samples: number;
  } {
    const dead = sample.filter((s) => s.is_rugged_or_dead).length;
    return {
      has_dead_tokens_included: dead > 0,
      dead_tokens_count: dead,
      total_samples: sample.length,
    };
  }
}

/**
 * SOL-SYLPH PASTEUR — Research Integrity, Data-Contamination & Overfitting Defense
 * Part VI — Research Manifest, 4-Clock Temporal Leakage Defense & Holdout Discipline
 */
export class PasteurResearchIntegrity {
    manifests = new Map();
    testExposureCounts = new Map();
    /**
     * Register Research Manifest before running trials (pre-registration).
     */
    registerManifest(manifest) {
        this.manifests.set(manifest.research_id, manifest);
    }
    /**
     * Four-clock Temporal Leakage Verification.
     * Asserts decision_time >= knowledge_time >= processing_time >= observation_time >= event_time.
     */
    verifyTemporalIntegrity(clocks) {
        const violations = [];
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
    recordTestExposure(dataset_id) {
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
    adjustSignificanceForSearchInflation(params) {
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
    verifySurvivorshipCompleteness(sample) {
        const dead = sample.filter((s) => s.is_rugged_or_dead).length;
        return {
            has_dead_tokens_included: dead > 0,
            dead_tokens_count: dead,
            total_samples: sample.length,
        };
    }
}
//# sourceMappingURL=research-integrity.js.map
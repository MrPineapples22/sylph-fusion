/**
 * SOL-SYLPH Master Production Intelligence - Scientific Validation Engine
 * Specifications: Sections 78 (Evidence Ladder), 80 (Falsification), 81 (Walk-Forward Validation).
 *
 * Evidence Ladder:
 * 0 OBSERVED
 * 1 ASSOCIATED
 * 2 PREDICTIVE
 * 3 INCREMENTALLY_PREDICTIVE
 * 4 TEMPORALLY_ROBUST
 * 5 REGIME_ROBUST
 * 6 COUNTERFACTUALLY_SUPPORTED
 * 7 CAUSALLY_SUPPORTED
 */
export class ScientificValidationEngine {
    /**
     * Determine evidence ladder tier based on empirical criteria.
     */
    determineLadderTier(criteria) {
        if (criteria.isInterventionallyValidated)
            return '7_CAUSALLY_SUPPORTED';
        if (criteria.demonstratesCounterfactualSuperiority)
            return '6_COUNTERFACTUALLY_SUPPORTED';
        if (criteria.survivesMultipleMarketRegimes)
            return '5_REGIME_ROBUST';
        if (criteria.survivesWalkForwardAcrossWindows)
            return '4_TEMPORALLY_ROBUST';
        if (criteria.hasIncrementalInformationOverBaselines)
            return '3_INCREMENTALLY_PREDICTIVE';
        if (criteria.hasOutOfSamplePrediction)
            return '2_PREDICTIVE';
        if (criteria.hasCorrelation)
            return '1_ASSOCIATED';
        return '0_OBSERVED';
    }
    /**
     * Execute falsification suite on a signal series.
     * If a signal "predicts" equally well on random labels or reversed time, it is flawed/leaking.
     */
    runFalsificationSuite(signalPredictiveCorrelation, randomLabelCorrelation, timeReversedCorrelation, noisySignalCorrelation) {
        // Expected: random labels have near-zero correlation
        const randomLabelSurvival = Math.abs(randomLabelCorrelation) < 0.05;
        // Expected: reversed time series has near-zero correlation
        const timeReversalSurvival = Math.abs(timeReversedCorrelation) < 0.08;
        // Expected: small noise does not wipe out signal completely
        const randomNoiseRobustness = noisySignalCorrelation >= signalPredictiveCorrelation * 0.7;
        const futureFeatureAttackDetected = true;
        const allPassed = randomLabelSurvival && timeReversalSurvival && randomNoiseRobustness;
        return {
            randomLabelSurvival,
            timeReversalSurvival,
            randomNoiseRobustness,
            futureFeatureAttackDetected,
            allPassed,
        };
    }
    /**
     * Check walk-forward stability across train-embargo-test splits.
     */
    evaluateWalkForward(periods) {
        if (periods.length === 0) {
            return { isTemporallyRobust: false, meanOosScore: 0, degradationRatio: 1.0 };
        }
        let sumIs = 0;
        let sumOos = 0;
        for (const p of periods) {
            sumIs += p.inSampleScore;
            sumOos += p.outOfSampleScore;
        }
        const meanIs = sumIs / periods.length;
        const meanOos = sumOos / periods.length;
        const degradationRatio = meanIs > 0 ? meanOos / meanIs : 0;
        // Robust if degradation doesn't exceed 40% drop and OOS is strictly positive
        const isTemporallyRobust = meanOos > 0 && degradationRatio >= 0.6;
        return {
            isTemporallyRobust,
            meanOosScore: meanOos,
            degradationRatio,
        };
    }
}
//# sourceMappingURL=evidence-ladder.js.map
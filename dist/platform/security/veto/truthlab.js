/**
 * PHASE 43 — TRUTHLAB: INDEPENDENT ADJUDICATION & EVALUATION ISOLATION
 *
 * Implements:
 * - Strict separation of STRUCTURAL ADJUDICATION from MARKET OUTCOME
 * - Independent ground truth reconstruction from canonical chain replay
 * - Shadow observation of vetoed tokens without policy feedback loop
 * - Metric calculations: Structural Veto Precision, Adjudication Coverage, Opportunity Cost
 */
export class TruthLabAdjudicator {
    adjudications = new Map();
    shadowObservations = new Map();
    key(subject) {
        return `${subject.clusterGenesisHash}:${subject.mint}`;
    }
    recordAdjudication(adjudication) {
        this.adjudications.set(this.key(adjudication.subject), adjudication);
    }
    recordShadowObservation(observation) {
        this.shadowObservations.set(this.key(observation.subject), observation);
    }
    /**
     * Evaluates the accuracy of the structural VETO system against chain ground truth.
     * Note: Market price return does NOT change whether a structural violation existed!
     */
    evaluateScorecard(vetoedMints) {
        let truePositives = 0;
        let falsePositives = 0;
        let opportunityCostSol = 0n;
        for (const subject of vetoedMints) {
            const adj = this.adjudications.get(this.key(subject));
            if (adj) {
                if (adj.canonicalViolationExisted) {
                    truePositives++;
                }
                else {
                    falsePositives++;
                }
            }
            const shadow = this.shadowObservations.get(this.key(subject));
            if (shadow && shadow.observedPeakPriceReturnPct > 0) {
                // Calculate tracked opportunity cost for analytical audit
                opportunityCostSol += shadow.volumeSol / 10n;
            }
        }
        const totalEvaluated = truePositives + falsePositives;
        const precision = totalEvaluated > 0 ? truePositives / totalEvaluated : 1.0;
        const coverage = vetoedMints.length > 0 ? totalEvaluated / vetoedMints.length : 1.0;
        return {
            structuralVetoPrecision: Number(precision.toFixed(4)),
            adjudicationCoverage: Number(coverage.toFixed(4)),
            falseVetoConfirmedCount: falsePositives,
            opportunityCostTrackedSol: opportunityCostSol,
            adjudicatedSamplesCount: totalEvaluated,
        };
    }
}
//# sourceMappingURL=truthlab.js.map
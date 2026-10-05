/**
 * SYLPH FUSION — COMPETING-RISK OUTCOME MODEL
 * Specifications: Blueprint Section 34
 * Workbook: #551, #552
 *
 * Status: RESEARCH_PRIOR (Research-only until validated; no production capital authority)
 *
 * Invariant:
 * 1. Models mutually exclusive competing hazards (2x, 5x, liquidity collapse, creator dump, route fracture, rug, strategy exit, time expiration).
 * 2. Competing risk probabilities must sum to <= 1.0; independent binary classification that double-counts probability is strictly forbidden.
 */
export class CompetingRiskOutcomeModel {
    incidents = [];
    recordIncident(incident) {
        this.incidents.push(incident);
    }
    /**
     * Evaluates competing risk cumulative incidence across all hazards.
     * Throws CALIBRATION_UNAVAILABLE if fewer than minSamples observations exist.
     */
    evaluate(cohortId, minSamples = 10) {
        if (this.incidents.length < minSamples) {
            throw new Error(`CALIBRATION_UNAVAILABLE: Insufficient competing hazard incidents (${this.incidents.length} < ${minSamples}); synthetic priors forbidden`);
        }
        const counts = {
            TARGET_2X_HIT: 0,
            TARGET_5X_HIT: 0,
            LIQUIDITY_COLLAPSE: 0,
            CREATOR_DUMP: 0,
            ROUTE_FRACTURE: 0,
            RUG_CONDITION: 0,
            STRATEGY_EXIT: 0,
            TIME_EXPIRATION: 0,
        };
        const survivalTimes = [];
        for (const inc of this.incidents) {
            counts[inc.terminalHazard]++;
            survivalTimes.push(inc.elapsedMs);
        }
        survivalTimes.sort((a, b) => a - b);
        const medianSurvivalTimeMs = survivalTimes[Math.floor(survivalTimes.length / 2)];
        const total = this.incidents.length;
        const cumulativeIncidence = {};
        let dominantHazard = 'TIME_EXPIRATION';
        let maxIncidence = -1;
        for (const [hazard, count] of Object.entries(counts)) {
            const cif = Number((count / total).toFixed(4));
            cumulativeIncidence[hazard] = cif;
            if (cif > maxIncidence) {
                maxIncidence = cif;
                dominantHazard = hazard;
            }
        }
        return {
            candidateCohort: cohortId,
            sampleCount: total,
            cumulativeIncidence,
            dominantHazard,
            medianSurvivalTimeMs,
            status: 'RESEARCH_PRIOR',
            evidenceRoot: `ev_competing_risk_${cohortId}_${total}_${Date.now()}`,
        };
    }
}
//# sourceMappingURL=competing-risk-model.js.map
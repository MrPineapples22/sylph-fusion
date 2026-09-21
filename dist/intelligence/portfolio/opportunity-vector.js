/**
 * SOL-SYLPH Opportunity Vector, Sequential Decision & Attention Engine
 * Blueprint Parts XXXV, XXXVI, XXXVII, XXXVIII, XXXIX, XL
 *
 * Encapsulates:
 * 1. 17-Dimensional OpportunityVector
 * 2. Sequential Decisions (REJECT, WAIT, GATHER, SHADOW, ABSTAIN, ENTER_SMALL, etc.)
 * 3. Value of Information (VOI) vs Delay Cost
 * 4. Opportunity Competition across simultaneous candidates
 * 5. Attention Scheduler allocating compute -> simulation -> risk budget
 */
export class OpportunityVectorEngine {
    computeVector(params) {
        const structSafe = Math.max(0, Math.min(100, params.structuralScore));
        const auth = Math.max(0, Math.min(100, params.authenticityScore * 100));
        const flow = Math.max(0, Math.min(100, params.netIndependentFlowSol * 10 + 50));
        const phase = Math.max(0, Math.min(100, params.phaseQualityScore));
        const execQual = Math.max(0, Math.min(100, 100 - (params.executionImpactBps / 10)));
        const simRobust = Math.max(0, Math.min(100, params.dtf * 100 * (1.0 - params.cascadeSusceptibility)));
        // Composite net edge in bps
        const baseEdge = (auth * 0.3 + structSafe * 0.2 + phase * 0.3 + execQual * 0.2);
        const netEdgeBps = Math.round((baseEdge - 50) * 4);
        return {
            mint: params.mint,
            structuralSafety: structSafe,
            marketAuthenticity: auth,
            independentCapitalFlow: flow,
            phaseQuality: phase,
            phaseTransition: 75,
            executionQuality: execQual,
            robustExitCapacitySol: params.robustExitCapacitySol,
            distanceToFailure: params.dtf,
            cascadeSusceptibility: params.cascadeSusceptibility,
            evidenceCoverage: params.coverageRatio,
            freshnessMs: params.freshnessMs,
            confidence: params.confidence,
            oodRisk: params.oodScore,
            opportunityHalfLifeSec: params.halfLifeSec,
            capitalMigrationScore: params.migrationScore,
            actorQuality: Math.round(params.actorIndependenceScore * 100),
            simulationRobustness: simRobust,
            compositeEdgeBps: netEdgeBps,
        };
    }
    evaluateSequentialAction(vec, proof3of3) {
        // Value of Information vs Delay Cost (Part XXXV)
        const expectedUncertaintyReduction = (1.0 - vec.evidenceCoverage) * 0.5;
        const valueOfInformation = expectedUncertaintyReduction * 100;
        const decayRatePerSec = vec.opportunityHalfLifeSec > 0 ? (100 / vec.opportunityHalfLifeSec) : 10;
        const delayCost = decayRatePerSec * 1.0; // 1 second delay cost
        const netDTV = valueOfInformation - delayCost;
        let action = 'ABSTAIN';
        let rationale = '';
        if (vec.structuralSafety < 50 || vec.distanceToFailure < 0.2) {
            action = 'REJECT';
            rationale = 'Failed structural safety or insufficient distance to failure.';
        }
        else if (!proof3of3) {
            if (netDTV > 15 && vec.evidenceCoverage < 0.7) {
                action = 'WAIT_1S';
                rationale = 'VOI exceeds delay cost; gathering additional evidence.';
            }
            else {
                action = 'SHADOW_ONLY';
                rationale = 'Proof certificates incomplete; candidate routed to shadow execution.';
            }
        }
        else if (vec.oodRisk > 0.4 || vec.confidence < 0.6) {
            action = 'ABSTAIN';
            rationale = 'High out-of-distribution uncertainty or low model confidence.';
        }
        else if (vec.compositeEdgeBps > 150 && vec.robustExitCapacitySol > 3.0) {
            action = 'ENTER_SMALL';
            rationale = 'Verified 3/3 proof, robust exit capacity, and positive edge.';
        }
        else {
            action = 'SHADOW_ONLY';
            rationale = 'Positive characteristics but marginal edge; observing in shadow mode.';
        }
        return {
            mint: vec.mint,
            action,
            valueOfInformation: Number(valueOfInformation.toFixed(2)),
            delayCost: Number(delayCost.toFixed(2)),
            netDecisionTimeValue: Number(netDTV.toFixed(2)),
            rationale,
        };
    }
    allocateAttention(candidates) {
        const allocations = new Map();
        for (const c of candidates) {
            // High-value uncertain candidates get deeper simulation budget
            const urgency = 100 / Math.max(5, c.opportunityHalfLifeSec);
            const isPromising = c.compositeEdgeBps > 50 && c.structuralSafety > 70;
            if (isPromising) {
                allocations.set(c.mint, {
                    computeBudgetMs: 50,
                    simulationIterations: 100,
                    permittedRiskSol: Math.min(1.0, c.robustExitCapacitySol * 0.2),
                });
            }
            else {
                allocations.set(c.mint, {
                    computeBudgetMs: 5,
                    simulationIterations: 10,
                    permittedRiskSol: 0,
                });
            }
        }
        return allocations;
    }
}
//# sourceMappingURL=opportunity-vector.js.map
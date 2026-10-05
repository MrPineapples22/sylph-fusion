/**
 * SYLPH FUSION — PLANNER VALUE OF INFORMATION (VOI), CONGESTION ALPHA & PREDICTIVE PREWARMING
 * Specification: Solana-Only Integration Blueprint (Sections 4, 8, 30, 32, 33)
 *
 * Epistemic Invariants:
 * 1. Section 8: Value of Information (VOI):
 *    VOI = P(info changes decision) * expected_economic_impact.
 *    Compare against: expected edge lost by waiting (edge decay).
 *    Decision: ACT | WAIT | REJECT. Never stall indefinitely to gather low-value features.
 * 2. Section 30 & 33: Congestion Alpha & Crowding Cost:
 *    Priority fee spikes and Jito tip wars signal bot competition; deduct CrowdingCost from EV.
 * 3. Section 4: Predictive Prewarming:
 *    Pre-warms ATAs, ALTs, pool accounts, and creator history backward in time before qualification.
 */
export class SolanaPlannerVoi {
    prewarmedTargets = new Map();
    /**
     * Section 8: Planner Value of Information (VOI) Engine
     */
    static evaluateInformationTradeoff(params) {
        // 1. Compute VOI = P(flips) * economic impact
        const voiLamports = BigInt(Math.floor(params.probDecisionFlips * Number(params.expectedFlipEconomicImpactLamports)));
        // 2. Compute edge decay during the waiting period
        // Fraction of half-life elapsed:
        const elapsedRatio = Math.min(1.0, params.estimatedQueryLatencyMs / params.edgeHalfLifeMs);
        const decayLamports = BigInt(Math.floor(Number(params.currentEstimatedEdgeLamports) * (elapsedRatio * 0.5)));
        const netValueLamports = voiLamports - decayLamports;
        let action;
        let reasoning;
        if (params.currentEstimatedEdgeLamports <= 0n) {
            action = 'REJECT';
            reasoning = 'Negative estimated edge under current observation; reject opportunity immediately';
        }
        else if (netValueLamports > 100000n) { // > 0.0001 SOL net value gained by waiting
            action = 'WAIT';
            reasoning = `WAIT: VOI (${voiLamports} lamports) exceeds latency decay (${decayLamports} lamports). Querying ${params.featureName}.`;
        }
        else {
            action = 'ACT';
            reasoning = `ACT: Edge decay (${decayLamports} lamports) exceeds VOI (${voiLamports} lamports). Proceeding immediately with current evidence.`;
        }
        return Object.freeze({
            action,
            featureRequested: params.featureName,
            probDecisionChange: params.probDecisionFlips,
            expectedImpactLamports: voiLamports,
            expectedEdgeDecayLamports: decayLamports,
            netInformationValueLamports: netValueLamports,
            reasoning,
        });
    }
    /**
     * Section 33: Crowding Cost Deduction
     * Subtracts crowding penalties from gross opportunity expected value.
     */
    static computeCrowdingPenalty(grossEdgeLamports, congestion) {
        let penaltyPct = 0;
        if (congestion.writableAccountContentionIndex > 0.5) {
            penaltyPct += (congestion.writableAccountContentionIndex - 0.5) * 40; // up to 20%
        }
        if (congestion.clusterCuPressurePct > 80) {
            penaltyPct += (congestion.clusterCuPressurePct - 80) * 1.5; // up to 30%
        }
        if (congestion.failureBurstDetected) {
            penaltyPct += 25; // 25% penalty for high recent reverts
        }
        const penaltyLamports = BigInt(Math.floor(Number(grossEdgeLamports) * (Math.min(80, penaltyPct) / 100)));
        const netEdge = grossEdgeLamports - penaltyLamports;
        return Object.freeze({
            crowdingPenaltyLamports: penaltyLamports,
            netEdgeAfterCrowdingLamports: netEdge > 0n ? netEdge : 0n,
        });
    }
    /**
     * Section 4: Predictive Prewarming Cache
     */
    prewarmOpportunity(target) {
        const full = Object.freeze({
            ...target,
            prewarmedAtMs: Date.now(),
            isReadyForInstantBuild: true,
        });
        this.prewarmedTargets.set(target.targetMint, full);
    }
    getPrewarmedState(mint) {
        return this.prewarmedTargets.get(mint) || null;
    }
    getAllPrewarmed() {
        return Object.freeze([...this.prewarmedTargets.values()]);
    }
}
//# sourceMappingURL=planner-voi.js.map
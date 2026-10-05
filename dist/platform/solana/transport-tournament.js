/**
 * SYLPH FUSION — SOLANA TRANSPORT TOURNAMENT & SAME ECONOMIC GENERATION
 * Specification: Solana-Only Integration Blueprint (Sections 25–29)
 *
 * Epistemic Invariants:
 * 1. Multi-lane transport race: Jito, Direct TPU, SWQoS, High-Performance RPC.
 * 2. Section 26: SAME ECONOMIC GENERATION INVARIANT:
 *    Transport racing must NEVER create duplicate economic intent.
 *    Strictly: 1 exact transaction, 1 cryptographic signature, 1 economicFactId,
 *    1 executionGenerationId -> broadcast across multiple delivery lanes.
 * 3. Section 27: Landing-Cost Optimizer:
 *    Maximize expected net realized edge: E[NetEdge] = P(land | fee, lane, congestion) * edge - fee - tip.
 * 4. Section 29: Transport Shadow Universe & RouteRegret calculation.
 */
export class SolanaTransportTournament {
    laneTelemetry = new Map();
    activeGenerations = new Set();
    regretHistory = [];
    constructor() {
        const lanes = ['JITO_BUNDLE', 'DIRECT_TPU', 'SWQOS_LANE', 'VALIDATOR_RPC'];
        for (const lane of lanes) {
            this.laneTelemetry.set(lane, {
                attempts: 10,
                landings: 8,
                totalLatencyMs: lane === 'JITO_BUNDLE' ? 1200 : lane === 'DIRECT_TPU' ? 450 : 600,
                totalTipLamports: lane === 'JITO_BUNDLE' ? 1000000n : 0n,
                totalFeeLamports: 50000n,
                failures: 1,
                totalSlippageBps: 20,
                totalRealizedEdgeBps: 85,
            });
        }
    }
    /**
     * Section 26: Asserts that transport multiplexing maintains the exact same economic generation.
     * If a second signature or different payload is submitted under the same generation, it is rejected.
     */
    registerEconomicGeneration(packet) {
        const generationKey = `${packet.economicFactId}:${packet.executionGenerationId}`;
        if (this.activeGenerations.has(generationKey)) {
            return {
                permitted: false,
                violation: `DUPLICATE_ECONOMIC_GENERATION_ERROR: Generation ${generationKey} already dispatched. Independent duplicate orders forbidden.`,
            };
        }
        if (packet.authorizedLanes.length === 0) {
            return {
                permitted: false,
                violation: 'EMPTY_TRANSPORT_LANES_ERROR: At least one transport lane must be authorized',
            };
        }
        this.activeGenerations.add(generationKey);
        return { permitted: true };
    }
    /**
     * Section 27: Landing-Cost Optimizer
     * Computes P(land | fee, lane, congestion) * remainingEdge - fee - tip.
     */
    optimizeLane(params) {
        const lanes = ['JITO_BUNDLE', 'DIRECT_TPU', 'SWQOS_LANE', 'VALIDATOR_RPC'];
        let bestDecision = null;
        let bestNetEdge = -999999999999n;
        for (const lane of lanes) {
            const stats = this.laneTelemetry.get(lane);
            const landingProb = stats.attempts > 0 ? (stats.landings / stats.attempts) : 0.5;
            const tip = lane === 'JITO_BUNDLE' ? BigInt(Math.floor(100_000 * params.congestionMultiplier)) : 0n;
            const priorityFee = BigInt(Math.floor(25_000 * params.congestionMultiplier));
            const expectedGross = BigInt(Math.floor(Number(params.estimatedGrossEdgeLamports) * landingProb));
            const expectedNet = expectedGross - tip - priorityFee;
            if (!bestDecision || expectedNet > bestNetEdge) {
                bestNetEdge = expectedNet;
                bestDecision = {
                    selectedLane: lane,
                    expectedLandingProbPct: landingProb * 100,
                    recommendedTipLamports: tip,
                    recommendedPriorityFeeLamports: priorityFee,
                    expectedNetEdgeLamports: expectedNet,
                    fallbackLanes: lanes.filter(l => l !== lane),
                };
            }
        }
        return Object.freeze(bestDecision);
    }
    /**
     * Section 29: Records route outcome and computes counterfactual RouteRegret.
     */
    recordExecutionOutcome(params) {
        const routeRegretBps = params.counterfactualEstimatedBps - params.actualRealizedBps;
        const record = Object.freeze({
            economicFactId: params.economicFactId,
            actualLane: params.actualLane,
            actualOutcomeBps: params.actualRealizedBps,
            counterfactualLane: params.counterfactualLane,
            counterfactualEstimatedOutcomeBps: params.counterfactualEstimatedBps,
            routeRegretBps,
        });
        this.regretHistory.push(record);
        if (this.regretHistory.length > 500) {
            this.regretHistory.shift();
        }
        return record;
    }
    /**
     * Export all aggregated lane telemetry.
     */
    getTelemetry() {
        const res = [];
        for (const [lane, st] of this.laneTelemetry) {
            const landingRatePct = st.attempts > 0 ? (st.landings / st.attempts) * 100 : 0;
            const meanLatencyMs = st.attempts > 0 ? st.totalLatencyMs / st.attempts : 0;
            const meanTipLamports = st.attempts > 0 ? st.totalTipLamports / BigInt(st.attempts) : 0n;
            const meanPriorityFeeLamports = st.attempts > 0 ? st.totalFeeLamports / BigInt(st.attempts) : 0n;
            const instructionFailureRatePct = st.attempts > 0 ? (st.failures / st.attempts) * 100 : 0;
            const postLandingSlippageBps = st.attempts > 0 ? st.totalSlippageBps / st.attempts : 0;
            const netRealizedEdgeBps = st.attempts > 0 ? st.totalRealizedEdgeBps / st.attempts : 0;
            res.push(Object.freeze({
                lane,
                attemptsCount: st.attempts,
                landingsCount: st.landings,
                landingRatePct,
                meanLatencyMs,
                meanTipLamports,
                meanPriorityFeeLamports,
                instructionFailureRatePct,
                postLandingSlippageBps,
                netRealizedEdgeBps,
            }));
        }
        return Object.freeze(res);
    }
}
//# sourceMappingURL=transport-tournament.js.map
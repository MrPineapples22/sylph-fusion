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
    static MINIMUM_MATCHED_BENCHMARK_EVENTS = 30;
    laneTelemetry = new Map();
    activeGenerations = new Set();
    regretHistory = [];
    attemptIds = new Set();
    matchedEventKeys = new Set();
    constructor() {
        for (const lane of SolanaTransportTournament.CANDIDATE_LANES)
            this.laneTelemetry.set(lane, { attempts: [] });
    }
    static CANDIDATE_LANES = [
        'JITO_BUNDLE', 'DIRECT_TPU', 'SWQOS_LANE', 'VALIDATOR_RPC',
    ];
    /** Records one resolved, externally measured attempt. This research scorecard
     * never sends transactions and refuses to infer outcomes from provider ACKs. */
    recordResolvedAttempt(attempt) {
        if (!attempt || typeof attempt.attemptId !== 'string' || !attempt.attemptId.trim() ||
            typeof attempt.benchmarkEventId !== 'string' || !attempt.benchmarkEventId.trim() ||
            typeof attempt.targetProgram !== 'string' || !attempt.targetProgram.trim() ||
            typeof attempt.benchmarkRegion !== 'string' || !attempt.benchmarkRegion.trim() ||
            !SolanaTransportTournament.CANDIDATE_LANES.includes(attempt.lane) ||
            !['LOW', 'MEDIUM', 'HIGH'].includes(attempt.congestionBucket) ||
            typeof attempt.inputNotionalLamports !== 'bigint' || attempt.inputNotionalLamports <= 0n ||
            !['SUCCESS', 'INSTRUCTION_FAILURE', 'NO_LAND'].includes(attempt.outcome) ||
            [attempt.baseFeeLamports, attempt.priorityFeeLamports, attempt.tipLamports].some((v) => typeof v !== 'bigint' || v < 0n) ||
            typeof attempt.realizedGrossEdgeLamports !== 'bigint' ||
            (attempt.postLandingSlippageBps !== undefined && !Number.isFinite(attempt.postLandingSlippageBps))) {
            throw new Error('INVALID_RESOLVED_TRANSPORT_ATTEMPT');
        }
        const landed = attempt.outcome !== 'NO_LAND';
        if ((landed && (!Number.isFinite(attempt.landingLatencyMs) || attempt.landingLatencyMs < 0)) ||
            (!landed && attempt.landingLatencyMs !== undefined) ||
            (attempt.outcome !== 'SUCCESS' && attempt.realizedGrossEdgeLamports !== 0n) ||
            (attempt.outcome === 'SUCCESS' && attempt.postLandingSlippageBps === undefined)) {
            throw new Error('INCONSISTENT_TRANSPORT_OUTCOME');
        }
        const laneEventKey = [attempt.targetProgram, attempt.benchmarkRegion, attempt.congestionBucket, attempt.benchmarkEventId, attempt.lane].join(':');
        if (this.attemptIds.has(attempt.attemptId) || this.matchedEventKeys.has(laneEventKey))
            throw new Error('DUPLICATE_TRANSPORT_ATTEMPT');
        this.attemptIds.add(attempt.attemptId);
        this.matchedEventKeys.add(laneEventKey);
        this.laneTelemetry.get(attempt.lane).attempts.push(Object.freeze({ ...attempt }));
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
        const lanes = SolanaTransportTournament.CANDIDATE_LANES;
        if (typeof params.estimatedGrossEdgeLamports !== 'bigint' || params.estimatedGrossEdgeLamports <= 0n ||
            !params.targetProgram || !params.benchmarkRegion || !['LOW', 'MEDIUM', 'HIGH'].includes(params.congestionBucket)) {
            throw new Error('INVALID_LANE_OPTIMIZATION_INPUT');
        }
        const byLane = new Map();
        for (const lane of lanes) {
            const matching = new Map();
            for (const attempt of this.laneTelemetry.get(lane).attempts) {
                if (attempt.targetProgram === params.targetProgram && attempt.benchmarkRegion === params.benchmarkRegion &&
                    attempt.congestionBucket === params.congestionBucket)
                    matching.set(attempt.benchmarkEventId, attempt);
            }
            byLane.set(lane, matching);
        }
        const commonEvents = [...(byLane.get(lanes[0])?.keys() ?? [])]
            .filter((eventId) => lanes.every((lane) => byLane.get(lane)?.has(eventId)));
        if (commonEvents.length < SolanaTransportTournament.MINIMUM_MATCHED_BENCHMARK_EVENTS) {
            return Object.freeze({
                status: 'ABSTAIN', abstainReason: 'INSUFFICIENT_MATCHED_BENCHMARKS', selectedLane: null,
                matchedSampleCount: commonEvents.length, expectedLandingProbPct: null, expectedExecutionSuccessPct: null,
                observedAverageTipLamports: null, observedAveragePriorityFeeLamports: null,
                expectedNetEdgeLamports: null, promotionAuthority: 'NONE', fallbackLanes: [],
            });
        }
        const scored = lanes.map((lane) => {
            const attempts = commonEvents.map((eventId) => byLane.get(lane).get(eventId));
            const landings = attempts.filter((a) => a.outcome !== 'NO_LAND').length;
            const successes = attempts.filter((a) => a.outcome === 'SUCCESS').length;
            const totalTip = attempts.reduce((sum, a) => sum + a.tipLamports, 0n);
            const totalPriority = attempts.reduce((sum, a) => sum + a.priorityFeeLamports, 0n);
            const totalCosts = attempts.reduce((sum, a) => sum + a.baseFeeLamports + a.priorityFeeLamports + a.tipLamports, 0n);
            const n = BigInt(attempts.length);
            const averageCostsCeil = (totalCosts + n - 1n) / n;
            const expectedGross = (params.estimatedGrossEdgeLamports * BigInt(successes)) / n;
            return {
                lane,
                landingRate: landings / attempts.length,
                successRate: successes / attempts.length,
                averageTip: (totalTip + n - 1n) / n,
                averagePriority: (totalPriority + n - 1n) / n,
                expectedNet: expectedGross - averageCostsCeil,
            };
        }).sort((a, b) => a.expectedNet === b.expectedNet ? 0 : a.expectedNet > b.expectedNet ? -1 : 1);
        const best = scored[0];
        if (best.expectedNet <= 0n) {
            return Object.freeze({
                status: 'ABSTAIN', abstainReason: 'NO_POSITIVE_EXPECTED_NET_EDGE', selectedLane: null,
                matchedSampleCount: commonEvents.length, expectedLandingProbPct: best.landingRate * 100,
                expectedExecutionSuccessPct: best.successRate * 100, observedAverageTipLamports: best.averageTip,
                observedAveragePriorityFeeLamports: best.averagePriority, expectedNetEdgeLamports: best.expectedNet,
                promotionAuthority: 'NONE', fallbackLanes: [],
            });
        }
        return Object.freeze({
            status: 'RESEARCH_CANDIDATE', selectedLane: best.lane, matchedSampleCount: commonEvents.length,
            expectedLandingProbPct: best.landingRate * 100, expectedExecutionSuccessPct: best.successRate * 100,
            observedAverageTipLamports: best.averageTip, observedAveragePriorityFeeLamports: best.averagePriority,
            expectedNetEdgeLamports: best.expectedNet, promotionAuthority: 'NONE',
            fallbackLanes: scored.slice(1).filter((score) => score.expectedNet > 0n).map((score) => score.lane),
        });
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
            const n = st.attempts.length;
            const landed = st.attempts.filter((a) => a.outcome !== 'NO_LAND');
            const successes = st.attempts.filter((a) => a.outcome === 'SUCCESS');
            const failures = st.attempts.filter((a) => a.outcome === 'INSTRUCTION_FAILURE');
            const totalTip = st.attempts.reduce((sum, a) => sum + a.tipLamports, 0n);
            const totalPriority = st.attempts.reduce((sum, a) => sum + a.priorityFeeLamports, 0n);
            const totalNet = st.attempts.reduce((sum, a) => sum + a.realizedGrossEdgeLamports - a.baseFeeLamports - a.priorityFeeLamports - a.tipLamports, 0n);
            const totalNotional = st.attempts.reduce((sum, a) => sum + a.inputNotionalLamports, 0n);
            const latencySamples = landed.filter((a) => a.landingLatencyMs !== undefined);
            const slippageSamples = successes.filter((a) => a.postLandingSlippageBps !== undefined);
            res.push(Object.freeze({
                lane,
                attemptsCount: n,
                landingsCount: landed.length,
                successfulExecutionsCount: successes.length,
                landingRatePct: n ? (landed.length / n) * 100 : null,
                meanLatencyMs: latencySamples.length ? latencySamples.reduce((sum, a) => sum + (a.landingLatencyMs ?? 0), 0) / latencySamples.length : null,
                meanTipLamports: n ? totalTip / BigInt(n) : null,
                meanPriorityFeeLamports: n ? totalPriority / BigInt(n) : null,
                instructionFailureRatePct: n ? (failures.length / n) * 100 : null,
                postLandingSlippageBps: slippageSamples.length ? slippageSamples.reduce((sum, a) => sum + (a.postLandingSlippageBps ?? 0), 0) / slippageSamples.length : null,
                netRealizedEdgeBps: totalNotional > 0n ? Number(totalNet) / Number(totalNotional) * 10_000 : null,
            }));
        }
        return Object.freeze(res);
    }
}
//# sourceMappingURL=transport-tournament.js.map
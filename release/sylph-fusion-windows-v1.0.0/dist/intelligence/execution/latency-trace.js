/**
 * SOL-SYLPH Intelligence Fabric - Latency-Aware Decision & Execution Intelligence
 * Specifications: Major Update #13 (Sections 31-38: Latency Trace, Signal Decay, Race Guard).
 *
 * Rules:
 * 1. Track signal age through every transition: Decision, Quote, Submission, Landing.
 * 2. Model learned decay rates for distinct signal families.
 * 3. Enforce monotonic generation numbers to prevent out-of-order race execution.
 */
export const SIGNAL_HALF_LIFE_MS_MAP = {
    QUOTE: 1_200, // 1.2s half life
    FLOW: 2_500, // 2.5s half life
    LIQUIDITY_SHOCK: 5_000, // 5.0s half life
    PUMPSCORE: 15_000, // 15s half life
    HSI: 30_000, // 30s half life
    WALLET_REPUTATION: 300_000, // 5m half life
};
export class LatencyTraceEngine {
    /**
     * Build complete latency breakdown for an order execution path.
     */
    calculateLatencyBreakdown(params) {
        const signalAgeAtDecisionMs = Math.max(0, params.decisionFinishedMs - params.chainObservedMs);
        const signalAgeAtQuoteMs = Math.max(0, params.quoteReceivedMs - params.chainObservedMs);
        const signalAgeAtSubmissionMs = Math.max(0, params.txSubmittedMs - params.chainObservedMs);
        const totalPipelineLatencyMs = Math.max(0, params.txSubmittedMs - params.localReceivedMs);
        return {
            ...params,
            signalAgeAtDecisionMs,
            signalAgeAtQuoteMs,
            signalAgeAtSubmissionMs,
            totalPipelineLatencyMs,
        };
    }
    /**
     * Compute decayed signal weight: $W(t) = W_0 \times 0.5^{(age / halfLife)}$
     */
    calculateSignalDecay(family, ageMs, initialWeight = 1.0) {
        const halfLife = SIGNAL_HALF_LIFE_MS_MAP[family];
        if (ageMs <= 0 || halfLife <= 0)
            return initialWeight;
        const decayFactor = Math.pow(0.5, ageMs / halfLife);
        return Number((initialWeight * decayFactor).toFixed(4));
    }
}
export class ExecutionRaceGuard {
    latestGenerationsByMint = new Map();
    /**
     * Allocate a new monotonic generation ID for a token order intent.
     */
    allocateGeneration(mint) {
        const current = this.latestGenerationsByMint.get(mint) ?? 0;
        const next = current + 1;
        this.latestGenerationsByMint.set(mint, next);
        return next;
    }
    /**
     * Invalidate all in-flight orders for a mint by incrementing generation.
     */
    cancelInFlightOrders(mint) {
        return this.allocateGeneration(mint);
    }
    /**
     * Verify that an order intent matches the latest monotonic generation.
     */
    isGenerationValid(mint, orderGeneration) {
        const current = this.latestGenerationsByMint.get(mint) ?? 0;
        return orderGeneration === current;
    }
}
//# sourceMappingURL=latency-trace.js.map
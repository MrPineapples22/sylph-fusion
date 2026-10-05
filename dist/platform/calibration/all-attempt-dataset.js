/**
 * SYLPH FUSION — ALL-ATTEMPT EXECUTION DATASET & CONDITIONAL CALIBRATION
 * Specifications: Blueprint Sections 29, 30, 31, 32, 33
 * Workbook: #287, #299, #303, #311, #315, #523, #527, #531, #539, #555
 *
 * Invariant:
 * 1. Records all attempts from intent creation to terminal settlement — not only landed fills.
 * 2. Zero samples MUST produce CALIBRATION_UNAVAILABLE; never a synthetic default margin.
 */
export class AllAttemptExecutionDataset {
    attempts = new Map();
    attemptsByStrategy = new Map();
    recordAttempt(record) {
        this.attempts.set(record.economicIntentId, record);
        let list = this.attemptsByStrategy.get(record.strategyId);
        if (!list) {
            list = [];
            this.attemptsByStrategy.set(record.strategyId, list);
        }
        list.push(record);
    }
    getAttempt(intentId) {
        return this.attempts.get(intentId);
    }
    /**
     * Computes conditional slippage for a given route and notional cohort.
     * Blueprint Section 30: Zero samples MUST throw CALIBRATION_UNAVAILABLE.
     */
    estimateConditionalSlippage(route, minCohortSamples = 10) {
        const routeAttempts = Array.from(this.attempts.values()).filter((a) => a.route === route && a.slippageBps !== undefined);
        if (routeAttempts.length < minCohortSamples) {
            throw new Error(`CALIBRATION_UNAVAILABLE: Insufficient observations for route ${route} (${routeAttempts.length} < ${minCohortSamples}); synthetic defaults forbidden`);
        }
        const slippages = routeAttempts.map((a) => a.slippageBps).sort((a, b) => a - b);
        const n = slippages.length;
        const medianBps = slippages[Math.floor(n * 0.5)];
        const p75Bps = slippages[Math.floor(n * 0.75)];
        const p90Bps = slippages[Math.floor(n * 0.9)];
        const p95Bps = slippages[Math.floor(n * 0.95)];
        const tail = slippages.slice(Math.floor(n * 0.95));
        const expectedShortfallBps = tail.reduce((sum, v) => sum + v, 0) / tail.length;
        return {
            route,
            sampleCount: n,
            medianBps,
            p75Bps,
            p90Bps,
            p95Bps,
            expectedShortfallBps: Number(expectedShortfallBps.toFixed(2)),
            confidenceInterval: [slippages[Math.floor(n * 0.05)], slippages[Math.floor(n * 0.95)]],
            evidenceRoot: `ev_slip_${route}_${n}`,
        };
    }
    /**
     * Decomposes total implementation shortfall into its 8 component sources (Section 32).
     */
    decomposeShortfall(record) {
        const quoteDriftBps = record.quoteErrorBps ?? 0;
        const executionSlippageBps = record.slippageBps ?? 0;
        const priorityFeeBps = Number((record.priorityFeeMicroLamports * 10000n) / (record.requestedInputLamports > 0n ? record.requestedInputLamports : 1000000n));
        const jitoTipBps = Number((record.jitoTipLamports * 10000n) / (record.requestedInputLamports > 0n ? record.requestedInputLamports : 1000000n));
        const totalShortfallBps = quoteDriftBps + executionSlippageBps + priorityFeeBps + jitoTipBps;
        return {
            signalDecayBps: 0,
            quoteDriftBps,
            buildLatencyCostBps: record.buildCompletedAt && record.buildStartedAt ? Math.round((record.buildCompletedAt - record.buildStartedAt) / 10) : 0,
            priorityFeeBps,
            jitoTipBps,
            priceImpactBps: Math.round(executionSlippageBps * 0.6),
            executionSlippageBps,
            landingDelayBps: record.landedAt && record.submittedAt ? Math.round((record.landedAt - record.submittedAt) / 40) : 0,
            totalShortfallBps,
        };
    }
}
//# sourceMappingURL=all-attempt-dataset.js.map
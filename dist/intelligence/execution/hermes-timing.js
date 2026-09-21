/**
 * HERMES: Timing & Execution Synchronization Engine
 * Blueprint Engine #30
 *
 * Measures total pipeline execution latency:
 * event -> ingestion -> parsing -> state -> features -> reasoning -> risk -> quote -> signing -> submission -> landing.
 * Maintains P50, P95, P99, and MAX latency distributions.
 * Decides: SUBMIT | WAIT | REQUOTE | ABANDON.
 * Invariant: Never chase when market velocity exceeds execution capability.
 */
export class HermesExecutionSynchronizationEngine {
    static VERSION = '1.0.0';
    samples = [];
    recordLatencySample(sample) {
        this.samples.push(sample);
        if (this.samples.length > 500) {
            this.samples.shift();
        }
    }
    getMetrics() {
        if (this.samples.length === 0) {
            return { sample_count: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0 };
        }
        const sorted = this.samples.map(s => s.total_path_ms).sort((a, b) => a - b);
        const count = sorted.length;
        const p50 = sorted[Math.floor(count * 0.50)];
        const p95 = sorted[Math.floor(count * 0.95)];
        const p99 = sorted[Math.floor(count * 0.99)];
        const max = sorted[count - 1];
        return {
            sample_count: count,
            p50_ms: p50,
            p95_ms: p95,
            p99_ms: p99,
            max_ms: max
        };
    }
    /**
     * Evaluates timing synchronization for an imminent trade submission.
     */
    evaluateTiming(params) {
        // Expected adverse price movement before landing
        const totalDelaySec = (params.quote_age_ms + params.estimated_landing_latency_ms) / 1000;
        const adverseMoveBps = Math.round(totalDelaySec * params.market_velocity_pct_per_sec * 100);
        // If quote is older than 2500ms, force requote
        if (params.quote_age_ms > 2500) {
            return {
                decision: 'REQUOTE',
                expected_adverse_move_bps: adverseMoveBps,
                reason: `Quote age (${params.quote_age_ms}ms) exceeds freshness threshold. Requote needed.`
            };
        }
        // If expected adverse move exceeds allowable slippage boundary, abandon order (don't chase)
        if (adverseMoveBps > params.max_slippage_bps * 0.85) {
            return {
                decision: 'ABANDON',
                expected_adverse_move_bps: adverseMoveBps,
                reason: `Market velocity (${params.market_velocity_pct_per_sec}%/s) exceeds landing capability. Chasing would cause slippage revert.`
            };
        }
        return {
            decision: 'SUBMIT',
            expected_adverse_move_bps: adverseMoveBps,
            reason: `Execution synchronization nominal. Adverse drift (${adverseMoveBps} bps) within slippage envelope.`
        };
    }
}
//# sourceMappingURL=hermes-timing.js.map
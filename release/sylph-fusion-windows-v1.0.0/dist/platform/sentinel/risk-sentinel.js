/**
 * SOL-SYLPH Multi-User Platform - AI Risk Sentinel & Behavioral Fingerprinting
 * Specifications: Sections XXXVIII (AI Risk Sentinel), XXXIX (Behavioral Fingerprinting).
 *
 * Rules:
 * 1. Independent anomaly detector to detect abnormal SOL-SYLPH behavior.
 * 2. Monitors trade frequency bursts, slippage clusters, latency spikes, and failure streaks.
 * 3. Behavioral fingerprinting detects STRATEGY_BEHAVIOR_DRIFT.
 * 4. Deterministic mitigation recommendations.
 */
import { randomUUID } from 'node:crypto';
export class AIRiskSentinel {
    profiles = new Map();
    recentTrades = [];
    findings = [];
    registerStrategyProfile(profile) {
        this.profiles.set(profile.strategyId, profile);
    }
    recordTradeTelemetry(trade) {
        this.recentTrades.push(trade);
        // Keep sliding window of last 200 trades
        if (this.recentTrades.length > 200) {
            this.recentTrades.shift();
        }
    }
    /**
     * Run anomaly detection across recent trading telemetry.
     */
    analyzeAnomalies(now = Date.now()) {
        const windowStart = now - 60_000; // 1-minute window
        const windowTrades = this.recentTrades.filter((t) => t.timestamp >= windowStart);
        // 1. Trade Burst Detection: More than 10 trades per minute for a single strategy
        const tradesByStrategy = new Map();
        for (const t of windowTrades) {
            const list = tradesByStrategy.get(t.strategyId) ?? [];
            list.push(t);
            tradesByStrategy.set(t.strategyId, list);
        }
        for (const [stratId, trades] of tradesByStrategy.entries()) {
            const profile = this.profiles.get(stratId);
            const burstLimit = profile?.maxObservedTradeBurstPerMin ?? 8;
            if (trades.length > burstLimit) {
                this.addFinding({
                    findingId: randomUUID(),
                    timestamp: now,
                    type: 'BURST_TRADING',
                    severity: 'HIGH',
                    targetStrategyId: stratId,
                    description: `Strategy ${stratId} emitted ${trades.length} trades in 60s (threshold: ${burstLimit})`,
                    suggestedMitigation: 'HALT_ENTRIES',
                });
            }
            // 2. Behavioral Drift: Average slippage > 2x baseline
            if (profile && trades.length >= 3) {
                const avgSlippage = trades.reduce((acc, t) => acc + t.slippageBps, 0) / trades.length;
                if (avgSlippage > profile.baselineAvgSlippageBps * 2.5) {
                    this.addFinding({
                        findingId: randomUUID(),
                        timestamp: now,
                        type: 'BEHAVIORAL_DRIFT',
                        severity: 'MEDIUM',
                        targetStrategyId: stratId,
                        description: `STRATEGY_BEHAVIOR_DRIFT: Strategy ${stratId} average slippage (${avgSlippage.toFixed(0)} bps) > 2.5x baseline (${profile.baselineAvgSlippageBps} bps)`,
                        suggestedMitigation: 'REDUCE_SIZE',
                    });
                }
            }
            // 3. Consecutive Failure Streak
            const failures = trades.filter((t) => !t.isSuccess);
            if (failures.length >= 3 && failures.length === trades.length) {
                this.addFinding({
                    findingId: randomUUID(),
                    timestamp: now,
                    type: 'FAILURE_STREAK',
                    severity: 'HIGH',
                    targetStrategyId: stratId,
                    description: `Strategy ${stratId} suffered ${failures.length} consecutive execution failures`,
                    suggestedMitigation: 'ISOLATE_STRATEGY',
                });
            }
        }
        return this.findings;
    }
    addFinding(finding) {
        this.findings.push(finding);
        if (this.findings.length > 100) {
            this.findings.shift();
        }
    }
    getRecentFindings() {
        return this.findings;
    }
}
//# sourceMappingURL=risk-sentinel.js.map
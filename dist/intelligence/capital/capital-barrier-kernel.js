/**
 * SOL-SYLPH Intelligence Fabric - Capital Barrier Kernel
 * Specifications: Master Blueprint Section 29 & 30, Priority Item 9.
 *
 * Implements:
 * 1. Deterministic safety kernel between AI model propositions and capital execution.
 * 2. Hard multi-factor gating:
 *    - Bankroll ceiling
 *    - Drawdown throttling
 *    - Daily cumulative loss circuit-breaker
 *    - Creator cluster / operator family concentration limits
 *    - Route exposure saturation limits
 *    - Conservative stressed exit capacity ceiling (Section 28)
 *    - Model uncertainty & calibration penalty scaling
 *    - Execution reliability & Truth Debt throttling
 * 3. Enforces Section 2.2: Models advise; deterministic authority moves capital.
 */
import { createHash } from 'node:crypto';
export class CapitalBarrierKernel {
    // Conservative baseline parameter defaults
    static MAX_SINGLE_TRADE_BANKROLL_PCT = 0.05; // Max 5% of total capital in 1 trade
    static MAX_DRAWDOWN_ALLOWABLE_PCT = 15.0; // 15% drawdown triggers global trading freeze
    static TRUTH_DEBT_HALT_THRESHOLD = 3; // > 3 unresolved intents freezes capital
    /**
     * Evaluates proposed trade capital through deterministic, non-compensatory gates.
     */
    static evaluateCapitalBarrier(inputs) {
        const { proposedSizeSol, totalBankrollSol, currentDrawdownPct, dailyRealizedLossSol, maxDailyLossSol, creatorClusterExposureSol, maxCreatorExposureSol, routeExposureSol, maxRouteExposureSol, stressedExitCapacitySol, modelUncertainty, executionReliability, truthDebtCount, } = inputs;
        const denialReasons = [];
        const throttlingReductions = {};
        const evaluatedAtMs = Date.now();
        // 1. Invariant: Truth Debt circuit-breaker (Section 78)
        if (truthDebtCount >= this.TRUTH_DEBT_HALT_THRESHOLD) {
            denialReasons.push(`TRUTH_DEBT_BREACH: ${truthDebtCount} unresolved economic intents exceeds halt threshold ${this.TRUTH_DEBT_HALT_THRESHOLD}`);
        }
        // 2. Invariant: Global Drawdown limit
        if (currentDrawdownPct >= this.MAX_DRAWDOWN_ALLOWABLE_PCT) {
            denialReasons.push(`MAX_DRAWDOWN_BREACH: Current portfolio drawdown ${currentDrawdownPct}% exceeds ceiling ${this.MAX_DRAWDOWN_ALLOWABLE_PCT}%`);
        }
        // 3. Invariant: Daily Loss circuit breaker
        if (dailyRealizedLossSol >= maxDailyLossSol) {
            denialReasons.push(`DAILY_LOSS_BREACH: Realized daily loss ${dailyRealizedLossSol} SOL reached limit ${maxDailyLossSol} SOL`);
        }
        // 4. Invariant: Creator / Cluster Exposure limit
        if (creatorClusterExposureSol >= maxCreatorExposureSol) {
            denialReasons.push(`CLUSTER_EXPOSURE_BREACH: Creator cluster exposure ${creatorClusterExposureSol} SOL reached limit ${maxCreatorExposureSol} SOL`);
        }
        // 5. Invariant: Route Exposure saturation
        if (routeExposureSol >= maxRouteExposureSol) {
            denialReasons.push(`ROUTE_SATURATION_BREACH: Route exposure ${routeExposureSol} SOL reached limit ${maxRouteExposureSol} SOL`);
        }
        // 6. Hard Stressed Exit Capacity Gate (Section 28 & 2.5: Exit before entry)
        if (stressedExitCapacitySol <= 0) {
            denialReasons.push('ZERO_STRESSED_EXIT_CAPACITY: Liquidation under stress is impossible');
        }
        if (denialReasons.length > 0) {
            const hash = this.computeBarrierHash(inputs, 'DENIED', 0, evaluatedAtMs);
            return {
                status: 'DENIED',
                requestedSizeSol: proposedSizeSol,
                authorizedSizeSol: 0,
                denialReasons: Object.freeze(denialReasons),
                throttlingReductions: Object.freeze(throttlingReductions),
                capitalBarrierHash: hash,
                evaluatedAtMs,
            };
        }
        // Compute maximum allowable nominal size
        const maxBankrollAllocation = totalBankrollSol * this.MAX_SINGLE_TRADE_BANKROLL_PCT;
        const remainingDailyLossBudget = Math.max(0, maxDailyLossSol - dailyRealizedLossSol);
        const remainingCreatorBudget = Math.max(0, maxCreatorExposureSol - creatorClusterExposureSol);
        const remainingRouteBudget = Math.max(0, maxRouteExposureSol - routeExposureSol);
        let ceiling = Math.min(proposedSizeSol, maxBankrollAllocation, remainingDailyLossBudget, remainingCreatorBudget, remainingRouteBudget, stressedExitCapacitySol);
        // Apply scaling / throttling penalties:
        // A. Drawdown throttle: linearly scale down size as drawdown approaches max allowable
        if (currentDrawdownPct > 5.0) {
            const ddFactor = Math.max(0.1, 1 - (currentDrawdownPct - 5.0) / (this.MAX_DRAWDOWN_ALLOWABLE_PCT - 5.0));
            throttlingReductions.drawdownThrottle = ddFactor;
            ceiling *= ddFactor;
        }
        // B. Model uncertainty penalty: if uncertainty is high, scale down
        if (modelUncertainty > 0.3) {
            const uncertaintyFactor = Math.max(0.05, 1 - modelUncertainty);
            throttlingReductions.uncertaintyPenalty = uncertaintyFactor;
            ceiling *= uncertaintyFactor;
        }
        // C. Execution reliability penalty: if landing probability is degraded (< 0.8), scale down
        if (executionReliability < 0.8) {
            const reliabilityFactor = Math.max(0.1, executionReliability / 0.8);
            throttlingReductions.executionPenalty = reliabilityFactor;
            ceiling *= reliabilityFactor;
        }
        const authorizedSizeSol = Number(Math.max(0, ceiling).toFixed(4));
        if (authorizedSizeSol <= 0.001) {
            denialReasons.push('ECONOMIC_MINIMUM_UNMET: Throttled size fell below 0.001 SOL minimum');
            const hash = this.computeBarrierHash(inputs, 'DENIED', 0, evaluatedAtMs);
            return {
                status: 'DENIED',
                requestedSizeSol: proposedSizeSol,
                authorizedSizeSol: 0,
                denialReasons: Object.freeze(denialReasons),
                throttlingReductions: Object.freeze(throttlingReductions),
                capitalBarrierHash: hash,
                evaluatedAtMs,
            };
        }
        const status = authorizedSizeSol < proposedSizeSol ? 'THROTTLED' : 'PERMITTED';
        const hash = this.computeBarrierHash(inputs, status, authorizedSizeSol, evaluatedAtMs);
        return {
            status,
            requestedSizeSol: proposedSizeSol,
            authorizedSizeSol,
            denialReasons: Object.freeze([]),
            throttlingReductions: Object.freeze(throttlingReductions),
            capitalBarrierHash: hash,
            evaluatedAtMs,
        };
    }
    static computeBarrierHash(inputs, status, authorizedSize, evaluatedAtMs) {
        return createHash('sha256')
            .update('CAPITAL_BARRIER:')
            .update(inputs.proposedSizeSol.toString())
            .update(inputs.totalBankrollSol.toString())
            .update(inputs.currentDrawdownPct.toString())
            .update(status)
            .update(authorizedSize.toString())
            .update(evaluatedAtMs.toString())
            .digest('hex');
    }
}
//# sourceMappingURL=capital-barrier-kernel.js.map
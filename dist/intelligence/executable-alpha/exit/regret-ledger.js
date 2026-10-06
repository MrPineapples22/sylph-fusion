/**
 * SYLPH FUSION — EXIT REGRET & COUNTERFACTUAL LEDGER ENGINE
 * Section XXIV & Study 41: RUNNER-HOLD-vs-RECOVERY-X
 *
 * Computes counterfactual exit regret once a position matures:
 * - PrematureLiquidationCost: Money left on table by selling before executable peak.
 * - LateExitCost: Capital destroyed by holding through post-peak collapse.
 * - ExecutionShortfall: Gap between paper signal mark and realized net cash.
 * - RunnerCaptureEfficiency (RCE): RealizedNetPnL / BestFeasibleExecutablePnL.
 *
 * CRITICAL INVARIANT:
 * The denominator of RCE MUST be the best feasible executable counterfactual,
 * NOT the mythological unexecutable historical chart ATH!
 */
export class ExitRegretLedger {
    static computeRegret(params) {
        const { positionId, realizedNetPnLUsd, bestFeasibleExecutablePnLUsd, exitTriggerPriceUsd, actualExecutedPriceUsd, tokensLiquidated, maxPostExitExecutablePriceUsd, counterfactualPolicyPnLs = {}, } = params;
        // Execution shortfall: loss between trigger intention and landed fill
        const executionShortfallUsd = Math.max(0, (exitTriggerPriceUsd - actualExecutedPriceUsd) * tokensLiquidated);
        // Premature liquidation: if price rose substantially post-exit and could be executed
        const prematureLiquidationCostUsd = Math.max(0, (maxPostExitExecutablePriceUsd - actualExecutedPriceUsd) * tokensLiquidated);
        // Late exit: if holding resulted in selling below best feasible executable peak
        const lateExitCostUsd = Math.max(0, bestFeasibleExecutablePnLUsd - realizedNetPnLUsd - executionShortfallUsd);
        // RCE: Runner Capture Efficiency
        // Normalized by best feasible executable P&L (not ATH)
        let rce = 0;
        if (bestFeasibleExecutablePnLUsd > 0) {
            rce = Math.max(0, Math.min(1.0, realizedNetPnLUsd / bestFeasibleExecutablePnLUsd));
        }
        else if (realizedNetPnLUsd >= 0) {
            rce = 1.0;
        }
        // Determine counterfactual policy winner
        let winner = 'authoritative-policy';
        let bestPnL = realizedNetPnLUsd;
        for (const [policyId, pnl] of Object.entries(counterfactualPolicyPnLs)) {
            if (pnl > bestPnL) {
                bestPnL = pnl;
                winner = policyId;
            }
        }
        return {
            positionId,
            realizedNetPnLUsd,
            bestFeasibleExecutablePnLUsd,
            runnerCaptureEfficiency: rce,
            prematureLiquidationCostUsd,
            lateExitCostUsd,
            executionShortfallUsd,
            counterfactualPolicyWinner: winner,
        };
    }
}
//# sourceMappingURL=regret-ledger.js.map
/**
 * SYLPH FUSION — RUNNER SEARCH COST ENGINE
 * Section XXV & Study 43: RUNNER-SEARCH-COST-X (Priority P0)
 *
 * Implements search cost accounting for extreme runner discovery:
 * RunnerSearchCost = \sum LossesBeforeRunner + ExecutionFriction
 * RunnerNetContribution = RunnerCapturedPnL - RunnerSearchCost
 *
 * Empirical Ground Truth: Since 10x runners occur in ~0.397% of launches (1 in 250),
 * discovering one runner accumulates hundreds of failed trades and friction costs.
 */
export class RunnerSearchCostEngine {
    static calculateSearchCost(outcomes) {
        let nonRunnerLossesUsd = 0;
        let cumulativeFrictionUsd = 0;
        let runnerCount = 0;
        let grossRunnerGainsUsd = 0;
        for (const item of outcomes) {
            cumulativeFrictionUsd += item.feesAndFrictionUsd;
            if (item.isRunner) {
                runnerCount++;
                grossRunnerGainsUsd += Math.max(0, item.netRealizedPnLUsd);
            }
            else {
                if (item.netRealizedPnLUsd < 0) {
                    nonRunnerLossesUsd += Math.abs(item.netRealizedPnLUsd);
                }
            }
        }
        const totalRunnerSearchCostUsd = nonRunnerLossesUsd + cumulativeFrictionUsd;
        const netRunnerContributionUsd = grossRunnerGainsUsd - totalRunnerSearchCostUsd;
        const averageSearchCostPerRunnerUsd = runnerCount > 0
            ? totalRunnerSearchCostUsd / runnerCount
            : totalRunnerSearchCostUsd;
        const isSearchEconomicallyViable = netRunnerContributionUsd > 0 && runnerCount > 0;
        return {
            totalCandidatesEvaluated: outcomes.length,
            nonRunnerLossesUsd,
            cumulativeFrictionUsd,
            totalRunnerSearchCostUsd,
            runnerCount,
            grossRunnerGainsUsd,
            netRunnerContributionUsd,
            averageSearchCostPerRunnerUsd,
            isSearchEconomicallyViable,
        };
    }
}
//# sourceMappingURL=runner-search-cost.js.map
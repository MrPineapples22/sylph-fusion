export class CapacityEngine {
    /**
     * Evaluates exit capacity.
     * A token with deep entry pool but shallow exit curve cannot support large size.
     * Emergency exit impact = (Proposed Position / Pool Liquidity) * 10,000 bps.
     */
    calculateExitCapacity(poolLiquidityLamports, maxImpactBps) {
        if (poolLiquidityLamports <= 0n)
            return 0n;
        // Max size where impact does not exceed maxImpactBps
        return (poolLiquidityLamports * BigInt(maxImpactBps)) / 10000n;
    }
    /**
     * Master capacity limiter enforcing Section XX:
     * MAX AUTHORIZED POSITION = min(user_risk, global_risk, entry_cap, exit_cap, strategy_cap, settlement_cap)
     */
    calculateMaxAuthorizedPosition(constraints, strategyCapLamports) {
        const exitCap = this.calculateExitCapacity(constraints.poolLiquidityLamports, constraints.maxAllowableExitImpactBps);
        // Near-settlement restriction: if remaining hours < 12, throttle capacity
        let settlementCap = constraints.userRiskCapacityLamports;
        if (constraints.settlementRemainingHours < 4) {
            settlementCap = 0n; // No new entries in final settlement hours
        }
        else if (constraints.settlementRemainingHours < 12) {
            settlementCap = constraints.userRiskCapacityLamports / 4n; // 25% max size
        }
        else if (constraints.settlementRemainingHours < 24) {
            settlementCap = constraints.userRiskCapacityLamports / 2n; // 50% max size
        }
        const limits = [
            constraints.userRiskCapacityLamports,
            constraints.globalRiskCapacityLamports,
            exitCap,
            strategyCapLamports,
            settlementCap,
        ];
        let minCap = limits[0];
        for (const lim of limits) {
            if (lim < minCap)
                minCap = lim;
        }
        return minCap > 0n ? minCap : 0n;
    }
    /**
     * Calculates Edge After Capacity:
     * EDGE AFTER CAPACITY = Expected Strategy Edge - Expected Execution Degradation
     */
    calculateEdgeAfterCapacity(expectedEdgeBps, positionSizeLamports, poolLiquidityLamports) {
        if (poolLiquidityLamports <= 0n) {
            return { edgeAfterCapacityBps: -10_000, degradationBps: 10_000, viable: false };
        }
        // Impact formula approximation: (Size / Liquidity) * 10,000 bps
        const degradationBps = Number((positionSizeLamports * 10000n) / poolLiquidityLamports);
        const edgeAfterCapacityBps = expectedEdgeBps - degradationBps;
        return {
            edgeAfterCapacityBps,
            degradationBps,
            viable: edgeAfterCapacityBps > 100, // At least 1.0% expected net edge after friction
        };
    }
    /**
     * Section XIX: Adversarial Pre-Trade Simulation.
     * Simulates trade survivability under adverse market shocks.
     */
    runAdversarialSimulation(positionCostLamports, poolLiquidityLamports) {
        const scenarios = [];
        // Scenario 1: Liquidity -25%
        const liq25 = (poolLiquidityLamports * 75n) / 100n;
        const impact25 = liq25 > 0n ? Number((positionCostLamports * 10000n) / liq25) : 10_000;
        const proceeds25 = (positionCostLamports * BigInt(Math.max(0, 10_000 - impact25 - 2500))) / 10000n;
        scenarios.push({
            scenarioName: 'liquidity_drop_25pct',
            simulatedExitProceedsLamports: proceeds25,
            maxDrawdownPct: impact25 / 100 + 25,
            survived: proceeds25 >= (positionCostLamports * 60n) / 100n, // Lost <= 40%
            liquidationPossible: proceeds25 > 0n,
        });
        // Scenario 2: Liquidity -50%
        const liq50 = (poolLiquidityLamports * 50n) / 100n;
        const impact50 = liq50 > 0n ? Number((positionCostLamports * 10000n) / liq50) : 10_000;
        const proceeds50 = (positionCostLamports * BigInt(Math.max(0, 10_000 - impact50 - 5000))) / 10000n;
        scenarios.push({
            scenarioName: 'liquidity_drop_50pct',
            simulatedExitProceedsLamports: proceeds50,
            maxDrawdownPct: impact50 / 100 + 50,
            survived: proceeds50 >= (positionCostLamports * 35n) / 100n, // Lost <= 65%
            liquidationPossible: proceeds50 > 0n,
        });
        // Scenario 3: Creator Dump Shock (Instant -35% value)
        const proceedsDump = (positionCostLamports * 55n) / 100n;
        scenarios.push({
            scenarioName: 'creator_dump_shock',
            simulatedExitProceedsLamports: proceedsDump,
            maxDrawdownPct: 45,
            survived: proceedsDump > 0n,
            liquidationPossible: true,
        });
        const failedScenarios = scenarios.filter(s => !s.survived);
        const catastrophicFailure = scenarios.some(s => !s.liquidationPossible || s.maxDrawdownPct >= 85);
        let score = 100 - failedScenarios.length * 30;
        if (catastrophicFailure)
            score = Math.min(score, 30);
        score = Math.max(0, score);
        const recommendation = catastrophicFailure ? 'REJECT' : score < 60 ? 'DOWNSIZE' : 'PASS';
        return {
            overallSurvivabilityScore: score,
            scenarios,
            catastrophicFailureDetected: catastrophicFailure,
            recommendation,
        };
    }
}
//# sourceMappingURL=capacity-engine.js.map
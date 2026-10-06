/**
 * SYLPH FUSION — DYNAMIC OPTIMAL STOPPING ENGINE
 * Section XXII & Study 42: DYNAMIC-STOPPING-X
 *
 * Implements Bellman-style continuous optimal stopping:
 * V(x, q) = \max( Liquidate, Partial, Continue )
 *
 * Evaluates continuation value vs immediate liquidation proceeds.
 * Invariant: Never assume HOLD is optimal simply because the price has risen!
 */
export class DynamicStoppingEngine {
    policyId = 'dynamic-stopping';
    static evaluateStopping(pos, research, liquidation) {
        // 1. Immediate liquidation value = 100% net liquidation proceeds under stressed conditions
        const immediateLiquidationValueUsd = liquidation.stressedExitCapacityUsd;
        // 2. Partial liquidation value = 50% liquidation proceeds + continuation on remainder
        const partialProceedsUsd = liquidation.base.points.find((p) => p.percentage === 50)?.netProceedsUsd ?? (immediateLiquidationValueUsd * 0.5);
        // 3. Continuation value:
        // Future expected value = Current * (1 + ExpectedDrift) - DownsideRiskDiscount
        // Downside hazard is governed by qFail and DTF score
        const expectedDrift = research.qUp * 2.5 - research.qFail * 1.8;
        const failurePenalty = research.qFail * pos.currentMarkPriceUsd * pos.remainingTokens;
        const continuationValueUsd = Math.max(0, (liquidation.currentMarkUsd * (1 + expectedDrift)) - failurePenalty);
        const partialReductionValueUsd = partialProceedsUsd + (continuationValueUsd * 0.5);
        // Dynamic programming choice
        let optimalAction = 'CONTINUE';
        if (immediateLiquidationValueUsd >= partialReductionValueUsd && immediateLiquidationValueUsd >= continuationValueUsd) {
            optimalAction = 'LIQUIDATE';
        }
        else if (partialReductionValueUsd >= continuationValueUsd) {
            optimalAction = 'PARTIAL';
        }
        const netAdvantage = continuationValueUsd - immediateLiquidationValueUsd;
        return {
            immediateLiquidationValueUsd,
            partialReductionValueUsd,
            continuationValueUsd,
            optimalAction,
            netContinuationAdvantageUsd: netAdvantage,
        };
    }
    evaluate(pos, research, liquidation) {
        // Hard protective triggers first (Section XXXV)
        if (research.isEmergencyStopTriggered || research.creatorDumpRisk || !research.authenticityIntact) {
            return {
                policyId: this.policyId,
                action: 'EMERGENCY_DUMP',
                targetFraction: 1.0,
                expectedProceedsUsd: liquidation.stressedExitCapacityUsd,
                expectedImpactBps: 2500,
                urgency: 'EMERGENCY',
                rationale: 'Hard protective trigger: creator dump, emergency stop, or compromised authenticity',
            };
        }
        const stopping = DynamicStoppingEngine.evaluateStopping(pos, research, liquidation);
        if (stopping.optimalAction === 'LIQUIDATE') {
            return {
                policyId: this.policyId,
                action: 'FULL_LIQUIDATION',
                targetFraction: 1.0,
                expectedProceedsUsd: liquidation.stressedExitCapacityUsd,
                expectedImpactBps: Math.round((liquidation.ownImpactUsd / Math.max(1, liquidation.currentMarkUsd)) * 10000),
                urgency: research.qFail > 0.60 ? 'HIGH' : 'NORMAL',
                rationale: `Dynamic stopping Bellman liquidation: continuation deficit $${(-stopping.netContinuationAdvantageUsd).toFixed(2)}`,
            };
        }
        if (stopping.optimalAction === 'PARTIAL') {
            return {
                policyId: this.policyId,
                action: 'PARTIAL_REDUCE',
                targetFraction: 0.50,
                expectedProceedsUsd: stopping.partialReductionValueUsd * 0.5,
                expectedImpactBps: 800,
                urgency: 'NORMAL',
                rationale: 'Dynamic stopping de-risking: partial reduction dominates full continuation',
            };
        }
        return {
            policyId: this.policyId,
            action: 'HOLD',
            targetFraction: 0,
            expectedProceedsUsd: 0,
            expectedImpactBps: 0,
            urgency: 'LOW',
            rationale: `Continuation value positive: +$${stopping.netContinuationAdvantageUsd.toFixed(2)} advantage`,
        };
    }
}
//# sourceMappingURL=dynamic-stopping.js.map
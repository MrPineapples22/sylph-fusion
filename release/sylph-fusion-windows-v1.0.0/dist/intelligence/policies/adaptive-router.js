/**
 * SOL-SYLPH Intelligence Fabric - Adaptive Strategy & Sequential Decision Policy Router
 * Specifications: Parts LXXXVI (Sequential Decision Intelligence),
 * LXXXVII (Decision State), LXXXVIII (Belief State), LXXXIX (Probe Positions),
 * XC (Value of Information), XCI (Position Thesis Engine), XCII (Opportunity Replacement),
 * XCIII (Policy Champion/Challenger), Major Update #5 (Abstention).
 */
export class PositionThesisEngine {
    evaluatePosition(params) {
        const { mint, entryTimeMs, holdingSeconds, currentPnlPct, liquidityRemainingPct, clusterDistributionPct, organicFlowPersistent, } = params;
        const invalidations = [];
        const supporting = [];
        if (liquidityRemainingPct < 75) {
            invalidations.push('LIQUIDITY_PULL_TRIGGERED: Liquidity dropped below 75% of entry');
        }
        if (clusterDistributionPct > 35) {
            invalidations.push('INSIDER_DUMP_TRIGGERED: Coordinated cluster distribution detected');
        }
        if (!organicFlowPersistent && holdingSeconds > 180) {
            invalidations.push('FLOW_EXHAUSTION_TRIGGERED: Organic buyer velocity ceased');
        }
        if (organicFlowPersistent) {
            supporting.push('Organic buyer flow continuing');
        }
        if (currentPnlPct > 15) {
            supporting.push(`Profitable trajectory (+${currentPnlPct.toFixed(1)}%)`);
        }
        let status = 'VALID';
        let action = 'HOLD';
        if (invalidations.length >= 2 || liquidityRemainingPct < 50) {
            status = 'BROKEN';
            action = 'EMERGENCY_EXIT';
        }
        else if (invalidations.length === 1) {
            status = 'WEAKENING';
            action = 'REDUCE';
        }
        else if (currentPnlPct > 40) {
            action = 'REDUCE'; // take partial profit
        }
        return {
            thesisId: `thesis_${mint.slice(0, 8)}_${entryTimeMs}`,
            mint,
            entryTimeMs,
            status,
            supportingEvidence: supporting,
            invalidationConditions: [
                'Liquidity drops below 75%',
                'Cluster distribution exceeds 35%',
                'Buyer flow ceases for > 180s',
            ],
            activeViolations: invalidations,
            expectedHorizonSec: 300,
            recommendedAction: action,
        };
    }
}
export class ValueOfInformationCalculator {
    /**
     * Part XC: Determines whether the value of gathering 1-2 more slots of data
     * exceeds the latency decay cost of alpha.
     */
    evaluate(params) {
        const { uncertainty, edgeHalfLifeMs, expectedGrossEdgeBps } = params;
        // Waiting 800ms (2 slots) reduces uncertainty by up to 30%
        const uncertaintyReductionGainBps = Math.round(uncertainty * 150);
        // Latency decay cost over 800ms
        const decayRatio = 1 - Math.exp((-Math.LN2 * 800) / Math.max(100, edgeHalfLifeMs));
        const edgeDecayCostBps = Math.round(expectedGrossEdgeBps * decayRatio);
        const netValueOfInformationBps = uncertaintyReductionGainBps - edgeDecayCostBps;
        return {
            action: netValueOfInformationBps > 25 ? 'WAIT_FOR_EVIDENCE' : 'ACT_NOW',
            uncertaintyReductionGainBps,
            edgeDecayCostBps,
            netValueOfInformationBps,
        };
    }
}
export class AdaptivePolicyRouter {
    thesisEngine = new PositionThesisEngine();
    voiCalc = new ValueOfInformationCalculator();
    route(input) {
        // Check if an existing position is being monitored
        if (input.activePosition) {
            const thesis = this.thesisEngine.evaluatePosition({
                mint: 'active_position',
                entryTimeMs: Date.now() - input.activePosition.holdingSeconds * 1000,
                holdingSeconds: input.activePosition.holdingSeconds,
                currentPnlPct: input.activePosition.currentPnlPct,
                liquidityRemainingPct: 95,
                clusterDistributionPct: (1.0 - input.clusterDispersalRatio) * 100,
                organicFlowPersistent: input.pumpScore > 40,
            });
            return {
                policyName: 'SequentialThesisPolicy',
                action: thesis.recommendedAction,
                confidence: 0.85,
                targetAllocationMultiplier: thesis.status === 'VALID' ? 1.0 : 0.0,
                primaryReason: `Position thesis status is ${thesis.status}: ${thesis.activeViolations.join('; ') || 'Holding targets intact'}`,
                stopLossBps: 500,
                takeProfitBps: 1500,
                thesis,
            };
        }
        // 1. Extreme OOD or Unknown State -> Observation Only Policy
        if (input.oodState === 'OUT_OF_DISTRIBUTION' || input.oodState === 'UNKNOWN') {
            return {
                policyName: 'ObservationOnlyPolicy',
                action: 'OBSERVE',
                confidence: 0.2,
                targetAllocationMultiplier: 0.0,
                primaryReason: `OOD Sentinel flagged environment as ${input.oodState}; abstaining to observe`,
                stopLossBps: 0,
                takeProfitBps: 0,
            };
        }
        // 2. Abnormal or Risk-Off Macro -> Defensive Policy
        if (input.macroRegime === 'ABNORMAL' || input.macroRegime === 'RISK_OFF') {
            return {
                policyName: 'DefensivePolicy',
                action: 'OBSERVE',
                confidence: 0.5,
                targetAllocationMultiplier: 0.0,
                primaryReason: `Macro regime is ${input.macroRegime}; capital defense active`,
                stopLossBps: 400,
                takeProfitBps: 800,
            };
        }
        // 3. Post-Migration Tokens -> PostMigrationPolicy
        if (input.isPostMigration) {
            const isAllowed = input.compositeHsi < 45 && input.deceptionGap < 15;
            return {
                policyName: 'PostMigrationPolicy',
                action: isAllowed ? 'QUALIFY' : 'REJECT',
                confidence: 0.75,
                targetAllocationMultiplier: isAllowed ? 0.7 : 0.0,
                primaryReason: isAllowed ? 'Post-migration liquidity stabilized' : 'Post-migration metrics fail quality gate',
                stopLossBps: 600,
                takeProfitBps: 1500,
            };
        }
        // 4. Value of Information Check: if uncertainty is high and net edge is positive, wait or probe
        if (input.compositeUncertainty && input.compositeUncertainty > 0.45) {
            const voi = this.voiCalc.evaluate({
                uncertainty: input.compositeUncertainty,
                edgeHalfLifeMs: 2000,
                expectedGrossEdgeBps: input.netEdgeBps || 200,
            });
            if (voi.action === 'WAIT_FOR_EVIDENCE') {
                return {
                    policyName: 'EarlyLaunchPolicy',
                    action: 'WATCH',
                    confidence: 0.65,
                    targetAllocationMultiplier: 0.0,
                    primaryReason: `Value of Information (${voi.netValueOfInformationBps} bps) favors waiting for 2 more slots of data`,
                    stopLossBps: 400,
                    takeProfitBps: 1000,
                };
            }
        }
        // 5. Early Launch (< 60s) -> EarlyLaunchPolicy
        if (input.tokenAgeSeconds <= 60) {
            const isHighMomentum = input.pumpScore >= 50 && input.compositeHsi < 45 && input.deceptionGap < 20;
            return {
                policyName: 'EarlyLaunchPolicy',
                action: isHighMomentum ? 'ENTER' : 'OBSERVE',
                confidence: isHighMomentum ? 0.8 : 0.4,
                targetAllocationMultiplier: isHighMomentum ? 0.5 : 0.0,
                primaryReason: isHighMomentum ? 'Rapid organic bonding curve acceleration' : 'Early curve velocity insufficient',
                stopLossBps: 400,
                takeProfitBps: 1000,
            };
        }
        // 6. Smart Cluster Follow Policy
        if (input.actorReputationScore >= 80 && input.clusterDispersalRatio > 0.5) {
            return {
                policyName: 'SmartClusterFollowPolicy',
                action: 'ENTER',
                confidence: 0.85,
                targetAllocationMultiplier: 0.8,
                primaryReason: 'High reputation cluster accumulation with organic dispersal',
                stopLossBps: 500,
                takeProfitBps: 1200,
            };
        }
        // 7. Organic Momentum Policy
        const isOrganic = input.pumpScore >= 40 && input.compositeHsi < 50 && input.deceptionGap < 25;
        return {
            policyName: 'OrganicMomentumPolicy',
            action: isOrganic ? 'ENTER' : 'REJECT',
            confidence: isOrganic ? 0.7 : 0.3,
            targetAllocationMultiplier: isOrganic ? 1.0 : 0.0,
            primaryReason: isOrganic ? 'Sufficient organic momentum detected' : 'Token metrics failed organic momentum criteria',
            stopLossBps: 500,
            takeProfitBps: 1000,
        };
    }
}
//# sourceMappingURL=adaptive-router.js.map
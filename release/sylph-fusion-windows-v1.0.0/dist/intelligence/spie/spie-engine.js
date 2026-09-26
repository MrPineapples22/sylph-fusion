/**
 * SOL-SYLPH Platform - Sylph Profit Intelligence Engine (SPIE)
 * Specifications: Master Quantitative Upgrade (Phases 1-30).
 *
 * Sits between the raw intelligence/model layer and the control/risk layer.
 * Transforms multidimensional features into a calibrated Net Expected Value (Net EV),
 * opportunity ranking score, and actionable stage transitions.
 *
 * Invariant: Net EV = Gross Alpha - Execution Friction - Tail Risk Penalty
 * Non-negotiable: If friction > 45% of gross alpha, the trade MUST ABSTAIN.
 */
// Weights across the 9 orthogonal factors (Sum = 1.00)
export const FACTOR_WEIGHTS = {
    tokenQuality: 0.12,
    momentum: 0.16,
    liquidityDepth: 0.14,
    participation: 0.12,
    walletQuality: 0.10,
    safety: 0.15,
    executionFeasibility: 0.08,
    regimeCompatibility: 0.08,
    timing: 0.05,
};
export class SpieEngine {
    minRealSolFloor = 1.0;
    maxFrictionRatio = 0.45; // Max 45% friction rule
    defaultTargetUpsidePct = 0.40; // +40%
    defaultStructuralStopPct = 0.12; // -12%
    /**
     * Evaluates a single candidate opportunity and computes its calibrated Net EV.
     */
    evaluate(candidate) {
        const timestamp = Date.now();
        const symbol = candidate.symbol || candidate.mint.slice(0, 6).toUpperCase();
        // 1. Sanitize and normalize factors into [0.0, 1.0]
        const factors = {
            tokenQuality: this.clamp(candidate.factors.tokenQuality ?? 0.5),
            momentum: this.clamp(candidate.factors.momentum ?? 0.5),
            liquidityDepth: this.clamp(candidate.factors.liquidityDepth ?? (candidate.realSolReserve > 5 ? 0.7 : candidate.realSolReserve / 7.14)),
            participation: this.clamp(candidate.factors.participation ?? 0.5),
            walletQuality: this.clamp(candidate.factors.walletQuality ?? 0.5),
            safety: this.clamp(candidate.factors.safety ?? 0.5),
            executionFeasibility: this.clamp(candidate.factors.executionFeasibility ?? 0.7),
            regimeCompatibility: this.clamp(candidate.factors.regimeCompatibility ?? 0.6),
            timing: this.clamp(candidate.factors.timing ?? 0.5),
        };
        // 2. Identify dominant positive and negative factors
        let maxFactorName = 'momentum';
        let maxFactorVal = -Infinity;
        let minFactorName = 'safety';
        let minFactorVal = Infinity;
        for (const [key, weight] of Object.entries(FACTOR_WEIGHTS)) {
            const val = factors[key];
            const weightedContribution = val * weight;
            if (weightedContribution > maxFactorVal) {
                maxFactorVal = weightedContribution;
                maxFactorName = key;
            }
            if (val < minFactorVal) {
                minFactorVal = val;
                minFactorName = key;
            }
        }
        // 3. Compute Composite Quality Vector
        let compositeZ = 0;
        for (const [key, weight] of Object.entries(FACTOR_WEIGHTS)) {
            compositeZ += factors[key] * weight;
        }
        // 4. Calibrate win probability pTarget via logistic sigmoid centered at 0.50
        // z in [0, 1] -> pTarget smoothly scaled between ~0.15 and ~0.85
        const pTarget = Number((1 / (1 + Math.exp(-4 * (compositeZ - 0.5)))).toFixed(4));
        const pStop = Number((1 - pTarget).toFixed(4));
        // 5. Compute Gross Edge & Return Dynamics
        const targetUpsidePct = candidate.targetUpsidePct ?? this.defaultTargetUpsidePct;
        const structuralStopPct = candidate.structuralStopPct ?? this.defaultStructuralStopPct;
        const grossExpectedUpsideBps = Math.round(targetUpsidePct * 10000);
        const modeledDownsideBps = Math.round(structuralStopPct * 10000);
        // Gross Alpha = (pTarget * targetUpside) - (pStop * structuralStop)
        const grossAlphaBps = Math.round((pTarget * grossExpectedUpsideBps) - (pStop * modeledDownsideBps));
        // 6. Compute Execution Friction
        const slippageBps = candidate.modeledSlippageBps ?? 120;
        const priceImpactBps = candidate.priceImpactBps ?? 80;
        const priorityFeeBps = candidate.priorityFeeBps ?? 20;
        const jitoTipBps = candidate.jitoTipBps ?? 25;
        const adverseSelectionBps = candidate.adverseSelectionBps ?? 35;
        const executionFrictionBps = slippageBps + priceImpactBps + priorityFeeBps + jitoTipBps + adverseSelectionBps;
        const frictionToGrossRatio = grossAlphaBps > 0 ? Number((executionFrictionBps / grossAlphaBps).toFixed(4)) : Infinity;
        // 7. Compute Tail Risk Penalty (Rug probability * catastrophic drawdown)
        const rugProb = candidate.rugProbability ?? (1 - factors.safety) * 0.2;
        const tailRiskPenaltyBps = Math.round(rugProb * 8000); // 80% loss penalty on rug event
        // 8. Net Expected Value (Net EV)
        const netExpectedEvBps = grossAlphaBps - executionFrictionBps - tailRiskPenaltyBps;
        // 9. Opportunity Score (0 to 100)
        // Scaled based on Net EV (0 BPS -> 50, +500 BPS -> 85, +1000 BPS -> 100, < -200 BPS -> 20)
        let opportunityScore = Math.round(50 + (netExpectedEvBps / 20));
        opportunityScore = Math.max(0, Math.min(100, opportunityScore));
        // 10. Hard Invariant & Action Evaluation
        let actionRecommendation = 'ABSTAIN';
        let abstainReason;
        let opportunityStage = 'WATCH';
        if (candidate.isDevSold) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = 'CREATOR_SELL_DETECTED: Dev dumped on active curve';
            opportunityStage = 'INVALIDATED';
        }
        else if (candidate.isCurveComplete) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = 'CURVE_COMPLETED: Bonding curve migrated to DEX AMM';
            opportunityStage = 'CLOSED';
        }
        else if (candidate.realSolReserve < this.minRealSolFloor) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = `RESERVE_INSUFFICIENT: Real SOL reserves (${candidate.realSolReserve.toFixed(2)} SOL) < 1.0 SOL floor`;
            opportunityStage = 'WATCH';
        }
        else if (grossAlphaBps <= 0) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = `NEGATIVE_GROSS_ALPHA: Modeled gross edge (${grossAlphaBps} BPS) is non-positive`;
            opportunityStage = 'DEVELOPING';
        }
        else if (frictionToGrossRatio > this.maxFrictionRatio) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = `EXCESSIVE_FRICTION: Execution cost (${executionFrictionBps} BPS) exceeds ${(this.maxFrictionRatio * 100).toFixed(0)}% of gross alpha (${grossAlphaBps} BPS, ratio: ${(frictionToGrossRatio * 100).toFixed(1)}%)`;
            opportunityStage = 'DEVELOPING';
        }
        else if (netExpectedEvBps <= 0) {
            actionRecommendation = 'ABSTAIN';
            abstainReason = `NEGATIVE_NET_EV: Net Expected Value (${netExpectedEvBps} BPS) is non-positive after friction and tail risk`;
            opportunityStage = 'DEVELOPING';
        }
        else {
            // Eligible opportunity! Determine stage and action
            if (netExpectedEvBps >= 400 && compositeZ >= 0.80) {
                opportunityStage = 'READY';
                actionRecommendation = factors.timing >= 0.75 ? 'FAST_BUY' : 'PULLBACK_WAIT';
            }
            else if (netExpectedEvBps >= 250 && compositeZ >= 0.70) {
                opportunityStage = 'HIGH_CONFIDENCE';
                actionRecommendation = factors.timing >= 0.70 ? 'SLOW_BUY' : 'PULLBACK_WAIT';
            }
            else if (netExpectedEvBps >= 100) {
                opportunityStage = 'QUALIFIED';
                actionRecommendation = 'SLOW_BUY';
            }
            else {
                opportunityStage = 'DEVELOPING';
                actionRecommendation = 'ABSTAIN';
            }
        }
        return {
            mint: candidate.mint,
            symbol,
            pTarget,
            pStop,
            grossExpectedUpsideBps,
            modeledDownsideBps,
            grossAlphaBps,
            executionFrictionBps,
            tailRiskPenaltyBps,
            netExpectedEvBps,
            opportunityScore,
            opportunityStage,
            actionRecommendation,
            abstainReason,
            factors,
            dominantPositiveFactor: maxFactorName,
            dominantNegativeConstraint: minFactorName,
            frictionToGrossRatio,
            timestamp,
        };
    }
    /**
     * Sorts and ranks an array of candidates into an ordered Opportunity Board.
     */
    rankOpportunities(candidates) {
        return candidates
            .map(c => this.evaluate(c))
            .sort((a, b) => b.netExpectedEvBps - a.netExpectedEvBps || b.opportunityScore - a.opportunityScore);
    }
    clamp(val) {
        return Math.max(0, Math.min(1, Number.isFinite(val) ? val : 0.5));
    }
}
//# sourceMappingURL=spie-engine.js.map
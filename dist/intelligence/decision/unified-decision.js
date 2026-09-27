/**
 * SOL-SYLPH Intelligence Fabric - Unified Opportunity Decision Object
 * Specifications: Master Quantitative Upgrade & Prompt Section 9.
 *
 * Provides a single, authoritative, immutable decision contract for token evaluation.
 * Synthesizes SPIE Net EV, Solaris execution feasibility, Veto safety kernels,
 * and market microstructure features into an auditable decision object.
 */
export class UnifiedDecisionBuilder {
    static fromSpieEvaluation(opportunityId, slot, evalResult, options) {
        const reasonsForAcceptance = [];
        const reasonsForRejection = [];
        if (evalResult.actionRecommendation === 'FAST_BUY' || evalResult.actionRecommendation === 'BREAKOUT_ENTER') {
            reasonsForAcceptance.push(`Positive Net EV (+${evalResult.netExpectedEvBps} bps) exceeds hurdle`);
            reasonsForAcceptance.push(`Strong dominant factor: ${evalResult.dominantPositiveFactor}`);
            reasonsForAcceptance.push(`Opportunity score: ${evalResult.opportunityScore}/100`);
        }
        else if (evalResult.actionRecommendation === 'ABSTAIN') {
            reasonsForRejection.push(evalResult.abstainReason || 'Friction or risk bounds exceeded');
            reasonsForRejection.push(`Limiting constraint: ${evalResult.dominantNegativeConstraint}`);
        }
        const stageMapping = {
            WATCH: 'WATCH',
            DEVELOPING: 'DEVELOPING',
            QUALIFIED: 'QUALIFIED',
            HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',
            READY: 'READY',
            ENTERED: 'ENTERED',
            INVALIDATED: 'INVALIDATED',
            EXITING: 'EXITING',
            CLOSED: 'CLOSED',
        };
        return {
            opportunityId,
            token: evalResult.mint,
            symbol: evalResult.symbol,
            timestamp: evalResult.timestamp,
            slot,
            expectedValue: (evalResult.netExpectedEvBps / 10_000) * (options?.recommendedMaxRiskUsd ?? 100),
            expectedNetEvBps: evalResult.netExpectedEvBps,
            confidence: evalResult.pTarget,
            uncertainty: options?.uncertainty ?? 0.15,
            expectedUpside: options?.expectedUpside ?? (evalResult.grossExpectedUpsideBps / 10_000),
            expectedDownside: options?.expectedDownside ?? (evalResult.modeledDownsideBps / 10_000),
            liquidityQuality: evalResult.factors.liquidityDepth,
            momentumQuality: evalResult.factors.momentum,
            participationQuality: evalResult.factors.participation,
            walletQuality: evalResult.factors.walletQuality,
            safetyScore: Math.round(evalResult.factors.safety * 100),
            rugProbability: Math.max(0, 1 - evalResult.factors.safety),
            manipulationProbability: options?.manipulationProbability ?? (1 - evalResult.factors.walletQuality) * 0.5,
            executionQuality: evalResult.factors.executionFeasibility,
            expectedSlippageBps: options?.expectedSlippageBps ?? 120,
            expectedTransactionCostLamports: options?.expectedTransactionCostLamports ?? 150000n,
            marketRegime: options?.marketRegime ?? 'TRENDING',
            opportunityWindowMs: options?.opportunityWindowMs ?? 4_000,
            invalidationCondition: options?.customInvalidation ?? 'Price drops below micro-support or creator dumps supply',
            recommendedMaxRiskUsd: options?.recommendedMaxRiskUsd ?? 100,
            reasonsForAcceptance: Object.freeze(reasonsForAcceptance),
            reasonsForRejection: Object.freeze(reasonsForRejection),
            stage: stageMapping[evalResult.opportunityStage] ?? 'DEVELOPING',
            actionRecommendation: evalResult.actionRecommendation,
            dominantFactor: evalResult.dominantPositiveFactor,
            limitingConstraint: evalResult.dominantNegativeConstraint,
        };
    }
}
//# sourceMappingURL=unified-decision.js.map
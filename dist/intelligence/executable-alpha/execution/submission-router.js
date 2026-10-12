/**
 * SYLPH FUSION — MULTI-LANE ADAPTIVE SUBMISSION ROUTER
 * Study 38: ADAPTIVE-SUBMISSION-ROUTER-X (Section XIX)
 *
 * Dynamically arbitrates transaction dispatch across multiple propagation lanes:
 * - Jito-Bundle (Private MEV bundle, tip auction, sandwich immune, leader conditional)
 * - Direct-TPU (Direct UDP/QUIC TPU broadcast bypassing intermediate RPC nodes)
 * - NextBlock-Relay (High-throughput validator fast-lane relay)
 * - Standard-RPC (Fallback public cluster submission)
 *
 * Optimizes net execution expectancy:
 *   Max( P(Landed | Lane) * GrossEdge - (Fee + Tip + Shortfall) )
 *
 * Fail-Closed Invariant:
 * If best available lane exhibits P(Landed) < 0.60, candidate fails closed with CHALLENGED_ABSTAIN.
 */
import { LandingPhysicsModel } from './landing-model.js';
import { AccountContentionEngine } from './account-contention.js';
import { FeeResponseSurfaceEngine } from './fee-response.js';
export class MultiLaneSubmissionRouter {
    scorecardEngine;
    static CANDIDATE_LANES = [
        'Jito-Bundle',
        'Direct-TPU',
        'NextBlock-Relay',
        'Standard-RPC',
    ];
    static MINIMUM_ACCEPTABLE_LANDING_PROBABILITY = 0.60;
    constructor(scorecardEngine) {
        this.scorecardEngine = scorecardEngine;
    }
    routeSubmission(input) {
        const { tradeType, isLeaderJitoEnabled, networkCongestionTps, writableAccountPubkeys, poolOpsPerSec = 15, urgency, expectedGrossEdgeUsd = 10.0, solPriceUsd = 150.0, } = input;
        // 1. Analyze account write-lock contention across writable accounts
        const globalCongestion = Math.min(1.0, networkCongestionTps / 3500.0);
        const contentionAnalysis = AccountContentionEngine.analyzeContention({
            writableAccountPubkeys,
            poolOpsPerSec,
            globalCongestionLevel: globalCongestion,
        });
        // 2. Evaluate optimal fees per urgency
        const baseCu = tradeType === 'ENTRY_BUY' ? 85_000 : 95_000;
        const congestionMult = 1.0 + globalCongestion * 1.5;
        const feeOpt = FeeResponseSurfaceEngine.optimizeFee({
            baseExecutionCuEstimate: baseCu,
            congestionMultiplier: congestionMult,
            urgency,
            solPriceUsd,
        });
        // 3. Evaluate each candidate lane
        const laneEvals = [];
        for (const laneId of MultiLaneSubmissionRouter.CANDIDATE_LANES) {
            const scorecard = this.scorecardEngine.getScorecard(laneId);
            const landingReport = LandingPhysicsModel.estimateLanding({
                laneId,
                priorityFeeMicroLamports: feeOpt.optimalPriorityMicroLamports,
                tipLamports: laneId.includes('Jito') ? feeOpt.optimalTipLamports : 0n,
                writableAccountCount: writableAccountPubkeys.length,
                isLeaderJitoEnabled,
                networkCongestionTps,
                tradeType,
            });
            // Viability check
            let isViable = true;
            let rejectionReason;
            // Jito requires leader support or sufficient tip auction participation
            if (laneId === 'Jito-Bundle' && !isLeaderJitoEnabled && landingReport.landingProbability < 0.50) {
                isViable = false;
                rejectionReason = 'Current slot leader is not Jito-enabled and bundle relay drops without MEV engine';
            }
            // Compute Net Utility:
            // Utility = P(Land) * GrossEdge - (Fee + Tip + Shortfall) - LatencyPenalty
            const historicalSuccessMultiplier = scorecard.resolvedAttempts >= 30
                ? scorecard.landingRate
                : 0.80; // neutral prior for un-benchmarked lanes
            const effectiveLandingProb = landingReport.landingProbability * (0.7 + 0.3 * historicalSuccessMultiplier);
            const latencyPenalty = (landingReport.expectedLandingLatencyMs / 1000.0) * (urgency === 'EMERGENCY' ? 8.0 : 2.0);
            const totalCostUsd = feeOpt.estimatedFeeUsd + landingReport.expectedImplementationShortfallUsd;
            const netUtilityScore = (effectiveLandingProb * expectedGrossEdgeUsd) - totalCostUsd - latencyPenalty;
            laneEvals.push({
                laneId,
                landingReport,
                scorecard,
                feeOptimization: feeOpt,
                netUtilityScore,
                isViable,
                rejectionReason,
            });
        }
        // Sort viable lanes descending by utility score
        const viableLanes = laneEvals.filter((e) => e.isViable).sort((a, b) => b.netUtilityScore - a.netUtilityScore);
        const primary = viableLanes[0] || laneEvals.sort((a, b) => b.netUtilityScore - a.netUtilityScore)[0];
        const fallback = viableLanes[1] || laneEvals.find((e) => e.laneId !== primary.laneId) || primary;
        const blockers = [];
        if (primary.landingReport.landingProbability < MultiLaneSubmissionRouter.MINIMUM_ACCEPTABLE_LANDING_PROBABILITY) {
            blockers.push(`LANDING_PROBABILITY_BELOW_MINIMUM: Best lane (${primary.laneId}) P(Land)=${(primary.landingReport.landingProbability * 100).toFixed(1)}% < ${(MultiLaneSubmissionRouter.MINIMUM_ACCEPTABLE_LANDING_PROBABILITY * 100).toFixed(1)}%`);
        }
        if (contentionAnalysis.lockCollisionProbability > 0.85) {
            blockers.push(`CRITICAL_ACCOUNT_CONTENTION: Lock collision probability ${(contentionAnalysis.lockCollisionProbability * 100).toFixed(1)}% with ${contentionAnalysis.estimatedWaitSlots} wait slots`);
        }
        const isExecutionSafe = blockers.length === 0;
        return {
            selectedLane: primary.laneId,
            fallbackLane: fallback.laneId,
            landingProbability: primary.landingReport.landingProbability,
            sameSlotProbability: primary.landingReport.sameSlotProbability,
            expectedLandingLatencyMs: primary.landingReport.expectedLandingLatencyMs,
            optimalPriorityFeeMicroLamports: primary.feeOptimization.optimalPriorityMicroLamports,
            optimalTipLamports: primary.laneId.includes('Jito') ? primary.feeOptimization.optimalTipLamports : 0n,
            estimatedCostUsd: primary.feeOptimization.estimatedFeeUsd + primary.landingReport.expectedImplementationShortfallUsd,
            isExecutionSafe,
            laneEvaluations: laneEvals,
            contentionAnalysis,
            safetyBlockers: blockers,
            decisionTimestampMs: Date.now(),
        };
    }
}
//# sourceMappingURL=submission-router.js.map
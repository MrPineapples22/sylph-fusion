/**
 * SYLPH FUSION — REALIZED EDGE LEDGER & CAUSAL ATTRIBUTION
 * Specifications: Prompt 20
 *
 * Tracks edge decay through the entire opportunity lifecycle:
 *   PredictedEdge
 *   → DecisionEdge
 *   → SubmissionEdge
 *   → LandingEdge
 *   → SettlementEdge
 *   → RealizedNetEdge
 *
 * Invariants:
 * 1. EdgeLeakage(stage) = Edge(stage) - Edge(next_stage)
 * 2. Causal attribution of RealizedPnL:
 *      SignalEdge + TimingEdge + RoutingEdge + LeaderEdge + LiquidityEdge
 *      - BaseFee - PriorityFee - JitoTip - Slippage - SelfImpact -
 *      FailureCost - CapitalTimeCost - VerificationCost
 * 3. Answers: "Where did expected edge disappear?"
 *    Prevents blaming the model when the real failure was latency, transport, or liquidity.
 */
import { hashCanonical } from './canonical-hashing.js';
export class RealizedEdgeLedger {
    records = [];
    append(params) {
        const { stages, feesAndTipsLamports, slippageAndImpactLamports, capitalTimeAndFrictionLamports } = params;
        // Calculate stage-by-stage leakage
        const predictionToDecision = stages.predictedEdgeLamports - stages.decisionEdgeLamports;
        const decisionToSubmission = stages.decisionEdgeLamports - stages.submissionEdgeLamports;
        const submissionToLanding = stages.submissionEdgeLamports - stages.landingEdgeLamports;
        const landingToSettlement = stages.landingEdgeLamports - stages.settlementEdgeLamports;
        const totalLeakage = stages.predictedEdgeLamports - stages.realizedNetEdgeLamports;
        const leakage = Object.freeze({
            predictionToDecisionLeakage: predictionToDecision,
            decisionToSubmissionLeakage: decisionToSubmission,
            submissionToLandingLeakage: submissionToLanding,
            landingToSettlementLeakage: landingToSettlement,
            totalEdgeLeakageLamports: totalLeakage,
        });
        // Determine primary leakage cause
        let primaryCause = 'NONE';
        if (totalLeakage > 0n) {
            if (submissionToLanding > predictionToDecision && submissionToLanding > slippageAndImpactLamports) {
                primaryCause = 'LATENCY_TRANSPORT';
            }
            else if (slippageAndImpactLamports > feesAndTipsLamports) {
                primaryCause = 'SLIPPAGE_IMPACT';
            }
            else if (predictionToDecision > 0n) {
                primaryCause = 'SIGNAL_DECAY';
            }
            else {
                primaryCause = 'EXECUTION_FRICTION';
            }
        }
        const attribution = Object.freeze({
            signalEdgeLamports: stages.decisionEdgeLamports,
            timingEdgeLamports: -decisionToSubmission,
            routingEdgeLamports: 0n,
            leaderEdgeLamports: 0n,
            liquidityEdgeLamports: -submissionToLanding,
            feesAndTipsLamports,
            slippageAndImpactLamports,
            capitalTimeAndFrictionLamports,
            netRealizedEdgeLamports: stages.realizedNetEdgeLamports,
        });
        const recordedAt = new Date().toISOString();
        const recordId = `edge_rec_${params.economicFactId}_${Date.now()}`;
        const recordPayload = {
            recordId,
            economicFactId: params.economicFactId,
            mint: params.mint,
            stages: {
                predicted: `${stages.predictedEdgeLamports}n`,
                decision: `${stages.decisionEdgeLamports}n`,
                submission: `${stages.submissionEdgeLamports}n`,
                landing: `${stages.landingEdgeLamports}n`,
                settlement: `${stages.settlementEdgeLamports}n`,
                realized: `${stages.realizedNetEdgeLamports}n`,
            },
            primaryCause,
            recordedAt,
        };
        const recordHash = hashCanonical(recordPayload);
        const record = Object.freeze({
            recordId,
            economicFactId: params.economicFactId,
            mint: params.mint,
            stages: Object.freeze({ ...stages }),
            leakage,
            attribution,
            primaryLeakageCause: primaryCause,
            recordedAt,
            recordHash,
        });
        this.records.push(record);
        return record;
    }
    all() {
        return Object.freeze([...this.records]);
    }
    count() {
        return this.records.length;
    }
}
//# sourceMappingURL=realized-edge-ledger.js.map
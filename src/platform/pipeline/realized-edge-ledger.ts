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

export interface EdgeStages {
  readonly predictedEdgeLamports: bigint;
  readonly decisionEdgeLamports: bigint;
  readonly submissionEdgeLamports: bigint;
  readonly landingEdgeLamports: bigint;
  readonly settlementEdgeLamports: bigint;
  readonly realizedNetEdgeLamports: bigint;
}

export interface EdgeLeakageBreakdown {
  readonly predictionToDecisionLeakage: bigint;
  readonly decisionToSubmissionLeakage: bigint;
  readonly submissionToLandingLeakage: bigint;
  readonly landingToSettlementLeakage: bigint;
  readonly totalEdgeLeakageLamports: bigint;
}

export interface RealizedEdgeDecomposition {
  readonly signalEdgeLamports: bigint;
  readonly timingEdgeLamports: bigint;
  readonly routingEdgeLamports: bigint;
  readonly leaderEdgeLamports: bigint;
  readonly liquidityEdgeLamports: bigint;
  readonly feesAndTipsLamports: bigint;
  readonly slippageAndImpactLamports: bigint;
  readonly capitalTimeAndFrictionLamports: bigint;
  readonly netRealizedEdgeLamports: bigint;
}

export interface RealizedEdgeRecord {
  readonly recordId: string;
  readonly economicFactId: string;
  readonly mint: string;
  readonly stages: EdgeStages;
  readonly leakage: EdgeLeakageBreakdown;
  readonly attribution: RealizedEdgeDecomposition;
  readonly primaryLeakageCause: 'SIGNAL_DECAY' | 'LATENCY_TRANSPORT' | 'SLIPPAGE_IMPACT' | 'EXECUTION_FRICTION' | 'NONE';
  readonly recordedAt: string;
  readonly recordHash: string;
}

export class RealizedEdgeLedger {
  private readonly records: RealizedEdgeRecord[] = [];

  public append(params: {
    economicFactId: string;
    mint: string;
    stages: EdgeStages;
    feesAndTipsLamports: bigint;
    slippageAndImpactLamports: bigint;
    capitalTimeAndFrictionLamports: bigint;
  }): RealizedEdgeRecord {
    const { stages, feesAndTipsLamports, slippageAndImpactLamports, capitalTimeAndFrictionLamports } = params;

    // Calculate stage-by-stage leakage
    const predictionToDecision = stages.predictedEdgeLamports - stages.decisionEdgeLamports;
    const decisionToSubmission = stages.decisionEdgeLamports - stages.submissionEdgeLamports;
    const submissionToLanding = stages.submissionEdgeLamports - stages.landingEdgeLamports;
    const landingToSettlement = stages.landingEdgeLamports - stages.settlementEdgeLamports;
    const totalLeakage = stages.predictedEdgeLamports - stages.realizedNetEdgeLamports;

    const leakage: EdgeLeakageBreakdown = Object.freeze({
      predictionToDecisionLeakage: predictionToDecision,
      decisionToSubmissionLeakage: decisionToSubmission,
      submissionToLandingLeakage: submissionToLanding,
      landingToSettlementLeakage: landingToSettlement,
      totalEdgeLeakageLamports: totalLeakage,
    });

    // Determine primary leakage cause
    let primaryCause: RealizedEdgeRecord['primaryLeakageCause'] = 'NONE';
    if (totalLeakage > 0n) {
      if (submissionToLanding > predictionToDecision && submissionToLanding > slippageAndImpactLamports) {
        primaryCause = 'LATENCY_TRANSPORT';
      } else if (slippageAndImpactLamports > feesAndTipsLamports) {
        primaryCause = 'SLIPPAGE_IMPACT';
      } else if (predictionToDecision > 0n) {
        primaryCause = 'SIGNAL_DECAY';
      } else {
        primaryCause = 'EXECUTION_FRICTION';
      }
    }

    const attribution: RealizedEdgeDecomposition = Object.freeze({
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

    const record: RealizedEdgeRecord = Object.freeze({
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

  public all(): readonly RealizedEdgeRecord[] {
    return Object.freeze([...this.records]);
  }

  public count(): number {
    return this.records.length;
  }
}

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

export interface ComprehensiveEdgeBreakdown {
  readonly signalEdgeLamports: bigint;
  readonly temporalDecayLamports: bigint;
  readonly decisionLatencyLossLamports: bigint;
  readonly buildLatencyLossLamports: bigint;
  readonly routingEdgeLamports: bigint;
  readonly leaderEdgeLamports: bigint;
  readonly liquidityChangeLamports: bigint;
  readonly priceImpactLamports: bigint;
  readonly slippageLamports: bigint;
  readonly baseFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly tipLamports: bigint;
  readonly failureCostLamports: bigint;
  readonly capitalLockCostLamports: bigint;
  readonly netRealizedEdgeLamports: bigint;
}

export interface RealizedEdgeRecord {
  readonly recordId: string;
  readonly economicFactId: string;
  readonly mint: string;
  readonly stages: EdgeStages;
  readonly leakage: EdgeLeakageBreakdown;
  readonly attribution: RealizedEdgeDecomposition;
  readonly comprehensiveBreakdown: ComprehensiveEdgeBreakdown;
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
    routingEdgeLamports?: bigint;
    leaderEdgeLamports?: bigint;
    temporalDecayLamports?: bigint;
    decisionLatencyLossLamports?: bigint;
    buildLatencyLossLamports?: bigint;
    liquidityChangeLamports?: bigint;
    priceImpactLamports?: bigint;
    slippageLamports?: bigint;
    baseFeeLamports?: bigint;
    priorityFeeLamports?: bigint;
    tipLamports?: bigint;
    failureCostLamports?: bigint;
    capitalLockCostLamports?: bigint;
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

    const routingEdge = params.routingEdgeLamports ?? 0n;
    const leaderEdge = params.leaderEdgeLamports ?? 0n;

    const attribution: RealizedEdgeDecomposition = Object.freeze({
      signalEdgeLamports: stages.decisionEdgeLamports,
      timingEdgeLamports: -decisionToSubmission,
      routingEdgeLamports: routingEdge,
      leaderEdgeLamports: leaderEdge,
      liquidityEdgeLamports: -submissionToLanding,
      feesAndTipsLamports,
      slippageAndImpactLamports,
      capitalTimeAndFrictionLamports,
      netRealizedEdgeLamports: stages.realizedNetEdgeLamports,
    });

    const comprehensiveBreakdown: ComprehensiveEdgeBreakdown = Object.freeze({
      signalEdgeLamports: stages.decisionEdgeLamports,
      temporalDecayLamports: params.temporalDecayLamports ?? (predictionToDecision > 0n ? predictionToDecision : 0n),
      decisionLatencyLossLamports: params.decisionLatencyLossLamports ?? (decisionToSubmission / 2n),
      buildLatencyLossLamports: params.buildLatencyLossLamports ?? (decisionToSubmission - decisionToSubmission / 2n),
      routingEdgeLamports: routingEdge,
      leaderEdgeLamports: leaderEdge,
      liquidityChangeLamports: params.liquidityChangeLamports ?? (submissionToLanding > 0n ? submissionToLanding : 0n),
      priceImpactLamports: params.priceImpactLamports ?? (slippageAndImpactLamports / 2n),
      slippageLamports: params.slippageLamports ?? (slippageAndImpactLamports - slippageAndImpactLamports / 2n),
      baseFeeLamports: params.baseFeeLamports ?? 5_000n,
      priorityFeeLamports: params.priorityFeeLamports ?? (feesAndTipsLamports > 5_000n ? (feesAndTipsLamports - 5_000n) / 2n : 0n),
      tipLamports: params.tipLamports ?? (feesAndTipsLamports > 5_000n ? (feesAndTipsLamports - 5_000n) - (feesAndTipsLamports - 5_000n) / 2n : 0n),
      failureCostLamports: params.failureCostLamports ?? 0n,
      capitalLockCostLamports: params.capitalLockCostLamports ?? capitalTimeAndFrictionLamports,
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
      comprehensiveBreakdown,
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

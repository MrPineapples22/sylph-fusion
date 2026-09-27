/**
 * SOL-SYLPH Intelligence Fabric - Unified Opportunity Decision Object
 * Specifications: Master Quantitative Upgrade & Prompt Section 9.
 *
 * Provides a single, authoritative, immutable decision contract for token evaluation.
 * Synthesizes SPIE Net EV, Solaris execution feasibility, Veto safety kernels,
 * and market microstructure features into an auditable decision object.
 */

import { SpieAction, SpieEvaluation, SpieFactors, OpportunityStage } from '../spie/spie-engine.js';
import { MarketRegimeType } from '../spie/kelly-allocator.js';

export interface UnifiedOpportunityDecision {
  readonly opportunityId: string;
  readonly token: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly slot: number;
  readonly expectedValue: number;                   // Net expected value in USD
  readonly expectedNetEvBps: number;                // Net EV in basis points
  readonly confidence: number;                      // Calibrated probability (Platt scaled, 0.0 to 1.0)
  readonly uncertainty: number;                     // Conformal interval width (0.0 to 1.0)
  readonly expectedUpside: number;                  // Target gain % (e.g. 0.40 = +40%)
  readonly expectedDownside: number;                // Structural stop % (e.g. 0.12 = -12%)
  readonly liquidityQuality: number;                // Liquidity & reserve score (0.0 to 1.0)
  readonly momentumQuality: number;                 // Volume velocity & tick acceleration (0.0 to 1.0)
  readonly participationQuality: number;            // Unique buyer count & organic dispersion (0.0 to 1.0)
  readonly walletQuality: number;                   // Smart wallet presence & low Sybil cluster (0.0 to 1.0)
  readonly safetyScore: number;                     // Aggregate safety score (0 to 100)
  readonly rugProbability: number;                  // Estimated rug / pull probability (0.0 to 1.0)
  readonly manipulationProbability: number;         // Wash trading / bundling signal (0.0 to 1.0)
  readonly executionQuality: number;                // Spread, depth, and confirmation feasibility (0.0 to 1.0)
  readonly expectedSlippageBps: number;             // Model-estimated slippage for order size
  readonly expectedTransactionCostLamports: bigint; // Combined base fee + priority fee + Jito tip
  readonly marketRegime: MarketRegimeType;
  readonly opportunityWindowMs: number;             // Valid execution half-life (default 4000ms)
  readonly invalidationCondition: string;           // Explicit criteria that revokes this decision
  readonly recommendedMaxRiskUsd: number;           // Capital allocation budget for this trade
  readonly reasonsForAcceptance: readonly string[]; // Evidence justifying acceptance
  readonly reasonsForRejection: readonly string[];  // Blocking criteria or risk vetoes
  readonly stage: OpportunityStage;
  readonly actionRecommendation: SpieAction;
  readonly dominantFactor: string;
  readonly limitingConstraint: string;
}

export class UnifiedDecisionBuilder {
  public static fromSpieEvaluation(
    opportunityId: string,
    slot: number,
    evalResult: SpieEvaluation,
    options?: {
      uncertainty?: number;
      expectedUpside?: number;
      expectedDownside?: number;
      manipulationProbability?: number;
      expectedSlippageBps?: number;
      expectedTransactionCostLamports?: bigint;
      marketRegime?: MarketRegimeType;
      opportunityWindowMs?: number;
      recommendedMaxRiskUsd?: number;
      customInvalidation?: string;
    }
  ): UnifiedOpportunityDecision {
    const reasonsForAcceptance: string[] = [];
    const reasonsForRejection: string[] = [];

    if (evalResult.actionRecommendation === 'FAST_BUY' || evalResult.actionRecommendation === 'BREAKOUT_ENTER') {
      reasonsForAcceptance.push(`Positive Net EV (+${evalResult.netExpectedEvBps} bps) exceeds hurdle`);
      reasonsForAcceptance.push(`Strong dominant factor: ${evalResult.dominantPositiveFactor}`);
      reasonsForAcceptance.push(`Opportunity score: ${evalResult.opportunityScore}/100`);
    } else if (evalResult.actionRecommendation === 'ABSTAIN') {
      reasonsForRejection.push(evalResult.abstainReason || 'Friction or risk bounds exceeded');
      reasonsForRejection.push(`Limiting constraint: ${evalResult.dominantNegativeConstraint}`);
    }

    const stageMapping: Record<string, OpportunityStage> = {
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
      expectedTransactionCostLamports: options?.expectedTransactionCostLamports ?? 150_000n,
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

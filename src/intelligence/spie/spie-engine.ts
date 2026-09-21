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

export type OpportunityStage =
  | 'WATCH'
  | 'DEVELOPING'
  | 'QUALIFIED'
  | 'HIGH_CONFIDENCE'
  | 'READY'
  | 'ENTERED'
  | 'INVALIDATED'
  | 'EXITING'
  | 'CLOSED';

export type SpieAction =
  | 'FAST_BUY'
  | 'SLOW_BUY'
  | 'PULLBACK_WAIT'
  | 'BREAKOUT_ENTER'
  | 'ABSTAIN'
  | 'EXIT';

export interface SpieFactors {
  readonly tokenQuality: number;          // Q: 0.0 to 1.0 (Authority, code, lock)
  readonly momentum: number;              // M: 0.0 to 1.0 (Volume velocity, tick acceleration)
  readonly liquidityDepth: number;        // L: 0.0 to 1.0 (SOL reserves, 2%/5% depth)
  readonly participation: number;         // P: 0.0 to 1.0 (Unique buyers, organic flow)
  readonly walletQuality: number;         // W: 0.0 to 1.0 (Smart wallet presence, low cluster)
  readonly safety: number;                // S: 0.0 to 1.0 (RugCheck, zero creator dump)
  readonly executionFeasibility: number;  // E: 0.0 to 1.0 (Spread, slippage model, network congestion)
  readonly regimeCompatibility: number;   // R: 0.0 to 1.0 (Solana macro market state)
  readonly timing: number;                // T: 0.0 to 1.0 (Pullback completion, seller exhaustion)
}

export interface SpieInputCandidate {
  readonly mint: string;
  readonly symbol?: string;
  readonly realSolReserve: number;
  readonly factors: Partial<SpieFactors>;
  readonly targetUpsidePct?: number;      // e.g. 0.40 (+40%)
  readonly structuralStopPct?: number;    // e.g. 0.12 (-12%)
  readonly modeledSlippageBps?: number;
  readonly priceImpactBps?: number;
  readonly priorityFeeBps?: number;
  readonly jitoTipBps?: number;
  readonly adverseSelectionBps?: number;
  readonly rugProbability?: number;       // 0.0 to 1.0
  readonly isDevSold?: boolean;
  readonly isCurveComplete?: boolean;
}

export interface SpieEvaluation {
  readonly mint: string;
  readonly symbol: string;
  readonly pTarget: number;               // Calibrated probability of reaching upside target
  readonly pStop: number;                 // Calibrated probability of stop loss (1 - pTarget)
  readonly grossExpectedUpsideBps: number;
  readonly modeledDownsideBps: number;
  readonly grossAlphaBps: number;
  readonly executionFrictionBps: number;
  readonly tailRiskPenaltyBps: number;
  readonly netExpectedEvBps: number;
  readonly opportunityScore: number;      // 0 to 100
  readonly opportunityStage: OpportunityStage;
  readonly actionRecommendation: SpieAction;
  readonly abstainReason?: string;
  readonly factors: SpieFactors;
  readonly dominantPositiveFactor: string;
  readonly dominantNegativeConstraint: string;
  readonly frictionToGrossRatio: number;
  readonly timestamp: number;
}

// Weights across the 9 orthogonal factors (Sum = 1.00)
export const FACTOR_WEIGHTS: Record<keyof SpieFactors, number> = {
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
  private readonly minRealSolFloor: number = 1.0;
  private readonly maxFrictionRatio: number = 0.45; // Max 45% friction rule
  private readonly defaultTargetUpsidePct: number = 0.40; // +40%
  private readonly defaultStructuralStopPct: number = 0.12; // -12%

  /**
   * Evaluates a single candidate opportunity and computes its calibrated Net EV.
   */
  public evaluate(candidate: SpieInputCandidate): SpieEvaluation {
    const timestamp = Date.now();
    const symbol = candidate.symbol || candidate.mint.slice(0, 6).toUpperCase();

    // 1. Sanitize and normalize factors into [0.0, 1.0]
    const factors: SpieFactors = {
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
      const val = factors[key as keyof SpieFactors];
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
      compositeZ += factors[key as keyof SpieFactors] * weight;
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
    let actionRecommendation: SpieAction = 'ABSTAIN';
    let abstainReason: string | undefined;
    let opportunityStage: OpportunityStage = 'WATCH';

    if (candidate.isDevSold) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = 'CREATOR_SELL_DETECTED: Dev dumped on active curve';
      opportunityStage = 'INVALIDATED';
    } else if (candidate.isCurveComplete) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = 'CURVE_COMPLETED: Bonding curve migrated to DEX AMM';
      opportunityStage = 'CLOSED';
    } else if (candidate.realSolReserve < this.minRealSolFloor) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = `RESERVE_INSUFFICIENT: Real SOL reserves (${candidate.realSolReserve.toFixed(2)} SOL) < 1.0 SOL floor`;
      opportunityStage = 'WATCH';
    } else if (grossAlphaBps <= 0) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = `NEGATIVE_GROSS_ALPHA: Modeled gross edge (${grossAlphaBps} BPS) is non-positive`;
      opportunityStage = 'DEVELOPING';
    } else if (frictionToGrossRatio > this.maxFrictionRatio) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = `EXCESSIVE_FRICTION: Execution cost (${executionFrictionBps} BPS) exceeds ${(this.maxFrictionRatio * 100).toFixed(0)}% of gross alpha (${grossAlphaBps} BPS, ratio: ${(frictionToGrossRatio * 100).toFixed(1)}%)`;
      opportunityStage = 'DEVELOPING';
    } else if (netExpectedEvBps <= 0) {
      actionRecommendation = 'ABSTAIN';
      abstainReason = `NEGATIVE_NET_EV: Net Expected Value (${netExpectedEvBps} BPS) is non-positive after friction and tail risk`;
      opportunityStage = 'DEVELOPING';
    } else {
      // Eligible opportunity! Determine stage and action
      if (netExpectedEvBps >= 400 && compositeZ >= 0.80) {
        opportunityStage = 'READY';
        actionRecommendation = factors.timing >= 0.75 ? 'FAST_BUY' : 'PULLBACK_WAIT';
      } else if (netExpectedEvBps >= 250 && compositeZ >= 0.70) {
        opportunityStage = 'HIGH_CONFIDENCE';
        actionRecommendation = factors.timing >= 0.70 ? 'SLOW_BUY' : 'PULLBACK_WAIT';
      } else if (netExpectedEvBps >= 100) {
        opportunityStage = 'QUALIFIED';
        actionRecommendation = 'SLOW_BUY';
      } else {
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
  public rankOpportunities(candidates: readonly SpieInputCandidate[]): readonly SpieEvaluation[] {
    return candidates
      .map(c => this.evaluate(c))
      .sort((a, b) => b.netExpectedEvBps - a.netExpectedEvBps || b.opportunityScore - a.opportunityScore);
  }

  private clamp(val: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(val) ? val : 0.5));
  }
}

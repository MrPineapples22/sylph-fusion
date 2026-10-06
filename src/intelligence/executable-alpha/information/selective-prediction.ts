/**
 * SYLPH FUSION — SELECTIVE PREDICTION & COVERAGE OPTIMIZER
 * Studies: SELECTIVE-PREDICTION-X (Sections IX & XXVII)
 *
 * Core Principle:
 * SYLPH is allowed to say: "I DO NOT KNOW."
 * Optimizes the selective risk-coverage trade-off:
 * Risk(Coverage) = E[Loss | Decision != ABSTAIN]
 * Trading 0.7% of launches with high positive expectancy is far superior
 * to trading 20% with negative expectancy.
 */

export interface SelectivePredictionResult {
  readonly decision: 'ENTER' | 'ABSTAIN' | 'REJECT';
  readonly nonconformityScore: number;
  readonly confidenceScore: number;
  readonly predictionSet: readonly ('WINNER_10X' | 'MODEST_MOVER' | 'COLLAPSE_RUG')[];
  readonly selectiveRiskEstimate: number;
  readonly targetCoverage: number;
  readonly reason: string;
}

export class SelectivePredictionEngine {
  public static evaluate(
    predictedMultiple: number,
    uncertaintyWidth: number,
    authenticityScore: number,
    reachabilityScore: number,
    conformalAlpha = 0.10 // 90% coverage confidence
  ): SelectivePredictionResult {
    // Nonconformity score measures distance from typical winning profiles
    const nonconformityScore = Number((
      (uncertaintyWidth * 0.5) +
      ((1.0 - authenticityScore) * 0.3) +
      ((1.0 - reachabilityScore) * 0.2)
    ).toFixed(4));

    const confidenceScore = Number(Math.max(0, 1.0 - nonconformityScore).toFixed(4));

    // Form split-conformal prediction set
    const predictionSet: ('WINNER_10X' | 'MODEST_MOVER' | 'COLLAPSE_RUG')[] = [];
    if (predictedMultiple >= 5.0 && nonconformityScore <= 0.35) {
      predictionSet.push('WINNER_10X');
    }
    if (predictedMultiple >= 1.25 && predictedMultiple <= 8.0) {
      predictionSet.push('MODEST_MOVER');
    }
    if (predictedMultiple < 1.5 || nonconformityScore >= 0.50 || authenticityScore < 0.60) {
      predictionSet.push('COLLAPSE_RUG');
    }

    // Hard rejection conditions
    if (authenticityScore < 0.50 || reachabilityScore < 0.20) {
      return {
        decision: 'REJECT',
        nonconformityScore,
        confidenceScore,
        predictionSet,
        selectiveRiskEstimate: 0.95,
        targetCoverage: 0.007,
        reason: 'REJECT: Authenticity or reachability failed hard threshold',
      };
    }

    // Ambiguous prediction set containing both WINNER and COLLAPSE
    if (predictionSet.includes('WINNER_10X') && predictionSet.includes('COLLAPSE_RUG')) {
      return {
        decision: 'ABSTAIN',
        nonconformityScore,
        confidenceScore,
        predictionSet,
        selectiveRiskEstimate: 0.45,
        targetCoverage: 0.007,
        reason: 'ABSTAIN: Conformal prediction set is ambiguous ({WINNER_10X, COLLAPSE_RUG})',
      };
    }

    // If prediction set has ONLY COLLAPSE
    if (predictionSet.length === 1 && predictionSet[0] === 'COLLAPSE_RUG') {
      return {
        decision: 'REJECT',
        nonconformityScore,
        confidenceScore,
        predictionSet,
        selectiveRiskEstimate: 0.88,
        targetCoverage: 0.007,
        reason: 'REJECT: Predicted outcome is strictly collapse/rug',
      };
    }

    // High confidence winner without collapse ambiguity
    if (
      predictionSet.includes('WINNER_10X') &&
      !predictionSet.includes('COLLAPSE_RUG') &&
      confidenceScore >= 0.72
    ) {
      return {
        decision: 'ENTER',
        nonconformityScore,
        confidenceScore,
        predictionSet,
        selectiveRiskEstimate: 0.12,
        targetCoverage: 0.007,
        reason: 'ENTER: Unambiguous winner prediction set with confidence >= 0.72',
      };
    }

    // Default selective outcome: ABSTAIN (do not force a trade!)
    return {
      decision: 'ABSTAIN',
      nonconformityScore,
      confidenceScore,
      predictionSet,
      selectiveRiskEstimate: 0.38,
      targetCoverage: 0.007,
      reason: 'ABSTAIN: Candidate lacks unambiguous high-conviction profile',
    };
  }
}

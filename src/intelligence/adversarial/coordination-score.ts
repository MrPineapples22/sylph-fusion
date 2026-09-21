/**
 * SOL-SYLPH Intelligence Fabric - Temporal Coordination Score Engine
 * Specifications: Major Update #2 (Section 8: Temporal Coordination Score).
 *
 * Rules:
 * 1. Build transparent coordination scoring from entry timing, lot sizing, and funding ancestry.
 * 2. High coordination does not mean guaranteed malicious, but flags synthetic volume and Sybils.
 */

export interface BuyerTradeObservation {
  readonly buyerAddress: string;
  readonly timestampMs: number;
  readonly amountSol: number;
  readonly parentFundingAddress?: string;
}

export interface CoordinationEvaluation {
  readonly coordinationScore: number; // 0.0 (fully independent) to 1.0 (highly coordinated)
  readonly isSyntheticClusterLikely: boolean;
  readonly timingSpreadMs: number;
  readonly sizeVariance: number;
  readonly fundingAncestorOverlapPct: number;
  readonly confidence: number;
}

export class CoordinationScoreEngine {
  /**
   * Evaluate temporal and structural coordination across a batch of buyer trades.
   */
  public evaluateCoordination(trades: readonly BuyerTradeObservation[]): CoordinationEvaluation {
    if (trades.length < 2) {
      return {
        coordinationScore: 0.0,
        isSyntheticClusterLikely: false,
        timingSpreadMs: 0,
        sizeVariance: 1.0,
        fundingAncestorOverlapPct: 0,
        confidence: 0.2,
      };
    }

    // 1. Timing Dispersion
    const timestamps = trades.map((t) => t.timestampMs);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timingSpreadMs = maxTime - minTime;

    // Clustering in < 500ms is a strong coordination indicator
    const timingScore = timingSpreadMs < 500 ? 0.9 : timingSpreadMs < 2000 ? 0.5 : 0.1;

    // 2. Trade Size Variance
    const sizes = trades.map((t) => t.amountSol);
    const meanSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const variance = sizes.reduce((acc, s) => acc + Math.pow(s - meanSize, 2), 0) / sizes.length;

    // Identical sizing (e.g. all 0.50 SOL) has variance near 0
    const sizeUniformityScore = variance < 0.005 ? 0.85 : variance < 0.05 ? 0.5 : 0.1;

    // 3. Funding Ancestor Overlap
    const funders = trades.map((t) => t.parentFundingAddress).filter((f): f is string => !!f);
    const uniqueFunders = new Set(funders);
    const fundingOverlapPct = funders.length > 0 ? ((funders.length - uniqueFunders.size) / funders.length) * 100 : 0;
    const fundingScore = fundingOverlapPct >= 50 ? 0.95 : fundingOverlapPct > 0 ? 0.5 : 0.0;

    // Weighted Coordination Score
    const rawScore = timingScore * 0.35 + sizeUniformityScore * 0.35 + fundingScore * 0.3;
    const coordinationScore = Number(Math.max(0, Math.min(1.0, rawScore)).toFixed(3));

    const isSyntheticCluster = coordinationScore >= 0.7;

    return {
      coordinationScore,
      isSyntheticClusterLikely: isSyntheticCluster,
      timingSpreadMs,
      sizeVariance: Number(variance.toFixed(4)),
      fundingAncestorOverlapPct: Number(fundingOverlapPct.toFixed(1)),
      confidence: Math.min(1.0, 0.4 + trades.length * 0.05),
    };
  }
}

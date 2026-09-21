/**
 * SOL-SYLPH Intelligence Fabric - Liquidity Depth & Price Impact Engine
 * Specifications: Major Update #4 (Market Microstructure Intelligence).
 *
 * Rules:
 * 1. Replace naive displayed liquidity with executable liquidity depth curves.
 * 2. Calculate PriceImpact(size) across standard trade tranches.
 * 3. Model constant-product bonding curve slippage non-linearly.
 */

export interface TrancheImpact {
  readonly sizeSol: number;
  readonly priceImpactBps: number;
  readonly expectedEffectivePriceLamports: bigint;
  readonly executableCapacityRemainingSol: number;
}

export interface LiquidityDepthProfile {
  readonly poolSolReserves: number;
  readonly virtualTokenReserves: bigint;
  readonly tranches: readonly TrancheImpact[];
  readonly maxSafePositionSol: number; // Max size before slippage exceeds 250 bps (2.5%)
  readonly evaluatedAtMs: number;
}

export class LiquidityDepthEngine {
  /**
   * Compute liquidity depth and price impact across standard trade sizes.
   */
  public calculateDepth(
    poolSolReserves: number,
    virtualTokenReserves = 1_000_000_000_000n,
    tranchesToEvaluate: readonly number[] = [0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
  ): LiquidityDepthProfile {
    const tranches: TrancheImpact[] = [];
    let maxSafePositionSol = 0;

    for (const size of tranchesToEvaluate) {
      // Non-linear price impact: deltaSol / (poolSolReserves + deltaSol)
      const denominator = poolSolReserves + size;
      const impactRatio = denominator > 0 ? size / denominator : 1.0;
      const priceImpactBps = Math.round(impactRatio * 10_000);

      // Effective price scaled by impact
      const basePrice = poolSolReserves > 0 ? Number(virtualTokenReserves) / (poolSolReserves * 1e9) : 0;
      const effectivePrice = Math.round(basePrice * (1.0 + impactRatio));

      const executableRemaining = Math.max(0, poolSolReserves * 0.15 - size);

      if (priceImpactBps <= 250) {
        maxSafePositionSol = Math.max(maxSafePositionSol, size);
      }

      tranches.push({
        sizeSol: size,
        priceImpactBps,
        expectedEffectivePriceLamports: BigInt(effectivePrice),
        executableCapacityRemainingSol: Number(executableRemaining.toFixed(3)),
      });
    }

    return {
      poolSolReserves,
      virtualTokenReserves,
      tranches,
      maxSafePositionSol,
      evaluatedAtMs: Date.now(),
    };
  }
}

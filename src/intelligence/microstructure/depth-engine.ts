import { createHash } from 'node:crypto';

/**
 * SOL-SYLPH Intelligence Fabric - Liquidity Depth & Price Impact Engine
 * Specifications: Major Update #4 (Market Microstructure Intelligence) & Blueprint Section 16, 28.
 *
 * Epistemic & Mathematical Invariants:
 * 1. Non-linear Price Impact: deltaSol / (poolSolReserves + deltaSol) modeled across discrete tranches.
 * 2. Monotonicity Invariant: for any tranche size s1 < s2, PriceImpact(s1) <= PriceImpact(s2).
 * 3. Capacity Depletion Bound: executable capacity cannot exceed 15% of poolSolReserves without catastrophic slippage.
 * 4. AMM Route Calibration: routes are dynamically chosen based on reserve regime (Bonding Curve, Raydium, Meteora DLMM, Orca Whirlpool).
 * 5. Fail-Closed Resilience: reserves <= 1.0 SOL or 0.5 SOL impact > 500 bps triggers isDepthCollapsed = true.
 */

export type AMMRouteType =
  | 'DIRECT_BONDING_CURVE'
  | 'SPL_POOL_RAYDIUM'
  | 'METEORA_DLMM'
  | 'WHIRLPOOL_ORCA';

export interface TrancheImpact {
  readonly sizeSol: number;
  readonly priceImpactBps: number;
  readonly expectedEffectivePriceLamports: bigint;
  readonly executableCapacityRemainingSol: number;
  readonly marginalImpactBpsPerSol: number;
  readonly routeRecommended: AMMRouteType;
  readonly isSafeTranche: boolean;
}

export interface LiquidityDepthProfile {
  readonly poolSolReserves: number;
  readonly virtualTokenReserves: bigint;
  readonly tranches: readonly TrancheImpact[];
  readonly maxSafePositionSol: number; // Max size before slippage exceeds 250 bps (2.5%)
  readonly depthResilienceScore: number; // 0.0 - 1.0 (resilience under trade flow)
  readonly isDepthCollapsed: boolean; // poolSolReserves < 1.0 || maxSafePositionSol < 0.25 || impact > 500 bps at 0.5 SOL
  readonly calibratedRoute: AMMRouteType;
  readonly profileHash: string; // Deterministic SHA-256 profile fingerprint
  readonly reserveDepletionRatio: number; // Fraction of pool consumed by max evaluated tranche
  readonly evaluatedAtMs: number;
}

/**
 * Apply the already-computed depth gate without promoting missing or malformed
 * target sizes into an executable decision. Kept pure so its boundary is testable.
 */
export function isLiquidityDepthGateBlocked(profile: LiquidityDepthProfile, targetTradeSizeSol: number): boolean {
  if (!Number.isFinite(targetTradeSizeSol) || targetTradeSizeSol < 0) return true;
  return profile.isDepthCollapsed || profile.maxSafePositionSol < targetTradeSizeSol;
}

export class LiquidityDepthEngine {
  /**
   * Calibrate the optimal AMM execution route based on pool reserve volume and liquidity regime.
   */
  public calibrateAmmRoute(poolSolReserves: number, preferredRoute?: AMMRouteType): AMMRouteType {
    if (preferredRoute) {
      return preferredRoute;
    }
    if (poolSolReserves <= 85.0) {
      return 'DIRECT_BONDING_CURVE';
    }
    if (poolSolReserves <= 250.0) {
      return 'SPL_POOL_RAYDIUM';
    }
    if (poolSolReserves <= 500.0) {
      return 'METEORA_DLMM';
    }
    return 'WHIRLPOOL_ORCA';
  }

  /**
   * Estimate non-linear price impact in basis points for an arbitrary size.
   */
  public estimateExecutionSlippageBps(sizeSol: number, poolSolReserves: number): number {
    if (poolSolReserves <= 0 || !Number.isFinite(poolSolReserves)) {
      return 10_000;
    }
    if (sizeSol <= 0) {
      return 0;
    }
    const denominator = poolSolReserves + sizeSol;
    const impactRatio = denominator > 0 ? sizeSol / denominator : 1.0;
    return Math.min(10_000, Math.round(impactRatio * 10_000));
  }

  /**
   * Evaluate whether a specific trade size is safe under a maximum allowed impact threshold (default 250 bps).
   */
  public evaluateTrancheSafety(
    sizeSol: number,
    poolSolReserves: number,
    maxAllowedImpactBps = 250
  ): { isSafe: boolean; impactBps: number } {
    const impactBps = this.estimateExecutionSlippageBps(sizeSol, poolSolReserves);
    return {
      isSafe: impactBps <= maxAllowedImpactBps,
      impactBps,
    };
  }

  /**
   * Compute liquidity depth profile and price impact curve across standard trade sizes.
   */
  public calculateDepth(
    poolSolReserves: number,
    virtualTokenReserves = 1_000_000_000_000n,
    tranchesToEvaluate: readonly number[] = [0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    preferredRoute?: AMMRouteType
  ): LiquidityDepthProfile {
    if (!Number.isFinite(poolSolReserves) || poolSolReserves < 0) {
      throw new RangeError(`Invalid poolSolReserves: must be a non-negative finite number (got ${poolSolReserves})`);
    }
    if (virtualTokenReserves < 0n) {
      throw new RangeError(`Invalid virtualTokenReserves: must be a non-negative bigint (got ${virtualTokenReserves})`);
    }

    const route = this.calibrateAmmRoute(poolSolReserves, preferredRoute);
    const tranches: TrancheImpact[] = [];
    let maxSafePositionSol = 0;
    let prevImpactBps = 0;
    let prevSize = 0;

    // Handle empty or zero reserve pool fail-closed
    if (poolSolReserves === 0) {
      for (const size of tranchesToEvaluate) {
        tranches.push({
          sizeSol: size,
          priceImpactBps: 10_000,
          expectedEffectivePriceLamports: 0n,
          executableCapacityRemainingSol: 0,
          marginalImpactBpsPerSol: 10_000,
          routeRecommended: route,
          isSafeTranche: false,
        });
      }

      const emptyHash = createHash('sha256')
        .update(`0:${virtualTokenReserves.toString()}:0:0:${route}`)
        .digest('hex');

      return {
        poolSolReserves: 0,
        virtualTokenReserves,
        tranches,
        maxSafePositionSol: 0,
        depthResilienceScore: 0.0,
        isDepthCollapsed: true,
        calibratedRoute: route,
        profileHash: emptyHash,
        reserveDepletionRatio: 1.0,
        evaluatedAtMs: Date.now(),
      };
    }

    for (const size of tranchesToEvaluate) {
      // Non-linear price impact: deltaSol / (poolSolReserves + deltaSol)
      const denominator = poolSolReserves + size;
      const impactRatio = denominator > 0 ? size / denominator : 1.0;
      const priceImpactBps = Math.min(10_000, Math.round(impactRatio * 10_000));

      // Effective price scaled by impact
      const basePrice = poolSolReserves > 0 ? Number(virtualTokenReserves) / (poolSolReserves * 1e9) : 0;
      const effectivePrice = Math.round(basePrice * (1.0 + impactRatio));

      // Maximum safe single-fill capacity (15% of pool reserves buffer)
      const executableRemaining = Math.max(0, poolSolReserves * 0.15 - size);

      // Marginal impact per SOL
      const sizeDelta = size - prevSize;
      const impactDelta = priceImpactBps - prevImpactBps;
      const marginalImpactBpsPerSol = sizeDelta > 0 ? Math.round(impactDelta / sizeDelta) : priceImpactBps;

      const isSafe = priceImpactBps <= 250;
      if (isSafe) {
        maxSafePositionSol = Math.max(maxSafePositionSol, size);
      }

      tranches.push({
        sizeSol: size,
        priceImpactBps,
        expectedEffectivePriceLamports: BigInt(effectivePrice),
        executableCapacityRemainingSol: Number(executableRemaining.toFixed(3)),
        marginalImpactBpsPerSol,
        routeRecommended: route,
        isSafeTranche: isSafe,
      });

      prevImpactBps = priceImpactBps;
      prevSize = size;
    }

    // Depth resilience score (0.0 to 1.0): normalized score where 100+ SOL reserves = 1.0, 30 SOL ~= 0.75, 5 SOL ~= 0.35
    const depthResilienceScore = Number(Math.min(1.0, Math.max(0.0, poolSolReserves / (poolSolReserves + 10.0))).toFixed(4));

    // Collapse detection
    const trancheAt05 = tranches.find((t) => t.sizeSol === 0.5) || tranches[0];
    const isDepthCollapsed =
      poolSolReserves < 1.0 ||
      maxSafePositionSol < 0.25 ||
      (trancheAt05 ? trancheAt05.priceImpactBps > 500 : false);

    const maxEvaluatedSize = tranchesToEvaluate.length > 0 ? Math.max(...tranchesToEvaluate) : 0;
    const reserveDepletionRatio = Number(Math.min(1.0, maxEvaluatedSize / (poolSolReserves + maxEvaluatedSize)).toFixed(4));

    const profileHash = createHash('sha256')
      .update(`${poolSolReserves}:${virtualTokenReserves.toString()}:${maxSafePositionSol}:${depthResilienceScore}:${route}`)
      .digest('hex');

    return {
      poolSolReserves,
      virtualTokenReserves,
      tranches,
      maxSafePositionSol,
      depthResilienceScore,
      isDepthCollapsed,
      calibratedRoute: route,
      profileHash,
      reserveDepletionRatio,
      evaluatedAtMs: Date.now(),
    };
  }
}


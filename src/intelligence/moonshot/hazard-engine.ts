/**
 * SYLPH FUSION — COMPETING-RISK HAZARD ENGINE
 * Specification: Master Blueprint Section XXVIII (Competing-Risk Hazard Engine)
 *
 * Replaces static trailing stops with dynamic competing risk hazards:
 * Expansion hazards: h_2x(t), h_5x(t), h_10x(t), h_50x(t)
 * vs
 * Failure hazards: h_rug(t), h_distribution(t), h_liquidityCollapse(t), h_death(t), h_unexitability(t)
 */

export interface RunnerHazardState {
  readonly timestampMs: number;
  readonly elapsedMs: number;
  readonly currentMultiple: number;
  // Upside hazards
  readonly h2x: number;
  readonly h5x: number;
  readonly h10x: number;
  readonly h50x: number;
  // Downside hazards
  readonly hRug: number;
  readonly hDistribution: number;
  readonly hLiquidityCollapse: number;
  readonly hDeath: number;
  readonly hUnexitability: number;
  // Net hazard ratio
  readonly netConvexHazardRatio: number;
  readonly recommendedAction: 'HOLD_CORE_RUNNER' | 'PARTIAL_DERISK' | 'FULL_EXIT_HAZARD' | 'PYRAMID_ADD';
  readonly exitFractionBps: number;
}

export class CompetingRiskRunner {
  /**
   * Computes point-in-time competing hazards for an active runner position.
   */
  public static evaluateHazards(params: {
    elapsedSeconds: number;
    currentMultiple: number;
    walletEntropy: number;
    independentCapitalAcceleration: number;
    exitDepthLamports: bigint;
    poolQuoteReservesLamports: bigint;
    coordinationDecayRate: number;
    sellerAbsorptionRate: number;
    recentPriceVelocityBps: number;
  }): RunnerHazardState {
    const t = Math.max(1, params.elapsedSeconds);
    const m = Math.max(0.1, params.currentMultiple);

    // Baseline hazard decay with time (survival baseline)
    const baseDecay = Math.exp(-t / 300);

    // 1. Expansion Hazards (h_2x, h_5x, h_10x, h_50x)
    const momentumFactor = Math.max(0, params.recentPriceVelocityBps / 100);
    const entropyBonus = Math.min(1.5, Math.max(0.5, params.walletEntropy));
    const icoaFactor = Math.min(2.0, Math.max(0.2, 1 + params.independentCapitalAcceleration));

    const h2x = m < 2.0 ? (0.4 * momentumFactor * entropyBonus * icoaFactor) / (1 + m) : 0.05;
    const h5x = m < 5.0 ? (0.25 * momentumFactor * entropyBonus * icoaFactor) / (1 + m * 0.5) : 0.03;
    const h10x = (0.15 * momentumFactor * entropyBonus * icoaFactor) / (1 + m * 0.3);
    const h50x = (0.05 * momentumFactor * entropyBonus * icoaFactor) / (1 + m * 0.2);

    // 2. Downside Hazards
    // Rug hazard: high when entropy is low or coordination decay is negative
    const hRug = Math.max(0.01, Math.min(0.95,
      (1 - Math.min(1, params.walletEntropy)) * 0.5 +
      (params.coordinationDecayRate < 0 ? 0.3 : 0.05) +
      (t < 60 ? 0.2 : 0.02)
    ));

    // Distribution hazard: high when sellers overwhelm absorption and multiple is high
    const hDistribution = Math.max(0.01, Math.min(0.95,
      (1 - params.sellerAbsorptionRate) * 0.6 +
      (m >= 5 ? 0.25 : 0.05)
    ));

    // Liquidity collapse hazard: exit capacity disappearing
    const exitReserveRatio = Number(params.exitDepthLamports) / Math.max(1, Number(params.poolQuoteReservesLamports));
    const hLiquidityCollapse = Math.max(0.01, Math.min(0.95,
      (exitReserveRatio < 0.1 ? 0.6 : 0.05) +
      (params.exitDepthLamports <= 0n ? 0.9 : 0.0)
    ));

    // Death hazard: low velocity + low volume over time
    const hDeath = Math.max(0.01, Math.min(0.95,
      (params.recentPriceVelocityBps < -50 ? 0.4 : 0.05) +
      (t > 600 && m < 1.2 ? 0.5 : 0.05)
    ));

    // Unexitability hazard: pool quote reserves cannot absorb position
    const hUnexitability = exitReserveRatio < 0.05 ? 0.85 : 0.05;

    // Total upside vs downside hazard
    const totalUpside = (m >= 10 ? h50x : m >= 5 ? h10x : m >= 2 ? h5x : h2x);
    const totalDownside = hRug * 0.35 + hDistribution * 0.25 + hLiquidityCollapse * 0.25 + hDeath * 0.10 + hUnexitability * 0.05;

    const netConvexHazardRatio = totalDownside > 0 ? totalUpside / totalDownside : totalUpside;

    let recommendedAction: RunnerHazardState['recommendedAction'] = 'HOLD_CORE_RUNNER';
    let exitFractionBps = 0;

    if (hLiquidityCollapse > 0.7 || hRug > 0.8 || hUnexitability > 0.7) {
      recommendedAction = 'FULL_EXIT_HAZARD';
      exitFractionBps = 10_000;
    } else if (netConvexHazardRatio < 0.3) {
      recommendedAction = 'PARTIAL_DERISK';
      exitFractionBps = 5_000;
    } else if (netConvexHazardRatio > 2.5 && m < 5.0 && params.walletEntropy > 1.2) {
      recommendedAction = 'PYRAMID_ADD';
      exitFractionBps = 0;
    }

    return {
      timestampMs: Date.now(),
      elapsedMs: t * 1000,
      currentMultiple: m,
      h2x: Number(h2x.toFixed(4)),
      h5x: Number(h5x.toFixed(4)),
      h10x: Number(h10x.toFixed(4)),
      h50x: Number(h50x.toFixed(4)),
      hRug: Number(hRug.toFixed(4)),
      hDistribution: Number(hDistribution.toFixed(4)),
      hLiquidityCollapse: Number(hLiquidityCollapse.toFixed(4)),
      hDeath: Number(hDeath.toFixed(4)),
      hUnexitability: Number(hUnexitability.toFixed(4)),
      netConvexHazardRatio: Number(netConvexHazardRatio.toFixed(3)),
      recommendedAction,
      exitFractionBps,
    };
  }
}

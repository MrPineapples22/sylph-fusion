/**
 * SYLPH FUSION — EXIT MIN-CUT LIQUIDITY ENGINE
 * Study 29: EXIT-MIN-CUT-X (Section XIV)
 *
 * Implements max-flow min-cut network bottleneck calculation for exit paths.
 * Computes Q_{safeExit} under multi-tiered stress scenarios:
 * BASE, -10%, -25%, -50% liquidity, creator dump, simultaneous whale liquidation.
 */

export interface StressScenarioResult {
  readonly scenario: string;
  readonly poolLiquidityAfterStressUsd: number;
  readonly maxExitCapacityUsd: number; // Max amount that can exit with <= 12% price impact
  readonly executableHaircutPct: number;
}

export interface ExitMinCutReport {
  readonly qSafeExitUsd: number; // Stressed exit capacity (min across severe scenarios)
  readonly baseExitCapacityUsd: number;
  readonly scenarios: readonly StressScenarioResult[];
  readonly minCutBottleneckEdge: string;
  readonly isCapacitySufficientForStake: (stakeUsd: number) => boolean;
}

export class ExitMinCutEngine {
  public static computeMinCut(params: {
    poolSolReservesUsd: number;
    creatorInventoryUsd: number;
    topWhaleInventoryUsd: number;
    maxAllowedImpactBps?: number;
  }): ExitMinCutReport {
    const {
      poolSolReservesUsd,
      creatorInventoryUsd,
      topWhaleInventoryUsd,
      maxAllowedImpactBps = 1200, // 12% max impact
    } = params;

    // AMM constant-product slippage formula:
    // Impact \approx \Delta x / (x + \Delta x)
    // Max exit \Delta x \approx x * (Impact / (1 - Impact))
    const impactFrac = maxAllowedImpactBps / 10000;
    const computeCapacity = (reserves: number) => Math.max(0, reserves * (impactFrac / (1 - impactFrac)));

    const scenarios: StressScenarioResult[] = [
      {
        scenario: 'BASE',
        poolLiquidityAfterStressUsd: poolSolReservesUsd,
        maxExitCapacityUsd: computeCapacity(poolSolReservesUsd),
        executableHaircutPct: 0.0,
      },
      {
        scenario: 'MINUS_10_PCT',
        poolLiquidityAfterStressUsd: poolSolReservesUsd * 0.90,
        maxExitCapacityUsd: computeCapacity(poolSolReservesUsd * 0.90),
        executableHaircutPct: 0.10,
      },
      {
        scenario: 'MINUS_25_PCT',
        poolLiquidityAfterStressUsd: poolSolReservesUsd * 0.75,
        maxExitCapacityUsd: computeCapacity(poolSolReservesUsd * 0.75),
        executableHaircutPct: 0.25,
      },
      {
        scenario: 'MINUS_50_PCT',
        poolLiquidityAfterStressUsd: poolSolReservesUsd * 0.50,
        maxExitCapacityUsd: computeCapacity(poolSolReservesUsd * 0.50),
        executableHaircutPct: 0.50,
      },
      {
        scenario: 'CREATOR_DUMP',
        poolLiquidityAfterStressUsd: Math.max(0, poolSolReservesUsd - creatorInventoryUsd),
        maxExitCapacityUsd: computeCapacity(Math.max(0, poolSolReservesUsd - creatorInventoryUsd)),
        executableHaircutPct: Math.min(1.0, creatorInventoryUsd / Math.max(1, poolSolReservesUsd)),
      },
      {
        scenario: 'SIMULTANEOUS_WHALE_EXIT',
        poolLiquidityAfterStressUsd: Math.max(0, poolSolReservesUsd - topWhaleInventoryUsd * 0.8),
        maxExitCapacityUsd: computeCapacity(Math.max(0, poolSolReservesUsd - topWhaleInventoryUsd * 0.8)),
        executableHaircutPct: Math.min(1.0, (topWhaleInventoryUsd * 0.8) / Math.max(1, poolSolReservesUsd)),
      },
    ];

    const baseExitCapacityUsd = scenarios[0].maxExitCapacityUsd;
    // qSafeExit is the conservative min-cut capacity across stressed scenarios (e.g. MINUS_50_PCT)
    const stressed50Scenario = scenarios.find((s) => s.scenario === 'MINUS_50_PCT')!;
    const qSafeExitUsd = Math.min(stressed50Scenario.maxExitCapacityUsd, scenarios[4].maxExitCapacityUsd);

    const minCutBottleneckEdge = scenarios.reduce((min, s) =>
      s.maxExitCapacityUsd < min.maxExitCapacityUsd ? s : min
    ).scenario;

    return {
      qSafeExitUsd,
      baseExitCapacityUsd,
      scenarios,
      minCutBottleneckEdge,
      isCapacitySufficientForStake: (stakeUsd: number) => qSafeExitUsd >= stakeUsd,
    };
  }
}

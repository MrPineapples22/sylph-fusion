/**
 * SYLPH FUSION — PATHWAY BOTTLENECK ENGINE
 * Study 19: PATHWAY-BOTTLENECK-X (Section XII)
 *
 * Identifies the kinetic and geometric bottlenecks along the runner path.
 * Pinpoints the bottleneck surface \Sigma^* that minimizes reactive flux capacity.
 */

export interface BottleneckAnalysis {
  readonly activationBarrierEnergy: number; // Dimensionless \Delta F^* / k_B T
  readonly bottleneckSurfaceLocation: string; // e.g., '2.5X_CREATOR_DUMP_HORIZON'
  readonly transmissionCoefficient: number; // Fraction of trajectories that successfully cross [0, 1]
  readonly isPathwayChoked: boolean;
  readonly recommendedAction: 'PROCEED' | 'HALT_BEFORE_BARRIER' | 'REQUIRE_FRESH_CAPITAL_SURGE';
}

export class PathwayBottleneckEngine {
  public static analyzeBottlenecks(params: {
    dtfScore: number;
    creatorRemainingPct: number;
    topHoldersConcentrationPct: number;
    bondingCurveProgressPct?: number;
    poolLiquidityUsd: number;
  }): BottleneckAnalysis {
    const {
      dtfScore,
      creatorRemainingPct,
      topHoldersConcentrationPct,
      bondingCurveProgressPct = 50,
      poolLiquidityUsd,
    } = params;

    // Estimate free energy barrier height: higher concentration & DTF increase barrier
    const barrier =
      1.5 +
      (dtfScore * 3.5) +
      (creatorRemainingPct * 4.0) +
      (topHoldersConcentrationPct * 2.5) +
      (poolLiquidityUsd < 5000 ? 2.0 : 0.0);

    // Eyring-Polanyi transmission coefficient: \kappa = exp(-\Delta F^*)
    const transmissionCoefficient = Math.exp(-Math.min(10, barrier) / 2.0);
    const isPathwayChoked = barrier > 4.5 || transmissionCoefficient < 0.10;

    let bottleneckLoc = 'MID_CURVE_LIQUIDITY_SINK';
    if (creatorRemainingPct > 0.05) {
      bottleneckLoc = 'CREATOR_EXIT_OVERHANG';
    } else if (bondingCurveProgressPct > 80 && bondingCurveProgressPct < 95) {
      bottleneckLoc = 'PRE_MIGRATION_FREEZE_BARRIER';
    } else if (dtfScore > 0.60) {
      bottleneckLoc = 'MOMENTUM_EXHAUSTION_FREEFALL';
    }

    let recommendedAction: BottleneckAnalysis['recommendedAction'] = 'PROCEED';
    if (isPathwayChoked) {
      recommendedAction = 'HALT_BEFORE_BARRIER';
    } else if (barrier > 3.0) {
      recommendedAction = 'REQUIRE_FRESH_CAPITAL_SURGE';
    }

    return {
      activationBarrierEnergy: barrier,
      bottleneckSurfaceLocation: bottleneckLoc,
      transmissionCoefficient,
      isPathwayChoked,
      recommendedAction,
    };
  }
}

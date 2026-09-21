/**
 * KEPLER: Multidimensional Trajectory Engine
 * Blueprint Engine #10
 * 
 * Models market movements across multiple dimensions:
 * Price, Liquidity, MCAP, Velocity, Pressure, Buyer Growth, Volume, Concentration.
 * Computes: Direction, Velocity, Acceleration, Curvature, Persistence.
 * Archetypes:
 * ORGANIC_EXPANSION | STEALTH_ACCUMULATION | BREAKOUT | PARABOLIC_EXPANSION |
 * FOMO_EXHAUSTION | DISTRIBUTION_ARC | FALSE_BREAKOUT | COLLAPSE | REVIVAL.
 */

export type KeplerTrajectoryArchetype = 
  | 'ORGANIC_EXPANSION'
  | 'STEALTH_ACCUMULATION'
  | 'BREAKOUT'
  | 'PARABOLIC_EXPANSION'
  | 'FOMO_EXHAUSTION'
  | 'DISTRIBUTION_ARC'
  | 'FALSE_BREAKOUT'
  | 'COLLAPSE'
  | 'REVIVAL'
  | 'STAGNANT';

export interface KeplerTrajectoryPoint {
  readonly timestamp_ms: number;
  readonly price_sol: number;
  readonly liquidity_sol: number;
  readonly volume_sol: number;
  readonly buy_pressure: number; // 0.0 to 1.0
  readonly unique_buyers: number;
}

export interface KeplerTrajectoryResult {
  readonly token_mint: string;
  readonly archetype: KeplerTrajectoryArchetype;
  readonly velocity: number;        // Rate of price change (% / min)
  readonly acceleration: number;    // Rate of velocity change
  readonly curvature: number;       // Angle/bend of trajectory path
  readonly persistence: number;     // 0.0 to 1.0 directional consistency
  readonly trajectory_efficiency: number; // Ratio of net displacement to total path length
  readonly evaluated_at_ms: number;
}

export class KeplerTrajectoryEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Computes trajectory dynamics from a time series of trajectory points.
   */
  public static evaluateTrajectory(
    tokenMint: string,
    points: readonly KeplerTrajectoryPoint[]
  ): KeplerTrajectoryResult {
    if (!points || points.length < 2) {
      return {
        token_mint: tokenMint,
        archetype: 'STAGNANT',
        velocity: 0,
        acceleration: 0,
        curvature: 0,
        persistence: 0,
        trajectory_efficiency: 0,
        evaluated_at_ms: Date.now()
      };
    }

    const first = points[0];
    const last = points[points.length - 1];
    const durationMinutes = Math.max(0.1, (last.timestamp_ms - first.timestamp_ms) / 60000);

    // Velocity = % price change per minute
    const netReturnPct = first.price_sol > 0 ? ((last.price_sol - first.price_sol) / first.price_sol) * 100 : 0;
    const velocity = netReturnPct / durationMinutes;

    // Split points into two halves to compute acceleration
    const midIdx = Math.floor(points.length / 2);
    const mid = points[midIdx];
    const v1 = ((mid.price_sol - first.price_sol) / (first.price_sol || 1)) / Math.max(0.05, (mid.timestamp_ms - first.timestamp_ms) / 60000);
    const v2 = ((last.price_sol - mid.price_sol) / (mid.price_sol || 1)) / Math.max(0.05, (last.timestamp_ms - mid.timestamp_ms) / 60000);
    const acceleration = v2 - v1;

    // Trajectory efficiency: net displacement / sum of absolute segment moves
    let pathLength = 0;
    let positiveSegments = 0;
    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].price_sol - points[i - 1].price_sol);
      pathLength += diff;
      if (points[i].price_sol >= points[i - 1].price_sol) {
        positiveSegments++;
      }
    }
    const netDisplacement = Math.abs(last.price_sol - first.price_sol);
    const efficiency = pathLength > 0 ? Math.min(1.0, netDisplacement / pathLength) : 0;
    const persistence = points.length > 1 ? positiveSegments / (points.length - 1) : 0.5;

    // Curvature: normalized divergence between linear fit and path
    const curvature = Math.min(1.0, Math.abs(acceleration) / (Math.abs(velocity) + 1));

    // Determine Archetype
    let archetype: KeplerTrajectoryArchetype = 'STAGNANT';
    const buyPressure = last.buy_pressure;
    const buyerGrowth = last.unique_buyers - first.unique_buyers;

    if (velocity > 50 && acceleration > 20) {
      archetype = 'PARABOLIC_EXPANSION';
    } else if (velocity > 15 && acceleration < -10 && buyPressure < 0.4) {
      archetype = 'FOMO_EXHAUSTION';
    } else if (velocity < -20 && acceleration < 0) {
      archetype = 'COLLAPSE';
    } else if (velocity < 0 && acceleration > 15 && buyPressure > 0.6) {
      archetype = 'REVIVAL';
    } else if (velocity > 10 && efficiency > 0.6 && buyerGrowth > 10) {
      archetype = 'ORGANIC_EXPANSION';
    } else if (Math.abs(velocity) < 5 && last.volume_sol > 20 && buyerGrowth > 5) {
      archetype = 'STEALTH_ACCUMULATION';
    } else if (velocity > 25 && efficiency > 0.7) {
      archetype = 'BREAKOUT';
    } else if (velocity > 15 && efficiency < 0.3) {
      archetype = 'FALSE_BREAKOUT';
    } else if (velocity < -5 && buyPressure < 0.35) {
      archetype = 'DISTRIBUTION_ARC';
    }

    return {
      token_mint: tokenMint,
      archetype,
      velocity: Number(velocity.toFixed(2)),
      acceleration: Number(acceleration.toFixed(2)),
      curvature: Number(curvature.toFixed(3)),
      persistence: Number(persistence.toFixed(3)),
      trajectory_efficiency: Number(efficiency.toFixed(3)),
      evaluated_at_ms: Date.now()
    };
  }
}

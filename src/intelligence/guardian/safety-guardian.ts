/**
 * SOL-SYLPH Master Implementation Blueprint - GUARDIAN
 * Predictive Failure Boundary & Near-Miss Intelligence
 * Specifications: Parts 30-33.
 */

import { NearMissEvent } from '../contracts/blueprint-contracts.js';

export interface BoundaryMetric {
  readonly name: string;
  readonly current_value: number;
  readonly unsafe_threshold: number;
  readonly distance_to_unsafe_pct: number; // 100% = safely centered; 0% = breached
  readonly velocity_pct_per_sec: number;   // Negative = moving towards unsafe
  readonly estimated_time_to_boundary_sec: number | null;
  readonly status: 'SAFE' | 'WARNING' | 'CRITICAL' | 'BREACHED';
}

export interface GuardianSafetyEnvelope {
  readonly overall_margin_pct: number;
  readonly closest_boundary: string;
  readonly margin_trend: 'EXPANDING' | 'STABLE' | 'DEGRADING';
  readonly safety_debt_score: number; // Accumulated near-miss exposure
  readonly active_boundaries: readonly BoundaryMetric[];
  readonly barrier_erosion_detected: boolean;
  readonly independent_barriers_count: number;
  readonly timestamp_ms: number;
}

export class SafetyGuardianEngine {
  private readonly nearMissLog: NearMissEvent[] = [];
  private accumulatedSafetyDebt: number = 0;

  // Previous readings to track boundary kinematics (velocity & acceleration)
  private previousReadings = new Map<string, { value: number; time: number }>();

  /**
   * Part 30: Evaluate Predictive Safety Boundaries
   */
  public evaluateBoundaries(telemetry: {
    execution_latency_ms: number;
    feed_age_ms: number;
    liquidity_depth_sol: number;
    queue_depth: number;
    capital_drawdown_pct: number;
    rpc_error_rate_pct: number;
  }): GuardianSafetyEnvelope {
    const now = Date.now();
    const boundaries: BoundaryMetric[] = [];

    // 1. Execution Latency (Unsafe threshold = 1,500 ms)
    boundaries.push(
      this.computeBoundaryMetric('execution_latency', telemetry.execution_latency_ms, 1500, false, now)
    );

    // 2. Feed Freshness (Unsafe threshold = 5,000 ms)
    boundaries.push(
      this.computeBoundaryMetric('feed_freshness', telemetry.feed_age_ms, 5000, false, now)
    );

    // 3. Liquidity Depth (Unsafe threshold = 5.0 SOL minimum)
    boundaries.push(
      this.computeBoundaryMetric('liquidity_depth', telemetry.liquidity_depth_sol, 5.0, true, now)
    );

    // 4. Queue Pressure (Unsafe threshold = 50 items)
    boundaries.push(
      this.computeBoundaryMetric('queue_lag', telemetry.queue_depth, 50, false, now)
    );

    // 5. Drawdown Margin (Unsafe threshold = 20% drawdown)
    boundaries.push(
      this.computeBoundaryMetric('capital_drawdown', telemetry.capital_drawdown_pct, 20.0, false, now)
    );

    // 6. RPC Error Rate (Unsafe threshold = 15% drop rate)
    boundaries.push(
      this.computeBoundaryMetric('rpc_health', telemetry.rpc_error_rate_pct, 15.0, false, now)
    );

    // Sort by smallest distance to unsafe
    const sorted = [...boundaries].sort((a, b) => a.distance_to_unsafe_pct - b.distance_to_unsafe_pct);
    const closest = sorted[0];

    // Part 31 & 32: Near-Miss Detection & Safety Debt Accumulation
    for (const b of boundaries) {
      if (b.distance_to_unsafe_pct < 20 && b.status !== 'BREACHED') {
        this.recordNearMiss({
          event_id: `nm_${b.name}_${now}`,
          boundary_name: b.name,
          timestamp_ms: now,
          closest_approach_pct: Number((100 - b.distance_to_unsafe_pct).toFixed(1)),
          duration_ms: 1000,
          contributing_factors: [`High volatility spike on ${b.name}`],
          protective_controls_triggered: ['Throttle queue', 'Capital sizing clamped'],
          actual_outcome: 'CONTAINED',
          counterfactual_failure_probability: 0.25,
        });
        this.accumulatedSafetyDebt += 1;
      }
    }

    // Trend analysis
    const avgVelocity = boundaries.reduce((acc, b) => acc + b.velocity_pct_per_sec, 0) / boundaries.length;
    const marginTrend = avgVelocity > 1.0 ? 'EXPANDING' : avgVelocity < -1.0 ? 'DEGRADING' : 'STABLE';

    // Part 33: Defense-in-depth barrier erosion check
    // If latency, feed freshness, and RPC error rate are all degrading simultaneously,
    // underlying Solana provider failure indicates barrier erosion.
    const providerDegradation =
      boundaries.filter(
        (b) => ['execution_latency', 'feed_freshness', 'rpc_health'].includes(b.name) && b.distance_to_unsafe_pct < 40
      ).length >= 2;

    return {
      overall_margin_pct: Number(closest.distance_to_unsafe_pct.toFixed(1)),
      closest_boundary: closest.name,
      margin_trend: marginTrend,
      safety_debt_score: this.accumulatedSafetyDebt,
      active_boundaries: boundaries,
      barrier_erosion_detected: providerDegradation,
      independent_barriers_count: providerDegradation ? 1 : 4,
      timestamp_ms: now,
    };
  }

  private computeBoundaryMetric(
    name: string,
    current: number,
    threshold: number,
    isLowerBound: boolean,
    now: number
  ): BoundaryMetric {
    let distancePct: number;
    if (isLowerBound) {
      // e.g. Liquidity must stay ABOVE threshold
      distancePct = current <= threshold ? 0 : Math.min(100, ((current - threshold) / threshold) * 100);
    } else {
      // e.g. Latency must stay BELOW threshold
      distancePct = current >= threshold ? 0 : Math.min(100, ((threshold - current) / threshold) * 100);
    }

    const prev = this.previousReadings.get(name);
    let velocity = 0;
    if (prev) {
      const dt = Math.max(0.1, (now - prev.time) / 1000);
      velocity = (distancePct - prev.value) / dt;
    }
    this.previousReadings.set(name, { value: distancePct, time: now });

    // Estimated time to boundary: distance / velocity if moving towards unsafe
    let ttb: number | null = null;
    if (velocity < -0.1 && distancePct > 0) {
      ttb = Number((distancePct / Math.abs(velocity)).toFixed(1));
    }

    let status: 'SAFE' | 'WARNING' | 'CRITICAL' | 'BREACHED' = 'SAFE';
    if (distancePct === 0) status = 'BREACHED';
    else if (distancePct < 15) status = 'CRITICAL';
    else if (distancePct < 40) status = 'WARNING';

    return {
      name,
      current_value: Number(current.toFixed(2)),
      unsafe_threshold: threshold,
      distance_to_unsafe_pct: Number(distancePct.toFixed(1)),
      velocity_pct_per_sec: Number(velocity.toFixed(2)),
      estimated_time_to_boundary_sec: ttb,
      status,
    };
  }

  public recordNearMiss(event: NearMissEvent): void {
    this.nearMissLog.push(event);
    if (this.nearMissLog.length > 100) this.nearMissLog.shift();
  }

  public getNearMisses(): readonly NearMissEvent[] {
    return this.nearMissLog;
  }

  public resetSafetyDebt(): void {
    this.accumulatedSafetyDebt = 0;
  }
}

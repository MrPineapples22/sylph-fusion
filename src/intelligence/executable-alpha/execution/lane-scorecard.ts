/**
 * SYLPH FUSION — EXECUTION LANE SCORECARD ENGINE
 * Section XIX: Execution Lane Scorecard
 *
 * Maintains empirical track records for different transaction propagation lanes
 * (e.g., Jito-Bundle, TPU-Direct, NextBlock, Bloxroute, Standard-RPC).
 *
 * Invariant: Minimum evidence threshold (>= 30 resolved attempts) required
 * before marking a lane eligibleForOptimization. Unknown performance defaults to non-optimized.
 */

import type { ExecutionLaneScorecard } from '../types.js';

export interface LaneAttemptEvent {
  readonly laneId: string;
  readonly landed: boolean;
  readonly sameSlot: boolean;
  readonly nextSlot: boolean;
  readonly latencyMs: number;
  readonly feeUsd: number;
  readonly tipUsd: number;
  readonly implementationShortfallUsd: number;
}

export class ExecutionLaneScorecardEngine {
  public static readonly MINIMUM_RESOLVED_ATTEMPTS = 30;

  private readonly scorecards: Map<string, ExecutionLaneScorecard> = new Map();
  private readonly history: Map<string, LaneAttemptEvent[]> = new Map();

  public recordAttempt(event: LaneAttemptEvent): ExecutionLaneScorecard {
    let list = this.history.get(event.laneId);
    if (!list) {
      list = [];
      this.history.set(event.laneId, list);
    }
    list.push(event);

    const scorecard = this.computeScorecard(event.laneId, list);
    this.scorecards.set(event.laneId, scorecard);
    return scorecard;
  }

  public getScorecard(laneId: string): ExecutionLaneScorecard {
    const existing = this.scorecards.get(laneId);
    if (existing) return existing;

    // Default empty scorecard with zero assumed superiority
    return {
      laneId,
      resolvedAttempts: 0,
      landingRate: 0,
      sameSlotRate: 0,
      nextSlotRate: 0,
      p50LandingMs: 9999,
      p95LandingMs: 9999,
      p99LandingMs: 9999,
      averageFeeUsd: 0,
      averageTipUsd: 0,
      averageImplementationShortfallUsd: 0,
      failureRate: 1.0,
      eligibleForOptimization: false,
    };
  }

  public getAllScorecards(): readonly ExecutionLaneScorecard[] {
    return Array.from(this.scorecards.values());
  }

  private computeScorecard(laneId: string, attempts: readonly LaneAttemptEvent[]): ExecutionLaneScorecard {
    const n = attempts.length;
    if (n === 0) return this.getScorecard(laneId);

    const landed = attempts.filter((a) => a.landed);
    const landingRate = landed.length / n;
    const sameSlotRate = attempts.filter((a) => a.sameSlot).length / n;
    const nextSlotRate = attempts.filter((a) => a.nextSlot).length / n;
    const failureRate = 1.0 - landingRate;

    const latencies = landed.map((a) => a.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)] || 1000;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 2000;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 3000;

    const avgFee = attempts.reduce((sum, a) => sum + a.feeUsd, 0) / n;
    const avgTip = attempts.reduce((sum, a) => sum + a.tipUsd, 0) / n;
    const avgShortfall = attempts.reduce((sum, a) => sum + a.implementationShortfallUsd, 0) / n;

    const eligibleForOptimization = n >= ExecutionLaneScorecardEngine.MINIMUM_RESOLVED_ATTEMPTS && landingRate >= 0.70;

    return {
      laneId,
      resolvedAttempts: n,
      landingRate,
      sameSlotRate,
      nextSlotRate,
      p50LandingMs: p50,
      p95LandingMs: p95,
      p99LandingMs: p99,
      averageFeeUsd: avgFee,
      averageTipUsd: avgTip,
      averageImplementationShortfallUsd: avgShortfall,
      failureRate,
      eligibleForOptimization,
    };
  }
}

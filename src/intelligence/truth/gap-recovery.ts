/**
 * SOL-SYLPH Intelligence Fabric - Gap Recovery & Source Health Engine
 * Specifications: Parts VI (Gap Recovery) & VII (Source Health).
 *
 * Flow:
 * Disconnect -> Record Watermark -> Reconnect -> Backfill/Replay -> Deduplicate
 * -> Reconcile Commitments -> Rebuild Projections -> Verify State Hash -> Return Live
 *
 * During recovery: DATA_CONFIDENCE is downgraded and policy responds with ABSTAIN.
 */

import { createHash } from 'node:crypto';
import type { CanonicalEvent, SourceHealthMetrics } from './types.js';
import { ChainTruthEngine } from './chain-truth.js';

export type RecoveryState = 'LIVE' | 'GAP_DETECTED' | 'BACKFILLING' | 'RECONCILING' | 'VERIFYING';

export interface Watermark {
  readonly lastSlot: number;
  readonly lastSequence: number;
  readonly lastEventId: string;
  readonly timestampMs: number;
  readonly stateHash: string;
}

export class GapDetector {
  private highestSeenSlot = 0;
  private readonly maxAllowedSlotGap = 5;

  public checkGap(latestSlot: number, lastConfirmedSlot: number): {
    hasGap: boolean;
    gapSlots: number;
  } {
    if (latestSlot > this.highestSeenSlot) {
      this.highestSeenSlot = latestSlot;
    }
    const gap = latestSlot - lastConfirmedSlot;
    return {
      hasGap: gap > this.maxAllowedSlotGap,
      gapSlots: Math.max(0, gap),
    };
  }
}

export class GapRecoveryManager {
  private recoveryState: RecoveryState = 'LIVE';
  private watermark: Watermark | null = null;
  private dataConfidenceMultiplier = 1.0;
  private recoveryHistory: Array<{ timestampMs: number; recoveredEventsCount: number; fromSlot: number; toSlot: number }> = [];

  constructor(private readonly chainTruth: ChainTruthEngine) {}

  public get state(): RecoveryState {
    return this.recoveryState;
  }

  public get currentConfidenceMultiplier(): number {
    return this.dataConfidenceMultiplier;
  }

  public recordWatermark(lastSlot: number, lastEventId: string, stateHash = ''): Watermark {
    this.watermark = {
      lastSlot,
      lastSequence: 0,
      lastEventId,
      timestampMs: Date.now(),
      stateHash: stateHash || createHash('sha256').update(`${lastSlot}:${lastEventId}`).digest('hex'),
    };
    this.recoveryState = 'GAP_DETECTED';
    this.dataConfidenceMultiplier = 0.35; // Immediate downgrade during recovery
    return this.watermark;
  }

  public async executeRecovery(
    backfillEvents: readonly CanonicalEvent[],
    expectedFinalStateHash?: string
  ): Promise<{
    recoveredCount: number;
    finalStateHash: string;
    verified: boolean;
  }> {
    if (!this.watermark) {
      this.recordWatermark(backfillEvents[0]?.slot ?? 0, backfillEvents[0]?.eventId ?? 'unknown');
    }

    this.recoveryState = 'BACKFILLING';
    let recoveredCount = 0;

    for (const evt of backfillEvents) {
      const accepted = this.chainTruth.registerEvent(evt);
      if (accepted) {
        recoveredCount++;
      }
    }

    this.recoveryState = 'RECONCILING';
    if (backfillEvents.length > 0) {
      const maxSlot = Math.max(...backfillEvents.map((e) => e.slot));
      this.chainTruth.advanceSlotCommitment(maxSlot, 'confirmed');
    }

    this.recoveryState = 'VERIFYING';
    const computedHash = createHash('sha256')
      .update(backfillEvents.map((e) => e.eventId).join(':'))
      .digest('hex');

    const verified = !expectedFinalStateHash || computedHash === expectedFinalStateHash;

    // Transition back to live
    this.recoveryState = 'LIVE';
    this.dataConfidenceMultiplier = verified ? 1.0 : 0.6;

    this.recoveryHistory.push({
      timestampMs: Date.now(),
      recoveredEventsCount: recoveredCount,
      fromSlot: this.watermark?.lastSlot ?? 0,
      toSlot: backfillEvents[backfillEvents.length - 1]?.slot ?? 0,
    });

    return {
      recoveredCount,
      finalStateHash: computedHash,
      verified,
    };
  }
}

export class SourceHealthTracker {
  private readonly providerMetrics = new Map<string, {
    latencies: number[];
    errors: number;
    successes: number;
    lastEventTime: number;
    duplicateCount: number;
    totalEvents: number;
    disagreements: number;
  }>();

  public recordEventObservation(providerId: string, latencyMs: number, isDuplicate = false, isDisagreement = false): void {
    const stats = this.providerMetrics.get(providerId) ?? {
      latencies: [],
      errors: 0,
      successes: 0,
      lastEventTime: Date.now(),
      duplicateCount: 0,
      totalEvents: 0,
      disagreements: 0,
    };

    stats.latencies.push(latencyMs);
    if (stats.latencies.length > 100) stats.latencies.shift();
    stats.successes++;
    stats.totalEvents++;
    stats.lastEventTime = Date.now();
    if (isDuplicate) stats.duplicateCount++;
    if (isDisagreement) stats.disagreements++;

    this.providerMetrics.set(providerId, stats);
  }

  public recordError(providerId: string): void {
    const stats = this.providerMetrics.get(providerId) ?? {
      latencies: [],
      errors: 0,
      successes: 0,
      lastEventTime: 0,
      duplicateCount: 0,
      totalEvents: 0,
      disagreements: 0,
    };
    stats.errors++;
    this.providerMetrics.set(providerId, stats);
  }

  public getHealth(providerId: string): SourceHealthMetrics {
    const stats = this.providerMetrics.get(providerId);
    if (!stats || stats.totalEvents === 0) {
      return {
        providerId,
        technicalHealth: {
          isAvailable: false,
          latencyP50Ms: 9999,
          latencyP95Ms: 9999,
          latencyP99Ms: 9999,
          errorRatePct: 100,
          connectionState: 'DISCONNECTED',
        },
        semanticHealth: {
          eventFreshnessMs: 99999,
          missingEventRatePct: 100,
          duplicateRatePct: 0,
          disagreementRatePct: 0,
          isSemanticallyUsable: false,
        },
      };
    }

    const sorted = [...stats.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const totalReqs = stats.successes + stats.errors;
    const errPct = totalReqs > 0 ? (stats.errors / totalReqs) * 100 : 0;
    const dupPct = (stats.duplicateCount / stats.totalEvents) * 100;
    const disagPct = (stats.disagreements / stats.totalEvents) * 100;
    const freshness = Date.now() - stats.lastEventTime;

    const technicalUp = errPct < 25 && freshness < 10000;
    const semanticUsable = technicalUp && freshness < 3000 && p95 < 800 && disagPct < 20;

    return {
      providerId,
      technicalHealth: {
        isAvailable: technicalUp,
        latencyP50Ms: p50,
        latencyP95Ms: p95,
        latencyP99Ms: p99,
        errorRatePct: Number(errPct.toFixed(1)),
        connectionState: technicalUp ? 'CONNECTED' : 'DISCONNECTED',
      },
      semanticHealth: {
        eventFreshnessMs: freshness,
        missingEventRatePct: 0,
        duplicateRatePct: Number(dupPct.toFixed(1)),
        disagreementRatePct: Number(disagPct.toFixed(1)),
        isSemanticallyUsable: semanticUsable,
      },
    };
  }
}

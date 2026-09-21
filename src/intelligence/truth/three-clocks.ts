/**
 * SOL-SYLPH Intelligence Fabric - Three Clock Model
 * Specifications: Section 4 (Three Clock Model: Chain Clock, Market Clock, Execution Clock).
 *
 * Rules:
 * 1. Chain Clock: Authoritative Solana slot, slot commitment, and validator block time.
 * 2. Market Clock: External feed observation time, exchange tick arrival time.
 * 3. Execution Clock: Monotonic high-resolution process time, CPU latency, deadline timeouts.
 * 4. Never conflate or treat these three clocks as equivalent.
 */

export interface ChainClockState {
  readonly currentSlot: number;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly estimatedBlockTimeMs: number;
  readonly slotDurationMs: number;
}

export interface MarketClockState {
  readonly observationTimestampMs: number;
  readonly arrivalTimestampMs: number;
  readonly feedAgeMs: number;
}

export interface ExecutionClockState {
  readonly monotonicTimeNs: bigint;
  readonly processUptimeMs: number;
  readonly eventLoopLagMs: number;
}

export interface ThreeClocksSnapshot {
  readonly chainClock: ChainClockState;
  readonly marketClock: MarketClockState;
  readonly executionClock: ExecutionClockState;
  readonly clockSkewMs: number; // Discrepancy between estimated chain time and market arrival time
  readonly capturedAtMs: number;
}

export class ThreeClocks {
  private latestSlot = 0;
  private latestCommitment: 'processed' | 'confirmed' | 'finalized' = 'processed';
  private slotAnchorTimeMs = Date.now();
  private slotAnchor = 0;

  public updateChainSlot(slot: number, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): void {
    this.latestSlot = slot;
    this.latestCommitment = commitment;
    this.slotAnchor = slot;
    this.slotAnchorTimeMs = Date.now();
  }

  public captureSnapshot(observationTimeMs: number, arrivalTimeMs = Date.now()): ThreeClocksSnapshot {
    const now = Date.now();
    const elapsedSinceAnchor = now - this.slotAnchorTimeMs;
    const estimatedSlot = this.slotAnchor + Math.floor(elapsedSinceAnchor / 400);

    const chainClock: ChainClockState = {
      currentSlot: Math.max(this.latestSlot, estimatedSlot),
      commitment: this.latestCommitment,
      estimatedBlockTimeMs: this.slotAnchorTimeMs + Math.floor(elapsedSinceAnchor / 400) * 400,
      slotDurationMs: 400,
    };

    const marketClock: MarketClockState = {
      observationTimestampMs: observationTimeMs,
      arrivalTimestampMs: arrivalTimeMs,
      feedAgeMs: Math.max(0, arrivalTimeMs - observationTimeMs),
    };

    const executionClock: ExecutionClockState = {
      monotonicTimeNs: process.hrtime.bigint(),
      processUptimeMs: Math.round(process.uptime() * 1000),
      eventLoopLagMs: Math.max(0, now - arrivalTimeMs),
    };

    const clockSkewMs = Math.abs(chainClock.estimatedBlockTimeMs - marketClock.arrivalTimestampMs);

    return {
      chainClock,
      marketClock,
      executionClock,
      clockSkewMs,
      capturedAtMs: now,
    };
  }
}

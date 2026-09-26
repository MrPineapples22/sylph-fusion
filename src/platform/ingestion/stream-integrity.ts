/**
 * SOL-SYLPH 2026 Platform - Stream Integrity Authority & Chain Watermark
 *
 * Enforces continuity across WebSocket / Geyser streaming feeds:
 * - Distinguishes between LOW-LATENCY OBSERVATION vs COMPLETE HISTORY
 * - Detects slot discontinuities (Δslot > 1) and emits STREAM_GAP_DETECTED
 * - Tracks three-dimensional ChainWatermark:
 *   observed_head, confirmed_head, finalized_root, contiguous_from, contiguous_through
 * - Enforces invariant:
 *   DATA: CURRENT requires BOTH freshness acceptable AND continuity proven.
 */

export interface ChainWatermark {
  readonly observedHeadSlot: number;
  readonly confirmedHeadSlot: number;
  readonly finalizedRootSlot: number;
  readonly contiguousFromSlot: number;
  readonly contiguousThroughSlot: number;
  readonly blockHeight: number;
  readonly streamIntegrity: 'CONTINUOUS' | 'GAP_DETECTED' | 'DISCONNECTED';
  readonly observationConfidence: number; // 0.0 to 1.0
  readonly lastObservedAtMs: number;
}

export interface StreamSlotNotification {
  readonly slot: number;
  readonly parentSlot?: number;
  readonly rootSlot?: number;
  readonly blockHeight?: number;
  readonly timestamp: number;
}

export class StreamIntegrityAuthority {
  private observedHead = 0;
  private confirmedHead = 0;
  private finalizedRoot = 0;
  private contiguousFrom = 0;
  private contiguousThrough = 0;
  private blockHeight = 0;

  private activeGapsCount = 0;
  private lastObservedAt = 0;
  private isConnected = false;

  constructor(private readonly maxAllowedGapSlots = 32) {}

  public onStreamConnected(): void {
    this.isConnected = true;
  }

  public onStreamDisconnected(): void {
    this.isConnected = false;
  }

  public registerSlotNotification(notif: StreamSlotNotification): {
    hasGap: boolean;
    gapStart?: number;
    gapEnd?: number;
  } {
    const now = Date.now();
    this.lastObservedAt = now;

    if (notif.rootSlot && notif.rootSlot > this.finalizedRoot) {
      this.finalizedRoot = notif.rootSlot;
    }
    if (notif.blockHeight) {
      this.blockHeight = Math.max(this.blockHeight, notif.blockHeight);
    }

    let hasGap = false;
    let gapStart: number | undefined;
    let gapEnd: number | undefined;

    if (this.observedHead > 0 && notif.slot > this.observedHead + 1) {
      // Discontinuity detected
      hasGap = true;
      gapStart = this.observedHead + 1;
      gapEnd = notif.slot - 1;
      this.activeGapsCount++;
    } else {
      // Monotonic progression
      if (this.contiguousFrom === 0) {
        this.contiguousFrom = notif.slot;
      }
      this.contiguousThrough = notif.slot;
    }

    this.observedHead = Math.max(this.observedHead, notif.slot);
    this.confirmedHead = Math.max(this.confirmedHead, notif.slot - 1); // Confirmed is roughly 1-2 slots behind tip

    return { hasGap, gapStart, gapEnd };
  }

  public markGapResolved(start: number, end: number): void {
    if (this.activeGapsCount > 0) {
      this.activeGapsCount--;
    }
    this.contiguousThrough = Math.max(this.contiguousThrough, end);
  }

  public getWatermark(): ChainWatermark {
    const streamIntegrity = !this.isConnected
      ? 'DISCONNECTED'
      : this.activeGapsCount > 0
      ? 'GAP_DETECTED'
      : 'CONTINUOUS';

    // Confidence drops if gaps exist or stream is disconnected
    let observationConfidence = 1.0;
    if (!this.isConnected) observationConfidence = 0.0;
    else if (this.activeGapsCount > 0) observationConfidence = 0.5;

    return {
      observedHeadSlot: this.observedHead,
      confirmedHeadSlot: this.confirmedHead,
      finalizedRootSlot: this.finalizedRoot,
      contiguousFromSlot: this.contiguousFrom,
      contiguousThroughSlot: this.contiguousThrough,
      blockHeight: this.blockHeight,
      streamIntegrity,
      observationConfidence,
      lastObservedAtMs: this.lastObservedAt,
    };
  }

  /**
   * Evaluates whether data can be considered CURRENT.
   * Invariant: Both freshness acceptable AND continuity proven.
   */
  public isDataCurrent(maxAgeMs = 5000, now = Date.now()): boolean {
    const watermark = this.getWatermark();
    if (watermark.streamIntegrity !== 'CONTINUOUS') {
      return false; // Gap detected or disconnected
    }
    const age = now - watermark.lastObservedAtMs;
    return age >= 0 && age <= maxAgeMs;
  }
}

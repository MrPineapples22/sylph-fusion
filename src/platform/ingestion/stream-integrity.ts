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
  private readonly unresolvedGaps: Array<{ start: number; end: number }> = [];
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
    // Freshness is based on local receipt time, not a provider supplied timestamp.
    // A stale or future timestamp must never make an old observation look current.
    const now = Date.now();
    this.lastObservedAt = now;

    if (!Number.isSafeInteger(notif.slot) || notif.slot < 0 ||
      (notif.parentSlot !== undefined && (!Number.isSafeInteger(notif.parentSlot) || notif.parentSlot < 0 || notif.parentSlot >= notif.slot))) {
      return { hasGap: true };
    }

    if (notif.rootSlot && notif.rootSlot > this.finalizedRoot) {
      this.finalizedRoot = notif.rootSlot;
    }
    if (notif.blockHeight) {
      this.blockHeight = Math.max(this.blockHeight, notif.blockHeight);
    }

    let hasGap = false;
    let gapStart: number | undefined;
    let gapEnd: number | undefined;

    if (notif.slot <= this.observedHead) {
      // Duplicates and delayed notifications are not new continuity evidence.
      return { hasGap: this.activeGapsCount > 0 };
    }

    const expectedPreviousSlot = notif.parentSlot ?? this.observedHead;
    if (this.observedHead > 0 && expectedPreviousSlot !== this.observedHead) {
      hasGap = true;
      gapStart = Math.min(expectedPreviousSlot, this.observedHead) + 1;
      gapEnd = Math.max(expectedPreviousSlot, this.observedHead);
      this.recordGap(gapStart, gapEnd);
    } else if (this.observedHead > 0 && notif.slot > this.observedHead + 1) {
      // Discontinuity detected
      hasGap = true;
      gapStart = this.observedHead + 1;
      gapEnd = notif.slot - 1;
      this.recordGap(gapStart, gapEnd);
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
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return;

    const remaining: Array<{ start: number; end: number }> = [];
    for (const gap of this.unresolvedGaps) {
      if (end < gap.start || start > gap.end) {
        remaining.push(gap);
        continue;
      }
      if (start > gap.start) remaining.push({ start: gap.start, end: start - 1 });
      if (end < gap.end) remaining.push({ start: end + 1, end: gap.end });
    }
    this.unresolvedGaps.splice(0, this.unresolvedGaps.length, ...remaining);
    this.activeGapsCount = this.unresolvedGaps.length;
    if (this.activeGapsCount === 0) this.contiguousThrough = this.observedHead;
  }

  private recordGap(start: number, end: number): void {
    if (end < start) return;
    const merged: Array<{ start: number; end: number }> = [];
    let next = { start, end };
    for (const gap of this.unresolvedGaps) {
      if (gap.end + 1 < next.start) merged.push(gap);
      else if (next.end + 1 < gap.start) {
        merged.push(next);
        next = gap;
      } else {
        next = { start: Math.min(next.start, gap.start), end: Math.max(next.end, gap.end) };
      }
    }
    merged.push(next);
    this.unresolvedGaps.splice(0, this.unresolvedGaps.length, ...merged);
    this.activeGapsCount = this.unresolvedGaps.length;
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

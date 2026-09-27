/**
 * SOLARIS-NEXUS: Ingestion Gap-Fill Reconciler
 * Maintains a circular buffer of processed slots, detects discontinuities (Δslot > 1),
 * and triggers historical block backfill to eliminate feature voids.
 */

import { SlotReceipt, SlotGap, ReconciliationReport } from './types.js';

export type BackfillHandler = (gap: SlotGap) => Promise<boolean>;

export class IngestionGapReconciler {
  private readonly bufferCapacity: number;
  private readonly slotRing: number[];
  private ringHead = 0;
  private ringSize = 0;
  private seenSlots = new Set<number>();

  private latestContinuousSlot = 0;
  private gaps: SlotGap[] = [];
  private totalSlotsBackfilled = 0;
  private backfillHandler?: BackfillHandler;
  private pendingBackfills: SlotGap[] = [];
  private backfillRunning = false;
  private generation = 0;
  private gapsDetected = 0;
  private gapsResolved = 0;
  private historyOverflow = false;
  private backfillFailures = 0;

  constructor(bufferCapacity = 1_000) {
    if (!Number.isSafeInteger(bufferCapacity) || bufferCapacity < 1 || bufferCapacity > 100_000) {
      throw new Error('Invalid slot buffer capacity');
    }
    this.bufferCapacity = Math.max(100, bufferCapacity);
    this.slotRing = new Array<number>(this.bufferCapacity);
  }

  public setBackfillHandler(handler: BackfillHandler): void {
    this.backfillHandler = handler;
    // A result from a replaced provider must not certify a gap after its
    // authority has been superseded. The new handler drains remaining work.
    this.generation++;
    void this.drainBackfills();
  }

  public registerSlot(slot: number, signatureCount = 1, expectContiguous = true): SlotGap | null {
    if (!Number.isSafeInteger(slot) || slot <= 0) return null;
    if (this.seenSlots.has(slot)) return null;

    let detectedGap: SlotGap | null = null;

    if (expectContiguous && this.latestContinuousSlot > 0 && slot > this.latestContinuousSlot + 1) {
      const missingCount = slot - this.latestContinuousSlot - 1;
      detectedGap = {
        startSlot: this.latestContinuousSlot + 1,
        endSlot: slot - 1,
        missingSlotCount: missingCount,
        detectedAtMs: Date.now(),
        isResolved: false,
      };
      this.gapsDetected++;
      if (this.gaps.length === this.bufferCapacity) {
        const removed = this.gaps.shift()!;
        if (!removed.isResolved) this.historyOverflow = true;
      }
      this.gaps.push(detectedGap);
      if (this.pendingBackfills.length === this.bufferCapacity) {
        this.pendingBackfills.shift();
        this.historyOverflow = true;
      }
      this.pendingBackfills.push(detectedGap);
      void this.drainBackfills();
    }

    // Push into circular buffer
    if (this.ringSize === this.bufferCapacity) this.seenSlots.delete(this.slotRing[this.ringHead]);
    this.slotRing[this.ringHead] = slot;
    this.ringHead = (this.ringHead + 1) % this.bufferCapacity;
    if (this.ringSize < this.bufferCapacity) {
      this.ringSize++;
    }
    this.seenSlots.add(slot);

    this.latestContinuousSlot = Math.max(this.latestContinuousSlot, slot);
    return detectedGap;
  }

  public markGapResolved(startSlot: number, endSlot: number): void {
    const gap = this.gaps.find(g => g.startSlot === startSlot && g.endSlot === endSlot);
    if (gap && !gap.isResolved) {
      (gap as any).isResolved = true;
      (gap as any).resolvedAtMs = Date.now();
      this.totalSlotsBackfilled += gap.missingSlotCount;
      this.gapsResolved++;
      // Resolution is represented by the interval itself. Enumerating every slot
      // can allocate billions of entries and does not constitute a slot receipt.
    }
  }

  public hasUnresolvedGaps(): boolean {
    return this.historyOverflow || this.gaps.some(g => !g.isResolved);
  }

  private async drainBackfills(): Promise<void> {
    if (this.backfillRunning || !this.backfillHandler) return;
    this.backfillRunning = true;
    try {
      while (this.pendingBackfills.length && this.backfillHandler) {
        const gap = this.pendingBackfills.shift()!;
        if (gap.isResolved) continue;
        const generation = this.generation;
        try {
          const success = await this.backfillHandler({...gap});
          if (generation !== this.generation) {
            // Revalidate this interval with the replacement provider; the old
            // result is evidence from a superseded authority.
            this.pendingBackfills.unshift(gap);
            continue;
          }
          if (success) this.markGapResolved(gap.startSlot, gap.endSlot);
          else this.backfillFailures++;
        } catch { if (generation === this.generation) this.backfillFailures++; }
      }
    } finally {
      this.backfillRunning = false;
      // A handler can change while an old request is in flight. Continue with
      // the current generation instead of leaving queued gaps stranded.
      if (this.pendingBackfills.length) void this.drainBackfills();
    }
  }

  public getUnresolvedGaps(): SlotGap[] {
    return this.gaps.filter(g => !g.isResolved).map(g => ({...g}));
  }

  public getReport(): ReconciliationReport {
    return {
      gapsDetected: this.gapsDetected,
      gapsResolved: this.gapsResolved,
      unresolvedHistoryTruncated: this.historyOverflow,
      backfillFailures: this.backfillFailures,
      pendingBackfills: this.pendingBackfills.length,
      totalSlotsBackfilled: this.totalSlotsBackfilled,
      latestContinuousSlot: this.latestContinuousSlot,
      circularBufferSize: this.ringSize,
    };
  }

  public reset(): void {
    this.generation++;
    this.pendingBackfills = [];
    this.gapsDetected = 0;
    this.gapsResolved = 0;
    this.historyOverflow = false;
    this.backfillFailures = 0;
    this.ringHead = 0;
    this.ringSize = 0;
    this.seenSlots.clear();
    this.latestContinuousSlot = 0;
    this.gaps = [];
    this.totalSlotsBackfilled = 0;
  }
}

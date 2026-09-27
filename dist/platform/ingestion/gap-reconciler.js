/**
 * SOLARIS-NEXUS: Ingestion Gap-Fill Reconciler
 * Maintains a circular buffer of processed slots, detects discontinuities (Δslot > 1),
 * and triggers historical block backfill to eliminate feature voids.
 */
export class IngestionGapReconciler {
    bufferCapacity;
    slotRing;
    ringHead = 0;
    ringSize = 0;
    seenSlots = new Set();
    latestContinuousSlot = 0;
    gaps = [];
    totalSlotsBackfilled = 0;
    backfillHandler;
    pendingBackfills = [];
    backfillRunning = false;
    generation = 0;
    gapsDetected = 0;
    gapsResolved = 0;
    historyOverflow = false;
    backfillFailures = 0;
    constructor(bufferCapacity = 1_000) {
        if (!Number.isSafeInteger(bufferCapacity) || bufferCapacity < 1 || bufferCapacity > 100_000) {
            throw new Error('Invalid slot buffer capacity');
        }
        this.bufferCapacity = Math.max(100, bufferCapacity);
        this.slotRing = new Array(this.bufferCapacity);
    }
    setBackfillHandler(handler) {
        this.backfillHandler = handler;
        // A result from a replaced provider must not certify a gap after its
        // authority has been superseded. The new handler drains remaining work.
        this.generation++;
        void this.drainBackfills();
    }
    registerSlot(slot, signatureCount = 1, expectContiguous = true) {
        if (!Number.isSafeInteger(slot) || slot <= 0)
            return null;
        if (this.seenSlots.has(slot))
            return null;
        let detectedGap = null;
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
                const removed = this.gaps.shift();
                if (!removed.isResolved)
                    this.historyOverflow = true;
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
        if (this.ringSize === this.bufferCapacity)
            this.seenSlots.delete(this.slotRing[this.ringHead]);
        this.slotRing[this.ringHead] = slot;
        this.ringHead = (this.ringHead + 1) % this.bufferCapacity;
        if (this.ringSize < this.bufferCapacity) {
            this.ringSize++;
        }
        this.seenSlots.add(slot);
        this.latestContinuousSlot = Math.max(this.latestContinuousSlot, slot);
        return detectedGap;
    }
    markGapResolved(startSlot, endSlot) {
        const gap = this.gaps.find(g => g.startSlot === startSlot && g.endSlot === endSlot);
        if (gap && !gap.isResolved) {
            gap.isResolved = true;
            gap.resolvedAtMs = Date.now();
            this.totalSlotsBackfilled += gap.missingSlotCount;
            this.gapsResolved++;
            // Resolution is represented by the interval itself. Enumerating every slot
            // can allocate billions of entries and does not constitute a slot receipt.
        }
    }
    hasUnresolvedGaps() {
        return this.historyOverflow || this.gaps.some(g => !g.isResolved);
    }
    async drainBackfills() {
        if (this.backfillRunning || !this.backfillHandler)
            return;
        this.backfillRunning = true;
        try {
            while (this.pendingBackfills.length && this.backfillHandler) {
                const gap = this.pendingBackfills.shift();
                if (gap.isResolved)
                    continue;
                const generation = this.generation;
                try {
                    const success = await this.backfillHandler({ ...gap });
                    if (generation !== this.generation) {
                        // Revalidate this interval with the replacement provider; the old
                        // result is evidence from a superseded authority.
                        this.pendingBackfills.unshift(gap);
                        continue;
                    }
                    if (success)
                        this.markGapResolved(gap.startSlot, gap.endSlot);
                    else
                        this.backfillFailures++;
                }
                catch {
                    if (generation === this.generation)
                        this.backfillFailures++;
                }
            }
        }
        finally {
            this.backfillRunning = false;
            // A handler can change while an old request is in flight. Continue with
            // the current generation instead of leaving queued gaps stranded.
            if (this.pendingBackfills.length)
                void this.drainBackfills();
        }
    }
    getUnresolvedGaps() {
        return this.gaps.filter(g => !g.isResolved).map(g => ({ ...g }));
    }
    getReport() {
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
    reset() {
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
//# sourceMappingURL=gap-reconciler.js.map
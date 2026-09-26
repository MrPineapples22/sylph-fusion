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
    constructor(bufferCapacity = 1_000) {
        this.bufferCapacity = Math.max(100, bufferCapacity);
        this.slotRing = new Array(this.bufferCapacity);
    }
    setBackfillHandler(handler) {
        this.backfillHandler = handler;
    }
    registerSlot(slot, signatureCount = 1) {
        if (!Number.isSafeInteger(slot) || slot <= 0)
            return null;
        if (this.seenSlots.has(slot))
            return null;
        let detectedGap = null;
        if (this.latestContinuousSlot > 0 && slot > this.latestContinuousSlot + 1) {
            const missingCount = slot - this.latestContinuousSlot - 1;
            detectedGap = {
                startSlot: this.latestContinuousSlot + 1,
                endSlot: slot - 1,
                missingSlotCount: missingCount,
                detectedAtMs: Date.now(),
                isResolved: false,
            };
            this.gaps.push(detectedGap);
            // Trigger asynchronous backfill if handler registered
            if (this.backfillHandler) {
                const gapRef = detectedGap;
                this.backfillHandler(gapRef)
                    .then(success => {
                    if (success) {
                        this.markGapResolved(gapRef.startSlot, gapRef.endSlot);
                    }
                })
                    .catch(() => { });
            }
        }
        // Push into circular buffer
        this.slotRing[this.ringHead] = slot;
        this.ringHead = (this.ringHead + 1) % this.bufferCapacity;
        if (this.ringSize < this.bufferCapacity) {
            this.ringSize++;
        }
        this.seenSlots.add(slot);
        // Evict oldest from seen set when ring wraps
        if (this.seenSlots.size > this.bufferCapacity * 2) {
            const pruneThreshold = slot - this.bufferCapacity;
            for (const s of this.seenSlots) {
                if (s < pruneThreshold) {
                    this.seenSlots.delete(s);
                }
            }
        }
        this.latestContinuousSlot = Math.max(this.latestContinuousSlot, slot);
        return detectedGap;
    }
    markGapResolved(startSlot, endSlot) {
        const gap = this.gaps.find(g => g.startSlot === startSlot && g.endSlot === endSlot);
        if (gap && !gap.isResolved) {
            gap.isResolved = true;
            gap.resolvedAtMs = Date.now();
            this.totalSlotsBackfilled += gap.missingSlotCount;
            for (let s = startSlot; s <= endSlot; s++) {
                this.seenSlots.add(s);
            }
        }
    }
    hasUnresolvedGaps() {
        return this.gaps.some(g => !g.isResolved);
    }
    getUnresolvedGaps() {
        return this.gaps.filter(g => !g.isResolved);
    }
    getReport() {
        const resolved = this.gaps.filter(g => g.isResolved).length;
        return {
            gapsDetected: this.gaps.length,
            gapsResolved: resolved,
            totalSlotsBackfilled: this.totalSlotsBackfilled,
            latestContinuousSlot: this.latestContinuousSlot,
            circularBufferSize: this.ringSize,
        };
    }
    reset() {
        this.ringHead = 0;
        this.ringSize = 0;
        this.seenSlots.clear();
        this.latestContinuousSlot = 0;
        this.gaps = [];
        this.totalSlotsBackfilled = 0;
    }
}
//# sourceMappingURL=gap-reconciler.js.map
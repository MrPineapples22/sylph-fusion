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
    certificates = new Map();
    constructor(bufferCapacity = 1_000, initialContinuousSlot = 0) {
        if (!Number.isSafeInteger(bufferCapacity) || bufferCapacity < 1 || bufferCapacity > 100_000) {
            throw new Error('Invalid slot buffer capacity');
        }
        this.bufferCapacity = Math.max(100, bufferCapacity);
        this.slotRing = new Array(this.bufferCapacity);
        if (Number.isSafeInteger(initialContinuousSlot) && initialContinuousSlot > 0) {
            this.latestContinuousSlot = initialContinuousSlot;
        }
    }
    preseedContinuousSlot(slot) {
        if (Number.isSafeInteger(slot) && slot > this.latestContinuousSlot) {
            this.latestContinuousSlot = slot;
        }
    }
    async loadPersistedFrontier(store, lane = 'CHAIN_BLOCK') {
        const frontier = await store.getCoverageFrontier(lane);
        const continuousSlot = frontier ? (frontier.continuous_slot ?? frontier.continuousSlot) : undefined;
        if (Number.isSafeInteger(continuousSlot) && continuousSlot > this.latestContinuousSlot) {
            this.latestContinuousSlot = continuousSlot;
        }
        return this.latestContinuousSlot;
    }
    setBackfillHandler(handler) {
        this.backfillHandler = handler;
        // A result from a replaced provider must not certify a gap after its
        // authority has been superseded. The new handler drains remaining work.
        this.generation++;
        void this.drainBackfills();
    }
    registerSlot(slot, signatureCount = 1, expectContiguous = true, metadata) {
        if (!Number.isSafeInteger(slot) || slot <= 0)
            return null;
        if (this.seenSlots.has(slot))
            return null;
        let detectedGap = null;
        // Shrink any active gap intervals if this slot arrives out-of-order
        this.shrinkUnresolvedInterval(slot);
        if (expectContiguous && this.latestContinuousSlot > 0 && slot > this.latestContinuousSlot + 1) {
            const missingCount = slot - this.latestContinuousSlot - 1;
            const startSlot = this.latestContinuousSlot + 1;
            const endSlot = slot - 1;
            const now = Date.now();
            detectedGap = {
                gapId: `gap_${startSlot}_${endSlot}_${now}`,
                startSlot,
                endSlot,
                missingSlotCount: missingCount,
                detectedAtMs: now,
                isResolved: false,
                providerId: metadata?.providerId,
                classification: metadata?.classification ?? 'UNKNOWN',
                lane: metadata?.lane ?? 'CHAIN_BLOCK',
                bankHash: metadata?.bankHash,
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
    observeSlot(slot, signatureCount = 1, expectContiguous = true, metadata) {
        return this.registerSlot(slot, signatureCount, expectContiguous, metadata);
    }
    shrinkUnresolvedInterval(slot) {
        const updatedGaps = [];
        for (const g of this.gaps) {
            if (g.isResolved || slot < g.startSlot || slot > g.endSlot) {
                updatedGaps.push(g);
                continue;
            }
            if (g.startSlot === g.endSlot && g.startSlot === slot) {
                g.isResolved = true;
                g.resolvedAtMs = Date.now();
                this.gapsResolved++;
                this.totalSlotsBackfilled += 1;
                updatedGaps.push(g);
            }
            else if (slot === g.startSlot) {
                updatedGaps.push({
                    ...g,
                    startSlot: slot + 1,
                    missingSlotCount: g.endSlot - (slot + 1) + 1,
                });
            }
            else if (slot === g.endSlot) {
                updatedGaps.push({
                    ...g,
                    endSlot: slot - 1,
                    missingSlotCount: (slot - 1) - g.startSlot + 1,
                });
            }
            else {
                updatedGaps.push({
                    ...g,
                    gapId: `${g.gapId ?? 'gap'}_p1`,
                    endSlot: slot - 1,
                    missingSlotCount: slot - g.startSlot,
                });
                updatedGaps.push({
                    ...g,
                    gapId: `${g.gapId ?? 'gap'}_p2`,
                    startSlot: slot + 1,
                    missingSlotCount: g.endSlot - slot,
                });
            }
        }
        this.gaps = updatedGaps;
    }
    markGapResolved(startSlot, endSlot, certificate) {
        const gap = this.gaps.find(g => g.startSlot === startSlot && g.endSlot === endSlot);
        if (gap && !gap.isResolved) {
            gap.isResolved = true;
            gap.resolvedAtMs = Date.now();
            if (certificate) {
                const id = gap.gapId ?? certificate.gapId;
                this.certificates.set(id, certificate);
            }
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
                    const result = await this.backfillHandler({ ...gap });
                    if (generation !== this.generation) {
                        // Revalidate this interval with the replacement provider; the old
                        // result is evidence from a superseded authority.
                        this.pendingBackfills.unshift(gap);
                        continue;
                    }
                    const isSuccess = typeof result === 'boolean' ? result : (result && result.isVerified);
                    if (isSuccess) {
                        this.markGapResolved(gap.startSlot, gap.endSlot, typeof result === 'object' ? result : undefined);
                    }
                    else {
                        this.backfillFailures++;
                    }
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
    getRecoveryCertificate(gapId) {
        return this.certificates.get(gapId);
    }
    getAllRecoveryCertificates() {
        return Array.from(this.certificates.values());
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
    getContinuousSlot() {
        return this.latestContinuousSlot;
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
        this.certificates.clear();
    }
}
//# sourceMappingURL=gap-reconciler.js.map
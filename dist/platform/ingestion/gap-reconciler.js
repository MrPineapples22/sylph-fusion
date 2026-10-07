/**
 * SOLARIS-NEXUS: Ingestion Gap-Fill Reconciler
 * Maintains a circular buffer of processed slots, detects discontinuities (Δslot > 1),
 * and triggers historical block backfill to eliminate feature voids.
 */
import { snapshotRecoveryCertificate } from './recovery-certificate.js';
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
    recoveryCertificateJournal;
    pendingBackfills = [];
    backfillRunning = false;
    generation = 0;
    gapsDetected = 0;
    gapsResolved = 0;
    historyOverflow = false;
    backfillFailures = 0;
    certificates = new Map();
    certificateRetentionUnits = new Map();
    retainedCertificateUnits = 0;
    maxCertificateRetentionUnits;
    constructor(bufferCapacity = 1_000, initialContinuousSlot = 0) {
        if (!Number.isSafeInteger(bufferCapacity) || bufferCapacity < 1 || bufferCapacity > 100_000) {
            throw new Error('Invalid slot buffer capacity');
        }
        this.bufferCapacity = Math.max(100, bufferCapacity);
        this.maxCertificateRetentionUnits = this.bufferCapacity * 2 + 1;
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
        // The legacy frontier row contains only a lane/slot/root tuple. It is not
        // linked to an immutable recovery certificate, provider provenance, or a
        // verified predecessor, so loading it as continuous truth could hide gaps.
        // Keep it readable for migration, but never let it advance this frontier.
        if (frontier !== null && frontier !== undefined)
            throw new Error('PERSISTED_COVERAGE_FRONTIER_UNVERIFIED');
        return this.latestContinuousSlot;
    }
    setBackfillHandler(handler) {
        this.backfillHandler = handler;
        // A result from a replaced provider must not certify a gap after its
        // authority has been superseded. The new handler drains remaining work.
        this.generation++;
        void this.drainBackfills();
    }
    setRecoveryCertificateJournal(journal) {
        if (!journal || typeof journal.saveVerifiedRecoveryCertificate !== 'function') {
            throw new Error('Invalid recovery certificate journal');
        }
        this.recoveryCertificateJournal = journal;
    }
    requeueBackfill(gap) {
        if (!this.gaps.some(current => !current.isResolved && current.startSlot === gap.startSlot && current.endSlot === gap.endSlot))
            return;
        if (this.pendingBackfills.some(pending => pending.gapId === gap.gapId &&
            pending.startSlot === gap.startSlot && pending.endSlot === gap.endSlot))
            return;
        if (this.pendingBackfills.length >= this.bufferCapacity) {
            this.historyOverflow = true;
            return;
        }
        this.pendingBackfills.unshift(gap);
    }
    registerSlot(slot, signatureCount = 1, expectContiguous = true, metadata) {
        if (!Number.isSafeInteger(slot) || slot <= 0)
            return null;
        const alreadySeen = this.seenSlots.has(slot);
        // A filtered receipt must not suppress a later receipt from a source that
        // claims contiguous coverage for the same slot.
        if (alreadySeen && !expectContiguous)
            return null;
        let detectedGap = null;
        // Only a compatible complete-source receipt can shrink a coverage gap.
        this.shrinkUnresolvedInterval(slot, expectContiguous, metadata);
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
        // Push into circular buffer once. A later contiguous-source receipt for a
        // previously filtered slot upgrades its evidence without duplicating it.
        if (!alreadySeen) {
            if (this.ringSize === this.bufferCapacity)
                this.seenSlots.delete(this.slotRing[this.ringHead]);
            this.slotRing[this.ringHead] = slot;
            this.ringHead = (this.ringHead + 1) % this.bufferCapacity;
            if (this.ringSize < this.bufferCapacity) {
                this.ringSize++;
            }
            this.seenSlots.add(slot);
        }
        // Filtered or otherwise non-contiguous observations are receipts only.
        // Advancing the contiguous frontier from them would make a later complete
        // source appear to have covered slots it never observed. The first
        // contiguous receipt establishes a new baseline; earlier history remains
        // unknown unless separately backfilled and certified.
        if (expectContiguous)
            this.latestContinuousSlot = Math.max(this.latestContinuousSlot, slot);
        return detectedGap;
    }
    observeSlot(slot, signatureCount = 1, expectContiguous = true, metadata) {
        return this.registerSlot(slot, signatureCount, expectContiguous, metadata);
    }
    shrinkUnresolvedInterval(slot, expectContiguous, metadata) {
        const updatedGaps = [];
        const changedGapIds = new Set();
        const retryIntervals = [];
        for (const g of this.gaps) {
            const compatibleProvider = g.providerId === undefined || metadata?.providerId === g.providerId;
            const compatibleClassification = (g.classification ?? 'UNKNOWN') === (metadata?.classification ?? 'UNKNOWN');
            const compatibleLane = (g.lane ?? 'CHAIN_BLOCK') === (metadata?.lane ?? 'CHAIN_BLOCK');
            if (!expectContiguous || !compatibleProvider || !compatibleClassification || !compatibleLane ||
                g.isResolved || slot < g.startSlot || slot > g.endSlot) {
                updatedGaps.push(g);
                continue;
            }
            if (g.startSlot === g.endSlot && g.startSlot === slot) {
                if (g.gapId)
                    changedGapIds.add(g.gapId);
                g.isResolved = true;
                g.resolvedAtMs = Date.now();
                this.gapsResolved++;
                // This slot was observed from the matching contiguous source; it was
                // not fetched by backfill, so keep the backfill counter exact.
                updatedGaps.push(g);
            }
            else if (slot === g.startSlot) {
                const remaining = {
                    ...g,
                    startSlot: slot + 1,
                    missingSlotCount: g.endSlot - (slot + 1) + 1,
                };
                if (g.gapId)
                    changedGapIds.add(g.gapId);
                updatedGaps.push(remaining);
                retryIntervals.push(remaining);
            }
            else if (slot === g.endSlot) {
                const remaining = {
                    ...g,
                    endSlot: slot - 1,
                    missingSlotCount: (slot - 1) - g.startSlot + 1,
                };
                if (g.gapId)
                    changedGapIds.add(g.gapId);
                updatedGaps.push(remaining);
                retryIntervals.push(remaining);
            }
            else {
                const left = {
                    ...g,
                    gapId: `${g.gapId ?? 'gap'}_p1`,
                    endSlot: slot - 1,
                    missingSlotCount: slot - g.startSlot,
                };
                const right = {
                    ...g,
                    gapId: `${g.gapId ?? 'gap'}_p2`,
                    startSlot: slot + 1,
                    missingSlotCount: g.endSlot - slot,
                };
                if (g.gapId)
                    changedGapIds.add(g.gapId);
                updatedGaps.push(left, right);
                retryIntervals.push(left, right);
            }
        }
        this.gaps = updatedGaps;
        if (changedGapIds.size) {
            // Queued requests for the old interval cannot certify its changed range.
            // Replace queued work with the exact remaining intervals; if an old
            // request is already in flight, these retries wait behind it.
            this.pendingBackfills = this.pendingBackfills.filter(gap => !gap.gapId || !changedGapIds.has(gap.gapId));
            for (const gap of retryIntervals) {
                if (this.pendingBackfills.some(pending => pending.gapId === gap.gapId))
                    continue;
                if (this.pendingBackfills.length === this.bufferCapacity) {
                    this.historyOverflow = true;
                    continue;
                }
                this.pendingBackfills.push(gap);
            }
            if (retryIntervals.length)
                void this.drainBackfills();
        }
    }
    snapshotCertificate(input) {
        return snapshotRecoveryCertificate(input, this.bufferCapacity);
    }
    isCertificateBoundToGap(gap, certificate) {
        if (certificate.isVerified !== true ||
            typeof certificate.certificateId !== 'string' || certificate.certificateId.length < 1 || certificate.certificateId.length > 128 ||
            certificate.gapId !== gap.gapId || certificate.startSlot !== gap.startSlot || certificate.endSlot !== gap.endSlot ||
            typeof certificate.providerId !== 'string' || certificate.providerId.length < 1 || certificate.providerId.length > 128 ||
            (gap.providerId !== undefined && certificate.providerId !== gap.providerId) ||
            certificate.classification !== (gap.classification ?? 'UNKNOWN') ||
            certificate.lane !== (gap.lane ?? 'CHAIN_BLOCK') ||
            typeof certificate.stateRoot !== 'string' || !/^[a-f0-9]{64}$/.test(certificate.stateRoot) ||
            typeof certificate.coverageRoot !== 'string' || !/^[a-f0-9]{64}$/.test(certificate.coverageRoot) ||
            !Number.isSafeInteger(certificate.certifiedAtMs) || certificate.certifiedAtMs < gap.detectedAtMs ||
            certificate.certifiedAtMs > Date.now())
            return false;
        const expectedCount = gap.endSlot - gap.startSlot + 1;
        if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > this.bufferCapacity)
            return false;
        const statuses = certificate.perSlotStatus;
        if (Object.keys(statuses).length !== expectedCount)
            return false;
        for (let slot = gap.startSlot; slot <= gap.endSlot; slot++) {
            const status = statuses[String(slot)];
            if (!status || status === 'UNAVAILABLE')
                return false;
        }
        return true;
    }
    markGapResolved(startSlot, endSlot, certificate) {
        const gap = this.gaps.find(g => g.startSlot === startSlot && g.endSlot === endSlot);
        if (!gap || gap.isResolved)
            return false;
        const snapshot = this.snapshotCertificate(certificate);
        if (!snapshot || this.certificates.has(snapshot.certificateId) || !this.isCertificateBoundToGap(gap, snapshot))
            return false;
        const retentionUnits = Object.keys(snapshot.perSlotStatus).length + snapshot.recoveredEventIds.length + 1;
        if (retentionUnits > this.maxCertificateRetentionUnits)
            return false;
        while (this.retainedCertificateUnits + retentionUnits > this.maxCertificateRetentionUnits) {
            const oldestCertificateId = this.certificates.keys().next().value;
            if (!oldestCertificateId)
                break;
            this.certificates.delete(oldestCertificateId);
            this.retainedCertificateUnits -= this.certificateRetentionUnits.get(oldestCertificateId) ?? 0;
            this.certificateRetentionUnits.delete(oldestCertificateId);
            // Retained proof history is incomplete after eviction. Keep the global
            // coverage status fail-closed even though recent gaps can still recover.
            this.historyOverflow = true;
        }
        if (this.retainedCertificateUnits + retentionUnits > this.maxCertificateRetentionUnits)
            return false;
        {
            gap.isResolved = true;
            gap.resolvedAtMs = Date.now();
            this.certificates.set(snapshot.certificateId, snapshot);
            this.certificateRetentionUnits.set(snapshot.certificateId, retentionUnits);
            this.retainedCertificateUnits += retentionUnits;
            this.totalSlotsBackfilled += gap.missingSlotCount;
            this.gapsResolved++;
            // Resolution is represented by the interval itself. Enumerating every slot
            // can allocate billions of entries and does not constitute a slot receipt.
            return true;
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
                        this.requeueBackfill(gap);
                        continue;
                    }
                    const certificate = this.snapshotCertificate(result);
                    const currentGap = this.gaps.find(candidate => candidate.startSlot === gap.startSlot && candidate.endSlot === gap.endSlot);
                    if (!certificate || !currentGap || currentGap.isResolved || this.certificates.has(certificate.certificateId) ||
                        !this.isCertificateBoundToGap(currentGap, certificate)) {
                        this.backfillFailures++;
                        continue;
                    }
                    if (this.recoveryCertificateJournal)
                        await this.recoveryCertificateJournal.saveVerifiedRecoveryCertificate(certificate);
                    if (generation !== this.generation) {
                        // The immutable proof may remain in the audit journal, but a
                        // superseded provider cannot resolve in-memory coverage.
                        this.requeueBackfill(gap);
                        continue;
                    }
                    if (!this.markGapResolved(currentGap.startSlot, currentGap.endSlot, certificate))
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
    getRecoveryCertificate(gapId) {
        return this.certificates.get(gapId) ?? Array.from(this.certificates.values()).find(certificate => certificate.gapId === gapId);
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
        this.certificateRetentionUnits.clear();
        this.retainedCertificateUnits = 0;
    }
}
//# sourceMappingURL=gap-reconciler.js.map
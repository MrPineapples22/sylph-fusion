/**
 * Research-only ordering buffer for transaction observations.
 *
 * Inspired by Solana Streamer (0xfnzero, order_buffer.rs) and Richat
 * (lamports-dev, pubsub/tracker.rs). It provides stable ordering and explicit
 * capacity/late-arrival reports. It cannot prove slot completeness: empty slots,
 * missing transactions, replay completion, and canonical fork choice require
 * separate source evidence.
 */
import { createHash } from 'node:crypto';
export class OrderedObservationStagingEngine {
    maxBufferSize;
    staged = new Map();
    highWatermarkSlot = 0;
    lastDrainedSlot = 0;
    capacityOverflowed = false;
    unorderedObservationCount = 0;
    totalStagedCount = 0;
    totalDuplicateCount = 0;
    totalCapacityRejections = 0;
    constructor(config = {}) {
        const maxBuffer = config.maxBufferSize ?? 5000;
        if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1)
            throw new Error('INVALID_MAX_BUFFER_SIZE');
        this.maxBufferSize = maxBuffer;
    }
    /** Stage one observation; capacity never evicts an earlier observation. */
    stageObservation(observation) {
        if (!observation ||
            !Number.isSafeInteger(observation.slot) || observation.slot < 0 ||
            !Number.isSafeInteger(observation.transactionIndex) || observation.transactionIndex < 0 ||
            typeof observation.signature !== 'string' || observation.signature.length === 0 ||
            typeof observation.eventType !== 'string' || observation.eventType.trim().length === 0 ||
            !Number.isFinite(observation.receivedAtMs) || observation.receivedAtMs < 0 ||
            typeof observation.observationDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(observation.observationDigest))
            throw new Error('INVALID_STAGED_OBSERVATION');
        const key = this.keyFor(observation);
        const existing = this.staged.get(key);
        if (existing) {
            if (!this.sameObservation(existing, observation))
                throw new Error('OBSERVATION_IDENTITY_CONFLICT');
            this.totalDuplicateCount++;
            return this.getWatermarkReport();
        }
        if (this.staged.size >= this.maxBufferSize) {
            this.capacityOverflowed = true;
            this.totalCapacityRejections++;
            return this.getWatermarkReport();
        }
        const frozen = Object.freeze({
            slot: observation.slot,
            transactionIndex: observation.transactionIndex,
            signature: observation.signature,
            eventType: observation.eventType,
            receivedAtMs: observation.receivedAtMs,
            observationDigest: observation.observationDigest.toLowerCase(),
        });
        this.staged.set(key, frozen);
        this.totalStagedCount++;
        if (observation.slot > this.highWatermarkSlot)
            this.highWatermarkSlot = observation.slot;
        return this.getWatermarkReport();
    }
    /** Record an event that lacked transaction identity/index, so this buffer cannot order it. */
    recordUnorderedObservation() {
        this.unorderedObservationCount++;
        return this.getWatermarkReport();
    }
    /**
     * Drain a deterministically sorted prefix. Sorting does not establish that the
     * prefix is complete; callers need independent replay/slot-completion evidence.
     */
    drainOrderedObservations(upToSlot) {
        if (upToSlot !== undefined && (!Number.isSafeInteger(upToSlot) || upToSlot < 0)) {
            throw new Error('INVALID_DRAIN_SLOT');
        }
        const targetSlot = upToSlot ?? this.highWatermarkSlot;
        const candidates = [...this.staged.values()]
            .filter((obs) => obs.slot <= targetSlot)
            .sort((a, b) => a.slot - b.slot || a.transactionIndex - b.transactionIndex || a.signature.localeCompare(b.signature));
        for (const obs of candidates) {
            this.staged.delete(this.keyFor(obs));
            if (obs.slot > this.lastDrainedSlot)
                this.lastDrainedSlot = obs.slot;
        }
        return Object.freeze(candidates);
    }
    getWatermarkReport() {
        const slots = [...new Set([...this.staged.values()].map((observation) => observation.slot))].sort((a, b) => a - b);
        const lowestPendingSlot = slots[0] ?? null;
        let observedSlotHoleCount = 0;
        for (let index = 1; index < slots.length; index++) {
            observedSlotHoleCount += Math.max(0, slots[index] - slots[index - 1] - 1);
        }
        const hasLateObservations = this.lastDrainedSlot > 0 && [...this.staged.values()].some((obs) => obs.slot <= this.lastDrainedSlot);
        let status = 'OBSERVATIONS_ORDERED';
        if (this.capacityOverflowed)
            status = 'CAPACITY_OVERFLOW';
        else if (this.unorderedObservationCount > 0)
            status = 'UNORDERED_OBSERVATIONS';
        else if (hasLateObservations)
            status = 'LATE_OBSERVATIONS';
        else if (observedSlotHoleCount > 0)
            status = 'SPARSE_SLOT_OBSERVATIONS';
        else if (this.staged.size === 0 && this.highWatermarkSlot === 0)
            status = 'EMPTY';
        const digestEntries = [...this.staged.values()]
            .sort((a, b) => a.slot - b.slot || a.transactionIndex - b.transactionIndex || a.signature.localeCompare(b.signature))
            .map((obs) => `${obs.slot}:${obs.transactionIndex}:${obs.signature}:${obs.eventType}:${obs.receivedAtMs}:${obs.observationDigest}`);
        const digestPayload = `${this.highWatermarkSlot}:${this.lastDrainedSlot}:${this.capacityOverflowed}:${this.unorderedObservationCount}:${digestEntries.join('|')}`;
        return Object.freeze({
            highWatermarkSlot: this.highWatermarkSlot,
            lastDrainedSlot: this.lastDrainedSlot,
            lowestPendingSlot,
            pendingCount: this.staged.size,
            hasObservedSlotHoles: observedSlotHoleCount > 0,
            observedSlotHoleCount,
            hasLateObservations,
            hasUnorderedObservations: this.unorderedObservationCount > 0,
            capacityOverflowed: this.capacityOverflowed,
            completeness: 'NOT_ESTABLISHED',
            watermarkDigest: createHash('sha256').update(digestPayload).digest('hex'),
            status,
        });
    }
    getStats() {
        return {
            totalStaged: this.totalStagedCount,
            totalDuplicates: this.totalDuplicateCount,
            totalCapacityRejections: this.totalCapacityRejections,
            pendingCount: this.staged.size,
        };
    }
    reset() {
        this.staged.clear();
        this.highWatermarkSlot = 0;
        this.lastDrainedSlot = 0;
        this.capacityOverflowed = false;
        this.unorderedObservationCount = 0;
    }
    keyFor(observation) {
        return `${observation.slot}:${observation.transactionIndex}:${observation.signature}`;
    }
    sameObservation(left, right) {
        return left.eventType === right.eventType && left.observationDigest.toLowerCase() === right.observationDigest.toLowerCase();
    }
}
//# sourceMappingURL=ordered-observation-buffer.js.map
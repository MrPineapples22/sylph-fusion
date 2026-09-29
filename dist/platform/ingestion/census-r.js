/**
 * SYLPH FUSION — CENSUS-R: Canonical Event Journal & Bank/Fork Authority
 * Specifications: Sections 9 (Canonical Event Journal), 10 (Event Atomicity), 103 (Invariant 14)
 *
 * Implements:
 * 1. Bank/fork-aware durable canonical event journal.
 * 2. Strict event progression: RAW -> OBSERVED -> CANONICAL -> SEALED.
 * 3. Canonical Event ID format: <slot>:<bank_hash>:<tx_hash>:<event_idx>.
 * 4. Transaction-level event batch atomicity (multi-event atomic commit / rollback).
 * 5. Late-event repair without discarding legitimate history (event.slot < currentSlot).
 * 6. Fork rollback handling: Rewinds abandoned bank forks to common ancestor slot.
 * 7. Deterministic, idempotent causal replay.
 */
import { createHash } from 'node:crypto';
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
export class CensusRJournalAuthority {
    journal = [];
    eventsById = new Map();
    batchesById = new Map();
    lifecycleByEventId = new Map();
    transitionSequence = 0;
    watermark = {
        highestObservedSlot: 0,
        highestCanonicalSlot: 0,
        highestSealedSlot: 0,
        activeBankFork: 'genesis-fork',
    };
    getJournalLength() {
        return this.journal.length;
    }
    getWatermark() {
        return { ...this.watermark };
    }
    getEvent(eventId) {
        const event = this.eventsById.get(eventId);
        return event ? this.projectEvent(event) : undefined;
    }
    getLifecycle(eventId) {
        return Object.freeze((this.lifecycleByEventId.get(eventId) ?? []).map(record => Object.freeze({ ...record })));
    }
    currentStage(eventId) {
        const records = this.lifecycleByEventId.get(eventId);
        return records?.[records.length - 1]?.stage;
    }
    recordStage(eventId, stage, reason) {
        const records = this.lifecycleByEventId.get(eventId) ?? [];
        const last = records[records.length - 1];
        if (last?.stage === stage)
            return;
        records.push(Object.freeze({ sequence: ++this.transitionSequence, eventId, stage, recordedAtMs: Date.now(), reason }));
        this.lifecycleByEventId.set(eventId, records);
    }
    projectEvent(event) {
        return Object.freeze({ ...event, stage: this.currentStage(event.eventId) ?? event.stage });
    }
    /**
     * Section 10: Transaction-Level Event Batch Atomicity.
     * Commits economically related events (creator transfer, curve update, trade) atomically.
     */
    commitTransactionBatch(params) {
        const { slot, bankHash, txHash, providerId, providerTimestampMs, events } = params;
        if (!Number.isSafeInteger(slot) || slot < 0 || !bankHash || !txHash || !providerId || !Number.isSafeInteger(providerTimestampMs) || providerTimestampMs < 0) {
            throw new Error('BATCH_COMMIT_FAILED: Invalid transaction provenance');
        }
        if (events.length === 0) {
            throw new Error('BATCH_COMMIT_FAILED: Event batch cannot be empty');
        }
        const batchId = `BATCH-${slot}-${bankHash}-${txHash}`;
        if (this.journal.some(event => event.slot === slot && event.bankHash === bankHash && event.txHash === txHash && this.currentStage(event.eventId) === 'REVOKED')) {
            throw new Error('BATCH_COMMIT_FAILED: A revoked transaction cannot be reingested as canonical');
        }
        const previousBatch = this.batchesById.get(batchId);
        if (previousBatch) {
            if (previousBatch.events.some(event => this.currentStage(event.eventId) === 'REVOKED')) {
                throw new Error('BATCH_COMMIT_FAILED: A revoked transaction cannot be reingested as canonical');
            }
            return previousBatch;
        }
        const preparedEvents = [];
        // Construct events with deterministic canonical IDs: <slot>:<bank_hash>:<tx_hash>:<event_idx>
        for (let idx = 0; idx < events.length; idx++) {
            const item = events[idx];
            const eventId = `${slot}:${bankHash}:${txHash}:${idx}`;
            // Idempotency: Ignore duplicate event IDs if already canonical
            if (this.eventsById.has(eventId)) {
                continue;
            }
            const serialized = JSON.stringify(item.payload);
            if (serialized === undefined)
                throw new Error('BATCH_COMMIT_FAILED: Event payload is not serializable');
            const canonicalPayload = deepFreeze(JSON.parse(serialized));
            const sha256 = createHash('sha256')
                .update(`${eventId}:${item.eventType}:${serialized}:${providerTimestampMs}`)
                .digest('hex');
            const journalEvent = Object.freeze({
                eventId,
                slot,
                bankHash,
                txHash,
                eventIndex: idx,
                providerId,
                providerTimestampMs,
                receivedAtMs: Date.now(),
                stage: 'CANONICAL',
                batchId,
                eventType: item.eventType,
                payload: canonicalPayload,
                sha256,
            });
            preparedEvents.push(journalEvent);
        }
        // Atomic persistence to journal
        for (const ev of preparedEvents) {
            this.journal.push(ev);
            this.eventsById.set(ev.eventId, ev);
            this.recordStage(ev.eventId, 'RAW');
            this.recordStage(ev.eventId, 'OBSERVED');
            this.recordStage(ev.eventId, 'CANONICAL');
        }
        if (preparedEvents.length === 0)
            throw new Error('BATCH_COMMIT_FAILED: No new canonical events were added');
        // Update watermarks
        if (slot > this.watermark.highestObservedSlot) {
            this.watermark.highestObservedSlot = slot;
        }
        if (slot > this.watermark.highestCanonicalSlot) {
            this.watermark.highestCanonicalSlot = slot;
        }
        this.watermark.activeBankFork = bankHash;
        const batch = Object.freeze({
            batchId,
            slot,
            bankHash,
            txHash,
            providerId,
            events: Object.freeze(preparedEvents.map(event => this.projectEvent(event))),
            isCommitted: true,
            committedAtMs: Date.now(),
        });
        this.batchesById.set(batchId, batch);
        return batch;
    }
    /**
     * Section 9: Late-Event Handling.
     * Does NOT discard legitimate late events simply because event.slot < currentSlot.
     * Late events repair missing state and maintain causal completeness.
     */
    ingestLateEvent(params) {
        const { slot, bankHash, txHash, eventIndex, providerId, providerTimestampMs, eventType, payload } = params;
        if (!Number.isSafeInteger(slot) || slot < 0 || !bankHash || !txHash || !providerId || !Number.isSafeInteger(eventIndex) || eventIndex < 0 || !Number.isSafeInteger(providerTimestampMs) || providerTimestampMs < 0)
            throw new Error('LATE_EVENT_INVALID_PROVENANCE');
        const eventId = `${slot}:${bankHash}:${txHash}:${eventIndex}`;
        if (this.journal.some(event => event.slot === slot && event.bankHash === bankHash && event.txHash === txHash && this.currentStage(event.eventId) === 'REVOKED')) {
            throw new Error('LATE_EVENT_INVALID: A revoked transaction cannot be extended implicitly');
        }
        const existing = this.eventsById.get(eventId);
        if (existing) {
            if (this.currentStage(eventId) === 'REVOKED')
                throw new Error('LATE_EVENT_INVALID: A revoked observation cannot be restored implicitly');
            return this.projectEvent(existing); // Idempotent projection
        }
        const serialized = JSON.stringify(payload);
        if (serialized === undefined)
            throw new Error('LATE_EVENT_INVALID_PAYLOAD');
        const canonicalPayload = deepFreeze(JSON.parse(serialized));
        const sha256 = createHash('sha256')
            .update(`${eventId}:${eventType}:${serialized}:${providerTimestampMs}`)
            .digest('hex');
        const lateEvent = Object.freeze({
            eventId,
            slot,
            bankHash,
            txHash,
            eventIndex,
            providerId,
            providerTimestampMs,
            receivedAtMs: Date.now(),
            stage: 'CANONICAL',
            batchId: `LATE-REPAIR-${slot}-${bankHash}-${txHash}`,
            eventType,
            payload: canonicalPayload,
            sha256,
        });
        // Insert late event into historical sequence maintaining slot ordering
        let insertIdx = this.journal.length;
        while (insertIdx > 0 && this.journal[insertIdx - 1].slot > slot) {
            insertIdx--;
        }
        this.journal.splice(insertIdx, 0, lateEvent);
        this.eventsById.set(eventId, lateEvent);
        this.recordStage(eventId, 'RAW');
        this.recordStage(eventId, 'OBSERVED');
        this.recordStage(eventId, 'CANONICAL');
        return lateEvent;
    }
    /**
     * Section 9: Fork Rollback.
     * Rewinds unsealed canonical state from an abandoned bank fork back to the common ancestor slot.
     */
    rollbackFork(abandonedBankFork, commonAncestorSlot) {
        if (!abandonedBankFork || !Number.isSafeInteger(commonAncestorSlot) || commonAncestorSlot < 0)
            throw new Error('FORK_ROLLBACK_INVALID_PROVENANCE');
        let rolledBackCount = 0;
        for (const ev of this.journal) {
            const stage = this.currentStage(ev.eventId);
            if (ev.bankHash === abandonedBankFork && ev.slot > commonAncestorSlot && stage !== 'SEALED' && stage !== 'REVOKED') {
                this.recordStage(ev.eventId, 'REVOKED', `fork ${abandonedBankFork} abandoned after common ancestor slot ${commonAncestorSlot}`);
                rolledBackCount++;
            }
        }
        this.watermark.highestCanonicalSlot = this.journal.reduce((highest, event) => {
            const stage = this.currentStage(event.eventId);
            return stage === 'CANONICAL' || stage === 'SEALED' ? Math.max(highest, event.slot) : highest;
        }, 0);
        const latestCanonical = [...this.journal].reverse().find(event => {
            const stage = this.currentStage(event.eventId);
            return stage === 'CANONICAL' || stage === 'SEALED';
        });
        this.watermark.activeBankFork = latestCanonical?.bankHash ?? 'genesis-fork';
        return {
            rolledBackEventsCount: rolledBackCount,
            remainingEventsCount: this.journal.length,
        };
    }
    /**
     * Canonical Sealing: Seals events up to the specified finalized slot.
     */
    sealUpToSlot(finalizedSlot) {
        if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < 0)
            throw new Error('CENSUS_INVALID_FINALIZED_SLOT');
        let sealedCount = 0;
        let lastSealedId;
        for (const ev of this.journal) {
            if (ev.slot <= finalizedSlot && this.currentStage(ev.eventId) === 'CANONICAL') {
                this.recordStage(ev.eventId, 'SEALED');
                sealedCount++;
                lastSealedId = ev.eventId;
            }
        }
        if (finalizedSlot > this.watermark.highestSealedSlot) {
            this.watermark.highestSealedSlot = finalizedSlot;
            if (lastSealedId)
                this.watermark.lastSealedEventId = lastSealedId;
        }
        return sealedCount;
    }
    /**
     * Deterministic Idempotent Replay.
     */
    replayJournal(fromSlot = 0, toSlot = Number.MAX_SAFE_INTEGER) {
        return Object.freeze(this.journal.filter(e => e.slot >= fromSlot && e.slot <= toSlot).map(event => this.projectEvent(event)));
    }
}
export const globalCensusR = new CensusRJournalAuthority();
//# sourceMappingURL=census-r.js.map
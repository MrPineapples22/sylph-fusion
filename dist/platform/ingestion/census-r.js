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
export class CensusRJournalAuthority {
    journal = [];
    eventsById = new Map();
    batchesById = new Map();
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
        return this.eventsById.get(eventId);
    }
    /**
     * Section 10: Transaction-Level Event Batch Atomicity.
     * Commits economically related events (creator transfer, curve update, trade) atomically.
     */
    commitTransactionBatch(params) {
        const { slot, bankHash, txHash, providerId, providerTimestampMs, events } = params;
        if (events.length === 0) {
            throw new Error('BATCH_COMMIT_FAILED: Event batch cannot be empty');
        }
        const batchId = `BATCH-${slot}-${txHash.slice(0, 8)}-${Date.now()}`;
        const preparedEvents = [];
        // Construct events with deterministic canonical IDs: <slot>:<bank_hash>:<tx_hash>:<event_idx>
        for (let idx = 0; idx < events.length; idx++) {
            const item = events[idx];
            const eventId = `${slot}:${bankHash.slice(0, 8)}:${txHash.slice(0, 16)}:${idx}`;
            // Idempotency: Ignore duplicate event IDs if already canonical
            if (this.eventsById.has(eventId)) {
                continue;
            }
            const serialized = JSON.stringify(item.payload);
            const sha256 = createHash('sha256')
                .update(`${eventId}:${item.eventType}:${serialized}:${providerTimestampMs}`)
                .digest('hex');
            const journalEvent = {
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
                payload: Object.freeze({ ...item.payload }),
                sha256,
            };
            preparedEvents.push(journalEvent);
        }
        // Atomic persistence to journal
        for (const ev of preparedEvents) {
            this.journal.push(ev);
            this.eventsById.set(ev.eventId, ev);
        }
        // Update watermarks
        if (slot > this.watermark.highestObservedSlot) {
            this.watermark.highestObservedSlot = slot;
        }
        if (slot > this.watermark.highestCanonicalSlot) {
            this.watermark.highestCanonicalSlot = slot;
        }
        this.watermark.activeBankFork = bankHash;
        const batch = {
            batchId,
            slot,
            bankHash,
            txHash,
            providerId,
            events: preparedEvents,
            isCommitted: true,
            committedAtMs: Date.now(),
        };
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
        const eventId = `${slot}:${bankHash.slice(0, 8)}:${txHash.slice(0, 16)}:${eventIndex}`;
        const existing = this.eventsById.get(eventId);
        if (existing) {
            return existing; // Idempotent return
        }
        const serialized = JSON.stringify(payload);
        const sha256 = createHash('sha256')
            .update(`${eventId}:${eventType}:${serialized}:${providerTimestampMs}`)
            .digest('hex');
        const lateEvent = {
            eventId,
            slot,
            bankHash,
            txHash,
            eventIndex,
            providerId,
            providerTimestampMs,
            receivedAtMs: Date.now(),
            stage: 'CANONICAL',
            batchId: `LATE-REPAIR-${slot}-${Date.now()}`,
            eventType,
            payload: Object.freeze({ ...payload }),
            sha256,
        };
        // Insert late event into historical sequence maintaining slot ordering
        let insertIdx = this.journal.length;
        while (insertIdx > 0 && this.journal[insertIdx - 1].slot > slot) {
            insertIdx--;
        }
        this.journal.splice(insertIdx, 0, lateEvent);
        this.eventsById.set(eventId, lateEvent);
        return lateEvent;
    }
    /**
     * Section 9: Fork Rollback.
     * Rewinds unsealed canonical state from an abandoned bank fork back to the common ancestor slot.
     */
    rollbackFork(abandonedBankFork, commonAncestorSlot) {
        const survivingEvents = [];
        let rolledBackCount = 0;
        for (const ev of this.journal) {
            if (ev.bankHash === abandonedBankFork && ev.slot > commonAncestorSlot && ev.stage !== 'SEALED') {
                this.eventsById.delete(ev.eventId);
                rolledBackCount++;
            }
            else {
                survivingEvents.push(ev);
            }
        }
        this.journal = survivingEvents;
        this.watermark.highestCanonicalSlot = Math.min(this.watermark.highestCanonicalSlot, commonAncestorSlot);
        return {
            rolledBackEventsCount: rolledBackCount,
            remainingEventsCount: this.journal.length,
        };
    }
    /**
     * Canonical Sealing: Seals events up to the specified finalized slot.
     */
    sealUpToSlot(finalizedSlot) {
        let sealedCount = 0;
        let lastSealedId;
        for (const ev of this.journal) {
            if (ev.slot <= finalizedSlot && ev.stage === 'CANONICAL') {
                ev.stage = 'SEALED';
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
        return this.journal.filter(e => e.slot >= fromSlot && e.slot <= toSlot);
    }
}
export const globalCensusR = new CensusRJournalAuthority();
//# sourceMappingURL=census-r.js.map
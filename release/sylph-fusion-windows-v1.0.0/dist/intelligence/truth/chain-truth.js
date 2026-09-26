/**
 * SOL-SYLPH Master Production Intelligence - Chain Truth Engine & Fork Reconciler
 * Specifications: Section 6 (Chain Truth Engine).
 *
 * Rules:
 * 1. Tracks processed, confirmed, and finalized Solana slots.
 * 2. If an event becomes invalid due to chain fork/reorg:
 *    - Mark it as ORPHANED or REPLACED.
 *    - Preserve full forensic history (never delete).
 *    - Trigger registered rollback handler to recompute derived state deterministically.
 */
import { createHash } from 'node:crypto';
export class ChainTruthEngine {
    eventsById = new Map();
    eventsBySlot = new Map();
    canonicalSlots = new Set();
    forensicOrphanedLog = [];
    rollbackListeners = [];
    processedDeduplicationKeys = new Set();
    latestProcessedSlot = 0;
    latestConfirmedSlot = 0;
    latestFinalizedSlot = 0;
    /**
     * Derive deterministic event identity from slot, signature, instruction, event type, and account.
     */
    static deriveEventIdentity(event) {
        const slot = event.slot ?? 0;
        const sig = event.signature || event.eventId || 'nosig';
        const ix = event.instructionIndex ?? 0;
        const innerIx = event.innerInstructionIndex ?? 0;
        const type = event.eventType;
        const acct = event.mint || event.wallet || 'noacct';
        return createHash('sha256')
            .update(`${slot}:${sig}:${ix}:${innerIx}:${type}:${acct}`)
            .digest('hex')
            .slice(0, 32);
    }
    registerRollbackListener(listener) {
        this.rollbackListeners.push(listener);
    }
    /**
     * Registers an event idempotently.
     * If an identical event has already been registered, repeated processing returns false
     * and guarantees that the final system state is unchanged (E o E o E == E).
     */
    registerEvent(event) {
        const dedupKey = ChainTruthEngine.deriveEventIdentity(event);
        if (this.processedDeduplicationKeys.has(dedupKey) || this.eventsById.has(event.eventId)) {
            return false; // Idempotent skip - duplicate
        }
        this.processedDeduplicationKeys.add(dedupKey);
        this.eventsById.set(event.eventId, event);
        const slotEvents = this.eventsBySlot.get(event.slot) ?? [];
        slotEvents.push(event);
        this.eventsBySlot.set(event.slot, slotEvents);
        if (event.slot > this.latestProcessedSlot) {
            this.latestProcessedSlot = event.slot;
            this.canonicalSlots.add(event.slot);
        }
        return true;
    }
    advanceSlotCommitment(slot, commitment) {
        if (commitment === 'processed') {
            if (slot > this.latestProcessedSlot)
                this.latestProcessedSlot = slot;
            this.canonicalSlots.add(slot);
        }
        else if (commitment === 'confirmed') {
            if (slot > this.latestConfirmedSlot)
                this.latestConfirmedSlot = slot;
            this.canonicalSlots.add(slot);
            this.updateSlotEventsState(slot, 'CONFIRMED');
        }
        else if (commitment === 'finalized') {
            if (slot > this.latestFinalizedSlot)
                this.latestFinalizedSlot = slot;
            this.canonicalSlots.add(slot);
            this.updateSlotEventsState(slot, 'FINAL');
        }
    }
    /**
     * Handle fork detection where a set of slots are recognized as orphaned.
     */
    handleForkDetected(orphanedSlots, canonicalSlot) {
        for (const slot of orphanedSlots) {
            this.canonicalSlots.delete(slot);
            const events = this.eventsBySlot.get(slot) ?? [];
            for (const evt of events) {
                evt.chainState = 'ORPHANED';
                const action = {
                    orphanedEvent: evt,
                    reason: `Slot ${slot} orphaned in favor of canonical slot ${canonicalSlot}`,
                    timestampMs: Date.now(),
                };
                this.forensicOrphanedLog.push(action);
                for (const listener of this.rollbackListeners) {
                    try {
                        listener(action);
                    }
                    catch (err) {
                        console.error(`Rollback listener error for event ${evt.eventId}:`, err);
                    }
                }
            }
        }
    }
    getEvent(eventId) {
        return this.eventsById.get(eventId);
    }
    getForensicOrphanedHistory() {
        return this.forensicOrphanedLog;
    }
    getCommitmentSummary() {
        return {
            processedSlot: this.latestProcessedSlot,
            confirmedSlot: this.latestConfirmedSlot,
            finalizedSlot: this.latestFinalizedSlot,
            totalTrackedEvents: this.eventsById.size,
            totalOrphanedEvents: this.forensicOrphanedLog.length,
        };
    }
    updateSlotEventsState(slot, nextState) {
        const events = this.eventsBySlot.get(slot) ?? [];
        for (const evt of events) {
            if (evt.chainState !== 'ORPHANED' && evt.chainState !== 'REPLACED') {
                evt.chainState = nextState;
            }
        }
    }
}
//# sourceMappingURL=chain-truth.js.map
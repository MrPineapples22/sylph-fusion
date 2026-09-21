/**
 * SOL-SYLPH Canonical Event Architecture
 * Specifications: Parts III, IV, V, VI, LXXXIII, LXXXIV, LXXXV, LXXXVI, LXXXVII
 *
 * Enforces:
 * 1. Typed SylphEvent with stable correlation ID chains and 40 semantic event types.
 * 2. Multi-clock separation (LiveClock, ReplayClock, TestClock) and late-arrival classification.
 * 3. Append-only Event Journal with watermark reorder buffers.
 * 4. Session & Release Manifest traceability.
 */
import { createHash } from 'crypto';
export class LiveClock {
    now() {
        return Date.now();
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    name() {
        return 'LiveClock';
    }
}
export class ReplayClock {
    currentMs;
    constructor(initialMs = Date.now()) {
        this.currentMs = initialMs;
    }
    now() {
        return this.currentMs;
    }
    advance(ms) {
        if (ms < 0)
            throw new Error('Cannot advance clock backward in time');
        this.currentMs += ms;
    }
    setTime(ms) {
        this.currentMs = ms;
    }
    async sleep(ms) {
        this.advance(ms);
    }
    name() {
        return 'ReplayClock';
    }
}
export class TestClock extends ReplayClock {
    name() {
        return 'TestClock';
    }
}
// --- Part IV: Reorder Buffer & Watermark Engine ---
export class WatermarkEngine {
    highestObservedTimeMs = 0;
    maxAllowedLatenessMs;
    hardExpiryMs;
    constructor(options) {
        this.maxAllowedLatenessMs = options?.maxAllowedLatenessMs ?? 5000;
        this.hardExpiryMs = options?.hardExpiryMs ?? 30000;
    }
    evaluateArrival(eventTimeMs, currentTimeMs) {
        if (eventTimeMs > this.highestObservedTimeMs) {
            this.highestObservedTimeMs = eventTimeMs;
        }
        const latenessMs = currentTimeMs - eventTimeMs;
        if (latenessMs <= this.maxAllowedLatenessMs) {
            return 'ON_TIME';
        }
        if (latenessMs <= this.hardExpiryMs) {
            return 'LATE_ACCEPTED';
        }
        return 'TOO_LATE';
    }
    getWatermark() {
        return Math.max(0, this.highestObservedTimeMs - this.maxAllowedLatenessMs);
    }
}
// --- Part V & Blueprint Part II: Append-Oriented Event Journal with Deduplication ---
export class EventJournal {
    events = [];
    eventsByCanonicalKey = new Map();
    sequenceCounter = 0;
    watermarkEngine;
    constructor(watermarkEngine) {
        this.watermarkEngine = watermarkEngine ?? new WatermarkEngine();
    }
    append(params) {
        const clock = params.clock ?? new LiveClock();
        const now = clock.now();
        const receivedAt = params.receivedAt ?? now;
        const processedAt = now;
        const canonicalKey = params.canonicalKey ??
            (params.slot && params.transactionSignature
                ? `${params.slot}:${params.transactionSignature}:${params.instructionIndex ?? 0}:${params.innerInstructionIndex ?? 0}:${params.eventType}`
                : `${params.mint}:${params.source}:${params.sourceSequence ?? params.observedAt}:${params.eventType}`);
        if (this.eventsByCanonicalKey.has(canonicalKey)) {
            const existing = this.eventsByCanonicalKey.get(canonicalKey);
            return { event: existing, arrivalStatus: 'DUPLICATE' };
        }
        const arrivalStatus = this.watermarkEngine.evaluateArrival(params.observedAt, now);
        this.sequenceCounter += 1;
        const sequence = this.sequenceCounter;
        const rawPayload = JSON.stringify(params.payload);
        const checksum = params.rawHash ?? createHash('sha256')
            .update(`${params.mint}:${sequence}:${params.eventType}:${params.observedAt}:${rawPayload}`)
            .digest('hex');
        const eventId = `evt_${params.eventType.toLowerCase()}_${params.mint.slice(0, 8)}_${sequence}`;
        const event = {
            eventId,
            canonicalKey,
            correlationId: params.correlationId ?? `corr_${sequence}_${now}`,
            causationId: params.causationId,
            sequence,
            eventType: params.eventType,
            mint: params.mint,
            slot: params.slot,
            transactionSignature: params.transactionSignature,
            instructionIndex: params.instructionIndex,
            innerInstructionIndex: params.innerInstructionIndex,
            source: params.source,
            sourceSequence: params.sourceSequence,
            commitment: params.commitment ?? 'confirmed',
            chainTime: params.chainTime ?? params.observedAt,
            observedAt: params.observedAt,
            receivedAt,
            decodedAt: params.decodedAt ?? receivedAt,
            processedAt,
            payload: params.payload,
            quality: params.quality ?? 'HIGH',
            schemaVersion: params.schemaVersion ?? '1.0.0',
            decoderVersion: params.decoderVersion ?? '1.0.0',
            sessionId: params.sessionId ?? 'session_default',
            environment: params.environment ?? 'SIMULATION',
            checksum,
            rawHash: checksum,
        };
        this.events.push(event);
        this.eventsByCanonicalKey.set(canonicalKey, event);
        return { event, arrivalStatus };
    }
    getEventCount() {
        return this.events.length;
    }
    getEvent(sequence) {
        return this.events.find(e => e.sequence === sequence);
    }
    getEventsForToken(mint) {
        return this.events.filter(e => e.mint === mint);
    }
    getEventsSlice(fromSequence, toSequence) {
        return this.events.filter(e => e.sequence >= fromSequence && (toSequence === undefined || e.sequence <= toSequence));
    }
    exportJournal() {
        return [...this.events];
    }
}
//# sourceMappingURL=canonical-event.js.map
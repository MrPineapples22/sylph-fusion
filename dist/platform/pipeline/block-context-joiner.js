/**
 * Joins feed observations only when a same-provider block observation reports
 * the exact transaction signature in that slot. Provider data remains
 * unverified; this module does not establish canonicality or bank identity.
 */
import bs58 from 'bs58';
import BN from 'bn.js';
import { types as utilTypes } from 'node:util';
import { PublicKey } from '@solana/web3.js';
import { createFusionEnvelopeV2 } from './fusion-envelope.js';
const COMMITMENT_RANK = {
    unknown: 0, processed: 1, confirmed: 2, finalized: 3,
};
const LABEL = /^[A-Za-z0-9_.:/-]{1,192}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_SLOT = (1n << 64n) - 1n;
const MAX_PENDING_EVENT_BYTES = 65_536;
const MAX_DATA_DEPTH = 24;
const MAX_DATA_NODES = 20_000;
const MAX_BIGINT_MAGNITUDE = 1n << BigInt(MAX_PENDING_EVENT_BYTES * 3);
const MAX_BN_WORDS = Math.ceil(MAX_PENDING_EVENT_BYTES * 3 / 26);
const BN_KEYS = ['negative', 'words', 'length', 'red'];
function base58Length(value, length) {
    if (typeof value !== 'string')
        return false;
    try {
        return bs58.decode(value).byteLength === length;
    }
    catch {
        return false;
    }
}
function contextKey(providerId, slot) {
    return JSON.stringify([providerId, slot.toString()]);
}
function snapshotRecord(value, allowedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value))
        throw new Error('BLOCK_INPUT_INVALID');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error('BLOCK_INPUT_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowedKeys.length || keys.some(key => typeof key !== 'string' || !allowedKeys.includes(key)))
        throw new Error('BLOCK_INPUT_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!('value' in descriptor))
            throw new Error('BLOCK_INPUT_INVALID');
        result[key] = descriptor.value;
    }
    return result;
}
function snapshotDenseArray(value, maxLength) {
    if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maxLength)
        throw new Error('BLOCK_INPUT_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))
        throw new Error('BLOCK_INPUT_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = [];
    for (let i = 0; i < value.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor))
            throw new Error('BLOCK_INPUT_INVALID');
        result.push(descriptor.value);
    }
    return result;
}
function validateBoundedBN(value, maxBits = MAX_PENDING_EVENT_BYTES * 3) {
    if (utilTypes.isProxy(value))
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    if (Object.getPrototypeOf(value) !== BN.prototype)
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== BN_KEYS.length || keys.some(key => typeof key !== 'string' || !BN_KEYS.includes(key))) {
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (BN_KEYS.some(key => !descriptors[key] || !('value' in descriptors[key])))
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    const words = descriptors.words.value;
    const length = descriptors.length.value;
    const negative = descriptors.negative.value;
    if (negative !== 0 && negative !== 1)
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    if (!Array.isArray(words) || utilTypes.isProxy(words) || !Number.isSafeInteger(length) || length < 1 || length > MAX_BN_WORDS ||
        words.length < length || words.length > MAX_BN_WORDS || (descriptors.red.value !== null && descriptors.red.value !== undefined)) {
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
    }
    const wordKeys = Reflect.ownKeys(words);
    if (wordKeys.length !== words.length + 1 || wordKeys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= words.length))) {
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    }
    const wordDescriptors = Object.getOwnPropertyDescriptors(words);
    if (Array.from({ length: words.length }, (_, i) => wordDescriptors[String(i)]).some(descriptor => !descriptor || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value >= 0x4000000)) {
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    }
    if (length > 1 && wordDescriptors[String(length - 1)]?.value === 0)
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    if (BN.prototype.bitLength.call(value) > maxBits)
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
}
function validateContext(context) {
    if (!context || typeof context !== 'object' || typeof context.slot !== 'bigint' || context.slot < 0n || context.slot > MAX_SLOT ||
        typeof context.bankId !== 'string' || context.bankId.trim().length < 1 || context.bankId.length > 256 ||
        !base58Length(context.blockhash, 32) || !['processed', 'confirmed', 'finalized'].includes(context.commitment) ||
        !Array.isArray(context.forkLineage) || context.forkLineage.length > 64 ||
        context.forkLineage.some(item => typeof item !== 'string' || item.length > 256)) {
        throw new Error('BLOCK_CONTEXT_INVALID');
    }
}
function validateMembershipEvidence(evidence, maxSignatures) {
    if (!evidence || typeof evidence !== 'object' || typeof evidence.providerId !== 'string' || !LABEL.test(evidence.providerId) ||
        !Array.isArray(evidence.transactionSignatures) || evidence.transactionSignatures.length > maxSignatures ||
        typeof evidence.rawPayloadHash !== 'string' || !HASH.test(evidence.rawPayloadHash) ||
        !Number.isSafeInteger(evidence.observedAtMs) || evidence.observedAtMs < 0 ||
        evidence.transactionSignatures.some(signature => !base58Length(signature, 64)) ||
        new Set(evidence.transactionSignatures).size !== evidence.transactionSignatures.length) {
        throw new Error('BLOCK_MEMBERSHIP_EVIDENCE_INVALID');
    }
}
function copyJsonValue(value, depth = 0, budget = { nodes: 0, bytes: 0 }, seen = new Set()) {
    if (depth > MAX_DATA_DEPTH || ++budget.nodes > MAX_DATA_NODES)
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
    if (typeof value === 'string') {
        budget.bytes += Buffer.byteLength(value);
        if (budget.bytes > MAX_PENDING_EVENT_BYTES)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        return value;
    }
    if (value === null || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('BLOCK_EVENT_DATA_INVALID');
        return value;
    }
    if (typeof value === 'bigint') {
        if (value >= MAX_BIGINT_MAGNITUDE || value <= -MAX_BIGINT_MAGNITUDE)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        const text = value.toString();
        budget.bytes += Buffer.byteLength(text);
        if (budget.bytes > MAX_PENDING_EVENT_BYTES)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        return text;
    }
    if (typeof value !== 'object')
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    if (utilTypes.isProxy(value))
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    if (value instanceof PublicKey && Object.getPrototypeOf(value) === PublicKey.prototype) {
        const publicKeyOwnKeys = Reflect.ownKeys(value);
        if (publicKeyOwnKeys.length !== 1 || publicKeyOwnKeys[0] !== '_bn')
            throw new Error('BLOCK_EVENT_DATA_INVALID');
        const keyDescriptors = Object.getOwnPropertyDescriptors(value);
        if (!keyDescriptors._bn || !('value' in keyDescriptors._bn) ||
            !keyDescriptors._bn.value)
            throw new Error('BLOCK_EVENT_DATA_INVALID');
        validateBoundedBN(keyDescriptors._bn.value, 256);
        const text = PublicKey.prototype.toBase58.call(value);
        budget.bytes += Buffer.byteLength(text);
        if (budget.bytes > MAX_PENDING_EVENT_BYTES)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        return text;
    }
    if (Object.getPrototypeOf(value) === BN.prototype) {
        validateBoundedBN(value);
        const text = BN.prototype.toString.call(value, 10);
        budget.bytes += Buffer.byteLength(text);
        if (budget.bytes > MAX_PENDING_EVENT_BYTES)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        return text;
    }
    if (seen.has(value))
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    seen.add(value);
    if (Array.isArray(value)) {
        if (value.length > 4096)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' &&
            (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
            throw new Error('BLOCK_EVENT_DATA_INVALID');
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const result = [];
        for (let i = 0; i < value.length; i++) {
            const descriptor = descriptors[String(i)];
            if (!descriptor || !('value' in descriptor))
                throw new Error('BLOCK_EVENT_DATA_INVALID');
            result.push(copyJsonValue(descriptor.value, depth + 1, budget, seen));
        }
        seen.delete(value);
        return Object.freeze(result);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 4096 || keys.some(key => typeof key !== 'string'))
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of keys) {
        budget.bytes += Buffer.byteLength(key);
        if (budget.bytes > MAX_PENDING_EVENT_BYTES)
            throw new Error('BLOCK_EVENT_DATA_BOUNDS');
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor))
            throw new Error('BLOCK_EVENT_DATA_INVALID');
        result[key] = copyJsonValue(descriptor.value, depth + 1, budget, seen);
    }
    seen.delete(value);
    return Object.freeze(result);
}
const EVENT_FIELDS = ['name', 'data', 'signature', 'slot', 'received', 'observation'];
const OBSERVATION_FIELDS = ['observationId', 'sourceId', 'providerId', 'transport', 'receivedAt', 'observedAt', 'slot', 'blockHeight', 'commitment', 'signature', 'transactionVersion', 'rawPayloadHash', 'schemaVersion', 'processingIntent'];
const CONTEXT_FIELDS = ['slot', 'bankId', 'blockhash', 'commitment', 'forkLineage'];
const MEMBERSHIP_FIELDS = ['providerId', 'transactionSignatures', 'rawPayloadHash', 'observedAtMs'];
function snapshotEvent(event) {
    const fields = snapshotRecord(event, EVENT_FIELDS);
    const obs = snapshotRecord(fields.observation, OBSERVATION_FIELDS);
    if (typeof fields.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(fields.name) ||
        !Number.isSafeInteger(fields.received) || fields.received < 0 ||
        !Number.isSafeInteger(fields.slot) || fields.slot < 0 ||
        typeof fields.signature !== 'string')
        throw new Error('BLOCK_EVENT_INVALID');
    if (!fields.data || typeof fields.data !== 'object' || Array.isArray(fields.data) ||
        utilTypes.isProxy(fields.data) || (Object.getPrototypeOf(fields.data) !== Object.prototype && Object.getPrototypeOf(fields.data) !== null)) {
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    }
    const data = copyJsonValue(fields.data);
    let serialized;
    try {
        serialized = JSON.stringify(data);
    }
    catch {
        throw new Error('BLOCK_EVENT_DATA_INVALID');
    }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_PENDING_EVENT_BYTES)
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
    const enumValue = (value, values) => typeof value === 'string' && values.includes(value);
    const optionalSafeInt = (value) => value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0);
    const optionalTime = (value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (typeof obs.observationId !== 'string' || obs.observationId.length < 1 || obs.observationId.length > 256 ||
        typeof obs.sourceId !== 'string' || obs.sourceId.length < 1 || obs.sourceId.length > 192 ||
        typeof obs.providerId !== 'string' || obs.providerId.length < 1 || obs.providerId.length > 192 ||
        typeof obs.transport !== 'string' || obs.transport.length < 1 || obs.transport.length > 128 ||
        typeof obs.schemaVersion !== 'string' || obs.schemaVersion.length < 1 || obs.schemaVersion.length > 128 ||
        !Number.isSafeInteger(obs.receivedAt) || Number(obs.receivedAt) < 0 || !optionalTime(obs.observedAt) ||
        !optionalSafeInt(obs.slot) || !optionalSafeInt(obs.blockHeight) ||
        !(obs.commitment === undefined || enumValue(obs.commitment, ['unknown', 'processed', 'confirmed', 'finalized'])) ||
        !(obs.signature === undefined || (typeof obs.signature === 'string' && base58Length(obs.signature, 64))) ||
        !(obs.transactionVersion === undefined || obs.transactionVersion === 'legacy' || obs.transactionVersion === 'unknown' || optionalSafeInt(obs.transactionVersion)) ||
        !(obs.processingIntent === undefined || enumValue(obs.processingIntent, ['LIVE', 'HISTORICAL_REPAIR', 'DETERMINISTIC_REPLAY', 'SHADOW_REPLAY'])) ||
        (obs.rawPayloadHash !== undefined && (typeof obs.rawPayloadHash !== 'string' || !HASH.test(obs.rawPayloadHash)))) {
        throw new Error('BLOCK_EVENT_INVALID');
    }
    const observation = Object.freeze(Object.fromEntries(OBSERVATION_FIELDS.flatMap(key => obs[key] === undefined ? [] : [[key, obs[key]]])));
    const copiedObservation = Object.freeze(Object.fromEntries(Object.entries(observation)));
    const copiedEvent = Object.freeze({ name: fields.name, data, signature: fields.signature, slot: fields.slot,
        received: fields.received, observation: copiedObservation });
    const eventBytes = Buffer.byteLength(JSON.stringify(copiedEvent));
    if (eventBytes > MAX_PENDING_EVENT_BYTES)
        throw new Error('BLOCK_EVENT_DATA_BOUNDS');
    return { event: copiedEvent, bytes: eventBytes };
}
/**
 * A bounded, observation-only join. Context insertion is not authentication:
 * callers must supply same-provider block membership evidence, and resulting
 * envelopes are labeled SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY.
 */
export class BlockContextJoiner {
    maxPendingObservations;
    maxCachedSlots;
    maxSignaturesPerBlock;
    maxTotalSignatures;
    maxPendingBytes;
    unifiedUnit;
    slotContexts = new Map();
    conflictedSlots = new Set();
    pendingObservations = new Map();
    totalPendingCount = 0;
    totalPendingBytes = 0;
    joinedCount = 0;
    evictedCount = 0;
    conflictCapacityExceeded = false;
    totalRetainedSignatures = 0;
    constructor(config = {}) {
        this.maxPendingObservations = config.maxPendingObservations ?? 1000;
        this.maxCachedSlots = config.maxCachedSlots ?? 2000;
        this.maxSignaturesPerBlock = config.maxSignaturesPerBlock ?? 100_000;
        this.maxTotalSignatures = config.maxTotalSignatures ?? 200_000;
        this.maxPendingBytes = config.maxPendingBytes ?? 8 * 1024 * 1024;
        if (!Number.isSafeInteger(this.maxPendingObservations) || this.maxPendingObservations < 1 || this.maxPendingObservations > 100_000 ||
            !Number.isSafeInteger(this.maxCachedSlots) || this.maxCachedSlots < 1 || this.maxCachedSlots > 100_000 ||
            !Number.isSafeInteger(this.maxSignaturesPerBlock) || this.maxSignaturesPerBlock < 1 || this.maxSignaturesPerBlock > 2_000_000 ||
            !Number.isSafeInteger(this.maxTotalSignatures) || this.maxTotalSignatures < 1 || this.maxTotalSignatures > 2_000_000 ||
            this.maxSignaturesPerBlock > this.maxTotalSignatures ||
            !Number.isSafeInteger(this.maxPendingBytes) || this.maxPendingBytes < MAX_PENDING_EVENT_BYTES || this.maxPendingBytes > 256 * 1024 * 1024) {
            throw new Error('BLOCK_CONTEXT_INVALID_BOUNDS');
        }
        this.unifiedUnit = config.unifiedUnit;
    }
    attachUnifiedUnit(unit) { this.unifiedUnit = unit; }
    getUnifiedUnit() { return this.unifiedUnit; }
    /** Registers a source-reported block context with exact transaction membership. */
    registerSlotContext(context, evidence) {
        const contextFields = snapshotRecord(context, CONTEXT_FIELDS);
        const evidenceFields = snapshotRecord(evidence, MEMBERSHIP_FIELDS);
        const lineage = snapshotDenseArray(contextFields.forkLineage, 64);
        const transactionSignatures = snapshotDenseArray(evidenceFields.transactionSignatures, this.maxSignaturesPerBlock);
        const safeContext = Object.freeze({ ...contextFields, forkLineage: Object.freeze(lineage) });
        const safeEvidence = Object.freeze({ ...evidenceFields, transactionSignatures: Object.freeze(transactionSignatures) });
        validateContext(safeContext);
        validateMembershipEvidence(safeEvidence, this.maxSignaturesPerBlock);
        const key = contextKey(safeEvidence.providerId, safeContext.slot);
        if (this.conflictCapacityExceeded || this.conflictedSlots.has(key))
            return Object.freeze([]);
        const existing = this.slotContexts.get(key);
        if (existing && (existing.context.blockhash !== safeContext.blockhash || existing.context.bankId !== safeContext.bankId ||
            JSON.stringify(existing.context.forkLineage) !== JSON.stringify(safeContext.forkLineage) ||
            existing.blockPayloadHash !== safeEvidence.rawPayloadHash ||
            existing.signatures.size !== safeEvidence.transactionSignatures.length ||
            safeEvidence.transactionSignatures.some(signature => !existing.signatures.has(signature)))) {
            this.removeContext(key);
            if (this.conflictedSlots.size >= this.maxCachedSlots)
                this.conflictCapacityExceeded = true;
            else
                this.conflictedSlots.add(key);
            return Object.freeze([]);
        }
        if (!existing) {
            while (this.slotContexts.size >= this.maxCachedSlots ||
                this.totalRetainedSignatures + safeEvidence.transactionSignatures.length > this.maxTotalSignatures) {
                const oldest = this.slotContexts.keys().next().value;
                if (oldest === undefined)
                    return Object.freeze([]);
                this.removeContext(oldest);
            }
        }
        const signatures = new Set(safeEvidence.transactionSignatures);
        const keepExistingCommitment = existing &&
            COMMITMENT_RANK[existing.context.commitment] > COMMITMENT_RANK[safeContext.commitment];
        const stored = Object.freeze({
            context: keepExistingCommitment ? existing.context : safeContext,
            providerId: safeEvidence.providerId,
            signatures,
            blockPayloadHash: safeEvidence.rawPayloadHash,
            observedAtMs: keepExistingCommitment ? existing.observedAtMs : safeEvidence.observedAtMs,
        });
        this.slotContexts.set(key, stored);
        if (!existing)
            this.totalRetainedSignatures += signatures.size;
        const pending = this.pendingObservations.get(key);
        if (!pending)
            return Object.freeze([]);
        this.pendingObservations.delete(key);
        this.totalPendingCount -= pending.length;
        const joined = [];
        const unmatched = [];
        for (const item of pending) {
            const event = item.event;
            if (!stored.signatures.has(event.signature)) {
                unmatched.push(item);
                continue;
            }
            this.totalPendingBytes -= item.bytes;
            joined.push(this.createAndIngestEnvelope(event, stored));
            this.joinedCount++;
        }
        if (unmatched.length) {
            this.pendingObservations.set(key, unmatched);
            this.totalPendingCount += unmatched.length;
        }
        return Object.freeze(joined);
    }
    /** RPC slot + latest blockhash cannot prove slot identity or signature membership. */
    registerFromRpc() {
        throw new Error('RPC_LATEST_BLOCKHASH_CANNOT_PROVE_TRANSACTION_MEMBERSHIP');
    }
    joinObservation(event) {
        let snapshot;
        let snapshotBytes = 0;
        try {
            const captured = snapshotEvent(event);
            snapshot = captured.event;
            snapshotBytes = captured.bytes;
        }
        catch (error) {
            return { joined: false, reason: error instanceof Error ? error.message : 'BLOCK_EVENT_DATA_INVALID', slot: 0n, pendingCount: this.totalPendingCount };
        }
        if (snapshot.observation.slot !== snapshot.slot || snapshot.observation.signature !== snapshot.signature ||
            typeof snapshot.observation.providerId !== 'string' || !LABEL.test(snapshot.observation.providerId) ||
            !base58Length(snapshot.signature, 64) || typeof snapshot.observation.rawPayloadHash !== 'string' ||
            !HASH.test(snapshot.observation.rawPayloadHash) || !snapshot.observation.commitment ||
            !Object.hasOwn(COMMITMENT_RANK, snapshot.observation.commitment)) {
            return { joined: false, reason: 'INVALID_SLOT_OR_TRANSACTION_OBSERVATION', slot: 0n, pendingCount: this.totalPendingCount };
        }
        const slot = BigInt(snapshot.slot);
        const key = contextKey(snapshot.observation.providerId, slot);
        const stored = this.slotContexts.get(key);
        if (stored?.signatures.has(snapshot.signature) &&
            COMMITMENT_RANK[snapshot.observation.commitment] <= COMMITMENT_RANK[stored.context.commitment] &&
            !this.conflictedSlots.has(key) && !this.conflictCapacityExceeded) {
            const envelope = this.createAndIngestEnvelope(snapshot, stored);
            this.joinedCount++;
            return { joined: true, envelope, slot };
        }
        this.enqueuePending(key, snapshot, snapshotBytes);
        const reason = this.conflictedSlots.has(key) || this.conflictCapacityExceeded
            ? 'BLOCK_CONTEXT_CONFLICT'
            : stored && stored.signatures.has(snapshot.signature) ? 'BLOCK_COMMITMENT_BELOW_TRANSACTION'
                : stored ? 'AWAITING_EXACT_SIGNATURE_MEMBERSHIP' : 'AWAITING_SAME_PROVIDER_BLOCK_CONTEXT';
        return { joined: false, reason, slot, pendingCount: this.totalPendingCount };
    }
    enqueuePending(key, event, bytes) {
        if (bytes > this.maxPendingBytes) {
            this.evictedCount++;
            return;
        }
        while (this.totalPendingCount >= this.maxPendingObservations || this.totalPendingBytes + bytes > this.maxPendingBytes) {
            const oldestKey = this.pendingObservations.keys().next().value;
            if (oldestKey === undefined)
                break;
            const events = this.pendingObservations.get(oldestKey);
            if (events?.length) {
                const dropped = events.shift();
                this.totalPendingCount--;
                this.totalPendingBytes -= dropped.bytes;
                this.evictedCount++;
                if (!events.length)
                    this.pendingObservations.delete(oldestKey);
            }
            else
                this.pendingObservations.delete(oldestKey);
        }
        const events = this.pendingObservations.get(key) ?? [];
        events.push({ event, bytes });
        this.pendingObservations.set(key, events);
        this.totalPendingCount++;
        this.totalPendingBytes += bytes;
    }
    removeContext(key) {
        const old = this.slotContexts.get(key);
        if (!old)
            return;
        this.totalRetainedSignatures -= old.signatures.size;
        this.slotContexts.delete(key);
    }
    createAndIngestEnvelope(event, stored) {
        const mint = event.data?.mint?.toBase58?.() ?? (typeof event.data?.mint === 'string' ? event.data.mint : event.signature);
        const payload = {
            name: event.name,
            signature: event.signature,
            slot: event.slot,
            received: event.received,
            data: event.data,
            transactionObservationId: event.observation.observationId,
            transactionPayloadHash: event.observation.rawPayloadHash,
            blockPayloadHash: stored.blockPayloadHash,
            blockObservedAtMs: stored.observedAtMs,
            providerId: stored.providerId,
        };
        const input = {
            eventType: event.name,
            subject: String(mint),
            payload,
            chain: stored.context,
            provenance: {
                providerId: stored.providerId,
                connectionGeneration: 'unknown',
                sourceClass: 'FEED_LOG_BLOCK_MEMBERSHIP_JOIN',
                decoderVersion: 'anchor-pump-v1',
                failureDomain: 'MARKET_INGESTION',
            },
            evidenceClass: 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY',
        };
        return this.unifiedUnit ? this.unifiedUnit.ingestRawReality(input) : createFusionEnvelopeV2(input);
    }
    getSlotContext(slot, providerId) {
        return this.slotContexts.get(contextKey(providerId, BigInt(slot)))?.context;
    }
    getPendingObservationsForSlot(slot, providerId) {
        const events = this.pendingObservations.get(contextKey(providerId, BigInt(slot)));
        return events ? Object.freeze(events.map(item => item.event)) : Object.freeze([]);
    }
    getPendingCount() { return this.totalPendingCount; }
    getRegisteredSlotCount() { return this.slotContexts.size; }
    getJoinedCount() { return this.joinedCount; }
    getEvictedCount() { return this.evictedCount; }
    clear() {
        this.slotContexts.clear();
        this.conflictedSlots.clear();
        this.pendingObservations.clear();
        this.totalPendingCount = 0;
        this.totalPendingBytes = 0;
        this.totalRetainedSignatures = 0;
        this.conflictCapacityExceeded = false;
    }
}
//# sourceMappingURL=block-context-joiner.js.map
/**
 * SYLPH FUSION — OBSERVATION FACTORY
 * Specifications: Frozen Architecture Execution Step 1 (Section 11)
 *
 * Responsibilities:
 * 1. Validates all source provenance attributes against strict safety regular expressions.
 * 2. Deep-copies raw payload bytes into an immutable Uint8Array.
 * 3. Derives 64-character lowercase hexadecimal SHA-256 digest over raw payload bytes.
 * 4. Computes deterministic observation identity binding metadata and payload hash.
 * 5. Binds explicit ProcessingIntent ('LIVE' | 'HISTORICAL_REPAIR' | 'DETERMINISTIC_REPLAY' | 'SHADOW_REPLAY').
 * 6. Strictly rejects malformed or unvalidated input.
 * 7. Constructs privately branded UnvalidatedObservation.
 */
import { createHash } from 'node:crypto';
const SAFE_LABEL_REGEX = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_SCHEMA_REGEX = /^[A-Za-z0-9_.:\/-]{1,128}$/;
const SAFE_ORIGIN_REGEX = /^(https?|wss?):\/\/[^/?#@]+$/;
const VALID_COMMITMENTS = new Set(['processed', 'confirmed', 'finalized', 'unknown']);
const VALID_PROCESSING_INTENTS = new Set([
    'LIVE',
    'HISTORICAL_REPAIR',
    'DETERMINISTIC_REPLAY',
    'SHADOW_REPLAY',
]);
const factoryObservations = new WeakSet();
export function isObservationCreatedByFactory(value) {
    return !!value && typeof value === 'object' && factoryObservations.has(value);
}
/**
 * Validates observation parameters and constructs a branded UnvalidatedObservation.
 * Throws immediately on any contract or invariant violation.
 */
export function createUnvalidatedObservation(params) {
    if (!params || typeof params !== 'object') {
        throw new Error('OBSERVATION_INVALID_PARAMS: Parameters must be a non-null object');
    }
    // 1. Validate Source ID
    if (typeof params.sourceId !== 'string' || !SAFE_LABEL_REGEX.test(params.sourceId)) {
        throw new Error(`OBSERVATION_INVALID_SOURCE_ID: Invalid source ID '${params.sourceId}'`);
    }
    // 2. Validate Provider ID
    if (typeof params.providerId !== 'string' ||
        (!SAFE_LABEL_REGEX.test(params.providerId) && !SAFE_ORIGIN_REGEX.test(params.providerId))) {
        throw new Error(`OBSERVATION_INVALID_PROVIDER_ID: Invalid provider ID '${params.providerId}'`);
    }
    // 3. Validate Transport
    if (typeof params.transport !== 'string' || !SAFE_LABEL_REGEX.test(params.transport)) {
        throw new Error(`OBSERVATION_INVALID_TRANSPORT: Invalid transport '${params.transport}'`);
    }
    // 4. Validate Times
    if (!Number.isFinite(params.receivedAtMs) || params.receivedAtMs <= 0) {
        throw new Error(`OBSERVATION_INVALID_RECEIVED_TIME: Invalid receivedAtMs '${params.receivedAtMs}'`);
    }
    const observedAtMs = params.observedAtMs ?? null;
    if (observedAtMs !== null && (!Number.isFinite(observedAtMs) || observedAtMs <= 0)) {
        throw new Error(`OBSERVATION_INVALID_OBSERVED_TIME: Invalid observedAtMs '${observedAtMs}'`);
    }
    // 5. Validate Slot
    const slot = params.slot ?? null;
    if (slot !== null && (!Number.isSafeInteger(slot) || slot < 0)) {
        throw new Error(`OBSERVATION_INVALID_SLOT: Slot must be non-negative integer, received '${slot}'`);
    }
    // 6. Validate Commitment
    const commitment = params.commitment ?? 'unknown';
    if (!VALID_COMMITMENTS.has(commitment)) {
        throw new Error(`OBSERVATION_INVALID_COMMITMENT: Unknown commitment '${commitment}'`);
    }
    // 7. Validate Signature
    const signature = params.signature ?? null;
    if (signature !== null && (typeof signature !== 'string' || signature.length < 1 || signature.length > 128)) {
        throw new Error(`OBSERVATION_INVALID_SIGNATURE: Malformed signature '${signature}'`);
    }
    // 8. Validate Schema Version
    if (typeof params.schemaVersion !== 'string' || !SAFE_SCHEMA_REGEX.test(params.schemaVersion)) {
        throw new Error(`OBSERVATION_INVALID_SCHEMA_VERSION: Invalid schema version '${params.schemaVersion}'`);
    }
    // 9. Validate Processing Intent
    if (!VALID_PROCESSING_INTENTS.has(params.processingIntent)) {
        throw new Error(`OBSERVATION_INVALID_INTENT: Unknown processing intent '${params.processingIntent}'`);
    }
    if (params.transactionVersion !== undefined && params.transactionVersion !== 'legacy' && params.transactionVersion !== 'unknown' &&
        (!Number.isSafeInteger(params.transactionVersion) || params.transactionVersion < 0)) {
        throw new Error(`OBSERVATION_INVALID_TRANSACTION_VERSION: Invalid transaction version '${params.transactionVersion}'`);
    }
    // 10. Copy and Hash Raw Payload Bytes
    if (!params.rawPayload || !(params.rawPayload instanceof Uint8Array || Buffer.isBuffer(params.rawPayload))) {
        throw new Error('OBSERVATION_INVALID_PAYLOAD: Raw payload must be a non-empty Uint8Array or Buffer');
    }
    if (params.rawPayload.byteLength === 0) {
        throw new Error('OBSERVATION_EMPTY_PAYLOAD: Raw payload cannot be empty');
    }
    const rawPayload = new Uint8Array(params.rawPayload.buffer, params.rawPayload.byteOffset, params.rawPayload.byteLength).slice(); // Deep copy ensuring isolation
    const rawPayloadHash = createHash('sha256')
        .update(rawPayload)
        .digest('hex');
    // 11. Derive Deterministic Observation Identity
    const identityPayload = JSON.stringify({
        sourceId: params.sourceId,
        providerId: params.providerId,
        transport: params.transport,
        observedAtMs,
        slot,
        commitment,
        signature,
        transactionVersion: params.transactionVersion ?? 'unknown',
        rawPayloadHash,
        schemaVersion: params.schemaVersion,
        processingIntent: params.processingIntent,
    });
    const observationId = createHash('sha256')
        .update(identityPayload)
        .digest('hex');
    const data = {
        observationId,
        sourceId: params.sourceId,
        providerId: params.providerId,
        transport: params.transport,
        receivedAtMs: params.receivedAtMs,
        observedAtMs,
        slot,
        commitment,
        signature,
        transactionVersion: params.transactionVersion ?? 'unknown',
        rawPayload,
        rawPayloadHash,
        schemaVersion: params.schemaVersion,
        processingIntent: params.processingIntent,
    };
    const observation = Object.freeze(data);
    factoryObservations.add(observation);
    return observation;
}
//# sourceMappingURL=observation-factory.js.map
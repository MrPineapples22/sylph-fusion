/**
 * SYLPH FUSION — POINT-IN-TIME (PIT) FEATURE & SNAPSHOT BUILDER
 * Specifications: Frozen Architecture Execution Prompt (Section 26, 27)
 *
 * Invariant: Every feature binds source observation, journal sequence, observedAtMs,
 * knownAtMs, evidenceHash, and calculationVersion.
 *
 * Causality Guard: knownAtMs <= decisionTimeMs.
 * Any violation immediately throws PIT_CAUSALITY_VIOLATION.
 * Bigint sequence 0n is handled correctly (never tested with truthiness).
 */
import { createHash } from 'node:crypto';
const PIT_FEATURE_BRAND = Symbol('__pitFeatureBrand__');
const PIT_FEATURE_SNAPSHOT_BRAND = Symbol('__pitFeatureSnapshotBrand__');
function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Map) {
        throw new Error('MUTABLE_MAP_FORBIDDEN: Feature value cannot contain mutable Map');
    }
    if (obj instanceof Set) {
        throw new Error('MUTABLE_SET_FORBIDDEN: Feature value cannot contain mutable Set');
    }
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return Object.freeze(obj);
}
export function isPITFeature(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        obj[PIT_FEATURE_BRAND] === true);
}
export function isPITFeatureSnapshot(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        obj[PIT_FEATURE_SNAPSHOT_BRAND] === true);
}
export function createPITFeature(params) {
    if (!params.featureId || typeof params.featureId !== 'string') {
        throw new Error('INVALID_FEATURE_ID: featureId must be non-empty string');
    }
    if (!params.sourceObservationId || typeof params.sourceObservationId !== 'string') {
        throw new Error('INVALID_SOURCE_OBSERVATION_ID: sourceObservationId must be non-empty string');
    }
    // Sequence zero (0n) is explicitly valid! Never use !params.journalSeq
    if (typeof params.journalSeq !== 'bigint' || params.journalSeq < 0n) {
        throw new Error('INVALID_JOURNAL_SEQUENCE: journalSeq must be a non-negative bigint');
    }
    if (!Number.isSafeInteger(params.observedAtMs) || params.observedAtMs <= 0) {
        throw new Error('INVALID_OBSERVED_AT_MS: observedAtMs must be positive safe integer');
    }
    if (!Number.isSafeInteger(params.knownAtMs) || params.knownAtMs < params.observedAtMs) {
        throw new Error('INVALID_KNOWN_AT_MS: knownAtMs must be safe integer >= observedAtMs');
    }
    if (typeof params.evidenceHash !== 'string' ||
        params.evidenceHash.length !== 64 ||
        !/^[0-9a-fA-F]{64}$/.test(params.evidenceHash)) {
        throw new Error('INVALID_EVIDENCE_HASH: evidenceHash must be 64-character hex string');
    }
    if (!params.calculationVersion || typeof params.calculationVersion !== 'string') {
        throw new Error('INVALID_CALCULATION_VERSION: calculationVersion must be non-empty string');
    }
    // Derive deterministic feature hash
    const serializedValue = JSON.stringify(params.value);
    const hashMaterial = [
        params.featureId,
        params.sourceObservationId,
        params.journalSeq.toString(),
        params.observedAtMs.toString(),
        params.knownAtMs.toString(),
        params.evidenceHash.toLowerCase(),
        params.calculationVersion,
        serializedValue,
    ].join(':');
    const featureHash = createHash('sha256').update(hashMaterial).digest('hex');
    const feature = {
        [PIT_FEATURE_BRAND]: true,
        featureId: params.featureId,
        sourceObservationId: params.sourceObservationId,
        journalSeq: params.journalSeq,
        observedAtMs: params.observedAtMs,
        knownAtMs: params.knownAtMs,
        evidenceHash: params.evidenceHash.toLowerCase(),
        calculationVersion: params.calculationVersion,
        value: params.value,
        featureHash,
    };
    return deepFreeze(feature);
}
export function buildPITFeatureSnapshot(params) {
    if (!params.snapshotId || typeof params.snapshotId !== 'string') {
        throw new Error('INVALID_SNAPSHOT_ID: snapshotId must be non-empty string');
    }
    if (!Array.isArray(params.features)) {
        throw new Error('INVALID_FEATURES: features must be an array');
    }
    if (!Number.isSafeInteger(params.decisionTimeMs) || params.decisionTimeMs <= 0) {
        throw new Error('INVALID_DECISION_TIME: decisionTimeMs must be positive safe integer');
    }
    let maxKnownAt = 0;
    for (const f of params.features) {
        if (!isPITFeature(f)) {
            throw new Error(`UNBRANDED_FEATURE_REJECTED: Feature ${f?.featureId ?? 'unknown'} is not an authenticated PITFeature`);
        }
        // POINT-IN-TIME CAUSALITY INVARIANT: knownAtMs <= decisionTimeMs
        if (f.knownAtMs > params.decisionTimeMs) {
            throw new Error(`PIT_CAUSALITY_VIOLATION: Feature ${f.featureId} knownAtMs (${f.knownAtMs}) > decisionTimeMs (${params.decisionTimeMs})`);
        }
        if (f.knownAtMs > maxKnownAt) {
            maxKnownAt = f.knownAtMs;
        }
    }
    // Derive Merkle-style root over lexicographically sorted feature hashes
    const sortedHashes = params.features
        .map(f => `${f.featureId}:${f.featureHash}`)
        .sort()
        .join('|');
    const featureRoot = createHash('sha256').update(sortedHashes).digest('hex');
    const snapshot = {
        [PIT_FEATURE_SNAPSHOT_BRAND]: true,
        snapshotId: params.snapshotId,
        features: Object.freeze([...params.features]),
        featureRoot,
        maxKnownAtMs: maxKnownAt,
        featureCount: params.features.length,
    };
    return Object.freeze(snapshot);
}
//# sourceMappingURL=pit-snapshot.js.map
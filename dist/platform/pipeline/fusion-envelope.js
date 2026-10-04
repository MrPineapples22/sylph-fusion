/**
 * SYLPH FUSION — CANONICAL FUSION ENVELOPE
 * Specifications: Prompt 3, Prompt 4, Prompt 5, Prompt 39
 *
 * Represents ONE economic opportunity/fact traveling through the entire architecture.
 * Carries content hashes, root hashes, stable IDs, and certificate references.
 *
 * Invariants:
 * 1. ONE economicFactId survives the complete lifecycle.
 * 2. Immutable identity guards: envelopeId, economicFactId, traceId cannot drift.
 * 3. Transport attempt != new economic intent.
 * 4. ACCEPTED != LANDED; UNKNOWN != FAILED.
 */
import { hashCanonical } from './canonical-hashing.js';
/**
 * Calculates deterministic root hash of an envelope.
 */
export function envelopeRoot(envelope) {
    return hashCanonical(envelope);
}
/**
 * Validates that an updated envelope maintains strict immutable identity invariants.
 * Throws immediately if identity drift is detected.
 */
/**
 * SYLPH FUSION — CANONICAL FUSION ENVELOPE V2
 * Specifications: Master Blueprint Section IV (Fusion Envelope V2)
 */
import { createHash } from 'node:crypto';
export function createFusionEnvelopeV2(params) {
    // Master Blueprint Section IV Invariant: Never fabricate confirmed head from slot - 1
    if (params.chain.commitment === 'confirmed' && (!params.chain.blockhash || params.chain.blockhash.length < 32)) {
        throw new Error('CONFIRMED_HEAD_FABRICATION_FORBIDDEN: Confirmed commitment requires explicit blockhash and bankId');
    }
    const payloadHash = hashCanonical(params.payload);
    const nowWall = Date.now();
    const monotonic = typeof process.hrtime === 'function' ? Number(process.hrtime.bigint()) : nowWall * 1_000_000;
    const time = {
        providerTimestamp: params.time?.providerTimestamp ?? nowWall,
        localWallTimestamp: params.time?.localWallTimestamp ?? nowWall,
        monotonicTimestamp: params.time?.monotonicTimestamp ?? monotonic,
        availableAt: params.time?.availableAt ?? nowWall,
    };
    const idPayload = `${params.eventType}:${params.subject}:${params.chain.slot}:${params.chain.bankId}:${payloadHash}:${time.monotonicTimestamp}`;
    const envelopeId = `env_v2_${createHash('sha256').update(idPayload).digest('hex').slice(0, 24)}`;
    return {
        schemaVersion: '2.0.0',
        envelopeId,
        eventType: params.eventType,
        subject: params.subject,
        payload: params.payload,
        chain: params.chain,
        time,
        provenance: params.provenance,
        evidenceClass: params.evidenceClass,
        payloadHash,
        forkStatus: params.forkStatus ?? 'FORK_OBSERVED',
    };
}
export function assertIdentityInvariant(original, updated) {
    if (updated.envelopeId !== undefined && updated.envelopeId !== original.envelopeId) {
        throw new Error(`IDENTITY_DRIFT_ERROR: envelopeId mismatch! original=${original.envelopeId}, updated=${updated.envelopeId}`);
    }
    if (updated.economicFactId !== undefined && updated.economicFactId !== original.economicFactId) {
        throw new Error(`IDENTITY_DRIFT_ERROR: economicFactId mismatch! original=${original.economicFactId}, updated=${updated.economicFactId}`);
    }
    if (updated.traceId !== undefined && updated.traceId !== original.traceId) {
        throw new Error(`IDENTITY_DRIFT_ERROR: traceId mismatch! original=${original.traceId}, updated=${updated.traceId}`);
    }
}
//# sourceMappingURL=fusion-envelope.js.map
/**
 * SYLPH FUSION — CANONICAL EVENT ADAPTER
 * Specifications: Prompt 2, Prompt 13, Prompt 21, Prompt 22
 *
 * Connects the existing Canonical Event Journal and SylphEvent architecture into
 * the Fusion pipeline without duplicating raw events.
 *
 * Provenance:
 *   Raw observation
 *   → SylphEvent
 *   → canonical event hash (checksum/rawHash)
 *   → FusionEnvelope
 *   → transition certificate
 *   → state root
 */
import { hashCanonical } from '../canonical-hashing.js';
/**
 * Transforms an authoritative SylphEvent into the canonical FusionEnvelope.
 * Binds slot, timestamps, raw event checksum, and stable identifiers.
 */
export function envelopeFromSylphEvent(event, options) {
    const cluster = options?.cluster ?? (event.environment === 'PRODUCTION' ? 'mainnet-beta' : 'simulation');
    const observedSlot = BigInt(event.slot ?? 0);
    // Solana Bank-State Fingerprint (Prompt 22)
    const bankFingerprint = options?.bankFingerprint ??
        hashCanonical({
            slot: event.slot,
            commitment: event.commitment ?? 'confirmed',
            source: event.source,
            signature: event.transactionSignature,
            chainTime: event.chainTime,
        });
    const observedAt = new Date(event.observedAt).toISOString();
    const knownAt = new Date(event.receivedAt).toISOString();
    const occurredAt = event.chainTime ? new Date(event.chainTime).toISOString() : observedAt;
    const eventChecksum = event.checksum ?? event.rawHash ?? hashCanonical(event.payload);
    const evidenceRoot = options?.evidenceRoot ?? eventChecksum;
    return Object.freeze({
        envelopeId: `env_${event.eventId}`,
        economicFactId: event.canonicalKey ?? `fact_${event.mint}_${event.sequence}`,
        traceId: event.correlationId,
        cluster,
        observedSlot,
        bankFingerprint,
        occurredAt,
        observedAt,
        knownAt,
        evidenceRoot,
        coverageCertificate: options?.coverageCertificate,
        transportAttempts: Object.freeze([]),
        certificateChain: Object.freeze([]),
        state: 'OBSERVED',
    });
}
/**
 * Creates transition request parameters for advancing EVIDENCE_CERTIFIED
 * using a SylphEvent as the canonical evidence source.
 */
export function createEvidenceCertifiedTransitionRequest(event, coverageCertificate) {
    const eventChecksum = event.checksum ?? event.rawHash ?? hashCanonical(event.payload);
    return {
        targetState: 'EVIDENCE_CERTIFIED',
        authority: 'OBSERVE',
        envelopePatch: {
            coverageCertificate,
            evidenceRoot: eventChecksum,
        },
        canonicalEventId: event.eventId,
        canonicalEventChecksum: eventChecksum,
        observedAt: new Date(event.processedAt).toISOString(),
    };
}
//# sourceMappingURL=canonical-event-adapter.js.map
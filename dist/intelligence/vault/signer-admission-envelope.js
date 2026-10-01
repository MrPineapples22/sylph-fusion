/**
 * SYLPH FUSION — Signer Admission Envelope V1
 * Architectural Directive: No verified SignerAdmissionEnvelope -> No exposure-increasing signature.
 *
 * Cryptographically binds capital reservations, commit certificates, execution witness digests,
 * control/revocation epochs, fee ceilings, and exact message hashes before signing admission.
 */
import { createHash } from 'node:crypto';
export function createSignerAdmissionEnvelope(params) {
    const payload = [
        params.intentId,
        params.reservationId,
        params.commitGeneration.toString(),
        params.commitDigest,
        params.exactMessageHash,
        params.executionWitnessDigest,
        params.controlEpoch.toString(),
        params.revocationEpoch.toString(),
        params.maxPrincipalLamports.toString(),
        params.maxNetworkFeeLamports.toString(),
        params.maxPriorityFeeLamports.toString(),
        params.maxTipLamports.toString(),
        params.expiresAtSlot.toString(),
    ].join(':');
    const envelopeHash = createHash('sha256').update(payload).digest('hex');
    const envelopeId = `ADMIT-${envelopeHash.slice(0, 16)}`;
    return Object.freeze({
        envelopeId,
        intentId: params.intentId,
        reservationId: params.reservationId,
        commitGeneration: params.commitGeneration,
        commitDigest: params.commitDigest,
        exactMessageHash: params.exactMessageHash,
        executionWitnessDigest: params.executionWitnessDigest,
        controlEpoch: params.controlEpoch,
        revocationEpoch: params.revocationEpoch,
        maxPrincipalLamports: params.maxPrincipalLamports,
        maxNetworkFeeLamports: params.maxNetworkFeeLamports,
        maxPriorityFeeLamports: params.maxPriorityFeeLamports,
        maxTipLamports: params.maxTipLamports,
        expiresAtSlot: params.expiresAtSlot,
        envelopeHash,
    });
}
//# sourceMappingURL=signer-admission-envelope.js.map
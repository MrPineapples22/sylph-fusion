/**
 * SYLPH FUSION — ASSURANCE FABRIC: PROOF ARTIFACT CONTRACT
 * Specifications: Master Blueprint Section XXXIV, XXXV (Proof Artifact Contract)
 *
 * Invariant: Every authority-bearing decision requires typed, hash-chained, cryptographic proof artifacts.
 */
import { createHash, createHmac } from 'node:crypto';
export function computePayloadHash(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export function computeProofArtifactDigest(params) {
    const pHash = params.payloadHash ?? computePayloadHash(params.payload);
    const sortedDeps = [...params.dependencies].sort().join(';');
    const sortedRoots = [...params.evidenceRoots].sort().join(';');
    const digestPayload = [
        params.schemaVersion,
        params.artifactType,
        params.subject,
        JSON.stringify(params.claim),
        params.evidenceClass,
        params.issuer,
        params.issuerRole,
        params.issuedAt,
        params.validFrom,
        params.validUntil,
        params.stateRoot,
        params.policyRoot,
        params.configRoot,
        params.releaseRoot,
        params.controlEpoch,
        params.revocationEpoch,
        sortedDeps,
        sortedRoots,
        pHash,
    ].join('|');
    return createHash('sha256').update(digestPayload).digest('hex');
}
export function createProofArtifact(params) {
    const now = Date.now();
    const payloadHash = computePayloadHash(params.payload);
    const dependencies = params.dependencies ?? [];
    const evidenceRoots = params.evidenceRoots ?? [];
    const base = {
        schemaVersion: '1.0.0',
        artifactType: params.artifactType,
        subject: params.subject,
        claim: params.claim,
        evidenceClass: params.evidenceClass,
        issuer: params.issuer,
        issuerRole: params.issuerRole,
        issuedAt: now,
        validFrom: now,
        validUntil: now + params.validDurationMs,
        stateRoot: params.stateRoot,
        policyRoot: params.policyRoot,
        configRoot: params.configRoot,
        releaseRoot: params.releaseRoot,
        controlEpoch: params.controlEpoch,
        revocationEpoch: params.revocationEpoch,
        dependencies,
        evidenceRoots,
        payload: params.payload,
        payloadHash,
    };
    const digest = computeProofArtifactDigest(base);
    const signature = createHmac('sha256', params.signingKey).update(digest).digest('hex');
    const artifactId = `art_${digest.slice(0, 20)}`;
    return {
        ...base,
        artifactId,
        signature,
    };
}
export function verifyProofArtifact(artifact, signingKey, nowMs = Date.now()) {
    if (nowMs < artifact.validFrom || nowMs > artifact.validUntil) {
        return { isValid: false, reason: `EXPIRED: Valid from ${artifact.validFrom} to ${artifact.validUntil}, current is ${nowMs}` };
    }
    const expectedPayloadHash = computePayloadHash(artifact.payload);
    if (artifact.payloadHash !== expectedPayloadHash) {
        return { isValid: false, reason: 'PAYLOAD_TAMPERED: Payload hash does not match payload content' };
    }
    const digest = computeProofArtifactDigest(artifact);
    const expectedSig = createHmac('sha256', signingKey).update(digest).digest('hex');
    if (artifact.signature !== expectedSig) {
        return { isValid: false, reason: 'INVALID_SIGNATURE: Proof cryptographic signature verification failed' };
    }
    return { isValid: true };
}
//# sourceMappingURL=proof-artifact.js.map
/**
 * SYLPH FUSION — CERTIFICATE CHAIN
 * Specifications: Prompt 10, Prompt 52
 *
 * Cryptographic certificate binding for every major pipeline transition.
 * Certificate chain is append-only and independently verifiable.
 *
 * Certificate binds:
 *   certificateId
 *   kind
 *   authority
 *   envelopeId
 *   economicFactId
 *   fromState
 *   toState
 *   predecessorCertificateHash
 *   envelopeRoot
 *   previousStateRoot
 *   nextStateRoot
 *   evidenceRoot
 *   issuedAt
 *   payloadRoot?
 *   certificateHash = H(canonical(fields_without_certificateHash))
 */
import { hashCanonical } from './canonical-hashing.js';
export const GENESIS_PREDECESSOR_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
/**
 * Computes deterministic SHA-256 certificate hash over all fields excluding certificateHash.
 */
export function computeCertificateHash(input) {
    return hashCanonical({
        certificateId: input.certificateId,
        kind: input.kind,
        authority: input.authority,
        envelopeId: input.envelopeId,
        economicFactId: input.economicFactId,
        fromState: input.fromState,
        toState: input.toState,
        predecessorCertificateHash: input.predecessorCertificateHash,
        envelopeRoot: input.envelopeRoot,
        previousStateRoot: input.previousStateRoot,
        nextStateRoot: input.nextStateRoot,
        evidenceRoot: input.evidenceRoot,
        issuedAt: input.issuedAt,
        payloadRoot: input.payloadRoot,
    });
}
/**
 * Creates a verified immutable FusionCertificate.
 */
export function createCertificate(input) {
    const certificateHash = computeCertificateHash(input);
    return Object.freeze({
        ...input,
        certificateHash,
    });
}
export class CertificateChain {
    certificates = [];
    lastCertificateHash = GENESIS_PREDECESSOR_HASH;
    /**
     * Returns current latest certificate hash in chain (or genesis hash if empty).
     */
    root() {
        return this.lastCertificateHash;
    }
    /**
     * Appends a new certificate to the chain, validating predecessor continuity.
     */
    append(input) {
        const certInput = {
            ...input,
            predecessorCertificateHash: this.lastCertificateHash,
        };
        const cert = createCertificate(certInput);
        this.certificates.push(cert);
        this.lastCertificateHash = cert.certificateHash;
        return cert;
    }
    /**
     * Returns an immutable copy of all certificates.
     */
    all() {
        return Object.freeze([...this.certificates]);
    }
    /**
     * Count of certificates in chain.
     */
    count() {
        return this.certificates.length;
    }
    /**
     * Verifies cryptographic chain integrity and predecessor links.
     */
    verify() {
        let expectedPredecessor = GENESIS_PREDECESSOR_HASH;
        for (let i = 0; i < this.certificates.length; i++) {
            const cert = this.certificates[i];
            // 1. Predecessor linkage check
            if (cert.predecessorCertificateHash !== expectedPredecessor) {
                return {
                    valid: false,
                    error: `BROKEN_CHAIN: Certificate index ${i} has predecessor ${cert.predecessorCertificateHash} != expected ${expectedPredecessor}`,
                };
            }
            // 2. Hash integrity check
            const expectedHash = computeCertificateHash(cert);
            if (cert.certificateHash !== expectedHash) {
                return {
                    valid: false,
                    error: `TAMPER_DETECTED: Certificate index ${i} (${cert.certificateId}) has invalid hash ${cert.certificateHash} != computed ${expectedHash}`,
                };
            }
            expectedPredecessor = cert.certificateHash;
        }
        return { valid: true };
    }
}
//# sourceMappingURL=certificate-chain.js.map
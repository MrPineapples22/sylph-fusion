/**
 * SYLPH FUSION — NO-LAND VERIFICATION AUTHORITY & FINALIZED SETTLEMENT CERTIFICATES
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2, 7).
 *
 * Legacy terminal-certificate data and checksum helpers. A digest establishes
 * field consistency, not chain truth or authorization. Both terminal issuers
 * are quarantined pending signature-bound chain-evidence verification.
 * Caller assertions and block height do not establish historical absence.
 *
 * Invariant: ZERO reservation release or generation advancement without terminal proof.
 */
import { createHash } from 'node:crypto';
export class NoLandVerificationAuthority {
    /**
     * Computes deterministic SHA-256 digest for a NoLandCertificate
     */
    static computeNoLandDigest(params) {
        return createHash('sha256')
            .update('NO_LAND:')
            .update(params.intentId)
            .update(`:${params.generation}:`)
            .update(params.signature)
            .update(`:${params.lastValidBlockHeight}:`)
            .update(`${params.observedBlockHeight}:`)
            .update(`${params.finalizedSlot}:`)
            .update(params.rpcEndpoint)
            .digest('hex');
    }
    /**
     * Computes deterministic SHA-256 digest for a FinalizedSettlementCertificate
     */
    static computeSettlementDigest(params) {
        return createHash('sha256')
            .update('FINALIZED_SETTLEMENT:')
            .update(params.intentId)
            .update(`:${params.generation}:`)
            .update(params.signature)
            .update(`:${params.slot}:`)
            .update(`${params.feeLamports}:`)
            .update(`${params.status}:`)
            .update(`${params.tokenDelta}:`)
            .update(`${params.solDelta}`)
            .digest('hex');
    }
    /**
     * Checks field consistency only; this is not evidence verification.
     * A matching digest must never authorize a terminal transition.
     */
    static validateCertificateDigest(cert) {
        if ('certificateType' in cert && cert.certificateType === 'NO_LAND_CERTIFICATE') {
            const expected = this.computeNoLandDigest({
                intentId: cert.intentId,
                generation: cert.generation,
                signature: cert.signature,
                lastValidBlockHeight: cert.lastValidBlockHeight,
                observedBlockHeight: cert.observedBlockHeight,
                finalizedSlot: cert.finalizedSlot,
                rpcEndpoint: cert.rpcEndpoint,
            });
            return cert.proofDigest === expected;
        }
        if ('certificateType' in cert && cert.certificateType === 'FINALIZED_SETTLEMENT_CERTIFICATE') {
            const expected = this.computeSettlementDigest({
                intentId: cert.intentId,
                generation: cert.generation,
                signature: cert.signature,
                slot: cert.slot,
                feeLamports: cert.feeLamports,
                status: cert.status,
                tokenDelta: cert.tokenDelta,
                solDelta: cert.solDelta,
            });
            return cert.proofDigest === expected;
        }
        return false;
    }
    /**
     * Legacy API retained to reject existing callers explicitly. No trusted
     * history-verification authority exists yet; booleans cannot substitute for it.
     */
    static certifyNoLand(_params) {
        throw new Error('NO_LAND_CERTIFICATION_UNAVAILABLE: Verified historical absence authority is not implemented; retain UNKNOWN');
    }
    /**
     * Legacy API retained to reject callers. No trusted, signature-bound
     * settlement evidence authority exists; caller fields cannot substitute for it.
     */
    static certifySettlement(_params) {
        throw new Error('SETTLEMENT_CERTIFICATION_UNAVAILABLE: Verified settlement authority is not implemented; retain UNKNOWN');
    }
}
//# sourceMappingURL=no-land-certificate.js.map
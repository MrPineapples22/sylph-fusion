/**
 * SYLPH FUSION — NO-LAND VERIFICATION AUTHORITY & FINALIZED SETTLEMENT CERTIFICATES
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2, 7).
 *
 * Implements cryptographic terminal certificates:
 * 1. FinalizedSettlementCertificate: Proof that an execution generation landed and settled on chain.
 * 2. NoLandCertificate: Irrefutable proof that a transaction generation DID NOT land and cannot land
 *    (block height exceeded AND verified absent from finalized ledger history).
 *
 * Invariant: ZERO reservation release or generation advancement without terminal proof.
 */
import { createHash } from 'node:crypto';
export class NoLandVerificationAuthority {
    static SAFETY_CONFIRMATION_SLOTS = 32;
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
     * Validates cryptographic digest on a certificate
     */
    static validateCertificateDigest(cert) {
        if (cert.certificateType === 'NO_LAND_CERTIFICATE') {
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
        if (cert.certificateType === 'FINALIZED_SETTLEMENT_CERTIFICATE') {
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
     * Constructs and certifies a NoLandCertificate with fail-closed invariant checks
     */
    static certifyNoLand(params) {
        if (!params.searchHistoryConfirmedNotFound) {
            throw new Error(`TRANSACTION_STATUS_UNCERTAIN: Cannot certify no-land for ${params.signature} without positive RPC confirmation of absence from finalized history`);
        }
        if (params.observedBlockHeight <= params.lastValidBlockHeight) {
            throw new Error(`PREMATURE_EXPIRY_ASSERTION: Observed block height ${params.observedBlockHeight} <= lastValidBlockHeight ${params.lastValidBlockHeight}`);
        }
        const proofDigest = this.computeNoLandDigest(params);
        return {
            certificateType: 'NO_LAND_CERTIFICATE',
            intentId: params.intentId,
            generation: params.generation,
            signature: params.signature,
            lastValidBlockHeight: params.lastValidBlockHeight,
            observedBlockHeight: params.observedBlockHeight,
            finalizedSlot: params.finalizedSlot,
            verifiedAt: Date.now(),
            rpcEndpoint: params.rpcEndpoint,
            proofDigest,
        };
    }
    /**
     * Constructs and certifies a FinalizedSettlementCertificate
     */
    static certifySettlement(params) {
        if (params.slot <= 0) {
            throw new Error(`INVALID_SETTLEMENT_SLOT: Slot must be positive (got ${params.slot})`);
        }
        const proofDigest = this.computeSettlementDigest(params);
        return {
            certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE',
            intentId: params.intentId,
            generation: params.generation,
            signature: params.signature,
            slot: params.slot,
            blockTime: params.blockTime,
            feeLamports: params.feeLamports,
            status: params.status,
            tokenDelta: params.tokenDelta,
            solDelta: params.solDelta,
            finalizedAt: Date.now(),
            proofDigest,
        };
    }
}
//# sourceMappingURL=no-land-certificate.js.map
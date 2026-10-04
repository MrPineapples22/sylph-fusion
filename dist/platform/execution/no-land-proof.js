/**
 * SYLPH FUSION — NO-LAND PROOF AUTHORITY & VERIFICATION ENGINE
 * Specifications: Prompt 16, Prompt 17, Prompt 41
 *
 * Implements real, multi-provider, archive-verified proof of transaction non-landing.
 *
 * Epistemic Invariants:
 * 1. UNKNOWN != FALSE
 * 2. Timeout != NoLand
 * 3. Expiry != NoLand
 * 4. Send failure != NoLand
 * 5. Bundle absence != NoLand
 * 6. Single RPC absence != NoLand
 * 7. Single getSignatureStatuses null != NoLand
 * 8. CERTIFIED_NOLAND requires verified multi-provider archive coverage across [startSlot, endSlot].
 * 9. Unproven transactions remain EXPIRED_UNRESOLVED; capital remains logically encumbered (Unknown Liability).
 */
import { hashCanonical } from '../pipeline/canonical-hashing.js';
export class NoLandProofAuthority {
    static MINIMUM_INDEPENDENT_ARCHIVES = 2;
    /**
     * Evaluates historical absence evidence across multiple providers.
     * Strictly enforces that absence cannot be inferred from timeouts, single providers,
     * or incomplete search ranges.
     */
    static evaluateProof(input) {
        const { signature, cluster, transactionLifetime, searchRange, commitmentLevel, providerResults } = input;
        // 1. Invariant: Commitment must be finalized
        if (commitmentLevel !== 'finalized') {
            return {
                certified: false,
                failureReason: `UNFINALIZED_SEARCH: NoLand cannot be certified with commitment '${commitmentLevel}'. Requires 'finalized'`,
                recommendedState: 'EXPIRED_UNRESOLVED',
            };
        }
        // 2. Invariant: Search end slot must be at or beyond the last valid slot
        if (searchRange.searchEndSlot < transactionLifetime.lastValidSlot) {
            return {
                certified: false,
                failureReason: `INCOMPLETE_RANGE: searchEndSlot (${searchRange.searchEndSlot}) < lastValidSlot (${transactionLifetime.lastValidSlot})`,
                recommendedState: 'EXPIRED_UNRESOLVED',
            };
        }
        // 3. Invariant: Quorum of independent healthy archive providers
        const healthyArchiveResults = providerResults.filter(p => p.isHealthy && p.providerType === 'ARCHIVE_RPC');
        if (healthyArchiveResults.length < this.MINIMUM_INDEPENDENT_ARCHIVES) {
            return {
                certified: false,
                failureReason: `INSUFFICIENT_ARCHIVE_QUORUM: Required at least ${this.MINIMUM_INDEPENDENT_ARCHIVES} independent archive RPCs, found ${healthyArchiveResults.length}`,
                recommendedState: 'EXPIRED_UNRESOLVED',
            };
        }
        // 4. Invariant: Check for transaction presence or conflicting observations
        const foundProviders = providerResults.filter(p => p.signatureFound === true);
        if (foundProviders.length > 0) {
            return {
                certified: false,
                failureReason: `TRANSACTION_OBSERVED: Signature ${signature} was found on ${foundProviders.map(p => p.providerEndpoint).join(', ')}`,
                recommendedState: 'DISPUTED',
            };
        }
        // 5. Invariant: Verify archive coverage continuity (no gaps in slot coverage)
        let coverageGaps = 0;
        for (const p of healthyArchiveResults) {
            if (p.archiveCoverageStartSlot > searchRange.searchStartSlot || p.archiveCoverageEndSlot < searchRange.searchEndSlot) {
                coverageGaps++;
            }
        }
        if (coverageGaps > 0) {
            return {
                certified: false,
                failureReason: `ARCHIVE_COVERAGE_GAP: ${coverageGaps} archive provider(s) do not fully cover the transaction lifetime window [${searchRange.searchStartSlot}, ${searchRange.searchEndSlot}]`,
                recommendedState: 'EXPIRED_UNRESOLVED',
            };
        }
        // All conditions satisfied: issue cryptographic ProvenNoLandCertificate
        const issuedAt = new Date().toISOString();
        const certificateId = `noland_cert_${signature.slice(0, 16)}_${Date.now()}`;
        const certPayload = {
            certificateType: 'PROVEN_NO_LAND_CERTIFICATE',
            certificateId,
            signature,
            cluster,
            transactionLifetime: {
                blockhash: transactionLifetime.blockhash,
                startSlot: `${transactionLifetime.startSlot}n`,
                lastValidBlockHeight: `${transactionLifetime.lastValidBlockHeight}n`,
                lastValidSlot: `${transactionLifetime.lastValidSlot}n`,
            },
            searchStartSlot: `${searchRange.searchStartSlot}n`,
            searchEndSlot: `${searchRange.searchEndSlot}n`,
            commitmentLevel,
            providersQueriedCount: providerResults.length,
            archiveProvidersCount: healthyArchiveResults.length,
            coverageGapsIdentified: 0,
            verifiedNonLanding: true,
            issuedAt,
        };
        const certificateHash = hashCanonical(certPayload);
        const certificate = Object.freeze({
            certificateType: 'PROVEN_NO_LAND_CERTIFICATE',
            certificateId,
            signature,
            cluster,
            transactionLifetime,
            searchStartSlot: searchRange.searchStartSlot,
            searchEndSlot: searchRange.searchEndSlot,
            commitmentLevel,
            providersQueriedCount: providerResults.length,
            archiveProvidersCount: healthyArchiveResults.length,
            coverageGapsIdentified: 0,
            verifiedNonLanding: true,
            issuedAt,
            certificateHash,
        });
        return { certified: true, certificate };
    }
}
//# sourceMappingURL=no-land-proof.js.map
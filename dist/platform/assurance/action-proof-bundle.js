/**
 * SYLPH FUSION — ASSURANCE FABRIC: ACTION PROOF BUNDLE
 * Specifications: Master Blueprint Section XXXVI (Action Proof Bundle)
 *
 * Invariant: Every capital-increasing action must present a complete, unrevoked ActionProofBundle.
 * Missing evidence can never become favorable evidence.
 */
import { createHash } from 'node:crypto';
export function computeActionProofBundleHash(bundle) {
    const parts = [
        bundle.actionId,
        bundle.exactActionHash,
        bundle.exactTransactionHash,
        bundle.marketTruthCertificate.artifactId,
        bundle.tokenSemanticsCertificate.artifactId,
        bundle.alphaRealityCertificate.artifactId,
        bundle.signalPortfolioCertificate.artifactId,
        bundle.executionPolicyCertificate.artifactId,
        bundle.simulationCertificate.artifactId,
        bundle.exitabilityCertificate.artifactId,
        bundle.portfolioEvacuationCertificate.artifactId,
        bundle.capitalAllocationCertificate.artifactId,
        bundle.reservationCertificate.artifactId,
        bundle.survivalCertificate.artifactId,
        bundle.twinTrustCertificate.artifactId,
        bundle.releaseVSA,
        bundle.configVSA,
        bundle.policyVSA,
        bundle.governorVSA,
        bundle.controlEpoch,
        bundle.fenceEpoch,
        bundle.revocationRoot,
        bundle.validUntilSlot.toString(),
        bundle.validUntilTime,
        bundle.proofGraphRoot,
    ].join(':');
    return createHash('sha256').update(parts).digest('hex');
}
export function validateActionProofBundle(bundle, activeRoots) {
    const reasons = [];
    // 1. Temporal & Slot Validity
    if (activeRoots.currentTime > bundle.validUntilTime) {
        reasons.push(`BUNDLE_EXPIRED_TIME: Current time ${activeRoots.currentTime} > validUntil ${bundle.validUntilTime}`);
    }
    if (activeRoots.currentSlot > bundle.validUntilSlot) {
        reasons.push(`BUNDLE_EXPIRED_SLOT: Current slot ${activeRoots.currentSlot} > validUntil ${bundle.validUntilSlot}`);
    }
    // 2. Epoch Validity
    if (bundle.controlEpoch !== activeRoots.controlEpoch) {
        reasons.push(`STALE_CONTROL_EPOCH: Bundle epoch ${bundle.controlEpoch} != active ${activeRoots.controlEpoch}`);
    }
    if (bundle.fenceEpoch !== activeRoots.fenceEpoch) {
        reasons.push(`STALE_FENCE_EPOCH: Bundle fence epoch ${bundle.fenceEpoch} != active ${activeRoots.fenceEpoch}`);
    }
    // 3. Roots Parity
    if (bundle.releaseVSA !== activeRoots.releaseRoot) {
        reasons.push(`RELEASE_ROOT_MISMATCH: Bundle built against ${bundle.releaseVSA}, active is ${activeRoots.releaseRoot}`);
    }
    if (bundle.configVSA !== activeRoots.configRoot) {
        reasons.push(`CONFIG_ROOT_MISMATCH: Bundle built against ${bundle.configVSA}, active is ${activeRoots.configRoot}`);
    }
    if (bundle.policyVSA !== activeRoots.policyRoot) {
        reasons.push(`POLICY_ROOT_MISMATCH: Bundle built against ${bundle.policyVSA}, active is ${activeRoots.policyRoot}`);
    }
    // 4. Mandatory Certificate Presence
    const mandatoryCerts = [
        { name: 'marketTruthCertificate', cert: bundle.marketTruthCertificate },
        { name: 'tokenSemanticsCertificate', cert: bundle.tokenSemanticsCertificate },
        { name: 'alphaRealityCertificate', cert: bundle.alphaRealityCertificate },
        { name: 'signalPortfolioCertificate', cert: bundle.signalPortfolioCertificate },
        { name: 'executionPolicyCertificate', cert: bundle.executionPolicyCertificate },
        { name: 'simulationCertificate', cert: bundle.simulationCertificate },
        { name: 'exitabilityCertificate', cert: bundle.exitabilityCertificate },
        { name: 'portfolioEvacuationCertificate', cert: bundle.portfolioEvacuationCertificate },
        { name: 'capitalAllocationCertificate', cert: bundle.capitalAllocationCertificate },
        { name: 'reservationCertificate', cert: bundle.reservationCertificate },
        { name: 'survivalCertificate', cert: bundle.survivalCertificate },
        { name: 'twinTrustCertificate', cert: bundle.twinTrustCertificate },
    ];
    for (const item of mandatoryCerts) {
        if (!item.cert || !item.cert.artifactId || !item.cert.signature) {
            reasons.push(`MISSING_MANDATORY_CERTIFICATE: Certificate ${item.name} is missing or unsigned`);
        }
        else if (item.cert.evidenceClass === 'UNKNOWN' || item.cert.evidenceClass === 'INSUFFICIENT_EVIDENCE') {
            reasons.push(`UNFAVORABLE_EVIDENCE: Certificate ${item.name} contains invalid evidenceClass '${item.cert.evidenceClass}'`);
        }
    }
    return {
        isAuthorized: reasons.length === 0,
        reasons,
    };
}
//# sourceMappingURL=action-proof-bundle.js.map
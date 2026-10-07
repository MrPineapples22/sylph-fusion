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
export function validateActionProofBundle(bundle, activeRoots, verifyArtifact) {
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
    // 4. Exact Transaction Wire Hash Check
    if (!bundle.exactTransactionHash || bundle.exactTransactionHash.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(bundle.exactTransactionHash)) {
        reasons.push(`INVALID_TRANSACTION_WIRE_HASH: exactTransactionHash must be a 64-character SHA-256 hex string`);
    }
    // 5. Mandatory Certificate Presence & Role Verification (Blueprint Section 6 Problem A)
    const mandatoryCerts = [
        { name: 'marketTruthCertificate', cert: bundle.marketTruthCertificate, expectedType: 'MARKET_TRUTH_CERTIFICATE', expectedRole: 'TruthAuthority' },
        { name: 'tokenSemanticsCertificate', cert: bundle.tokenSemanticsCertificate, expectedType: 'TOKEN_SEMANTICS_CERTIFICATE', expectedRole: 'SemanticAuthority' },
        { name: 'alphaRealityCertificate', cert: bundle.alphaRealityCertificate, expectedType: 'ALPHA_REALITY_CERTIFICATE', expectedRole: 'ResearchAuthority' },
        { name: 'signalPortfolioCertificate', cert: bundle.signalPortfolioCertificate, expectedType: 'SIGNAL_PORTFOLIO_CERTIFICATE', expectedRole: 'ResearchAuthority' },
        { name: 'executionPolicyCertificate', cert: bundle.executionPolicyCertificate, expectedType: 'EXECUTION_POLICY_CERTIFICATE', expectedRole: 'RiskAuthority' },
        { name: 'simulationCertificate', cert: bundle.simulationCertificate, expectedType: 'SIMULATION_CERTIFICATE', expectedRole: 'SimulationAuthority' },
        { name: 'exitabilityCertificate', cert: bundle.exitabilityCertificate, expectedType: 'EXITABILITY_CERTIFICATE', expectedRole: 'ExitabilityAuthority' },
        { name: 'portfolioEvacuationCertificate', cert: bundle.portfolioEvacuationCertificate, expectedType: 'PORTFOLIO_EVACUATION_CERTIFICATE', expectedRole: 'RiskAuthority' },
        { name: 'capitalAllocationCertificate', cert: bundle.capitalAllocationCertificate, expectedType: 'CAPITAL_ALLOCATION_CERTIFICATE', expectedRole: 'CapitalAuthority' },
        { name: 'reservationCertificate', cert: bundle.reservationCertificate, expectedType: 'RESERVATION_CERTIFICATE', expectedRole: 'CapitalAuthority' },
        { name: 'survivalCertificate', cert: bundle.survivalCertificate, expectedType: 'SURVIVAL_CERTIFICATE', expectedRole: 'RiskAuthority' },
        { name: 'twinTrustCertificate', cert: bundle.twinTrustCertificate, expectedType: 'TWIN_TRUST_CERTIFICATE', expectedRole: 'SimulationAuthority' },
    ];
    const seenArtifactIds = new Set();
    for (const item of mandatoryCerts) {
        if (!item.cert || !item.cert.artifactId || !item.cert.signature) {
            reasons.push(`MISSING_MANDATORY_CERTIFICATE: Certificate ${item.name} is missing or unsigned`);
            continue;
        }
        if (seenArtifactIds.has(item.cert.artifactId)) {
            reasons.push(`DUPLICATE_AUTHORITY_IMPERSONATION: Artifact ${item.cert.artifactId} was reused across multiple certificates; each authority must be independently certified`);
        }
        seenArtifactIds.add(item.cert.artifactId);
        if (item.cert.artifactType !== item.expectedType) {
            reasons.push(`ARTIFACT_TYPE_MISMATCH: Certificate ${item.name} expected type ${item.expectedType}, got ${item.cert.artifactType}`);
        }
        if (item.cert.issuerRole !== item.expectedRole) {
            reasons.push(`AUTHORITY_ROLE_MISMATCH: Certificate ${item.name} expected role ${item.expectedRole}, got ${item.cert.issuerRole}`);
        }
        if (item.cert.evidenceClass === 'UNKNOWN' || item.cert.evidenceClass === 'INSUFFICIENT_EVIDENCE' || item.cert.evidenceClass === 'MISSING') {
            reasons.push(`UNFAVORABLE_EVIDENCE: Certificate ${item.name} contains invalid evidenceClass '${item.cert.evidenceClass}'`);
        }
        if (!verifyArtifact) {
            reasons.push(`CERTIFICATE_SIGNATURE_UNVERIFIED: No trusted verifier is configured for ${item.name}`);
        }
        else {
            try {
                const verification = verifyArtifact(item.cert);
                if (verification?.isValid !== true) {
                    reasons.push(`CERTIFICATE_SIGNATURE_INVALID: ${item.name}${verification?.reason ? ` (${verification.reason})` : ''}`);
                }
            }
            catch {
                reasons.push(`CERTIFICATE_SIGNATURE_INVALID: Trusted verifier failed for ${item.name}`);
            }
        }
    }
    return {
        isAuthorized: reasons.length === 0,
        reasons,
    };
}
//# sourceMappingURL=action-proof-bundle.js.map
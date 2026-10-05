/**
 * SYLPH FUSION — COMPLETE FUSION STATE ROOT V2
 * Specifications: Blueprint Section 10 (Complete the State Root)
 * Workbook: #515 Capital-State-Root Completeness, #516 Learning Flywheel
 *
 * Invariant: Every economically and cryptographically relevant field is bound into the state root.
 * Mutating any single protected field MUST alter the resulting state root.
 */
import { createHash } from 'node:crypto';
export function computeStateRootV2(fields) {
    // Deterministic, byte-level ordered canonical serialization
    const elements = [
        fields.economicFactId,
        fields.traceId,
        fields.state,
        fields.revision.toString(),
        fields.cluster,
        fields.observedSlot.toString(),
        fields.bankFingerprint,
        fields.blockhash,
        fields.lastValidBlockHeight.toString(),
        fields.evidenceRoot,
        fields.coverageCertificateRoot,
        fields.sourceIndependenceRoot,
        fields.semanticStateRoot,
        fields.tokenSemanticsRoot,
        fields.programEpochRoot,
        fields.accountResolutionRoot,
        fields.marketStateRoot,
        fields.authenticityRoot,
        fields.actorGraphRoot,
        fields.featureSnapshotRoot,
        fields.hypothesisRoot,
        fields.alphaRealityRoot,
        fields.portfolioRiskRoot,
        fields.exitabilityRoot,
        fields.systemicRiskRoot,
        fields.survivalRoot,
        fields.evacuationRoot,
        fields.safetyCapacityRoot,
        fields.resourceReservationId,
        fields.capitalStateRoot,
        fields.capitalReservationId,
        fields.authorityEpoch.toString(),
        fields.fenceEpoch.toString(),
        fields.revocationEpoch.toString(),
        fields.executionGenerationId,
        fields.executionPermitId,
        fields.effectSpecHash,
        fields.messageHash,
        fields.transactionSignature,
        fields.transportAttemptRoot,
        fields.chainOutcomeRoot,
        fields.terminalityCertificateRoot,
        fields.economicOutcomeRoot,
        fields.configRoot,
        fields.policyRoot,
        fields.releaseRoot,
        fields.proofGraphRoot,
    ];
    return createHash('sha256').update(elements.join('\x1f')).digest('hex');
}
//# sourceMappingURL=state-root-v2.js.map
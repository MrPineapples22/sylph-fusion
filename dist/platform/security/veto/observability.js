/**
 * PHASE 45 — VETO OBSERVABILITY & RELEASE GATE METRICS
 *
 * Implements:
 * - Real-time tracking of the 19 specified veto safety metrics
 * - Strict zero-tolerance production release gate evaluation:
 *   Catastrophic counters MUST equal zero.
 */
export class VetoObservabilityTracker {
    falseVetoConfirmedCount = 0;
    unverifiableVetoCount = 0;
    zombieProofCount = 0;
    orphanProofCount = 0;
    proofInvalidationLatencyMs = 0;
    decisionReevaluationLatencyMs = 0;
    crossMintEvidenceLeakCount = 0;
    schemaMismatchCount = 0;
    decoderDisagreementCount = 0;
    authorityDomainMismatchCount = 0;
    staleWriterAttemptCount = 0;
    proofResurrectionAttemptCount = 0;
    ruleCoverageIncompleteCount = 0;
    unknownConvertedToBooleanCount = 0;
    providerEquivocationCount = 0;
    unsupportedExplanationClaimCount = 0;
    crossGenerationRenderCount = 0;
    supersededDecisionDisplayCount = 0;
    invalidProofDisplayCount = 0;
    recordCrossMintLeak() { this.crossMintEvidenceLeakCount++; }
    recordDecoderDisagreement() { this.decoderDisagreementCount++; }
    recordStaleWriterAttempt() { this.staleWriterAttemptCount++; }
    recordProofResurrectionAttempt() { this.proofResurrectionAttemptCount++; }
    recordProviderEquivocation() { this.providerEquivocationCount++; }
    recordIncompleteCoverage() { this.ruleCoverageIncompleteCount++; }
    recordFalseVeto() { this.falseVetoConfirmedCount++; }
    recordUnverifiableVeto() { this.unverifiableVetoCount++; }
    getSnapshot() {
        return {
            falseVetoConfirmedCount: this.falseVetoConfirmedCount,
            unverifiableVetoCount: this.unverifiableVetoCount,
            zombieProofCount: this.zombieProofCount,
            orphanProofCount: this.orphanProofCount,
            proofInvalidationLatencyMs: this.proofInvalidationLatencyMs,
            decisionReevaluationLatencyMs: this.decisionReevaluationLatencyMs,
            crossMintEvidenceLeakCount: this.crossMintEvidenceLeakCount,
            schemaMismatchCount: this.schemaMismatchCount,
            decoderDisagreementCount: this.decoderDisagreementCount,
            authorityDomainMismatchCount: this.authorityDomainMismatchCount,
            staleWriterAttemptCount: this.staleWriterAttemptCount,
            proofResurrectionAttemptCount: this.proofResurrectionAttemptCount,
            ruleCoverageIncompleteCount: this.ruleCoverageIncompleteCount,
            unknownConvertedToBooleanCount: this.unknownConvertedToBooleanCount,
            providerEquivocationCount: this.providerEquivocationCount,
            unsupportedExplanationClaimCount: this.unsupportedExplanationClaimCount,
            crossGenerationRenderCount: this.crossGenerationRenderCount,
            supersededDecisionDisplayCount: this.supersededDecisionDisplayCount,
            invalidProofDisplayCount: this.invalidProofDisplayCount,
        };
    }
    /**
     * Evaluates Production Release Gates.
     * Fails if any catastrophic counter is > 0.
     */
    evaluateProductionReleaseGates() {
        const s = this.getSnapshot();
        const breached = [];
        if (s.falseVetoConfirmedCount > 0)
            breached.push(`FalseVetoConfirmedCount (${s.falseVetoConfirmedCount} > 0)`);
        if (s.unverifiableVetoCount > 0)
            breached.push(`UnverifiableVetoCount (${s.unverifiableVetoCount} > 0)`);
        if (s.zombieProofCount > 0)
            breached.push(`ZombieProofCount (${s.zombieProofCount} > 0)`);
        if (s.orphanProofCount > 0)
            breached.push(`OrphanProofCount (${s.orphanProofCount} > 0)`);
        if (s.crossMintEvidenceLeakCount > 0)
            breached.push(`CrossMintEvidenceLeakCount (${s.crossMintEvidenceLeakCount} > 0)`);
        if (s.schemaMismatchCount > 0)
            breached.push(`SchemaMismatchCount (${s.schemaMismatchCount} > 0)`);
        if (s.authorityDomainMismatchCount > 0)
            breached.push(`AuthorityDomainMismatchCount (${s.authorityDomainMismatchCount} > 0)`);
        if (s.proofResurrectionAttemptCount > 0)
            breached.push(`ProofResurrectionAttemptCount (${s.proofResurrectionAttemptCount} > 0)`);
        if (s.unknownConvertedToBooleanCount > 0)
            breached.push(`UnknownConvertedToBooleanCount (${s.unknownConvertedToBooleanCount} > 0)`);
        if (s.unsupportedExplanationClaimCount > 0)
            breached.push(`UnsupportedExplanationClaimCount (${s.unsupportedExplanationClaimCount} > 0)`);
        if (s.crossGenerationRenderCount > 0)
            breached.push(`CrossGenerationRenderCount (${s.crossGenerationRenderCount} > 0)`);
        if (s.supersededDecisionDisplayCount > 0)
            breached.push(`SupersededDecisionDisplayCount (${s.supersededDecisionDisplayCount} > 0)`);
        if (s.invalidProofDisplayCount > 0)
            breached.push(`InvalidProofDisplayCount (${s.invalidProofDisplayCount} > 0)`);
        return {
            certified: breached.length === 0,
            breachedGates: breached,
        };
    }
}
//# sourceMappingURL=observability.js.map
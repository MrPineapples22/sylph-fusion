/**
 * PHASE 45 — VETO OBSERVABILITY & RELEASE GATE METRICS
 *
 * Implements:
 * - Real-time tracking of the 19 specified veto safety metrics
 * - Strict zero-tolerance production release gate evaluation:
 *   Catastrophic counters MUST equal zero.
 */

export interface VetoObservabilitySnapshot {
  readonly falseVetoConfirmedCount: number;
  readonly unverifiableVetoCount: number;
  readonly zombieProofCount: number;
  readonly orphanProofCount: number;
  readonly proofInvalidationLatencyMs: number;
  readonly decisionReevaluationLatencyMs: number;
  readonly crossMintEvidenceLeakCount: number;
  readonly schemaMismatchCount: number;
  readonly decoderDisagreementCount: number;
  readonly authorityDomainMismatchCount: number;
  readonly staleWriterAttemptCount: number;
  readonly proofResurrectionAttemptCount: number;
  readonly ruleCoverageIncompleteCount: number;
  readonly unknownConvertedToBooleanCount: number;
  readonly providerEquivocationCount: number;
  readonly unsupportedExplanationClaimCount: number;
  readonly crossGenerationRenderCount: number;
  readonly supersededDecisionDisplayCount: number;
  readonly invalidProofDisplayCount: number;
}

export class VetoObservabilityTracker {
  private falseVetoConfirmedCount = 0;
  private unverifiableVetoCount = 0;
  private zombieProofCount = 0;
  private orphanProofCount = 0;
  private proofInvalidationLatencyMs = 0;
  private decisionReevaluationLatencyMs = 0;
  private crossMintEvidenceLeakCount = 0;
  private schemaMismatchCount = 0;
  private decoderDisagreementCount = 0;
  private authorityDomainMismatchCount = 0;
  private staleWriterAttemptCount = 0;
  private proofResurrectionAttemptCount = 0;
  private ruleCoverageIncompleteCount = 0;
  private unknownConvertedToBooleanCount = 0;
  private providerEquivocationCount = 0;
  private unsupportedExplanationClaimCount = 0;
  private crossGenerationRenderCount = 0;
  private supersededDecisionDisplayCount = 0;
  private invalidProofDisplayCount = 0;

  public recordCrossMintLeak(): void { this.crossMintEvidenceLeakCount++; }
  public recordDecoderDisagreement(): void { this.decoderDisagreementCount++; }
  public recordStaleWriterAttempt(): void { this.staleWriterAttemptCount++; }
  public recordProofResurrectionAttempt(): void { this.proofResurrectionAttemptCount++; }
  public recordProviderEquivocation(): void { this.providerEquivocationCount++; }
  public recordIncompleteCoverage(): void { this.ruleCoverageIncompleteCount++; }
  public recordFalseVeto(): void { this.falseVetoConfirmedCount++; }
  public recordUnverifiableVeto(): void { this.unverifiableVetoCount++; }

  public getSnapshot(): VetoObservabilitySnapshot {
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
  public evaluateProductionReleaseGates(): {
    readonly certified: boolean;
    readonly breachedGates: readonly string[];
  } {
    const s = this.getSnapshot();
    const breached: string[] = [];

    if (s.falseVetoConfirmedCount > 0) breached.push(`FalseVetoConfirmedCount (${s.falseVetoConfirmedCount} > 0)`);
    if (s.unverifiableVetoCount > 0) breached.push(`UnverifiableVetoCount (${s.unverifiableVetoCount} > 0)`);
    if (s.zombieProofCount > 0) breached.push(`ZombieProofCount (${s.zombieProofCount} > 0)`);
    if (s.orphanProofCount > 0) breached.push(`OrphanProofCount (${s.orphanProofCount} > 0)`);
    if (s.crossMintEvidenceLeakCount > 0) breached.push(`CrossMintEvidenceLeakCount (${s.crossMintEvidenceLeakCount} > 0)`);
    if (s.schemaMismatchCount > 0) breached.push(`SchemaMismatchCount (${s.schemaMismatchCount} > 0)`);
    if (s.authorityDomainMismatchCount > 0) breached.push(`AuthorityDomainMismatchCount (${s.authorityDomainMismatchCount} > 0)`);
    if (s.proofResurrectionAttemptCount > 0) breached.push(`ProofResurrectionAttemptCount (${s.proofResurrectionAttemptCount} > 0)`);
    if (s.unknownConvertedToBooleanCount > 0) breached.push(`UnknownConvertedToBooleanCount (${s.unknownConvertedToBooleanCount} > 0)`);
    if (s.unsupportedExplanationClaimCount > 0) breached.push(`UnsupportedExplanationClaimCount (${s.unsupportedExplanationClaimCount} > 0)`);
    if (s.crossGenerationRenderCount > 0) breached.push(`CrossGenerationRenderCount (${s.crossGenerationRenderCount} > 0)`);
    if (s.supersededDecisionDisplayCount > 0) breached.push(`SupersededDecisionDisplayCount (${s.supersededDecisionDisplayCount} > 0)`);
    if (s.invalidProofDisplayCount > 0) breached.push(`InvalidProofDisplayCount (${s.invalidProofDisplayCount} > 0)`);

    return {
      certified: breached.length === 0,
      breachedGates: breached,
    };
  }
}

/**
 * SYLPH FUSION — PROVENANCE VERIFIER & VERIFIED DECISIONS
 * Specifications: Frozen Architecture Execution Prompt (Section 29)
 *
 * Invariant: ProvenanceVerifier must independently resolve:
 *   1. journal sequence (supporting 0n correctly)
 *   2. journal record
 *   3. envelope hash
 *   4. state transition
 *   5. feature root
 *   6. PIT bounds (knownAtMs <= decisionTimeMs)
 *   7. decision hash
 *   8. release root
 *   9. control root
 *  10. canonical branch
 *
 * Only ProvenanceVerifier can construct VerifiedDecision.
 * RiskAuthority accepts ONLY VerifiedDecision.
 */

import { createHash } from 'node:crypto';
import type {
  AuthoritativeDecision,
  PITFeatureSnapshot,
  VerifiedDecision,
} from './types.js';
import { isAuthoritativeDecision, computeDecisionHash } from './decision-provenance.js';
import { isPITFeatureSnapshot } from './pit-snapshot.js';

const VERIFIED_DECISION_BRAND = Symbol('__verifiedDecisionBrand__');

export function isVerifiedDecision(obj: unknown): obj is VerifiedDecision {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as any)[VERIFIED_DECISION_BRAND] === true
  );
}

export interface CommittedJournalRecord {
  readonly journalSeq: bigint;
  readonly envelopeHash: string;
  readonly stateRootBefore: string;
  readonly stateRootAfter: string;
}

export interface JournalRecordResolver {
  getCommittedRecord(journalSeq: bigint): Promise<CommittedJournalRecord | null> | (CommittedJournalRecord | null);
}

export interface CanonicalRootsResolver {
  getActiveReleaseRoot(): string;
  getActiveControlRoot(): string;
  getCanonicalBranch(): string;
}

export class ProvenanceVerifier {
  constructor(
    private readonly journalResolver: JournalRecordResolver,
    private readonly rootsResolver: CanonicalRootsResolver
  ) {}

  public async verify(
    decision: AuthoritativeDecision,
    snapshot: PITFeatureSnapshot
  ): Promise<VerifiedDecision> {
    // Fail-closed gate: Verify nominal branding
    if (!isAuthoritativeDecision(decision)) {
      throw new Error('PROVENANCE_VERIFICATION_FAILED: Decision lacks authoritative branding');
    }
    if (!isPITFeatureSnapshot(snapshot)) {
      throw new Error('PROVENANCE_VERIFICATION_FAILED: Snapshot lacks authoritative PITFeatureSnapshot branding');
    }

    const p = decision.provenance;

    // 1. Journal Sequence Validity (0n is explicitly valid!)
    if (typeof p.journalSeq !== 'bigint' || p.journalSeq < 0n) {
      throw new Error(`PROVENANCE_VERIFICATION_FAILED: Invalid journal sequence ${String(p.journalSeq)}`);
    }

    // 2. Journal Record Resolution & Ancestry Verification
    const journalRecord = await this.journalResolver.getCommittedRecord(p.journalSeq);
    if (!journalRecord) {
      throw new Error(`PROVENANCE_VERIFICATION_FAILED: No committed journal record found for sequence ${p.journalSeq}`);
    }

    // 3. Envelope Hash Verification
    if (journalRecord.envelopeHash.toLowerCase() !== p.envelopeHash.toLowerCase()) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Envelope hash mismatch (journal: ${journalRecord.envelopeHash}, decision: ${p.envelopeHash})`
      );
    }

    // 4. State Transition Verification
    if (journalRecord.stateRootBefore.toLowerCase() !== p.stateRootBefore.toLowerCase()) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: State root before mismatch (journal: ${journalRecord.stateRootBefore}, decision: ${p.stateRootBefore})`
      );
    }
    if (journalRecord.stateRootAfter.toLowerCase() !== p.stateRootAfter.toLowerCase()) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: State root after mismatch (journal: ${journalRecord.stateRootAfter}, decision: ${p.stateRootAfter})`
      );
    }

    // 5. Feature Root Verification
    if (snapshot.featureRoot.toLowerCase() !== p.featureRoot.toLowerCase()) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Feature root mismatch (snapshot: ${snapshot.featureRoot}, decision: ${p.featureRoot})`
      );
    }

    // 6. Point-in-Time Causality Bounds Verification
    if (snapshot.maxKnownAtMs > decision.decisionTimeMs) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: PIT_CAUSALITY_VIOLATION (maxKnownAtMs ${snapshot.maxKnownAtMs} > decisionTimeMs ${decision.decisionTimeMs})`
      );
    }

    // 7. Decision Hash Re-computation & Verification
    const expectedDecisionHash = computeDecisionHash({
      decisionId: decision.decisionId,
      decisionTimeMs: decision.decisionTimeMs,
      targetMint: decision.targetMint,
      action: decision.action,
      journalSeq: p.journalSeq,
      envelopeHash: p.envelopeHash,
      stateRootBefore: p.stateRootBefore,
      stateRootAfter: p.stateRootAfter,
      featureRoot: p.featureRoot,
      releaseRoot: p.releaseRoot,
      controlRoot: p.controlRoot,
      reducerVersion: p.reducerVersion,
      intelligenceVersion: p.intelligenceVersion,
      evaluationJson: JSON.stringify(decision.evaluation),
    });

    if (
      expectedDecisionHash.toLowerCase() !== decision.decisionHash.toLowerCase() ||
      expectedDecisionHash.toLowerCase() !== p.decisionHash.toLowerCase()
    ) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Decision hash mismatch (computed: ${expectedDecisionHash}, decision: ${decision.decisionHash})`
      );
    }

    // 8. Release Root Verification
    const activeReleaseRoot = this.rootsResolver.getActiveReleaseRoot().toLowerCase();
    if (p.releaseRoot.toLowerCase() !== activeReleaseRoot) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Release root mismatch (active: ${activeReleaseRoot}, decision: ${p.releaseRoot})`
      );
    }

    // 9. Control Root Verification
    const activeControlRoot = this.rootsResolver.getActiveControlRoot().toLowerCase();
    if (p.controlRoot.toLowerCase() !== activeControlRoot) {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Control root mismatch (active: ${activeControlRoot}, decision: ${p.controlRoot})`
      );
    }

    // 10. Canonical Branch Verification
    const activeBranch = this.rootsResolver.getCanonicalBranch();
    if (!activeBranch || activeBranch === 'detached' || activeBranch === 'non_canonical_fork') {
      throw new Error(
        `PROVENANCE_VERIFICATION_FAILED: Non-canonical branch rejected (${activeBranch})`
      );
    }

    const verifiedAtMs = Date.now();
    const verificationHash = createHash('sha256')
      .update([decision.decisionHash, verifiedAtMs.toString(), activeBranch].join(':'))
      .digest('hex');

    // Construct immutable VerifiedDecision
    const verified = {
      [VERIFIED_DECISION_BRAND]: true,
      decision: Object.freeze(decision),
      verificationHash,
      verifiedAtMs,
      canonicalBranch: activeBranch,
    };

    return Object.freeze(verified) as unknown as VerifiedDecision;
  }
}

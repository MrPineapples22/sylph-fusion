/**
 * SYLPH FUSION — PIPELINE ORCHESTRATOR
 * Specifications: Prompt 12, Prompt 52
 *
 * Coordinates proofs, authority checks, certificates, and hash-chained journal entries
 * across pipeline state transitions.
 *
 * Steps per transition:
 *   1. Receive target state & immutable patch
 *   2. Enforce identity invariants
 *   3. Enforce authority capability (models cannot authorize, reserve, sign, settle)
 *   4. Reducer validates transition legality and evidence prerequisites
 *   5. Compute deterministic next state root
 *   6. Issue transition certificate binding roots
 *   7. Append hash-chained journal entry
 *   8. Attach certificate reference to envelope
 *   9. Publish immutable new reduced state snapshot
 */

import {
  type FusionEnvelope,
  envelopeRoot,
  type CertificateRef,
} from './fusion-envelope.js';
import {
  type FusionPipelineState,
  type PipelineAuthority,
  isAuthorizedForState,
} from './pipeline-state.js';
import {
  type FusionReducedState,
  initializeReducedState,
  reduceFusionTransition,
} from './fusion-reducer.js';
import {
  FusionJournal,
  type FusionJournalEntry,
} from './fusion-journal.js';
import {
  CertificateChain,
  type FusionCertificate,
} from './certificate-chain.js';

export interface TransitionRequest {
  readonly targetState: FusionPipelineState;
  readonly authority: PipelineAuthority;
  readonly envelopePatch: Partial<FusionEnvelope>;
  readonly evidenceRoot?: string;
  readonly canonicalEventId?: string;
  readonly canonicalEventChecksum?: string;
  readonly economicJournalRoot?: string;
  readonly observedAt?: string;
}

export interface TransitionResult {
  readonly state: FusionReducedState;
  readonly certificate: FusionCertificate;
  readonly journalEntry: FusionJournalEntry;
}

export class FusionPipeline {
  private currentState: FusionReducedState;
  private readonly journal: FusionJournal;
  private readonly certificateChain: CertificateChain;

  constructor(
    initialEnvelope: FusionEnvelope,
    journal?: FusionJournal,
    certificateChain?: CertificateChain
  ) {
    this.journal = journal ?? new FusionJournal();
    this.certificateChain = certificateChain ?? new CertificateChain();
    this.currentState = initializeReducedState(initialEnvelope);

    // Record initial observation in journal if empty
    if (this.journal.length() === 0) {
      const envRoot = envelopeRoot(this.currentState.envelope);
      this.journal.append({
        journalEntryId: `entry_genesis_${this.currentState.envelopeId}`,
        envelopeId: this.currentState.envelopeId,
        economicFactId: this.currentState.economicFactId,
        fromState: 'OBSERVED',
        toState: 'OBSERVED',
        previousStateRoot: this.currentState.stateRoot,
        nextStateRoot: this.currentState.stateRoot,
        envelopeRoot: envRoot,
        certificateHash: '0000000000000000000000000000000000000000000000000000000000000000',
        canonicalEventId: undefined,
        canonicalEventChecksum: undefined,
        economicJournalRoot: undefined,
        observedAt: this.currentState.envelope.observedAt,
      });
    }
  }

  /**
   * Returns current immutable snapshot.
   */
  public snapshot(): FusionReducedState {
    return this.currentState;
  }

  /**
   * Returns the underlying journal.
   */
  public getJournal(): FusionJournal {
    return this.journal;
  }

  /**
   * Returns the underlying certificate chain.
   */
  public getCertificateChain(): CertificateChain {
    return this.certificateChain;
  }

  /**
   * Transitions pipeline to target state with atomic proof and journal binding.
   */
  public async transition(req: TransitionRequest): Promise<TransitionResult> {
    const {
      targetState,
      authority,
      envelopePatch,
      evidenceRoot,
      canonicalEventId,
      canonicalEventChecksum,
      economicJournalRoot,
      observedAt,
    } = req;

    // 1. Check authority capability
    if (!isAuthorizedForState(authority, targetState)) {
      throw new Error(
        `AUTHORITY_VIOLATION: Authority '${authority}' is not authorized to transition to '${targetState}'`
      );
    }

    const previousState = this.currentState.state;
    const previousStateRoot = this.currentState.stateRoot;

    // 2. Reducer validates transition, identity, and evidence prerequisites
    const nextReducedState = reduceFusionTransition(
      this.currentState,
      targetState,
      envelopePatch
    );

    const envRoot = envelopeRoot(nextReducedState.envelope);
    const resolvedEvidenceRoot =
      evidenceRoot ?? nextReducedState.envelope.evidenceRoot ?? '0000000000000000000000000000000000000000000000000000000000000000';
    const timestamp = observedAt ?? new Date().toISOString();

    // 3. Issue transition certificate
    const certificateId = `cert_${targetState.toLowerCase()}_${this.currentState.envelopeId}_rev${nextReducedState.revision}`;
    const certificate = this.certificateChain.append({
      certificateId,
      kind: `TRANSITION_TO_${targetState}`,
      authority,
      envelopeId: this.currentState.envelopeId,
      economicFactId: this.currentState.economicFactId,
      fromState: previousState,
      toState: targetState,
      envelopeRoot: envRoot,
      previousStateRoot,
      nextStateRoot: nextReducedState.stateRoot,
      evidenceRoot: resolvedEvidenceRoot,
      issuedAt: timestamp,
    });

    // 4. Append to hash-chained journal
    const journalEntryId = `entry_${targetState.toLowerCase()}_${this.currentState.envelopeId}_rev${nextReducedState.revision}`;
    const journalEntry = this.journal.append({
      journalEntryId,
      envelopeId: this.currentState.envelopeId,
      economicFactId: this.currentState.economicFactId,
      fromState: previousState,
      toState: targetState,
      previousStateRoot,
      nextStateRoot: nextReducedState.stateRoot,
      envelopeRoot: envRoot,
      certificateHash: certificate.certificateHash,
      canonicalEventId,
      canonicalEventChecksum,
      economicJournalRoot: economicJournalRoot ?? nextReducedState.envelope.economicOutcome?.economicJournalRoot,
      observedAt: timestamp,
    });

    // 5. Attach certificate reference to envelope and update state
    const certRef: CertificateRef = {
      certificateId: certificate.certificateId,
      kind: certificate.kind,
      certificateHash: certificate.certificateHash,
      issuedAt: certificate.issuedAt,
    };

    const finalEnvelope: FusionEnvelope = Object.freeze({
      ...nextReducedState.envelope,
      certificateChain: Object.freeze([
        ...nextReducedState.envelope.certificateChain,
        certRef,
      ]),
    });

    this.currentState = Object.freeze({
      ...nextReducedState,
      envelope: finalEnvelope,
    });

    return {
      state: this.currentState,
      certificate,
      journalEntry,
    };
  }

  /**
   * Verifies end-to-end integrity of journal, certificates, and current state.
   */
  public verify(): { valid: boolean; error?: string } {
    const journalCheck = this.journal.verify();
    if (!journalCheck.valid) {
      return { valid: false, error: `Journal verification failed: ${journalCheck.error}` };
    }

    const certCheck = this.certificateChain.verify();
    if (!certCheck.valid) {
      return { valid: false, error: `Certificate chain verification failed: ${certCheck.error}` };
    }

    return { valid: true };
  }
}

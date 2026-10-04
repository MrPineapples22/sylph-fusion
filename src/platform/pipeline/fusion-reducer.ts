/**
 * SYLPH FUSION — FUSION REDUCER
 * Specifications: Prompt 6, Prompt 7, Prompt 8, Prompt 52
 *
 * The FusionReducer is the ONLY writer of canonical top-level Fusion pipeline state.
 * It is pure, deterministic, and enforces epistemic & evidence invariants:
 *   1. Identity invariants (one envelopeId, one economicFactId).
 *   2. Strict state transition rules (no skipped states, no illegal backward transitions).
 *   3. Epistemic invariant: UNKNOWN != FALSE; missing evidence blocks advancement.
 *   4. Deterministic revision incrementation and stateRoot calculation.
 *   5. Zero Date.now() or random IDs inside deterministic state calculation.
 */

import { hashCanonical } from './canonical-hashing.js';
import {
  type FusionEnvelope,
  envelopeRoot,
  assertIdentityInvariant,
} from './fusion-envelope.js';
import {
  type FusionPipelineState,
  isValidTransition,
} from './pipeline-state.js';

export interface FusionReducedState {
  readonly envelopeId: string;
  readonly economicFactId: string;
  readonly state: FusionPipelineState;
  readonly stateRoot: string;
  readonly revision: bigint;
  readonly envelope: FusionEnvelope;
}

/**
 * Validates that all evidence prerequisites for entering `targetState` are satisfied by `envelope`.
 * Implements Prompt 52 evidence assertion matrix.
 */
export function validateEvidencePrerequisites(
  targetState: FusionPipelineState,
  envelope: FusionEnvelope
): void {
  switch (targetState) {
    case 'EVIDENCE_CERTIFIED':
      if (!envelope.coverageCertificate || envelope.coverageCertificate.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to EVIDENCE_CERTIFIED without coverageCertificate'
        );
      }
      if (!envelope.evidenceRoot || envelope.evidenceRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to EVIDENCE_CERTIFIED without evidenceRoot'
        );
      }
      break;

    case 'TEMPORALLY_VALID':
      if (!envelope.observedSlot || envelope.observedSlot <= 0n) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to TEMPORALLY_VALID without observedSlot'
        );
      }
      if (!envelope.bankFingerprint || envelope.bankFingerprint.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to TEMPORALLY_VALID without bankFingerprint'
        );
      }
      break;

    case 'SEMANTICALLY_RESOLVED':
      if (!envelope.semanticStateRoot || envelope.semanticStateRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to SEMANTICALLY_RESOLVED without semanticStateRoot'
        );
      }
      break;

    case 'AUTHENTICATED_MARKET':
      if (!envelope.authenticityRoot || envelope.authenticityRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to AUTHENTICATED_MARKET without authenticityRoot'
        );
      }
      break;

    case 'FEATURED':
      if (!envelope.featureSnapshotRoot || envelope.featureSnapshotRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to FEATURED without featureSnapshotRoot'
        );
      }
      break;

    case 'HYPOTHESIS_READY':
      if (!envelope.hypothesisRoot || envelope.hypothesisRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to HYPOTHESIS_READY without hypothesisRoot'
        );
      }
      break;

    case 'DECIDED':
      if (envelope.decisionAt === undefined || envelope.decisionAt.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to DECIDED without decisionAt timestamp'
        );
      }
      if (envelope.predictedEdgeLamports === undefined) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to DECIDED without predictedEdgeLamports'
        );
      }
      break;

    case 'RISK_APPROVED':
      if (!envelope.portfolioRiskRoot || envelope.portfolioRiskRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to RISK_APPROVED without portfolioRiskRoot'
        );
      }
      break;

    case 'RESOURCE_ADMITTED':
      if (!envelope.safetyCapacityRoot || envelope.safetyCapacityRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to RESOURCE_ADMITTED without safetyCapacityRoot'
        );
      }
      if (!envelope.resourceReservationId || envelope.resourceReservationId.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to RESOURCE_ADMITTED without resourceReservationId'
        );
      }
      break;

    case 'CAPITAL_RESERVED':
      if (!envelope.capitalStateRoot || envelope.capitalStateRoot.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to CAPITAL_RESERVED without capitalStateRoot'
        );
      }
      if (!envelope.capitalReservationId || envelope.capitalReservationId.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to CAPITAL_RESERVED without capitalReservationId'
        );
      }
      break;

    case 'AUTHORIZED':
      if (!envelope.executionPermitId || envelope.executionPermitId.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to AUTHORIZED without executionPermitId'
        );
      }
      break;

    case 'TRANSACTION_VERIFIED':
      if (!envelope.effectSpecHash || envelope.effectSpecHash.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to TRANSACTION_VERIFIED without effectSpecHash'
        );
      }
      if (!envelope.messageHash || envelope.messageHash.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to TRANSACTION_VERIFIED without messageHash'
        );
      }
      break;

    case 'PROOF_READY':
      // Proof package requires verification of all upstream roots
      if (!envelope.effectSpecHash || !envelope.executionPermitId || !envelope.capitalReservationId) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to PROOF_READY without effectSpecHash, executionPermitId, and capitalReservationId'
        );
      }
      break;

    case 'SIGNED':
      if (!envelope.transactionSignature || envelope.transactionSignature.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to SIGNED without transactionSignature'
        );
      }
      break;

    case 'SUBMITTED':
      if (!envelope.transportAttempts || envelope.transportAttempts.length === 0) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to SUBMITTED without at least one transportAttempt'
        );
      }
      break;

    case 'CERTIFIED_NOLAND':
      if (!envelope.noLandProofCertificateId || envelope.noLandProofCertificateId.trim() === '') {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to CERTIFIED_NOLAND without verified noLandProofCertificateId'
        );
      }
      break;

    case 'ECONOMIC_RECONCILED':
      if (!envelope.economicOutcome) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to ECONOMIC_RECONCILED without economicOutcome'
        );
      }
      if (!envelope.economicOutcome.economicJournalRoot) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to ECONOMIC_RECONCILED without economicJournalRoot'
        );
      }
      break;

    case 'SETTLED':
      if (!envelope.economicOutcome) {
        throw new Error(
          'EVIDENCE_DEFICIT: Cannot advance to SETTLED without finalized economicOutcome'
        );
      }
      break;

    default:
      // Base states require no additional external evidence check
      break;
  }
}

/**
 * Pure state root calculation.
 */
export function computeStateRoot(
  envelopeId: string,
  economicFactId: string,
  state: FusionPipelineState,
  revision: bigint,
  envRoot: string
): string {
  return hashCanonical({
    envelopeId,
    economicFactId,
    state,
    revision,
    envelopeRoot: envRoot,
  });
}

/**
 * Creates the initial reduced state from an observed envelope.
 */
export function initializeReducedState(envelope: FusionEnvelope): FusionReducedState {
  if (envelope.state !== 'OBSERVED') {
    throw new Error(`INITIALIZE_ERROR: Initial state must be OBSERVED, received ${envelope.state}`);
  }
  const revision = 0n;
  const envRoot = envelopeRoot(envelope);
  const stateRoot = computeStateRoot(
    envelope.envelopeId,
    envelope.economicFactId,
    'OBSERVED',
    revision,
    envRoot
  );

  return Object.freeze({
    envelopeId: envelope.envelopeId,
    economicFactId: envelope.economicFactId,
    state: 'OBSERVED',
    stateRoot,
    revision,
    envelope: Object.freeze({ ...envelope }),
  });
}

/**
 * Pure transition reducer.
 * Receives current reduced state and a patch to apply.
 * Validates identity, validates transition, validates evidence,
 * computes next stateRoot and increments revision.
 */
export function reduceFusionTransition(
  current: FusionReducedState,
  targetState: FusionPipelineState,
  envelopePatch: Partial<FusionEnvelope>
): FusionReducedState {
  // 1. Identity validation
  assertIdentityInvariant(current.envelope, envelopePatch);

  // 2. Transition validation
  if (!isValidTransition(current.state, targetState)) {
    throw new Error(
      `ILLEGAL_TRANSITION: Cannot transition from ${current.state} to ${targetState}`
    );
  }

  // 3. Assemble candidate envelope
  const candidateEnvelope: FusionEnvelope = {
    ...current.envelope,
    ...envelopePatch,
    state: targetState,
  };

  // 4. Validate evidence prerequisites for target state
  validateEvidencePrerequisites(targetState, candidateEnvelope);

  // 5. Deterministic revision incrementation
  const nextRevision = current.revision + 1n;

  // 6. Compute new envelope root and state root
  const nextEnvelopeRoot = envelopeRoot(candidateEnvelope);
  const nextStateRoot = computeStateRoot(
    current.envelopeId,
    current.economicFactId,
    targetState,
    nextRevision,
    nextEnvelopeRoot
  );

  return Object.freeze({
    envelopeId: current.envelopeId,
    economicFactId: current.economicFactId,
    state: targetState,
    stateRoot: nextStateRoot,
    revision: nextRevision,
    envelope: Object.freeze(candidateEnvelope),
  });
}

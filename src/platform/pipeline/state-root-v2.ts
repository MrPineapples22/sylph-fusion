/**
 * SYLPH FUSION — COMPLETE FUSION STATE ROOT V2
 * Specifications: Blueprint Section 10 (Complete the State Root)
 * Workbook: #515 Capital-State-Root Completeness, #516 Learning Flywheel
 *
 * Invariant: Every economically and cryptographically relevant field is bound into the state root.
 * Mutating any single protected field MUST alter the resulting state root.
 */

import { createHash } from 'node:crypto';
import type { FusionPipelineState } from './pipeline-state.js';

export interface FusionStateRootFieldsV2 {
  readonly economicFactId: string;
  readonly traceId: string;
  readonly state: FusionPipelineState;
  readonly revision: bigint;
  readonly cluster: string;
  readonly observedSlot: bigint;
  readonly bankFingerprint: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly evidenceRoot: string;
  readonly coverageCertificateRoot: string;
  readonly sourceIndependenceRoot: string;
  readonly semanticStateRoot: string;
  readonly tokenSemanticsRoot: string;
  readonly programEpochRoot: string;
  readonly accountResolutionRoot: string;
  readonly marketStateRoot: string;
  readonly authenticityRoot: string;
  readonly actorGraphRoot: string;
  readonly featureSnapshotRoot: string;
  readonly hypothesisRoot: string;
  readonly alphaRealityRoot: string;
  readonly portfolioRiskRoot: string;
  readonly exitabilityRoot: string;
  readonly systemicRiskRoot: string;
  readonly survivalRoot: string;
  readonly evacuationRoot: string;
  readonly safetyCapacityRoot: string;
  readonly resourceReservationId: string;
  readonly capitalStateRoot: string;
  readonly capitalReservationId: string;
  readonly authorityEpoch: number;
  readonly fenceEpoch: number;
  readonly revocationEpoch: number;
  readonly executionGenerationId: string;
  readonly executionPermitId: string;
  readonly effectSpecHash: string;
  readonly messageHash: string;
  readonly transactionSignature: string;
  readonly transportAttemptRoot: string;
  readonly chainOutcomeRoot: string;
  readonly terminalityCertificateRoot: string;
  readonly economicOutcomeRoot: string;
  readonly configRoot: string;
  readonly policyRoot: string;
  readonly releaseRoot: string;
  readonly proofGraphRoot: string;
}

export function computeStateRootV2(fields: FusionStateRootFieldsV2): string {
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

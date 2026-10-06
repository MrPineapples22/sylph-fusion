/**
 * SYLPH FUSION — CANONICAL FUSION ENVELOPE
 * Specifications: Prompt 3, Prompt 4, Prompt 5, Prompt 39
 *
 * Represents ONE economic opportunity/fact traveling through the entire architecture.
 * Carries content hashes, root hashes, stable IDs, and certificate references.
 *
 * Invariants:
 * 1. ONE economicFactId survives the complete lifecycle.
 * 2. Immutable identity guards: envelopeId, economicFactId, traceId cannot drift.
 * 3. Transport attempt != new economic intent.
 * 4. ACCEPTED != LANDED; UNKNOWN != FAILED.
 */

import { hashCanonical } from './canonical-hashing.js';
import type { FusionPipelineState } from './pipeline-state.js';

export interface TransportAttempt {
  readonly transport: 'JITO_BUNDLE' | 'TPU' | 'RPC' | 'SIMULATION' | string;
  readonly attemptedAt: string;
  readonly status: 'NOT_SENT' | 'ACCEPTED' | 'UNKNOWN' | 'REJECTED';
  readonly acknowledgementId?: string;
  readonly bundleId?: string;
  readonly reason?: string;
  readonly leader?: string;
  readonly endpoint?: string;
  readonly latencyMs?: number;
}

export interface ChainOutcome {
  readonly outcome: 'LANDED_SUCCESS' | 'LANDED_FAILED' | 'EXPIRED_UNRESOLVED' | 'CERTIFIED_NOLAND' | 'DISPUTED';
  readonly slot?: bigint;
  readonly signature?: string;
  readonly error?: string;
  readonly reconciledAt: string;
  readonly proofCertificateId?: string;
}

export interface EconomicOutcome {
  readonly deltaCashLamports: bigint;
  readonly deltaTokensRaw: bigint;
  readonly mint: string;
  readonly feeLamports: bigint;
  readonly tipLamports: bigint;
  readonly rentLamports: bigint;
  readonly realizedProceedsLamports?: bigint;
  readonly basisRelievedLamports?: bigint;
  readonly realizedPnLLamports?: bigint;
  readonly reconciledAt: string;
  readonly economicJournalRoot: string;
}

export interface CertificateRef {
  readonly certificateId: string;
  readonly kind: string;
  readonly certificateHash: string;
  readonly issuedAt: string;
}

export interface FusionEnvelope {
  readonly envelopeId: string;
  readonly economicFactId: string;
  readonly traceId: string;
  readonly cluster: string;
  readonly observedSlot: bigint;
  readonly bankFingerprint: string;
  readonly blockhash?: string;
  readonly lastValidBlockHeight?: bigint;
  readonly occurredAt?: string;
  readonly observedAt: string;
  readonly knownAt: string;
  readonly decisionAt?: string;
  readonly evidenceRoot: string;
  readonly coverageCertificate?: string;
  readonly sourceIndependenceRoot?: string;
  readonly semanticStateRoot?: string;
  readonly tokenSemanticsRoot?: string;
  readonly programEpochRoot?: string;
  readonly accountResolutionRoot?: string;
  readonly marketStateRoot?: string;
  readonly authenticityRoot?: string;
  readonly actorGraphRoot?: string;
  readonly featureSnapshotRoot?: string;
  readonly hypothesisRoot?: string;
  readonly predictedEdgeLamports?: bigint;
  readonly executableAlphaCertificate?: string;
  readonly portfolioRiskRoot?: string;
  readonly exitabilityRoot?: string;
  readonly systemicRiskRoot?: string;
  readonly safetyCapacityRoot?: string;
  readonly resourceReservationId?: string;
  readonly economicWorkPermitId?: string;
  readonly capitalStateRoot?: string;
  readonly capitalReservationId?: string;
  readonly authorityEpoch?: bigint;
  readonly revocationEpoch?: bigint;
  readonly executionPermitId?: string;
  readonly effectSpecHash?: string;
  readonly messageHash?: string;
  readonly transactionSignature?: string;
  readonly transportAttempts: readonly TransportAttempt[];
  readonly chainOutcome?: ChainOutcome;
  readonly noLandProofCertificateId?: string;
  readonly economicOutcome?: EconomicOutcome;
  readonly realizedEdgeLamports?: bigint;
  readonly certificateChain: readonly CertificateRef[];
  readonly state: FusionPipelineState;
}

/**
 * Calculates deterministic root hash of an envelope.
 */
export function envelopeRoot(envelope: FusionEnvelope): string {
  return hashCanonical(envelope);
}

/**
 * Validates that an updated envelope maintains strict immutable identity invariants.
 * Throws immediately if identity drift is detected.
 */
/**
 * SYLPH FUSION — CANONICAL FUSION ENVELOPE V2
 * Specifications: Master Blueprint Section IV (Fusion Envelope V2)
 */

import { createHash } from 'node:crypto';

export type ForkLifecycleEvent = 'FORK_OBSERVED' | 'FORK_SURVIVED' | 'FORK_RETRACTED' | 'CANONICAL_CONFIRMED';

export interface ChainContextV2 {
  readonly slot: bigint;
  readonly bankId: string;
  readonly blockhash: string;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly forkLineage: readonly string[];
}

export interface TimeContextV2 {
  readonly providerTimestamp: number;
  readonly localWallTimestamp: number;
  readonly monotonicTimestamp: number;
  readonly availableAt: number;
}

export interface ProvenanceContextV2 {
  readonly providerId: string;
  readonly connectionGeneration: number | 'unknown';
  readonly sourceClass: string;
  readonly decoderVersion: string;
  readonly failureDomain: string;
}

export interface FusionEnvelopeV2<TPayload = unknown> {
  readonly schemaVersion: '2.0.0';
  readonly envelopeId: string;
  readonly eventType: string;
  readonly subject: string;
  readonly payload: TPayload;
  readonly chain: ChainContextV2;
  readonly time: TimeContextV2;
  readonly provenance: ProvenanceContextV2;
  readonly evidenceClass: string;
  readonly payloadHash: string;
  readonly forkStatus?: ForkLifecycleEvent;
}

export function createFusionEnvelopeV2<TPayload>(params: {
  eventType: string;
  subject: string;
  payload: TPayload;
  chain: ChainContextV2;
  time?: Partial<TimeContextV2>;
  provenance: ProvenanceContextV2;
  evidenceClass: string;
  forkStatus?: ForkLifecycleEvent;
}): FusionEnvelopeV2<TPayload> {
  // Master Blueprint Section IV Invariant: Never fabricate confirmed head from slot - 1
  if (params.chain.commitment === 'confirmed' && (!params.chain.blockhash || params.chain.blockhash.length < 32)) {
    throw new Error('CONFIRMED_HEAD_FABRICATION_FORBIDDEN: Confirmed commitment requires explicit blockhash and bankId');
  }

  const payloadHash = hashCanonical(params.payload);
  const nowWall = Date.now();
  const monotonic = typeof process.hrtime === 'function' ? Number(process.hrtime.bigint()) : nowWall * 1_000_000;

  const time: TimeContextV2 = {
    providerTimestamp: params.time?.providerTimestamp ?? nowWall,
    localWallTimestamp: params.time?.localWallTimestamp ?? nowWall,
    monotonicTimestamp: params.time?.monotonicTimestamp ?? monotonic,
    availableAt: params.time?.availableAt ?? nowWall,
  };

  const idPayload = `${params.eventType}:${params.subject}:${params.chain.slot}:${params.chain.bankId}:${payloadHash}:${time.monotonicTimestamp}`;
  const envelopeId = `env_v2_${createHash('sha256').update(idPayload).digest('hex').slice(0, 24)}`;

  return {
    schemaVersion: '2.0.0',
    envelopeId,
    eventType: params.eventType,
    subject: params.subject,
    payload: params.payload,
    chain: params.chain,
    time,
    provenance: params.provenance,
    evidenceClass: params.evidenceClass,
    payloadHash,
    forkStatus: params.forkStatus ?? 'FORK_OBSERVED',
  };
}

export function assertIdentityInvariant(original: FusionEnvelope, updated: Partial<FusionEnvelope>): void {
  if (updated.envelopeId !== undefined && updated.envelopeId !== original.envelopeId) {
    throw new Error(
      `IDENTITY_DRIFT_ERROR: envelopeId mismatch! original=${original.envelopeId}, updated=${updated.envelopeId}`
    );
  }
  if (updated.economicFactId !== undefined && updated.economicFactId !== original.economicFactId) {
    throw new Error(
      `IDENTITY_DRIFT_ERROR: economicFactId mismatch! original=${original.economicFactId}, updated=${updated.economicFactId}`
    );
  }
  if (updated.traceId !== undefined && updated.traceId !== original.traceId) {
    throw new Error(
      `IDENTITY_DRIFT_ERROR: traceId mismatch! original=${original.traceId}, updated=${updated.traceId}`
    );
  }
}



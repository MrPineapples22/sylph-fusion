/**
 * SYLPH FUSION — INTELLIGENCE PROVENANCE TYPES
 * Specifications: Frozen Architecture Execution Prompt (Section 26, 27, 28, 29)
 *
 * Invariant: Every authoritative decision requires uncompromised cryptographic
 * and temporal ancestry binding:
 *   journalSeq, envelopeHash, stateRootBefore, stateRootAfter, featureRoot,
 *   decisionId, decisionHash, releaseRoot, controlRoot, reducerVersion, intelligenceVersion.
 *
 * No optional provenance. Sequence zero is explicitly valid.
 * All types are nominally branded with non-forgeable symbols.
 */

import type { FusionStateRootV2, StateTransitionProof } from '../../platform/reducer/types.js';

// Private nominal brand symbols (never exported, never Symbol.for)
declare const _pitFeatureBrand: unique symbol;
declare const _pitFeatureSnapshotBrand: unique symbol;
declare const _decisionProvenanceBrand: unique symbol;
declare const _intelligenceInputBrand: unique symbol;
declare const _authoritativeDecisionBrand: unique symbol;
declare const _verifiedDecisionBrand: unique symbol;

/**
 * Point-in-time feature binding raw evidence to derived metrics.
 */
export interface PITFeature {
  readonly [_pitFeatureBrand]: true;
  readonly featureId: string;
  readonly sourceObservationId: string;
  readonly journalSeq: bigint;
  readonly observedAtMs: number;
  readonly knownAtMs: number;
  readonly evidenceHash: string; // SHA-256
  readonly calculationVersion: string;
  readonly value: unknown;
  readonly featureHash: string; // SHA-256
}

/**
 * Point-in-time feature snapshot with cryptographic Merkle/root binding.
 */
export interface PITFeatureSnapshot {
  readonly [_pitFeatureSnapshotBrand]: true;
  readonly snapshotId: string;
  readonly features: readonly PITFeature[];
  readonly featureRoot: string; // SHA-256 root of sorted feature hashes
  readonly maxKnownAtMs: number;
  readonly featureCount: number;
}

/**
 * Cryptographic provenance envelope bound to every authoritative decision.
 */
export interface DecisionProvenance {
  readonly [_decisionProvenanceBrand]: true;
  readonly journalSeq: bigint; // Sequence 0n is explicitly valid
  readonly envelopeHash: string; // SHA-256
  readonly stateRootBefore: string; // SHA-256
  readonly stateRootAfter: string; // SHA-256
  readonly featureRoot: string; // SHA-256
  readonly decisionId: string;
  readonly decisionHash: string; // SHA-256
  readonly releaseRoot: string; // SHA-256
  readonly controlRoot: string; // SHA-256
  readonly reducerVersion: string;
  readonly intelligenceVersion: string;
}

/**
 * Exclusively accepted input for Engine.evaluate().
 * Forbids MarketEvent, UnvalidatedObservation, CompiledFusionEnvelope, ValidatedFusionEnvelope.
 */
export interface IntelligenceInput {
  readonly [_intelligenceInputBrand]: true;
  readonly state: FusionStateRootV2;
  readonly snapshot: PITFeatureSnapshot;
  readonly proof: StateTransitionProof;
  readonly decisionTimeMs: number;
}

export type DecisionAction = 'BUY' | 'SELL' | 'HOLD' | 'REJECT';

/**
 * Authoritative decision produced by the Intelligence Engine.
 */
export interface AuthoritativeDecision {
  readonly [_authoritativeDecisionBrand]: true;
  readonly decisionId: string;
  readonly decisionTimeMs: number;
  readonly targetMint: string;
  readonly action: DecisionAction;
  readonly provenance: DecisionProvenance;
  readonly evaluation: Readonly<Record<string, unknown>>;
  readonly decisionHash: string; // SHA-256
}

/**
 * Verified decision authenticated strictly by ProvenanceVerifier.
 * Only ProvenanceVerifier can construct this type.
 */
export interface VerifiedDecision {
  readonly [_verifiedDecisionBrand]: true;
  readonly decision: AuthoritativeDecision;
  readonly verificationHash: string; // SHA-256
  readonly verifiedAtMs: number;
  readonly canonicalBranch: string;
}

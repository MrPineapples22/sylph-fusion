/**
 * SYLPH FUSION — CANONICAL REDUCER TYPES & MUTATION EXCLUSIVITY
 * Specifications: Frozen Architecture Execution Step 2 (Sections 23, 24, 25)
 *
 * Guarantees:
 * 1. Private nominal branding prevents ordinary data or callers from creating authoritative FusionStateRootV2.
 * 2. Only CanonicalReducer may produce the next authoritative state.
 * 3. Type-state invariant:
 *    CommittedEnvelope -> CanonicalReducer -> (nextState: FusionStateRootV2, proof: StateTransitionProof)
 * 4. StateTransitionProof binds journalSeq, envelopeHash, stateRootBefore, stateRootAfter, reducerVersion, and transitionHash.
 * 5. Full immutability: zero mutable aliases or collections escape.
 */

import type { Hash256, CommittedEnvelope } from '../ingress/types.js';
import type { FusionStateRootFieldsV2 } from '../pipeline/state-root-v2.js';
import type { FusionPipelineState } from '../pipeline/pipeline-state.js';

// Module-scoped private nominal branding symbols (strictly module-scoped, NOT Symbol.for)
declare const _fusionStateRootV2Brand: unique symbol;
declare const _stateTransitionProofBrand: unique symbol;

/**
 * Authoritative Canonical Fusion State Root V2.
 * Fully immutable, cryptographically bound over all 47 protected pipeline fields.
 * Can ONLY be produced by CanonicalReducer.
 */
export interface FusionStateRootV2 extends Readonly<FusionStateRootFieldsV2> {
  readonly [_fusionStateRootV2Brand]: true;
  readonly stateRoot: Hash256;
}

/**
 * Cryptographic state transition proof produced exclusively by CanonicalReducer.
 * Proves that nextState arose deterministically from current state and a durably committed envelope.
 */
export interface StateTransitionProof {
  readonly [_stateTransitionProofBrand]: true;
  readonly journalSeq: bigint;
  readonly envelopeHash: Hash256;
  readonly stateRootBefore: Hash256;
  readonly stateRootAfter: Hash256;
  readonly reducerVersion: string;
  readonly transitionHash: Hash256;
}

/**
 * Reduction result emitted exclusively by CanonicalReducer.reduce().
 */
export interface ReductionResult {
  readonly nextState: FusionStateRootV2;
  readonly proof: StateTransitionProof;
}

/**
 * Interface contract for canonical reducers.
 */
export interface CanonicalReducerPort {
  reduce(current: FusionStateRootV2, envelope: CommittedEnvelope): ReductionResult;
}

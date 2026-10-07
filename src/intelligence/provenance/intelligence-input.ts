/**
 * SYLPH FUSION — INTELLIGENCE INPUT FACTORY & GUARDS
 * Specifications: Frozen Architecture Execution Prompt (Section 28)
 *
 * Target:
 *   engine.evaluate(input: IntelligenceInput)
 *
 * Containing:
 *   readonly state: FusionStateRootV2
 *   readonly snapshot: PITFeatureSnapshot
 *   readonly proof: StateTransitionProof
 *   readonly decisionTimeMs: number
 *
 * Engine must NOT accept:
 *   MarketEvent, UnvalidatedObservation, CompiledFusionEnvelope, ValidatedFusionEnvelope
 */

import { CanonicalReducer } from '../../platform/reducer/canonical-reducer.js';
import type { FusionStateRootV2, StateTransitionProof } from '../../platform/reducer/types.js';
import { isPITFeatureSnapshot } from './pit-snapshot.js';
import type { IntelligenceInput, PITFeatureSnapshot } from './types.js';

const INTELLIGENCE_INPUT_BRAND = Symbol('__intelligenceInputBrand__');

export function isIntelligenceInput(obj: unknown): obj is IntelligenceInput {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as any)[INTELLIGENCE_INPUT_BRAND] === true
  );
}

export interface CreateIntelligenceInputParams {
  readonly state: FusionStateRootV2;
  readonly snapshot: PITFeatureSnapshot;
  readonly proof: StateTransitionProof;
  readonly decisionTimeMs: number;
}

export function createIntelligenceInput(params: CreateIntelligenceInputParams): IntelligenceInput {
  if (!params || typeof params !== 'object') {
    throw new Error('INVALID_INTELLIGENCE_INPUT: Input parameters must be a non-null object');
  }

  // 1. Verify State Root
  if (!CanonicalReducer.isStateRootV2(params.state)) {
    throw new Error('UNAUTHORIZED_STATE_ROOT: Input state lacks authoritative FusionStateRootV2 brand');
  }

  // 2. Verify PIT Feature Snapshot
  if (!isPITFeatureSnapshot(params.snapshot)) {
    throw new Error('UNAUTHORIZED_FEATURE_SNAPSHOT: Input snapshot lacks authoritative PITFeatureSnapshot brand');
  }

  // 3. Verify State Transition Proof
  if (!CanonicalReducer.isStateTransitionProof(params.proof)) {
    throw new Error('UNAUTHORIZED_TRANSITION_PROOF: Input proof lacks authoritative StateTransitionProof brand');
  }

  // 4. Invariant: Proof stateRootAfter MUST match the state.stateRoot
  if (params.proof.stateRootAfter !== params.state.stateRoot) {
    throw new Error(
      `STATE_ROOT_PROOF_MISMATCH: Proof stateRootAfter (${params.proof.stateRootAfter}) does not match state.stateRoot (${params.state.stateRoot})`
    );
  }

  // 5. Temporal Validity & PIT Causality Rule
  if (!Number.isSafeInteger(params.decisionTimeMs) || params.decisionTimeMs <= 0) {
    throw new Error('INVALID_DECISION_TIME_MS: decisionTimeMs must be positive safe integer');
  }

  if (params.snapshot.maxKnownAtMs > params.decisionTimeMs) {
    throw new Error(
      `PIT_CAUSALITY_VIOLATION: Snapshot maxKnownAtMs (${params.snapshot.maxKnownAtMs}) > decisionTimeMs (${params.decisionTimeMs})`
    );
  }

  const inputObj = {
    [INTELLIGENCE_INPUT_BRAND]: true,
    state: params.state,
    snapshot: params.snapshot,
    proof: params.proof,
    decisionTimeMs: params.decisionTimeMs,
  };

  return Object.freeze(inputObj) as unknown as IntelligenceInput;
}

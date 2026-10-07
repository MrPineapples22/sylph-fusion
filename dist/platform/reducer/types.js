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
export {};
//# sourceMappingURL=types.js.map
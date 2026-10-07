/**
 * SYLPH FUSION — INGRESS PORT & OBSERVATION SOURCE CONTRACTS
 * Specifications: Frozen Architecture Execution Step 1 (Sections 12, 13)
 *
 * Guarantees:
 * 1. ObservationIngressPort accepts UnvalidatedObservation and returns IngressReceipt.
 * 2. ObservationSource boundary provides read-only ingestion access.
 * 3. Observation sources are strictly forbidden from receiving or importing Engine,
 *    RiskAuthority, EconomicAuthorityStore, ExecutionEngine, Signer, Transport,
 *    ActionProofBundleBuilder, CanonicalReducer, or writable state roots.
 */
export {};
//# sourceMappingURL=port.js.map
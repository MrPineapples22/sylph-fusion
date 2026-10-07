/**
 * SYLPH FUSION — INGRESS TYPES AND PRIVATE NOMINAL BRANDING
 * Specifications: Frozen Architecture Execution Step 1 (Sections 9, 10, 12, 14)
 *
 * Guarantees:
 * 1. Private nominal branding prevents ordinary data from being cast into authoritative types.
 * 2. Raw payload bytes are preserved and bound to a 64-hex SHA-256 digest.
 * 3. Type-state progression:
 *    UnvalidatedObservation != CompiledFusionEnvelope != ValidatedFusionEnvelope != CommittedEnvelope
 * 4. Only FSYNC_COMMITTED durability creates a CommittedEnvelope.
 * 5. General callers cannot construct authoritative types through exported constructors.
 */
export const FSYNC_COMMITTED = 'FSYNC_COMMITTED';
//# sourceMappingURL=types.js.map
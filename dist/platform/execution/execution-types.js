/**
 * SYLPH FUSION — EXECUTION TYPES, BRANDED UNITS & LIFETIMES
 * Specifications: Blueprint Section 21, 22, 23
 *
 * Invariant: Slot and BlockHeight are branded types.
 * Comparing Slot and BlockHeight directly will cause a TypeScript compile error.
 */
export function asSlot(val) {
    return BigInt(val);
}
export function asBlockHeight(val) {
    return BigInt(val);
}
//# sourceMappingURL=execution-types.js.map
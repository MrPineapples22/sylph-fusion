/**
 * SOL-SYLPH Intelligence Evidence Provenance Contract
 * Specifications: Section 8 (Remove remaining synthetic intelligence inputs)
 *
 * Every intelligence and decision field must have explicit provenance.
 * Non-negotiable invariant:
 * Absence of evidence must never be converted into favorable evidence.
 * Do not turn unavailable fields into zero unless zero itself was observed.
 */
export function observedEvidence(value, source, observedAt = Date.now(), validatedAt = Date.now(), confidence = 1.0) {
    return {
        value,
        status: 'OBSERVED',
        source,
        observedAt,
        validatedAt,
        confidence,
    };
}
export function derivedEvidence(value, source, observedAt = null, validatedAt = Date.now(), confidence = 0.9) {
    return {
        value,
        status: 'DERIVED',
        source,
        observedAt,
        validatedAt,
        confidence,
    };
}
export function unavailableEvidence(source = null) {
    return {
        value: null,
        status: 'UNAVAILABLE',
        source,
        observedAt: null,
        validatedAt: null,
        confidence: null,
    };
}
export function staleEvidence(value, source, observedAt, validatedAt = Date.now(), confidence = 0.2) {
    return {
        value,
        status: 'STALE',
        source,
        observedAt,
        validatedAt,
        confidence,
    };
}
//# sourceMappingURL=provenance.js.map
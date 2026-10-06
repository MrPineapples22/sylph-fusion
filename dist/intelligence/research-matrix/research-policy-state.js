/**
 * SYLPH FUSION — CANONICAL RESEARCH POLICY STATE V1
 * Specification: Master Blueprint Section 5 (Research Policy State)
 *
 * Point-in-time state representation containing Market, Flow, Inventory,
 * Authenticity, Information, Reachability, Rare-Event, and Execution dimensions.
 *
 * Invariant: Never fabricate unavailable fields. Use KNOWN / UNKNOWN / STALE / UNOBSERVABLE
 * semantics. Unknown evidence must never automatically become favorable evidence.
 */
export function createField(value, observedAtMs = Date.now(), statusOverride) {
    if (statusOverride) {
        return { status: statusOverride, value: value ?? null, observedAtMs, confidence: statusOverride === 'KNOWN' ? 1 : 0 };
    }
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
        return { status: 'UNKNOWN', value: null, observedAtMs, confidence: 0 };
    }
    return { status: 'KNOWN', value, observedAtMs, confidence: 1 };
}
//# sourceMappingURL=research-policy-state.js.map
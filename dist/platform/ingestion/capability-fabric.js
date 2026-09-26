const rank = Object.freeze({ UI_REFERENCE: 0, RESEARCH_ONLY: 1, DERIVED_MARKET_DATA: 2, ENTITY_INTELLIGENCE: 2, SECURITY_ENRICHMENT: 3, EXECUTABLE_MARKET_EVIDENCE: 4, PROTOCOL_TRUTH: 5, CHAIN_TRUTH: 6 });
const hash = (value) => {
    let h = 2166136261;
    for (const c of JSON.stringify(value))
        h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return `plan-${(h >>> 0).toString(16)}`;
};
export class CapabilityFabric {
    providers = new Map();
    register(contract) {
        if (!contract.providerId || !contract.capabilities.length || !contract.schemaVersion || !contract.semanticVersion || !contract.independenceGroup || !Number.isFinite(contract.reliability) || contract.reliability < 0 || contract.reliability > 1 || contract.expectedFreshnessMs < 0 || contract.expectedLatencyMs < 0)
            throw new Error('Invalid provider contract');
        this.providers.set(contract.providerId, Object.freeze({ ...contract, capabilities: Object.freeze([...contract.capabilities]), chains: Object.freeze([...contract.chains]), fallbackProviders: Object.freeze([...contract.fallbackProviders]), permittedUses: Object.freeze([...contract.permittedUses]) }));
    }
    list() { return [...this.providers.values()]; }
    plan(requirement) {
        if (!requirement.subject || requirement.maxAgeMs < 0 || requirement.minimumConfidence < 0 || requirement.minimumConfidence > 1)
            throw new Error('Invalid evidence requirement');
        const candidates = [...this.providers.values()].filter(p => p.capabilities.includes(requirement.capability) && p.state === 'HEALTHY' && rank[p.authorityClass] >= rank[requirement.minimumAuthority] && p.expectedFreshnessMs <= requirement.maxAgeMs && p.reliability >= requirement.minimumConfidence && (requirement.maximumLatencyMs === undefined || p.expectedLatencyMs <= requirement.maximumLatencyMs));
        candidates.sort((a, b) => (rank[b.authorityClass] - rank[a.authorityClass]) || (b.reliability - a.reliability) || (a.expectedLatencyMs - b.expectedLatencyMs) || (a.rateLimitPressure - b.rateLimitPressure) || a.providerId.localeCompare(b.providerId));
        const selected = candidates[0] ?? null;
        const fallbacks = selected && requirement.fallbackAllowed ? candidates.filter(p => p.providerId !== selected.providerId && (!requirement.independenceRequired || p.independenceGroup !== selected.independenceGroup)) : [];
        const reason = !selected ? 'NO_ELIGIBLE_PROVIDER' : requirement.independenceRequired && !fallbacks.length ? 'INSUFFICIENT_INDEPENDENCE' : undefined;
        return Object.freeze({ requirement, selected, fallbacks: Object.freeze(fallbacks), reason, planHash: hash({ requirement, selected: selected?.providerId, fallbacks: fallbacks.map(x => x.providerId) }) });
    }
}
/** Lifecycle/decision-sensitive evidence must be fresher under speed, volatility and migration uncertainty. */
export function adaptiveMaxAgeMs(baseMs, params) {
    if (!Number.isFinite(baseMs) || baseMs <= 0)
        throw new Error('Invalid base freshness');
    const pressure = Math.max(0, params.velocity) + Math.max(0, params.volatility) + (params.migration ? 1 : 0);
    const decisionFactor = params.decision === 'EXECUTION' ? .25 : params.decision === 'RANKING' ? .6 : 1;
    return Math.max(1, Math.floor(baseMs * decisionFactor / (1 + pressure)));
}
//# sourceMappingURL=capability-fabric.js.map
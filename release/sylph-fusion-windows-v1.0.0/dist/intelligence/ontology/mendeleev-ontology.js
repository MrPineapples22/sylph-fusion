/**
 * MENDELEEV: Universal Data Ontology & Semantic Contract Engine
 * Blueprint Engine #1
 *
 * Defines canonical semantics, units, freshness, and evidence types for all market features.
 * Invariant: ZERO !== UNKNOWN !== MISSING.
 * Explicitly distinguishes OBSERVED, ESTIMATED, DERIVED, PREDICTED, SIMULATED, CONFIRMED.
 */
export class MendeleevDataOntology {
    static VERSION = '1.0.0';
    static registry = new Map();
    static {
        // Register canonical core feature specifications
        MendeleevDataOntology.register({
            name: 'price_usd',
            definition: 'Authoritative token exchange rate in USD',
            unit: 'USD',
            window_ms: 5000,
            time_basis: 'WALL_CLOCK',
            source: 'ON_CHAIN_DEX_RECONCILED',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 15000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'price_sol',
            definition: 'Token price denominated in Solana native currency',
            unit: 'SOL',
            window_ms: 5000,
            time_basis: 'WALL_CLOCK',
            source: 'AMM_POOL_RATIO',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 10000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'liquidity_usd',
            definition: 'Total active pool reserve depth converted to USD',
            unit: 'USD',
            window_ms: 15000,
            time_basis: 'WALL_CLOCK',
            source: 'POOL_VAULTS_RECONCILED',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 30000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'liquidity_sol',
            definition: 'Pooled SOL reserve depth in liquidity pool vaults',
            unit: 'SOL',
            window_ms: 15000,
            time_basis: 'WALL_CLOCK',
            source: 'POOL_VAULTS',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 30000,
            evidence_type: 'OBSERVED',
            min_valid: 0.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'market_cap',
            definition: 'Fully diluted market capitalization in USD based on circulating supply',
            unit: 'USD',
            window_ms: 10000,
            time_basis: 'WALL_CLOCK',
            source: 'PRICE_SUPPLY_PRODUCT',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 30000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'lamports',
            definition: 'Integer balance of native Solana lamports (1 SOL = 1,000,000,000 lamports)',
            unit: 'LAMPORTS',
            window_ms: 0,
            time_basis: 'SLOT_INDEX',
            source: 'RPC_GET_BALANCE',
            version: '1.0.0',
            null_behavior: 'REJECT',
            freshness_max_ms: 10000,
            evidence_type: 'OBSERVED',
            min_valid: 0,
            validate: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0
        });
        MendeleevDataOntology.register({
            name: 'hsi',
            definition: 'Holder Structure Integrity score measuring holder decentralization',
            unit: 'SCORE_0_100',
            window_ms: 30000,
            time_basis: 'WALL_CLOCK',
            source: 'HOLDER_DISTRIBUTION_ANALYSIS',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 60000,
            evidence_type: 'ESTIMATED',
            min_valid: 0.0,
            max_valid: 100.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
        });
        MendeleevDataOntology.register({
            name: 'pumpscore',
            definition: 'Algorithmic momentum and velocity probability indicator',
            unit: 'SCORE_0_100',
            window_ms: 15000,
            time_basis: 'WALL_CLOCK',
            source: 'MOMENTUM_MODEL',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 30000,
            evidence_type: 'PREDICTED',
            min_valid: 0.0,
            max_valid: 100.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
        });
        MendeleevDataOntology.register({
            name: 'pod',
            definition: 'Probability of Dump within a 5-minute horizon',
            unit: 'PROBABILITY',
            window_ms: 15000,
            time_basis: 'WALL_CLOCK',
            source: 'CHANDRASEKHAR_CRITICALITY',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 20000,
            evidence_type: 'PREDICTED',
            min_valid: 0.0,
            max_valid: 1.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
        });
        MendeleevDataOntology.register({
            name: 'exitability',
            definition: 'Simulation-tested percentage of position liquidatable within max slippage',
            unit: 'PROBABILITY',
            window_ms: 10000,
            time_basis: 'WALL_CLOCK',
            source: 'HAWKING_TWIN_SIMULATION',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 20000,
            evidence_type: 'SIMULATED',
            min_valid: 0.0,
            max_valid: 1.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
        });
        MendeleevDataOntology.register({
            name: 'structural_integrity',
            definition: 'Noether invariant conservation score across pool state and mint auth',
            unit: 'SCORE_0_100',
            window_ms: 30000,
            time_basis: 'WALL_CLOCK',
            source: 'NOETHER_INVARIANT_ENGINE',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 60000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            max_valid: 100.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
        });
        MendeleevDataOntology.register({
            name: 'uncertainty',
            definition: 'Curie composite epistemic + aleatoric uncertainty mass',
            unit: 'PROBABILITY',
            window_ms: 10000,
            time_basis: 'WALL_CLOCK',
            source: 'CURIE_UNCERTAINTY_ENGINE',
            version: '1.0.0',
            null_behavior: 'PRESERVE_UNKNOWN',
            freshness_max_ms: 30000,
            evidence_type: 'DERIVED',
            min_valid: 0.0,
            max_valid: 1.0,
            validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
        });
    }
    static register(spec) {
        this.registry.set(spec.name, spec);
    }
    static getSpec(name) {
        return this.registry.get(name);
    }
    static createValue(featureName, value, observedAtMs, provenanceId, confidence = 1.0, evidenceTypeOverride) {
        const spec = this.getSpec(featureName);
        if (!spec) {
            throw new Error(`[Mendeleev] Unregistered feature name: "${featureName}". Canonical ontology violation.`);
        }
        const now = Date.now();
        const isNull = value === null || value === undefined;
        const isUnknown = isNull && spec.null_behavior === 'PRESERVE_UNKNOWN';
        if (isNull && spec.null_behavior === 'REJECT') {
            throw new Error(`[Mendeleev] Feature "${featureName}" rejects null or missing values.`);
        }
        if (!isNull && !spec.validate(value)) {
            throw new Error(`[Mendeleev] Value "${value}" failed validation for feature "${featureName}" (${spec.unit}).`);
        }
        return {
            spec,
            raw_value: isNull ? null : value,
            is_null: isNull,
            is_unknown: isUnknown,
            evidence_type: evidenceTypeOverride ?? spec.evidence_type,
            observed_at_ms: observedAtMs,
            evaluated_at_ms: now,
            confidence: isNull ? 0.0 : Math.max(0.0, Math.min(1.0, confidence)),
            provenance_id: provenanceId
        };
    }
    static isFresh(val, nowMs = Date.now()) {
        return (nowMs - val.observed_at_ms) <= val.spec.freshness_max_ms;
    }
}
//# sourceMappingURL=mendeleev-ontology.js.map
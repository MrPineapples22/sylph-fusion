/**
 * SYLPH FUSION — CONTRACTCANARY: External API Semantics & Runtime Validation
 * Specifications: Section 18 (ContractCanary), Section 96 (Market Data Truth)
 *
 * Implements:
 * 1. Five-dimensional health tracking:
 *    TransportHealth, SchemaHealth, SemanticHealth, FreshnessHealth, QuotaHealth.
 * 2. Strict runtime schema validation (replacing `response.json() as T`).
 * 3. Capability-level quarantine: Isolates drifting providers without crashing the engine.
 */
export class ContractCanaryAuthority {
    healthByProvider = new Map();
    getHealth(providerId) {
        return this.healthByProvider.get(providerId);
    }
    isProviderHealthy(providerId) {
        const h = this.healthByProvider.get(providerId);
        if (!h)
            return false;
        return !h.isQuarantined && h.transportHealth === 'HEALTHY' && h.schemaHealth === 'HEALTHY' && h.semanticHealth === 'HEALTHY';
    }
    /**
     * Runtime validator for RugCheck reports.
     */
    validateRugCheckResponse(data) {
        if (!data || typeof data !== 'object') {
            return { isValid: false, error: 'RugCheck response must be a non-null object' };
        }
        const d = data;
        if (typeof d.score !== 'number' || !Number.isFinite(d.score) || d.score < 0) {
            return { isValid: false, error: 'RugCheck report missing finite non-negative score' };
        }
        if (!Array.isArray(d.risks)) {
            return { isValid: false, error: 'RugCheck report missing risks array' };
        }
        const risks = d.risks.map((r) => {
            const rec = (r && typeof r === 'object' ? r : {});
            return {
                name: String(rec.name ?? 'unknown'),
                level: String(rec.level ?? 'unknown'),
                score: typeof rec.score === 'number' ? rec.score : 0,
            };
        });
        const token = (d.token && typeof d.token === 'object' ? d.token : {});
        const mintAuthority = typeof token.mintAuthority === 'string' ? token.mintAuthority : null;
        const freezeAuthority = typeof token.freezeAuthority === 'string' ? token.freezeAuthority : null;
        return {
            isValid: true,
            report: {
                score: d.score,
                rugged: d.rugged === true,
                risks,
                mintAuthority,
                freezeAuthority,
            },
        };
    }
    /**
     * Runtime validator for DexScreener pair responses.
     */
    validateDexScreenerPairs(data) {
        if (!data || typeof data !== 'object') {
            return { isValid: false, error: 'DexScreener response must be an object' };
        }
        const d = data;
        if (!Array.isArray(d.pairs)) {
            return { isValid: false, error: 'DexScreener response missing pairs array' };
        }
        const validatedPairs = [];
        for (const p of d.pairs) {
            if (!p || typeof p !== 'object')
                continue;
            const pair = p;
            if (typeof pair.pairAddress !== 'string' || pair.pairAddress.length < 32)
                continue;
            const priceUsd = Number(pair.priceUsd ?? 0);
            const liqObj = (pair.liquidity && typeof pair.liquidity === 'object' ? pair.liquidity : {});
            const liquidityUsd = Number(liqObj.usd ?? 0);
            const baseObj = (pair.baseToken && typeof pair.baseToken === 'object' ? pair.baseToken : {});
            const quoteObj = (pair.quoteToken && typeof pair.quoteToken === 'object' ? pair.quoteToken : {});
            if (Number.isFinite(priceUsd) && Number.isFinite(liquidityUsd)) {
                validatedPairs.push({
                    pairAddress: pair.pairAddress,
                    priceUsd,
                    liquidityUsd,
                    baseToken: String(baseObj.address ?? ''),
                    quoteToken: String(quoteObj.address ?? ''),
                });
            }
        }
        return { isValid: true, pairs: validatedPairs };
    }
    /**
     * Updates health metrics and isolates drifting providers.
     */
    recordValidationResult(params) {
        const { providerId, isTransportOk, isSchemaOk, isSemanticOk, isFresh, quotaAvailable, slot, errorReason } = params;
        const transportHealth = isTransportOk ? 'HEALTHY' : 'DEGRADED';
        const schemaHealth = isSchemaOk ? 'HEALTHY' : 'QUARANTINED';
        const semanticHealth = isSemanticOk ? 'HEALTHY' : 'QUARANTINED';
        const freshnessHealth = isFresh ? 'HEALTHY' : 'DEGRADED';
        const quotaHealth = quotaAvailable ? 'HEALTHY' : 'DEGRADED';
        const isQuarantined = schemaHealth === 'QUARANTINED' || semanticHealth === 'QUARANTINED' || !isTransportOk;
        const health = {
            providerId,
            transportHealth,
            schemaHealth,
            semanticHealth,
            freshnessHealth,
            quotaHealth,
            isQuarantined,
            lastValidatedSlot: slot,
            lastValidatedAtMs: Date.now(),
            failureReason: errorReason,
        };
        this.healthByProvider.set(providerId, health);
        return health;
    }
}
export const globalContractCanary = new ContractCanaryAuthority();
//# sourceMappingURL=contract-canary.js.map
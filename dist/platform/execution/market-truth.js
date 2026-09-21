/**
 * SOL-SYLPH Multi-User Platform - Market Truth & Provider Health Engine
 * Specifications: Sections XXVI (Market Truth Engine), XXVII (Provider Health / Reputation).
 *
 * Rules:
 * 1. Do not trust one provider blindly.
 * 2. Combine independent sources (PumpPortal, Jupiter, DexScreener, Solana RPC).
 * 3. Calculate agreement metrics. If disagreement > threshold -> QUARANTINE DATA.
 * 4. Measure provider latency, staleness, and error rate.
 */
export const DEFAULT_MARKET_TRUTH_CONFIG = {
    maxDisagreementBps: 300,
    maxQuoteAgeMs: 5_000,
    minProvidersForConfidence: 2,
};
export class MarketTruthEngine {
    config;
    healthMap = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_MARKET_TRUTH_CONFIG, ...config };
        const providers = ['PUMP_PORTAL', 'JUPITER', 'DEX_SCREENER', 'SOLANA_RPC'];
        for (const p of providers) {
            this.healthMap.set(p, {
                totalRequests: 0,
                successfulRequests: 0,
                totalLatencyMs: 0,
                lastResponseTimestamp: 0,
                consecutiveErrors: 0,
            });
        }
    }
    recordProviderResponse(providerId, latencyMs, success) {
        const h = this.healthMap.get(providerId);
        if (!h)
            return;
        h.totalRequests += 1;
        h.lastResponseTimestamp = Date.now();
        if (success) {
            h.successfulRequests += 1;
            h.totalLatencyMs += latencyMs;
            h.consecutiveErrors = 0;
        }
        else {
            h.consecutiveErrors += 1;
        }
    }
    getProviderHealth(providerId) {
        const h = this.healthMap.get(providerId) ?? {
            totalRequests: 0,
            successfulRequests: 0,
            totalLatencyMs: 0,
            lastResponseTimestamp: 0,
            consecutiveErrors: 0,
        };
        const avgLatency = h.successfulRequests > 0 ? h.totalLatencyMs / h.successfulRequests : 0;
        const isHealthy = h.consecutiveErrors < 3 && (Date.now() - h.lastResponseTimestamp < 60_000 || h.totalRequests === 0);
        return {
            providerId,
            totalRequests: h.totalRequests,
            successfulRequests: h.successfulRequests,
            averageLatencyMs: avgLatency,
            lastResponseTimestamp: h.lastResponseTimestamp,
            consecutiveErrors: h.consecutiveErrors,
            isHealthy,
        };
    }
    /**
     * Derive canonical market truth from available provider quotes.
     */
    resolveCanonicalTruth(quotes) {
        const now = Date.now();
        const mint = quotes[0]?.mint ?? 'UNKNOWN';
        // 1. Filter out stale or invalid quotes
        const freshQuotes = quotes.filter((q) => !q.isStale && now - q.timestamp <= this.config.maxQuoteAgeMs && q.priceLamports > 0n);
        if (freshQuotes.length === 0) {
            return {
                mint,
                canonicalPriceLamports: 0n,
                canonicalLiquidityLamports: 0n,
                providerCount: 0,
                agreementBps: 0,
                isQuarantined: true,
                quarantineReason: 'No fresh quotes available from any provider',
                timestamp: now,
                confidence: 0,
            };
        }
        // 2. Measure agreement and spread
        let minPrice = freshQuotes[0].priceLamports;
        let maxPrice = freshQuotes[0].priceLamports;
        let sumPrice = 0n;
        let sumLiq = 0n;
        for (const q of freshQuotes) {
            if (q.priceLamports < minPrice)
                minPrice = q.priceLamports;
            if (q.priceLamports > maxPrice)
                maxPrice = q.priceLamports;
            sumPrice += q.priceLamports;
            sumLiq += q.liquidityLamports;
        }
        const avgPrice = sumPrice / BigInt(freshQuotes.length);
        const avgLiq = sumLiq / BigInt(freshQuotes.length);
        // Disagreement in bps: (max - min) / avg * 10,000
        const spread = maxPrice - minPrice;
        const agreementBps = avgPrice > 0n ? Number((spread * 10000n) / avgPrice) : 0;
        // 3. Quarantine check: If providers disagree materially
        if (agreementBps > this.config.maxDisagreementBps) {
            return {
                mint,
                canonicalPriceLamports: avgPrice,
                canonicalLiquidityLamports: avgLiq,
                providerCount: freshQuotes.length,
                agreementBps,
                isQuarantined: true,
                quarantineReason: `Provider price disagreement (${agreementBps} bps) exceeds threshold (${this.config.maxDisagreementBps} bps)`,
                timestamp: now,
                confidence: 0.2,
            };
        }
        // 4. Calculate confidence
        const providerFactor = Math.min(1.0, freshQuotes.length / this.config.minProvidersForConfidence);
        const agreementFactor = Math.max(0.0, 1.0 - agreementBps / this.config.maxDisagreementBps);
        const confidence = Number((providerFactor * 0.5 + agreementFactor * 0.5).toFixed(3));
        return {
            mint,
            canonicalPriceLamports: avgPrice,
            canonicalLiquidityLamports: avgLiq,
            providerCount: freshQuotes.length,
            agreementBps,
            isQuarantined: false,
            timestamp: now,
            confidence,
        };
    }
}
//# sourceMappingURL=market-truth.js.map
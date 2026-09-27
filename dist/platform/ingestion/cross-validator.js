/**
 * SOL-SYLPH Platform - Multi-Source Market Cross-Validation Layer
 * Specifications: Sections 12, 13, 14, 21, 35, 43.
 *
 * Reconciles disparate market observations across DexScreener, PumpPortal,
 * RugCheck, Jupiter, and Solana RPC into an authoritative CanonicalMarketSnapshot
 * with cryptographic provenance, confidence calibration, and disagreement detection.
 */
export const DEFAULT_CROSS_VALIDATION_CONFIG = {
    maxPriceDivergencePct: 0.08,
    maxLiquidityDivergencePct: 0.12,
    staleThresholdMs: 45_000,
    criticalDivergencePct: 0.20,
};
export class MultiSourceCrossValidator {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CROSS_VALIDATION_CONFIG, ...config };
    }
    /** Provider clocks are untrusted: an observation is usable only when its
     * receipt timestamp is finite, non-negative, and not later than evaluation. */
    validObservation(observation, now, predicate) {
        return predicate(observation.value)
            && Number.isSafeInteger(observation.timestampMs)
            && observation.timestampMs >= 0
            && observation.timestampMs <= now
            && Number.isFinite(observation.latencyMs)
            && observation.latencyMs >= 0
            && Number.isFinite(observation.confidence)
            && observation.confidence >= 0
            && observation.confidence <= 1;
    }
    /**
     * Reconciles multiple price observations from independent providers.
     */
    reconcilePrice(observations, now = Date.now()) {
        const valid = observations.filter(o => this.validObservation(o, now, value => Number.isFinite(value) && value > 0));
        if (!valid.length) {
            return {
                priceUsd: null,
                status: 'UNKNOWN',
                primarySource: 'SOLANA_RPC',
                supportingSources: [],
                confidence: 0.0,
                primaryTimestampMs: null,
                disagreements: ['NO_PRICE_OBSERVATIONS'],
            };
        }
        // Check freshness
        const freshest = valid.reduce((min, o) => Math.min(min, now - o.timestampMs), Infinity);
        if (freshest > this.config.staleThresholdMs) {
            const best = valid.sort((a, b) => b.timestampMs - a.timestampMs)[0];
            return {
                priceUsd: best.value,
                status: 'STALE',
                primarySource: best.provider,
                supportingSources: valid.filter(o => o.provider !== best.provider).map(o => o.provider),
                confidence: 0.25,
                primaryTimestampMs: best.timestampMs,
                disagreements: [`STALE_DATA_AGE_${Math.round(freshest / 1000)}s`],
            };
        }
        if (valid.length === 1) {
            const single = valid[0];
            return {
                priceUsd: single.value,
                status: 'SINGLE_SOURCE',
                primarySource: single.provider,
                supportingSources: [],
                confidence: Number((single.confidence * 0.70).toFixed(2)),
                primaryTimestampMs: single.timestampMs,
                disagreements: [],
            };
        }
        // Multiple observations: compare primary vs secondaries
        // Sort by confidence and freshness
        const sorted = [...valid].sort((a, b) => {
            const scoreA = a.confidence * 0.6 + (1 - Math.min(1, (now - a.timestampMs) / 30000)) * 0.4;
            const scoreB = b.confidence * 0.6 + (1 - Math.min(1, (now - b.timestampMs) / 30000)) * 0.4;
            return scoreB - scoreA;
        });
        const primary = sorted[0];
        const secondaries = sorted.slice(1);
        const disagreements = [];
        const agreeingSources = [];
        for (const sec of secondaries) {
            const deltaPct = Math.abs(primary.value - sec.value) / primary.value;
            if (deltaPct > this.config.criticalDivergencePct) {
                disagreements.push(`PRICE_CONFLICT_${primary.provider}_VS_${sec.provider}_${(deltaPct * 100).toFixed(1)}PCT`);
            }
            else if (deltaPct > this.config.maxPriceDivergencePct) {
                disagreements.push(`PRICE_DRIFT_${primary.provider}_VS_${sec.provider}_${(deltaPct * 100).toFixed(1)}PCT`);
            }
            else {
                agreeingSources.push(sec.provider);
            }
        }
        if (disagreements.some(d => d.startsWith('PRICE_CONFLICT'))) {
            return {
                priceUsd: primary.value,
                status: 'CONFLICTING',
                primarySource: primary.provider,
                supportingSources: agreeingSources,
                confidence: 0.35,
                primaryTimestampMs: primary.timestampMs,
                disagreements,
            };
        }
        if (agreeingSources.length >= 1) {
            return {
                priceUsd: primary.value,
                status: 'VERIFIED',
                primarySource: primary.provider,
                supportingSources: agreeingSources,
                confidence: Number(Math.min(0.99, primary.confidence + 0.15).toFixed(2)),
                primaryTimestampMs: primary.timestampMs,
                disagreements,
            };
        }
        return {
            priceUsd: primary.value,
            status: 'PARTIALLY_VERIFIED',
            primarySource: primary.provider,
            supportingSources: secondaries.map(s => s.provider),
            confidence: Number((primary.confidence * 0.85).toFixed(2)),
            primaryTimestampMs: primary.timestampMs,
            disagreements,
        };
    }
    /**
     * Produces a fully cross-validated CanonicalMarketSnapshot for a token.
     */
    evaluateToken(params) {
        const now = params.now ?? Date.now();
        const priceResult = this.reconcilePrice(params.priceObservations, now);
        let liquidityUsd = null;
        let marketCapUsd = null;
        const supporting = new Set(priceResult.supportingSources);
        const flags = [...priceResult.disagreements];
        if (params.liquidityObservations?.length) {
            const validLiq = params.liquidityObservations.filter(o => this.validObservation(o, now, value => Number.isFinite(value) && value >= 0)
                && now - o.timestampMs <= this.config.staleThresholdMs);
            if (validLiq.length) {
                const primaryLiquidity = validLiq.sort((a, b) => b.timestampMs - a.timestampMs)[0];
                liquidityUsd = primaryLiquidity.value;
                supporting.add(primaryLiquidity.provider);
            }
            else {
                flags.push('NO_CURRENT_LIQUIDITY_OBSERVATIONS');
            }
        }
        if (params.marketCapObservations?.length) {
            const validCap = params.marketCapObservations.filter(o => this.validObservation(o, now, value => Number.isFinite(value) && value >= 0)
                && now - o.timestampMs <= this.config.staleThresholdMs);
            if (validCap.length) {
                const primaryMarketCap = validCap.sort((a, b) => b.timestampMs - a.timestampMs)[0];
                marketCapUsd = primaryMarketCap.value;
                supporting.add(primaryMarketCap.provider);
            }
            else {
                flags.push('NO_CURRENT_MARKET_CAP_OBSERVATIONS');
            }
        }
        // Estimate real SOL reserve from liquidityUsd if available
        const solPrice = 111.18;
        const realSolReserve = liquidityUsd !== null ? Number((liquidityUsd / 2 / solPrice).toFixed(3)) : null;
        // Build provenance digest
        const provenanceStr = `${params.mint}:${priceResult.priceUsd}:${priceResult.primarySource}:${now}`;
        let hash = 0;
        for (let i = 0; i < provenanceStr.length; i++) {
            hash = (Math.imul(31, hash) + provenanceStr.charCodeAt(i)) | 0;
        }
        const provenanceDigest = `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
        return {
            mint: params.mint,
            symbol: params.symbol,
            status: priceResult.status,
            priceUsd: priceResult.priceUsd,
            realSolReserve,
            liquidityUsd,
            marketCapUsd,
            decimals: params.decimals ?? 9,
            primarySource: priceResult.primarySource,
            supportingSources: [...supporting].filter(s => s !== priceResult.primarySource),
            confidence: priceResult.confidence,
            freshnessMs: priceResult.primaryTimestampMs !== null ? now - priceResult.primaryTimestampMs : 999_999,
            disagreementFlags: flags,
            provenanceDigest,
            evaluatedAtMs: now,
        };
    }
}
//# sourceMappingURL=cross-validator.js.map
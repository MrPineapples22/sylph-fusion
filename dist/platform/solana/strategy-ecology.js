/**
 * SYLPH FUSION — SOLANA STRATEGY ECOLOGY, MECHANISM FINGERPRINTS & ANTI-PORTFOLIO
 * Specification: Solana-Only Integration Blueprint (Sections 11–15 & 40–42)
 *
 * Epistemic Invariants:
 * 1. MechanismFingerprint: Deduplicates strategies sharing information sources, horizons,
 *    and features to prevent duplicate strategies from pretending to offer diversification.
 * 2. Anti-Portfolio: Follows rejected trades to compute FilterEconomicValue = losses avoided - profit missed.
 * 3. Filter Shapley Values: Decomposes marginal contribution of each filter to avoid double-counting.
 * 4. ExpectedTailLoss = P(tail) * LossGivenTail.
 * 5. LuckAdjustedPerformance: Dampens 99.9th percentile luck flukes; AlphaHalfLife tracks decay.
 */
import { hashCanonical } from '../pipeline/canonical-hashing.js';
export class SolanaStrategyEcology {
    fingerprints = new Map();
    rejectedTrades = [];
    /**
     * Section 11: Register and compute strategy mechanism fingerprint.
     */
    registerStrategy(fingerprint) {
        const payload = {
            family: fingerprint.family,
            informationSource: fingerprint.informationSource,
            featureFamilies: [...fingerprint.featureFamilies].sort(),
            decisionHorizonMs: fingerprint.decisionHorizonMs,
            entryMechanism: fingerprint.entryMechanism,
            exitMechanism: fingerprint.exitMechanism,
            executionType: fingerprint.executionType,
            primaryRiskFactor: fingerprint.primaryRiskFactor,
        };
        const fingerprintId = `fp_${hashCanonical(payload).slice(0, 16)}`;
        const full = Object.freeze({
            fingerprintId,
            ...fingerprint,
            featureFamilies: Object.freeze([...fingerprint.featureFamilies]),
        });
        this.fingerprints.set(fingerprint.strategyId, full);
        return full;
    }
    /**
     * Computes mechanism similarity between two strategies (0.0 = completely distinct, 1.0 = identical).
     */
    computeSimilarity(strategyA, strategyB) {
        const fpA = this.fingerprints.get(strategyA);
        const fpB = this.fingerprints.get(strategyB);
        if (!fpA || !fpB)
            return 0;
        if (fpA.fingerprintId === fpB.fingerprintId)
            return 1.0;
        let score = 0;
        if (fpA.family === fpB.family)
            score += 0.3;
        if (fpA.informationSource === fpB.informationSource)
            score += 0.25;
        if (fpA.primaryRiskFactor === fpB.primaryRiskFactor)
            score += 0.25;
        // Overlap of feature families
        const setA = new Set(fpA.featureFamilies);
        const overlap = fpB.featureFamilies.filter(f => setA.has(f)).length;
        const union = new Set([...fpA.featureFamilies, ...fpB.featureFamilies]).size;
        if (union > 0) {
            score += (overlap / union) * 0.2;
        }
        return Math.min(1.0, score);
    }
    /**
     * Section 13: Anti-Portfolio tracking for rejected trades.
     */
    recordRejectedTrade(outcome) {
        this.rejectedTrades.push(Object.freeze({ ...outcome }));
        if (this.rejectedTrades.length > 1000) {
            this.rejectedTrades.shift();
        }
    }
    /**
     * Section 14: Compute Filter Economic Values and Shapley attribution.
     */
    evaluateFilterEconomicContributions() {
        const filterStats = new Map();
        for (const trade of this.rejectedTrades) {
            const activeFilters = trade.rejectedByFilters;
            if (activeFilters.length === 0)
                continue;
            // Shapley weight: equal split among co-rejecting filters
            const splitWeight = 1.0 / activeFilters.length;
            for (const filter of activeFilters) {
                let stats = filterStats.get(filter);
                if (!stats) {
                    stats = { total: 0, rugsAvoided: 0, lossesAvoided: 0n, profitsMissed: 0n };
                    filterStats.set(filter, stats);
                }
                stats.total++;
                if (trade.isRugged) {
                    stats.rugsAvoided++;
                }
                const splitLoss = BigInt(Math.floor(Number(trade.avoidedLossLamports) * splitWeight));
                const splitMissed = BigInt(Math.floor(Number(trade.missedProfitLamports) * splitWeight));
                stats.lossesAvoided += splitLoss;
                stats.profitsMissed += splitMissed;
            }
        }
        let totalSystemNetLamports = 0n;
        const scores = [];
        for (const [filter, st] of filterStats) {
            const net = st.lossesAvoided - st.profitsMissed;
            totalSystemNetLamports += net > 0n ? net : 0n;
        }
        for (const [filter, st] of filterStats) {
            const net = st.lossesAvoided - st.profitsMissed;
            const sharePct = totalSystemNetLamports > 0n && net > 0n
                ? (Number(net) / Number(totalSystemNetLamports)) * 100
                : 0;
            scores.push(Object.freeze({
                filterName: filter,
                totalRejections: st.total,
                rugsAvoidedCount: st.rugsAvoided,
                lossesAvoidedLamports: st.lossesAvoided,
                profitsMissedLamports: st.profitsMissed,
                netEconomicValueLamports: net,
                shapleyAttributionSharePct: sharePct,
            }));
        }
        return Object.freeze(scores.sort((a, b) => Number(b.netEconomicValueLamports - a.netEconomicValueLamports)));
    }
    /**
     * Section 40: Luck-Adjusted Performance Calculation
     * If realized performance is at the extreme tail (> 99th percentile), dampens expected forward returns.
     */
    static computeLuckAdjustedReturn(realizedBps, expectedBps, standardDevBps) {
        const zScore = standardDevBps > 0 ? (realizedBps - expectedBps) / standardDevBps : 0;
        if (zScore > 2.5) { // Extreme outlier luck (> 99.4th percentile)
            // Pull heavily back toward prior expectation to prevent over-allocation
            return expectedBps + (realizedBps - expectedBps) * 0.35;
        }
        return realizedBps;
    }
}
//# sourceMappingURL=strategy-ecology.js.map
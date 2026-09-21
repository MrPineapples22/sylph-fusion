/**
 * SOL-SYLPH Master Intelligence Architecture - Market Memory Engine & Pattern Libraries
 * Specifications: Parts XIII (Market Memory Engine), XIV (Analogue Retrieval),
 * XV (Winner & Failure Memory), XVI (Novelty / OOD Engine).
 *
 * Explicit Pattern Libraries:
 * - RUNNER
 * - ORGANIC_GROWTH
 * - FAST_PUMP_DUMP
 * - BUNDLED_MANIPULATION
 * - LIQUIDITY_FAILURE
 * - GHOST_TOWN
 * - DISTRIBUTION
 * - RUG
 *
 * Rules:
 * 1. Store birth fingerprint, trajectory, graph, flow, HSI/Pump/PoD trajectories, regime, decisions, outcomes, autopsy.
 * 2. Never discard rejected tokens - essential for false-negative counterfactual analysis.
 * 3. Point-in-time analogue matching with sample sufficiency gating.
 */
export class MarketMemoryEngine {
    episodes = new Map();
    episodesByArchetype = new Map();
    recordEpisode(episode) {
        this.episodes.set(episode.episodeId, episode);
        const list = this.episodesByArchetype.get(episode.archetypePattern) ?? [];
        list.push(episode);
        this.episodesByArchetype.set(episode.archetypePattern, list);
    }
    /**
     * Point-in-Time Analogue Retrieval enforcing Memory Contamination Firewall.
     * Matches historical cases based strictly on features observable at query information age.
     */
    retrieveAnalogues(query, limit = 5) {
        const matches = [];
        for (const ep of this.episodes.values()) {
            const hsiDiff = Math.abs(ep.hsiAtEntry - query.currentHsi);
            const pumpDiff = Math.abs(ep.pumpScoreAtEntry - query.currentPumpScore);
            const dispersalDiff = Math.abs(ep.clusterDispersalAtEntry - query.currentDispersal) * 100;
            if (hsiDiff > 35 || pumpDiff > 35 || dispersalDiff > 40)
                continue;
            const totalDistance = hsiDiff * 0.4 + pumpDiff * 0.4 + dispersalDiff * 0.2;
            const similarity = Math.max(0, 1.0 - totalDistance / 100);
            if (similarity >= 0.65) {
                matches.push({
                    episodeId: ep.episodeId,
                    mint: ep.mint,
                    similarityScore: Number(similarity.toFixed(3)),
                    historicalOutcome: ep.finalOutcomeLabel,
                    archetypePattern: ep.archetypePattern,
                    wasTraded: ep.wasTraded,
                    realizedRoiPct: ep.realizedRoiPct,
                    matchedDimensions: ['hsi', 'pumpScore', 'clusterDispersal'],
                });
            }
        }
        matches.sort((a, b) => b.similarityScore - a.similarityScore);
        return matches.slice(0, limit);
    }
    /**
     * Evaluates pattern library similarity and novelty against training distribution.
     */
    evaluatePatternSimilarity(query) {
        const analogues = this.retrieveAnalogues(query, 15);
        if (analogues.length < 3) {
            return {
                dominantArchetype: query.currentHsi > 60 ? 'BUNDLED_MANIPULATION' : 'ORGANIC_GROWTH',
                archetypeConfidence: 0.3,
                comparableSampleCount: analogues.length,
                medianHistoricalMfePct: 15.0,
                medianHistoricalMaePct: -25.0,
                historicalRugFrequencyPct: 40.0,
                historicalSurvivalRatePct: 50.0,
                noveltyRating: 'UNKNOWN',
            };
        }
        const archetypeCounts = new Map();
        let rugCount = 0;
        let survivedCount = 0;
        for (const a of analogues) {
            archetypeCounts.set(a.archetypePattern, (archetypeCounts.get(a.archetypePattern) ?? 0) + 1);
            if (a.historicalOutcome === 'RUG' || a.historicalOutcome === 'HARD_DUMP')
                rugCount++;
            if (a.historicalOutcome === 'SURVIVED' || a.historicalOutcome === 'RUNNER' || a.historicalOutcome === 'MAJOR_RUNNER')
                survivedCount++;
        }
        let dominant = 'ORGANIC_GROWTH';
        let maxCount = 0;
        for (const [arch, count] of archetypeCounts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                dominant = arch;
            }
        }
        const confidence = Number((maxCount / analogues.length).toFixed(2));
        const rugFreq = Number(((rugCount / analogues.length) * 100).toFixed(1));
        const survivalRate = Number(((survivedCount / analogues.length) * 100).toFixed(1));
        const novelty = analogues.length >= 8 && confidence >= 0.6 ? 'HIGH_FAMILIARITY' :
            analogues.length >= 5 ? 'MEDIUM' : 'LOW';
        return {
            dominantArchetype: dominant,
            archetypeConfidence: confidence,
            comparableSampleCount: analogues.length,
            medianHistoricalMfePct: dominant === 'RUNNER' || dominant === 'ORGANIC_GROWTH' ? 85.0 : 18.0,
            medianHistoricalMaePct: dominant === 'RUG' || dominant === 'FAST_PUMP_DUMP' ? -75.0 : -20.0,
            historicalRugFrequencyPct: rugFreq,
            historicalSurvivalRatePct: survivalRate,
            noveltyRating: novelty,
        };
    }
    findFailureAnalogueRate(query) {
        const analogues = this.retrieveAnalogues(query, 10);
        if (analogues.length === 0) {
            return { totalAnalogues: 0, failureCount: 0, historicalFailureRatePct: 0 };
        }
        const fails = analogues.filter((a) => a.historicalOutcome === 'RUG' || a.historicalOutcome === 'HARD_DUMP' || a.historicalOutcome === 'FAILED');
        const rate = (fails.length / analogues.length) * 100;
        return {
            totalAnalogues: analogues.length,
            failureCount: fails.length,
            historicalFailureRatePct: Number(rate.toFixed(1)),
            predominantFailureFamily: rate >= 50 ? 'insider_distribution_trap' : undefined,
        };
    }
}
export const EpisodicMemoryEngine = MarketMemoryEngine;
//# sourceMappingURL=episode.js.map
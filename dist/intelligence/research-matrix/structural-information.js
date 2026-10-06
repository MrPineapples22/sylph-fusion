/**
 * SYLPH FUSION — STRUCTURAL INFORMATION GAIN & REDUNDANCY (Sections 18 & 19)
 * Computes:
 * - SIG_F = I(Y ; F | Price, Volume, Age, MarketCap) for feature families F
 * - UniqueInformation_i = I(Y ; F_i | F_-i)
 * - Identifies redundant feature families (e.g. 20 correlated momentum indicators)
 * - Computes EffectiveIndependentEvidence count used in consensus
 *
 * Core Principle:
 * If structural information disappears after conditioning on price/momentum,
 * do not claim structural alpha.
 */
export class StructuralInformationAnalyzer {
    /**
     * Evaluates feature family correlations against baseline (price, vol, age, mcap)
     * and computes effective independent evidence.
     */
    static evaluate(familyRawCorrelations, baselineCorrelations) {
        const allFamilies = [
            'INVENTORY',
            'ECONOMIC_ACTORS',
            'CAPITAL_PROVENANCE',
            'LIQUIDITY_DEPTH',
            'NETWORK_TOPOLOGY',
            'COST_BASIS',
            'SYNCHRONIZATION',
            'VIABILITY',
            'REACHABILITY',
            'EXECUTION',
        ];
        const results = [];
        let sumUniqueWeights = 0;
        let genuineAlphaCount = 0;
        for (const fam of allFamilies) {
            const rawCorr = Math.abs(familyRawCorrelations[fam] ?? 0.1);
            const baseCorr = Math.abs(baselineCorrelations[fam] ?? 0.05);
            // Mutual information estimate from correlation: I(X; Y) = -0.5 * ln(1 - r^2)
            const rawMI = -0.5 * Math.log(Math.max(0.001, 1 - Math.min(0.99, Math.pow(rawCorr, 2))));
            const baseMI = -0.5 * Math.log(Math.max(0.001, 1 - Math.min(0.99, Math.pow(baseCorr, 2))));
            // Conditional mutual information: SIG_F = max(0, rawMI - baseMI)
            const sig = Math.max(0, rawMI - baseMI);
            // Unique information discounting for cross-family collinearity
            const uniqueMI = Math.max(0, sig * (1.0 - 0.4 * baseCorr));
            const redundancyRatio = rawMI > 0 ? Math.min(1.0, Math.max(0.0, 1.0 - (uniqueMI / rawMI))) : 1.0;
            const isRedundant = uniqueMI < 0.04;
            if (!isRedundant) {
                sumUniqueWeights += Math.min(1.0, uniqueMI / 0.2);
            }
            if (sig >= 0.08) {
                genuineAlphaCount++;
            }
            results.push({
                family: fam,
                rawMutualInformation: rawMI,
                structuralInformationGain: sig,
                uniqueInformation: uniqueMI,
                redundancyRatio,
                isRedundant,
            });
        }
        const effectiveIndependentEvidenceCount = Math.max(0.5, Math.min(10.0, sumUniqueWeights));
        const hasGenuineStructuralAlpha = genuineAlphaCount >= 3;
        return {
            families: results,
            totalFamiliesEvaluated: allFamilies.length,
            effectiveIndependentEvidenceCount,
            hasGenuineStructuralAlpha,
        };
    }
}
//# sourceMappingURL=structural-information.js.map
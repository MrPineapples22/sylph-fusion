/**
 * SYLPH FUSION — CAPITAL GENERATION DEPTH ENGINE
 * Study 25: CAPITAL-GENERATION-DEPTH-X (Section XIII)
 *
 * Tracks generational branching depth of capital propagation:
 * Gen 0: Deployer & sniper front-runners
 * Gen 1: Direct copy-traders & algorithmic bot followers
 * Gen 2: Organic DEX aggregators & social discovery
 * Gen 3+: Virality / momentum cascade
 *
 * A runner requires depth >= 2 to avoid single-wave collapse.
 */
export class CapitalGenerationEngine {
    static evaluateDepth(params) {
        const { gen0CapitalUsd, gen1CapitalUsd, gen2CapitalUsd, gen3PlusCapitalUsd } = params;
        const total = gen0CapitalUsd + gen1CapitalUsd + gen2CapitalUsd + gen3PlusCapitalUsd;
        if (total <= 0) {
            return {
                maximumGenerationReached: 0,
                generationMassDistribution: { 0: 1.0, 1: 0, 2: 0, 3: 0 },
                organicGenerationalRatio: 0,
                depthSufficientForRunner: false,
                generationalDecayFactor: 1.0,
            };
        }
        const dist = {
            0: gen0CapitalUsd / total,
            1: gen1CapitalUsd / total,
            2: gen2CapitalUsd / total,
            3: gen3PlusCapitalUsd / total,
        };
        let maxGen = 0;
        if (gen3PlusCapitalUsd > 0.05 * total)
            maxGen = 3;
        else if (gen2CapitalUsd > 0.05 * total)
            maxGen = 2;
        else if (gen1CapitalUsd > 0.05 * total)
            maxGen = 1;
        const organicGenerationalRatio = (gen2CapitalUsd + gen3PlusCapitalUsd) / total;
        const depthSufficientForRunner = maxGen >= 2 && organicGenerationalRatio >= 0.25;
        // Generational decay factor \lambda_{gen} = gen_{k+1} / gen_k
        const decayFactor = gen1CapitalUsd > 0 ? (gen2CapitalUsd + gen3PlusCapitalUsd) / gen1CapitalUsd : 0.0;
        return {
            maximumGenerationReached: maxGen,
            generationMassDistribution: dist,
            organicGenerationalRatio,
            depthSufficientForRunner,
            generationalDecayFactor: decayFactor,
        };
    }
}
//# sourceMappingURL=capital-generation.js.map
/**
 * CHANDRASEKHAR: Criticality & Cascade Engine
 * Blueprint Engine #11
 *
 * Determines proximity to structural instability and cascading selling:
 * States: STABLE | STRAINED | FRAGILE | CRITICAL | UNSTABLE | CASCADE.
 * Models: Liquidity stress, whale-sale absorption, buyer replacement rate,
 * and portfolio-level cascade contagion.
 */
export class ChandrasekharCriticalityEngine {
    static VERSION = '1.0.0';
    /**
     * Evaluates proximity to liquidity collapse or selling cascades.
     */
    static evaluateCriticality(params) {
        // 1. Whale absorption capacity = pool liquidity * (1 - concentration)
        const availableBuffer = Math.max(0.1, params.liquidity_sol * 0.25); // Max healthy single sell is 25% of pool
        const whaleAbsorptionCapacitySol = Number(availableBuffer.toFixed(2));
        // 2. Cascade risk drivers:
        // a. Whale size relative to pool liquidity
        const whaleToLiquidityRatio = params.largest_whale_balance_sol / Math.max(0.1, params.liquidity_sol);
        // b. Buyer replacement deficit
        const replacementDeficit = Math.max(0, params.seller_velocity - params.buyer_replacement_rate);
        // c. Concentration factor
        const concentrationRisk = params.top10_holder_share;
        // Calculate composite stability reserve (0-100)
        let stabilityScore = 100;
        stabilityScore -= Math.min(45, whaleToLiquidityRatio * 50);
        stabilityScore -= Math.min(30, concentrationRisk * 40);
        stabilityScore -= Math.min(25, params.sell_pressure * 30);
        stabilityScore -= Math.min(20, (replacementDeficit / 5) * 10);
        stabilityScore = Math.max(0, Math.min(100, Math.round(stabilityScore)));
        const cascadeProb = Math.max(0.0, Math.min(1.0, (100 - stabilityScore) / 100));
        // Determine State
        let state = 'STABLE';
        let vulnerability = 'None: Balanced liquidity and distributed holdings.';
        if (stabilityScore <= 15 || whaleToLiquidityRatio > 1.0) {
            state = 'CASCADE';
            vulnerability = 'Active cascade: Whale position exceeds entire pool liquidity.';
        }
        else if (stabilityScore <= 30) {
            state = 'UNSTABLE';
            vulnerability = 'Severe instability: Buyer replacement collapsed, high concentration.';
        }
        else if (stabilityScore <= 50) {
            state = 'CRITICAL';
            vulnerability = 'Critical fragility: Large whale dump cannot be absorbed without >30% slippage.';
        }
        else if (stabilityScore <= 65) {
            state = 'FRAGILE';
            vulnerability = 'Elevated concentration: Dependent on continuous new buyer arrival.';
        }
        else if (stabilityScore <= 80) {
            state = 'STRAINED';
            vulnerability = 'Minor strain: Sell pressure elevated but liquidity buffer intact.';
        }
        return {
            state,
            stability_reserve_score: stabilityScore,
            whale_absorption_capacity_sol: whaleAbsorptionCapacitySol,
            cascade_probability: Number(cascadeProb.toFixed(3)),
            primary_vulnerability: vulnerability,
            evaluated_at_ms: Date.now()
        };
    }
}
//# sourceMappingURL=chandrasekhar-criticality.js.map
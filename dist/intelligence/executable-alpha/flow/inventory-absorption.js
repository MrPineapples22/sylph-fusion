/**
 * SYLPH FUSION — INVENTORY ABSORPTION ENGINE
 * Study 27: INVENTORY-ABSORPTION-X (Section XIII)
 *
 * Evaluates the market's capacity to absorb floating inventory overhang
 * (unrealized tokens held by early insiders, deployer, and snipers)
 * without precipitating a freefall crash.
 */
export class InventoryAbsorptionEngine {
    static evaluateAbsorption(params) {
        const { insiderHoldingTokens, tokenPriceUsd, poolDepthUsd, organicBuyRateUsdPerMin, } = params;
        const totalOverhangUsd = insiderHoldingTokens * tokenPriceUsd;
        const overhangToPoolRatio = poolDepthUsd > 0 ? totalOverhangUsd / poolDepthUsd : 999;
        const safeBuyRate = Math.max(1.0, organicBuyRateUsdPerMin);
        const absorptionTimeMinutes = totalOverhangUsd / safeBuyRate;
        // Dangerous if overhang is > 50% of total pool reserves or would take > 60 mins to absorb
        const isOverhangDangerous = overhangToPoolRatio > 0.50 || absorptionTimeMinutes > 45.0;
        // Maximum safe position size: safe position should be < 5% of organic absorption capacity
        const maxSafePositionSizeUsd = Math.max(0, Math.min(poolDepthUsd * 0.05, organicBuyRateUsdPerMin * 2.0));
        return {
            totalOverhangTokens: insiderHoldingTokens,
            totalOverhangUsd,
            poolDepthUsd,
            overhangToPoolRatio,
            absorptionTimeMinutes,
            isOverhangDangerous,
            maxSafePositionSizeUsd,
        };
    }
}
//# sourceMappingURL=inventory-absorption.js.map
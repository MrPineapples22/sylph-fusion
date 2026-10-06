/**
 * SYLPH FUSION — LIQUIDITY FATIGUE ENGINE
 * Study 31: LIQUIDITY-FATIGUE-X (Section XIV)
 *
 * Models fatigue and progressive fragility induced by repeated partial sales.
 * In a small AMM pool, selling 25% then 25% then 25% depletes reserves non-linearly.
 * Section XVI invariant: Never model sequential sales using initial reserves State0.
 */
export class LiquidityFatigueEngine {
    static simulateStagedSales(params) {
        const { initialPoolSolReservesUsd, initialTokenReserves, totalPositionTokens, fractions = [0.25, 0.25, 0.25, 0.25], } = params;
        let currentSolReserves = initialPoolSolReservesUsd;
        let currentTokenReserves = initialTokenReserves;
        const k = currentSolReserves * currentTokenReserves; // Constant product invariant
        const steps = [];
        let totalProceedsUsd = 0;
        for (let i = 0; i < fractions.length; i++) {
            const frac = fractions[i];
            const tokensToSell = totalPositionTokens * frac;
            const startSol = currentSolReserves;
            // Invariant: (Sol - \Delta Sol) * (Tokens + \Delta Tokens) = k
            const newTokenReserves = currentTokenReserves + tokensToSell;
            const newSolReserves = k / newTokenReserves;
            const proceeds = Math.max(0, currentSolReserves - newSolReserves);
            currentSolReserves = newSolReserves;
            currentTokenReserves = newTokenReserves;
            totalProceedsUsd += proceeds;
            const effectivePrice = tokensToSell > 0 ? proceeds / tokensToSell : 0;
            const impactBps = Math.round(((startSol - proceeds) / startSol) * 10000);
            steps.push({
                stepIndex: i + 1,
                fractionOfInitialTokens: frac,
                startSolReservesUsd: startSol,
                endSolReservesUsd: currentSolReserves,
                proceedsUsd: proceeds,
                effectivePriceUsd: effectivePrice,
                cumulativeImpactBps: Math.max(0, impactBps),
            });
        }
        const terminalFraction = initialPoolSolReservesUsd > 0
            ? currentSolReserves / initialPoolSolReservesUsd
            : 0;
        const avgPrice = totalPositionTokens > 0 ? totalProceedsUsd / totalPositionTokens : 0;
        // Compare with hypothetical un-fatigued proceeds
        const singleSaleTokens = totalPositionTokens;
        const singleNewSol = k / (initialTokenReserves + singleSaleTokens);
        const singleSaleProceeds = initialPoolSolReservesUsd - singleNewSol;
        const fatigueDiscount = singleSaleProceeds > 0
            ? Math.max(0, 1.0 - (totalProceedsUsd / singleSaleProceeds))
            : 0;
        return {
            sequentialSteps: steps,
            totalProceedsUsd,
            averageRealizedPriceUsd: avgPrice,
            terminalReserveFractionRemaining: terminalFraction,
            fatigueDiscountVsSingleSale: fatigueDiscount,
        };
    }
}
//# sourceMappingURL=liquidity-fatigue.js.map
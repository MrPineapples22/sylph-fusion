/**
 * SYLPH FUSION — FIXED REFERENCE SHIFT ENGINE
 * Study: FIXED-REFERENCE-SHIFT-X (Section XI)
 *
 * Ground Truth Invariant:
 * Theoretical initial price, post-graduation USD price, and first retained SOL price
 * are distinct baselines. Mixing them alters the definition of an "X".
 * Denomination currency (SOL vs USD) must be declared and preserved consistently.
 */
export class FixedReferenceShiftEngine {
    static calculateReturn(baselinePrice, currentPrice, currency, solPriceUsdAtT0, solPriceUsdAtT1) {
        if ((currency !== 'SOL' && currency !== 'USD') ||
            !Number.isFinite(baselinePrice) || !Number.isFinite(currentPrice) ||
            baselinePrice <= 0 || currentPrice <= 0) {
            return {
                denominationCurrency: currency,
                baselinePrice: 0,
                currentPrice: 0,
                grossMultiple: 1.0,
                currencyDivergenceBps: 0,
                isValidBaseline: false,
            };
        }
        const grossMultiple = currentPrice / baselinePrice;
        let currencyDivergenceBps = 0;
        let solPriceUsdChangePct;
        const hasEitherSolFx = solPriceUsdAtT0 !== undefined || solPriceUsdAtT1 !== undefined;
        if (hasEitherSolFx && (!Number.isFinite(solPriceUsdAtT0) || !Number.isFinite(solPriceUsdAtT1) ||
            solPriceUsdAtT0 <= 0 || solPriceUsdAtT1 <= 0)) {
            return {
                denominationCurrency: currency,
                baselinePrice,
                currentPrice,
                grossMultiple: currentPrice / baselinePrice,
                currencyDivergenceBps: 0,
                isValidBaseline: false,
            };
        }
        if (solPriceUsdAtT0 !== undefined && solPriceUsdAtT1 !== undefined) {
            solPriceUsdChangePct = ((solPriceUsdAtT1 - solPriceUsdAtT0) / solPriceUsdAtT0) * 100.0;
            // Divergence between SOL multiple and USD multiple
            if (currency === 'SOL') {
                const usdMultiple = grossMultiple * (solPriceUsdAtT1 / solPriceUsdAtT0);
                currencyDivergenceBps = Math.round(Math.abs(usdMultiple / grossMultiple - 1) * 10000);
            }
        }
        return {
            denominationCurrency: currency,
            baselinePrice,
            currentPrice,
            grossMultiple,
            solPriceUsdChangePct,
            currencyDivergenceBps,
            isValidBaseline: true,
        };
    }
}
//# sourceMappingURL=fixed-reference-shift.js.map
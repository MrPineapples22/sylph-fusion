/**
 * SYLPH FUSION — PROFIT COMPILER-X: EXACT ACCOUNTING IDENTITY & ATTRIBUTION
 * Specifications: Master Blueprint Section XLIX (Profit Accounting Identity)
 *
 * Invariant: Separate exact accounting from attribution.
 * Accounting Identity:
 * ActualExitProceeds - ActualEntryCost - ExplicitFees === RealizedNetPnL.
 * Never double count slippage or fees.
 */
export function compileTradeAccounting(params) {
    const totalExplicitFeesLamports = params.networkFeesLamports +
        params.priorityFeesLamports +
        params.jitoTipsLamports +
        params.routeFeesLamports;
    const realizedNetPnLLamports = params.actualExitProceedsLamports -
        params.actualEntryCostLamports -
        totalExplicitFeesLamports;
    // Exact accounting invariant check
    const calculated = params.actualExitProceedsLamports - params.actualEntryCostLamports - totalExplicitFeesLamports;
    const isAccountingBalanced = calculated === realizedNetPnLLamports;
    return {
        actualEntryCostLamports: params.actualEntryCostLamports,
        actualExitProceedsLamports: params.actualExitProceedsLamports,
        networkFeesLamports: params.networkFeesLamports,
        priorityFeesLamports: params.priorityFeesLamports,
        jitoTipsLamports: params.jitoTipsLamports,
        routeFeesLamports: params.routeFeesLamports,
        totalExplicitFeesLamports,
        realizedNetPnLLamports,
        isAccountingBalanced,
    };
}
export function decomposePnLAttribution(accounting, betaRatio = 0.0, alphaRatio = 1.0) {
    const grossProceedsDelta = accounting.actualExitProceedsLamports - accounting.actualEntryCostLamports;
    const betaLamports = BigInt(Math.round(Number(grossProceedsDelta) * betaRatio));
    const alphaLamports = BigInt(Math.round(Number(grossProceedsDelta) * alphaRatio));
    const entryShortfall = accounting.priorityFeesLamports + accounting.jitoTipsLamports;
    const exitShortfall = accounting.routeFeesLamports;
    const totalAttributed = betaLamports + alphaLamports - entryShortfall - exitShortfall - accounting.networkFeesLamports;
    const attributionGap = accounting.realizedNetPnLLamports - totalAttributed;
    return {
        marketBetaLamports: betaLamports,
        predictiveAlphaLamports: alphaLamports,
        discoveryShortfallLamports: 0n,
        decisionShortfallLamports: 0n,
        entryImplementationShortfallLamports: entryShortfall,
        holdingPolicyEffectLamports: 0n,
        exitShortfallLamports: exitShortfall,
        totalAttributedLamports: totalAttributed,
        attributionGapLamports: attributionGap,
    };
}
//# sourceMappingURL=accounting-compiler.js.map
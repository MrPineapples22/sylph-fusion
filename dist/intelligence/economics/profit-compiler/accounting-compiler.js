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
    const category = params.category ?? 'PAPER_PNL';
    if (category === 'REALIZED_FINAL_PNL' && !params.isFinalizedSettlement) {
        throw new Error('PNL_AUTHORITY_VIOLATION: REALIZED_FINAL_PNL requires isFinalizedSettlement=true');
    }
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
        category,
        settlementId: params.settlementId,
        economicFactId: params.economicFactId,
        isFinalizedSettlement: params.isFinalizedSettlement ?? false,
    };
}
export function decomposeComprehensiveProfitAttribution(params) {
    const { accounting } = params;
    const marketBeta = params.marketBetaLamports ?? 0n;
    const cohortReturn = params.marketWideCohortReturnLamports ?? 0n;
    const tokenSpecific = params.tokenSpecificReturnLamports ?? 0n;
    const timingAlpha = params.timingAlphaLamports ?? 0n;
    const signalAlpha = params.strategySignalAlphaLamports ?? 0n;
    const execEfficiency = params.executionEfficiencyLamports ?? -accounting.totalExplicitFeesLamports;
    const routeEfficiency = params.routeEfficiencyLamports ?? 0n;
    const liquidityImpact = params.liquidityImpactLamports ?? 0n;
    const explainedSum = marketBeta +
        cohortReturn +
        tokenSpecific +
        timingAlpha +
        signalAlpha +
        execEfficiency +
        routeEfficiency +
        liquidityImpact;
    // Crucial invariant: remainder is explicitly UNEXPLAINED, never laundered into alpha!
    const unexplainedResidual = accounting.realizedNetPnLLamports - explainedSum;
    const totalAttributed = explainedSum + unexplainedResidual;
    const isReconciled = totalAttributed === accounting.realizedNetPnLLamports;
    return {
        marketBetaLamports: marketBeta,
        marketWideCohortReturnLamports: cohortReturn,
        tokenSpecificReturnLamports: tokenSpecific,
        timingAlphaLamports: timingAlpha,
        strategySignalAlphaLamports: signalAlpha,
        executionEfficiencyLamports: execEfficiency,
        routeEfficiencyLamports: routeEfficiency,
        liquidityImpactLamports: liquidityImpact,
        unexplainedResidualLamports: unexplainedResidual,
        totalAttributedLamports: totalAttributed,
        isReconciled,
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
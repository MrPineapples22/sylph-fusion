/**
 * SYLPH FUSION — TAIL CONCENTRATION & OUTLIER FRAGILITY ENGINE
 * Section XXV & Study 44: TAIL-CONCENTRATION-X
 *
 * Evaluates whether portfolio profitability is an artifact of a single extreme winner
 * or a statistically robust structural edge.
 *
 * Invariant: If profitability disappears without the top outlier, flag:
 * TAIL_DEPENDENT_NOT_ROBUST
 */
export class TailConcentrationEngine {
    static evaluateTailConcentration(positionPnLsUsd) {
        const n = positionPnLsUsd.length;
        if (n === 0) {
            return {
                totalPositions: 0,
                totalNetPnLUsd: 0,
                pnlExcludingTop1Usd: 0,
                pnlExcludingTop3Usd: 0,
                pnlExcludingTop5Usd: 0,
                pnlExcludingTop1PctUsd: 0,
                pnlExcludingTop5PctUsd: 0,
                top1ShareOfPositiveGains: 0,
                isTailDependent: false,
                robustnessClassification: 'ROBUST_EDGE',
            };
        }
        const sortedDesc = [...positionPnLsUsd].sort((a, b) => b - a);
        const totalNetPnL = sortedDesc.reduce((sum, p) => sum + p, 0);
        const positiveGainsTotal = sortedDesc.filter((p) => p > 0).reduce((sum, p) => sum + p, 0);
        const top1 = sortedDesc[0] || 0;
        const top1Share = positiveGainsTotal > 0 ? Math.max(0, top1 / positiveGainsTotal) : 0;
        const pnlExcludingTop1 = sortedDesc.slice(1).reduce((sum, p) => sum + p, 0);
        const pnlExcludingTop3 = sortedDesc.slice(3).reduce((sum, p) => sum + p, 0);
        const pnlExcludingTop5 = sortedDesc.slice(5).reduce((sum, p) => sum + p, 0);
        const top1PctCount = Math.max(1, Math.ceil(n * 0.01));
        const pnlExcludingTop1Pct = sortedDesc.slice(top1PctCount).reduce((sum, p) => sum + p, 0);
        const top5PctCount = Math.max(1, Math.ceil(n * 0.05));
        const pnlExcludingTop5Pct = sortedDesc.slice(top5PctCount).reduce((sum, p) => sum + p, 0);
        // If overall PnL was positive, but removing the single top trade flips it negative:
        const isTailDependent = totalNetPnL > 0 && pnlExcludingTop1 <= 0;
        let classification = 'ROBUST_EDGE';
        if (isTailDependent || top1Share > 0.65) {
            classification = 'TAIL_DEPENDENT_NOT_ROBUST';
        }
        else if (pnlExcludingTop3 <= 0 || top1Share > 0.40) {
            classification = 'MODERATE_CONCENTRATION';
        }
        return {
            totalPositions: n,
            totalNetPnLUsd: totalNetPnL,
            pnlExcludingTop1Usd: pnlExcludingTop1,
            pnlExcludingTop3Usd: pnlExcludingTop3,
            pnlExcludingTop5Usd: pnlExcludingTop5,
            pnlExcludingTop1PctUsd: pnlExcludingTop1Pct,
            pnlExcludingTop5PctUsd: pnlExcludingTop5Pct,
            top1ShareOfPositiveGains: top1Share,
            isTailDependent,
            robustnessClassification: classification,
        };
    }
}
//# sourceMappingURL=tail-concentration.js.map
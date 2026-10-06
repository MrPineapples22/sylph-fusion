/**
 * SYLPH FUSION — EXECUTABLE LIQUIDATION SURFACE ENGINE
 * Section XV & Priority P0 (Section XLVI)
 *
 * Continually estimates executable liquidation proceeds across laddered percentage exits:
 * 10%, 25%, 50%, 75%, 100%
 * Under BASE, -25% stressed liquidity, and -50% stressed liquidity.
 *
 * Crucial Invariant: Never assume book depth equals liquidatable cash.
 * Computes price impact, LP fees, network priority fees, and stressed exit haircut.
 */
import { createHash } from 'node:crypto';
export class ExecutableLiquidationSurfaceEngine {
    static EXIT_PERCENTAGES = [10, 25, 50, 75, 100];
    static computeSurface(params) {
        const { totalTokens, currentMarkPriceUsd, poolSolReservesUsd, poolTokenReserves, estimatedBaseFeeUsd = 0.005, estimatedTipUsd = 0.015, slot = 0n, nowMs = Date.now(), } = params;
        const currentMarkUsd = totalTokens * currentMarkPriceUsd;
        // Helper to compute a single liquidation curve given available pool SOL reserves
        const buildCurve = (scenarioName, solReserves) => {
            const k = solReserves * poolTokenReserves;
            const points = [];
            for (const pct of this.EXIT_PERCENTAGES) {
                const tokensToSell = totalTokens * (pct / 100.0);
                const newTokenReserves = poolTokenReserves + tokensToSell;
                const newSolReserves = k / newTokenReserves;
                const grossSolProceedsUsd = Math.max(0, solReserves - newSolReserves);
                // Fees: 0.25% LP fee + network fee + tip
                const lpFeeUsd = grossSolProceedsUsd * 0.0025;
                const feeUsd = lpFeeUsd + estimatedBaseFeeUsd + estimatedTipUsd;
                const netProceedsUsd = Math.max(0, grossSolProceedsUsd - feeUsd);
                const effectivePriceUsd = tokensToSell > 0 ? netProceedsUsd / tokensToSell : 0;
                const benchmarkUsd = tokensToSell * currentMarkPriceUsd;
                const impactBps = benchmarkUsd > 0
                    ? Math.max(0, Math.round(((benchmarkUsd - netProceedsUsd) / benchmarkUsd) * 10000))
                    : 0;
                points.push({
                    percentage: pct,
                    tokensSold: tokensToSell,
                    netProceedsUsd,
                    effectivePriceUsd,
                    impactBps,
                    feeUsd,
                });
            }
            // Max capacity with <= 1500 bps (15%) impact
            const safePoint = points.find((p) => p.impactBps <= 1500) || points[0];
            const maxCapacityUsd = safePoint ? safePoint.netProceedsUsd : 0;
            return {
                scenarioName,
                points,
                maxCapacityUsd,
            };
        };
        const baseCurve = buildCurve('BASE', poolSolReservesUsd);
        const stressed25Curve = buildCurve('STRESSED_25', poolSolReservesUsd * 0.75);
        const stressed50Curve = buildCurve('STRESSED_50', poolSolReservesUsd * 0.50);
        // 100% liquidation point under stressed 50%
        const base100 = baseCurve.points.find((p) => p.percentage === 100);
        const stressed50_100 = stressed50Curve.points.find((p) => p.percentage === 100);
        const stressedExitCapacityUsd = stressed50_100.netProceedsUsd;
        const liquidityHaircutUsd = Math.max(0, base100.netProceedsUsd - stressed50_100.netProceedsUsd);
        const ownImpactUsd = Math.max(0, currentMarkUsd - base100.netProceedsUsd);
        const projectedFeesUsd = base100.feeUsd;
        const surfaceDigest = createHash('sha256')
            .update([
            currentMarkUsd.toFixed(4),
            stressedExitCapacityUsd.toFixed(4),
            liquidityHaircutUsd.toFixed(4),
            ownImpactUsd.toFixed(4),
            projectedFeesUsd.toFixed(4),
            slot.toString(),
            nowMs.toString(),
        ].join('::'))
            .digest('hex');
        return {
            currentMarkUsd,
            base: baseCurve,
            stressed25: stressed25Curve,
            stressed50: stressed50Curve,
            stressedExitCapacityUsd,
            liquidityHaircutUsd,
            ownImpactUsd,
            projectedFeesUsd,
            computedAtMs: nowMs,
            slot,
            surfaceDigest,
        };
    }
}
//# sourceMappingURL=liquidation-surface.js.map
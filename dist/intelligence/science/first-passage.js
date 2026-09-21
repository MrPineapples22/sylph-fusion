/**
 * SOL-SYLPH Intelligence Fabric - First-Passage & Competing-Risk Engine
 * Specifications: Parts XXX (Probabilistic Intelligence), XXXI (First-Passage Engine),
 * XXXII (Quantile Distributions), XXXVII (Probability Velocity), XXXVIII (Probability Shocks).
 *
 * Path-dependent prediction:
 * P(target before stop), P(stop before target), P(neither before expiry)
 * Quantiles: Q01, Q05, Q10, Q25, Q50, Q75, Q90, Q95, Q99
 * Expected MFE / MAE
 */
export class FirstPassageEngine {
    historicalProbabilities = new Map();
    evaluateProbabilisticForecast(params) {
        const { mint, pumpScore, hsi, podRiskScore, regimeMultiplier, liquidityQuality, independentDemandScore, clusterConcentrationPct, } = params;
        const now = Date.now();
        // Composite organic momentum factor [0.0 - 1.0]
        const organicAlpha = Math.max(0.01, Math.min(0.99, (pumpScore * 0.35 +
            (100 - hsi) * 0.25 +
            independentDemandScore * 0.25 +
            liquidityQuality * 0.15) /
            100 *
            regimeMultiplier));
        // Dump overhang penalty
        const dumpHazard = (podRiskScore * 0.6 + clusterConcentrationPct * 0.4) / 100;
        // Competing risk estimation for +25% target vs -15% stop at 5m
        const calcCompetingRisk = (targetPct, stopPct, sec) => {
            const timeScale = Math.sqrt(sec / 300);
            const rawTarget = Math.max(0.05, Math.min(0.90, organicAlpha * (1 - dumpHazard * 0.5) * timeScale));
            const rawStop = Math.max(0.05, Math.min(0.85, (dumpHazard * 0.7 + (1 - organicAlpha) * 0.3) * timeScale));
            const neither = Math.max(0.05, 1.0 - (rawTarget + rawStop) * 0.85);
            const total = rawTarget + rawStop + neither;
            return {
                targetPct,
                stopPct,
                horizonSec: sec,
                pTargetFirst: Number((rawTarget / total).toFixed(3)),
                pStopFirst: Number((rawStop / total).toFixed(3)),
                pNeither: Number((neither / total).toFixed(3)),
            };
        };
        const competing5m = calcCompetingRisk(25, -15, 300);
        // Probabilities across predefined return thresholds
        const pPlus10 = Math.min(0.95, organicAlpha * 1.1);
        const pPlus25 = Math.min(0.90, organicAlpha * 0.85);
        const pPlus50 = Math.min(0.80, organicAlpha * 0.55);
        const pPlus100 = Math.min(0.65, organicAlpha * 0.30);
        const pMinus10 = Math.min(0.90, dumpHazard * 0.8 + 0.1);
        const pMinus25 = Math.min(0.80, dumpHazard * 0.6 + 0.05);
        const pMinus50 = Math.min(0.70, dumpHazard * 0.45);
        const pCatastrophic = Math.min(0.60, dumpHazard * 0.35);
        // Quantile distributions around expected return
        const medianReturn = (organicAlpha - 0.45) * 60; // in %
        const spread = (100 - liquidityQuality) * 0.3 + 20;
        const quantiles = {
            q01: Number((medianReturn - spread * 2.33).toFixed(1)),
            q05: Number((medianReturn - spread * 1.64).toFixed(1)),
            q10: Number((medianReturn - spread * 1.28).toFixed(1)),
            q25: Number((medianReturn - spread * 0.67).toFixed(1)),
            q50: Number(medianReturn.toFixed(1)),
            q75: Number((medianReturn + spread * 0.67).toFixed(1)),
            q90: Number((medianReturn + spread * 1.28).toFixed(1)),
            q95: Number((medianReturn + spread * 1.64).toFixed(1)),
            q99: Number((medianReturn + spread * 2.33).toFixed(1)),
        };
        // Expected MFE / MAE
        const expectedMfe = Number((Math.max(5, organicAlpha * 75)).toFixed(1));
        const expectedMae = Number((-Math.max(4, dumpHazard * 45 + 5)).toFixed(1));
        // Probability Velocity & Shock tracking
        const history = this.historicalProbabilities.get(mint) ?? [];
        history.push({ timestampMs: now, p: competing5m.pTargetFirst });
        if (history.length > 20)
            history.shift();
        this.historicalProbabilities.set(mint, history);
        let dPdt = 0;
        let d2Pdt2 = 0;
        let isShock = false;
        let shockReason;
        if (history.length >= 3) {
            const pCurrent = history[history.length - 1].p;
            const pPrev = history[history.length - 2].p;
            const pPrev2 = history[history.length - 3].p;
            const dt = Math.max(1, (history[history.length - 1].timestampMs - history[history.length - 2].timestampMs) / 1000);
            dPdt = (pCurrent - pPrev) / dt;
            const prevVelocity = (pPrev - pPrev2) / dt;
            d2Pdt2 = (dPdt - prevVelocity) / dt;
            if (pCurrent - pPrev <= -0.20 || dPdt <= -0.05) {
                isShock = true;
                shockReason = podRiskScore >= 70 ? 'PoD Dump Overhang Triggered' : 'Abrupt Liquidity Deterioration';
            }
        }
        return {
            mint,
            timestampMs: now,
            horizons: {
                '5s': calcCompetingRisk(10, -5, 5),
                '15s': calcCompetingRisk(15, -8, 15),
                '30s': calcCompetingRisk(20, -10, 30),
                '1m': calcCompetingRisk(20, -12, 60),
                '5m': competing5m,
                '15m': calcCompetingRisk(35, -20, 900),
            },
            probabilities: {
                pReturnPlus10: Number(pPlus10.toFixed(3)),
                pReturnPlus25: Number(pPlus25.toFixed(3)),
                pReturnPlus50: Number(pPlus50.toFixed(3)),
                pReturnPlus100: Number(pPlus100.toFixed(3)),
                pDrawdownMinus10: Number(pMinus10.toFixed(3)),
                pDrawdownMinus25: Number(pMinus25.toFixed(3)),
                pDrawdownMinus50: Number(pMinus50.toFixed(3)),
                pCatastrophicLoss: Number(pCatastrophic.toFixed(3)),
            },
            quantiles,
            expectedMfePct: expectedMfe,
            expectedMaePct: expectedMae,
            probabilityVelocity: {
                p: competing5m.pTargetFirst,
                dPdt: Number(dPdt.toFixed(4)),
                d2Pdt2: Number(d2Pdt2.toFixed(4)),
                isProbabilityShock: isShock,
                shockAttribution: shockReason,
            },
        };
    }
}
//# sourceMappingURL=first-passage.js.map
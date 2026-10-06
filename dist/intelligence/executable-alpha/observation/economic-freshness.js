/**
 * SYLPH FUSION — ECONOMIC FRESHNESS & EXECUTABLE PEAK ENGINE
 * Study: EXECUTABLE-PEAK-X (Section VIII)
 *
 * Ground Truth Invariant:
 * Chart ATH != Executable Peak
 * In the 523k cohort, median peak was only 1.0899x (+8.99%).
 * Large winners give back gains rapidly (median 5.13s to -50% drop).
 */
export class EconomicFreshnessEngine {
    static analyzeTrajectory(initialPriceSol, ticks, simulatedTradeSizeSol = 0.05) {
        if (ticks.length === 0 || initialPriceSol <= 0) {
            return {
                observedPeakMultiple: 1.0,
                executablePeakMultiple: 1.0,
                timeToPeakSeconds: 0,
                liquidityAtPeakSol: 0,
                captureLossToImpactPct: 0,
                isOutlierDistortion: false,
            };
        }
        const t0 = ticks[0].timestampMs;
        let maxPrice = initialPriceSol;
        let peakTimestamp = t0;
        let liquidityAtPeak = 0;
        for (const tick of ticks) {
            if (tick.priceSol > maxPrice) {
                maxPrice = tick.priceSol;
                peakTimestamp = tick.timestampMs;
                liquidityAtPeak = Number(tick.quoteReservesLamports) / 1e9;
            }
        }
        const observedPeakMultiple = maxPrice / initialPriceSol;
        const timeToPeakSeconds = Math.max(0, (peakTimestamp - t0) / 1000.0);
        // Constant-product slippage haircut at peak
        const impactHaircut = liquidityAtPeak > 0
            ? Math.min(0.50, simulatedTradeSizeSol / liquidityAtPeak)
            : 0.15;
        const executablePeakMultiple = observedPeakMultiple * (1.0 - impactHaircut);
        const captureLossToImpactPct = impactHaircut * 100.0;
        // Measure time to 50% drop from peak
        let postPeakDrop50Seconds;
        const halfPeakPrice = maxPrice * 0.50;
        let pastPeak = false;
        for (const tick of ticks) {
            if (tick.timestampMs === peakTimestamp) {
                pastPeak = true;
            }
            if (pastPeak && tick.priceSol <= halfPeakPrice) {
                postPeakDrop50Seconds = Math.max(0, (tick.timestampMs - peakTimestamp) / 1000.0);
                break;
            }
        }
        return {
            observedPeakMultiple,
            executablePeakMultiple,
            timeToPeakSeconds,
            postPeakDrop50Seconds,
            liquidityAtPeakSol: liquidityAtPeak,
            captureLossToImpactPct,
            isOutlierDistortion: observedPeakMultiple > 1000.0,
        };
    }
}
//# sourceMappingURL=economic-freshness.js.map
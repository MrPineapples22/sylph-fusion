/**
 * SYLPH FUSION — EARLIEST DECISION TIME CALIBRATOR
 * Study: EARLIEST-INFORMATION-TIME-X (Section IX)
 *
 * Computes the optimal stopping time T^* for distinct multiple horizons
 * (2x, 5x, 10x, 20x, 100x). If current tick is before T^*, output is ABSTAIN.
 */
export class EarliestDecisionTimeEngine {
    static calculate(elapsedSeconds, volatilityAtr, observationsCount) {
        // Under higher volatility or sparse samples, minimum decision time stretches
        const sampleDilation = Math.max(1.0, 10.0 / Math.max(1, observationsCount));
        const volDilation = 1.0 + (volatilityAtr * 2.0);
        const base2x = 8.0 * sampleDilation * volDilation;
        const base5x = 18.0 * sampleDilation * volDilation;
        const base10x = 35.0 * sampleDilation * volDilation;
        const base20x = 60.0 * sampleDilation * volDilation;
        const base100x = 120.0 * sampleDilation * volDilation;
        return {
            tStar2xSeconds: Number(base2x.toFixed(1)),
            tStar5xSeconds: Number(base5x.toFixed(1)),
            tStar10xSeconds: Number(base10x.toFixed(1)),
            tStar20xSeconds: Number(base20x.toFixed(1)),
            tStar100xSeconds: Number(base100x.toFixed(1)),
            optimalActionTimeSeconds: Number(base10x.toFixed(1)),
            isElapsedAdequate: elapsedSeconds >= base2x,
        };
    }
}
//# sourceMappingURL=earliest-decision-time.js.map
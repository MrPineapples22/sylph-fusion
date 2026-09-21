/**
 * SOL-SYLPH Master Production Intelligence - Outcome Truth Engine
 * Specifications: Section 76 (Outcome Truth).
 *
 * Immutable future checkpoints:
 * 5s, 10s, 30s, 1m, 3m, 5m, 10m, 15m, 30m, 1h, 3h.
 *
 * Outcome Labels:
 * RUG, HARD_DUMP, FAILED, FLAT, SURVIVED, RUNNER, MAJOR_RUNNER.
 */
export const HORIZON_MS_MAP = {
    '5s': 5_000,
    '10s': 10_000,
    '15s': 15_000,
    '30s': 30_000,
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '10m': 600_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '3h': 10_800_000,
};
export class OutcomeTruthEngine {
    labelVersion = 'outcome_label_v1_institutional';
    /**
     * Evaluate complete outcome profile from price trajectory.
     */
    evaluateOutcome(mint, entryPrice, initialLiquidity, entryTimeMs, trajectory) {
        if (trajectory.length === 0 || entryPrice <= 0) {
            return {
                mint,
                entryTimestampMs: entryTimeMs,
                entryPriceUsd: entryPrice,
                initialLiquidityUsd: initialLiquidity,
                checkpoints: {},
                mfePct: 0,
                maePct: 0,
                timeToPeakMs: 0,
                primaryLabel: 'FLAT',
                labelVersion: this.labelVersion,
            };
        }
        let maxPrice = entryPrice;
        let minPrice = entryPrice;
        let peakTimestamp = entryTimeMs;
        let failureTimestamp;
        const checkpoints = {};
        // Match checkpoints
        for (const [horizon, offsetMs] of Object.entries(HORIZON_MS_MAP)) {
            const targetTime = entryTimeMs + offsetMs;
            // find nearest point at or after targetTime
            const pt = trajectory.find((p) => p.timestampMs >= targetTime);
            if (pt) {
                checkpoints[horizon] = {
                    horizon,
                    targetTimestampMs: targetTime,
                    recordedPriceUsd: pt.priceUsd,
                    recordedLiquidityUsd: pt.liquidityUsd,
                    returnPct: (pt.priceUsd - entryPrice) / entryPrice,
                };
            }
        }
        for (const pt of trajectory) {
            if (pt.priceUsd > maxPrice) {
                maxPrice = pt.priceUsd;
                peakTimestamp = pt.timestampMs;
            }
            if (pt.priceUsd < minPrice) {
                minPrice = pt.priceUsd;
            }
            // Check for rug/severe dump: > 80% drawdown or liquidity drop > 85%
            const drawdown = (pt.priceUsd - entryPrice) / entryPrice;
            const liqDrop = initialLiquidity > 0 ? (initialLiquidity - pt.liquidityUsd) / initialLiquidity : 0;
            if (!failureTimestamp && (drawdown <= -0.8 || liqDrop >= 0.85)) {
                failureTimestamp = pt.timestampMs;
            }
        }
        const mfePct = ((maxPrice - entryPrice) / entryPrice) * 100;
        const maePct = ((entryPrice - minPrice) / entryPrice) * 100;
        const timeToPeakMs = peakTimestamp - entryTimeMs;
        const timeToFailureMs = failureTimestamp ? failureTimestamp - entryTimeMs : undefined;
        // Classify primary outcome label
        let primaryLabel = 'FLAT';
        if (failureTimestamp !== undefined && minPrice < entryPrice * 0.1) {
            primaryLabel = 'RUG';
        }
        else if (maePct >= 65 && mfePct < 20) {
            primaryLabel = 'HARD_DUMP';
        }
        else if (mfePct >= 300) {
            primaryLabel = 'MAJOR_RUNNER';
        }
        else if (mfePct >= 100) {
            primaryLabel = 'RUNNER';
        }
        else if (mfePct >= 20 && maePct < 30) {
            primaryLabel = 'SURVIVED';
        }
        else if (maePct > 35) {
            primaryLabel = 'FAILED';
        }
        return {
            mint,
            entryTimestampMs: entryTimeMs,
            entryPriceUsd: entryPrice,
            initialLiquidityUsd: initialLiquidity,
            checkpoints,
            mfePct,
            maePct,
            timeToPeakMs,
            timeToFailureMs,
            primaryLabel,
            labelVersion: this.labelVersion,
        };
    }
}
//# sourceMappingURL=outcome-truth.js.map
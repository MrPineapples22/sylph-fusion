/** Versioned sampled-path outcomes. No claim of continuous observation or executable fills. */
export const HORIZON_MS_MAP = {
    '5s': 5_000, '10s': 10_000, '15s': 15_000, '30s': 30_000,
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '10m': 600_000,
    '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '3h': 10_800_000,
};
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
function finiteNonnegative(value) { return Number.isFinite(value) && value >= 0; }
function percent(price, entry) {
    const value = ((price - entry) / entry) * 100;
    if (!Number.isFinite(value))
        throw new Error('INVALID_OUTCOME: return overflow');
    return value;
}
export class OutcomeTruthEngine {
    evaluateOutcome(mint, entryPrice, initialLiquidity, entryTimeMs, trajectory, options) {
        if (!finiteNonnegative(entryPrice) || entryPrice === 0 || !finiteNonnegative(initialLiquidity)
            || !timestamp(entryTimeMs))
            throw new Error('INVALID_OUTCOME: entry values');
        const labelHorizon = options?.labelHorizon ?? '3h';
        const tolerance = options?.checkpointToleranceMs ?? 0;
        if (!Object.hasOwn(HORIZON_MS_MAP, labelHorizon) || !timestamp(tolerance))
            throw new Error('INVALID_OUTCOME: sampling policy');
        const sorted = trajectory.map(p => {
            if (!timestamp(p.timestampMs) || !finiteNonnegative(p.priceUsd) || !finiteNonnegative(p.liquidityUsd)) {
                throw new Error('INVALID_OUTCOME: trajectory values');
            }
            return { ...p };
        }).sort((a, b) => a.timestampMs - b.timestampMs);
        const points = [];
        for (const p of sorted) {
            const previous = points.at(-1);
            if (previous?.timestampMs === p.timestampMs) {
                if (previous.priceUsd !== p.priceUsd || previous.liquidityUsd !== p.liquidityUsd)
                    throw new Error('INVALID_OUTCOME: conflicting duplicate timestamp');
            }
            else
                points.push(p);
        }
        const cutoff = options === undefined ? Math.max(entryTimeMs, points.at(-1)?.timestampMs ?? entryTimeMs) : options.evaluationCutoffMs;
        if (!timestamp(cutoff) || cutoff < entryTimeMs)
            throw new Error('INVALID_OUTCOME: cutoff');
        const labelEnd = entryTimeMs + HORIZON_MS_MAP[labelHorizon] + tolerance;
        if (!timestamp(entryTimeMs + HORIZON_MS_MAP['3h'] + tolerance))
            throw new Error('INVALID_OUTCOME: timestamp overflow');
        const eligible = points.filter(p => p.timestampMs >= entryTimeMs && p.timestampMs <= cutoff);
        const checkpoints = {};
        for (const horizon of Object.keys(HORIZON_MS_MAP)) {
            const target = entryTimeMs + HORIZON_MS_MAP[horizon];
            const p = eligible.find(p => p.timestampMs >= target && p.timestampMs <= target + tolerance);
            checkpoints[horizon] = p ? {
                horizon, targetTimestampMs: target, status: 'OBSERVED', observedTimestampMs: p.timestampMs,
                samplingDelayMs: p.timestampMs - target, recordedPriceUsd: p.priceUsd,
                recordedLiquidityUsd: p.liquidityUsd, returnPct: percent(p.priceUsd, entryPrice),
            } : { horizon, targetTimestampMs: target,
                status: cutoff < target + tolerance ? 'NOT_YET_OBSERVABLE' : 'MISSING_WITHIN_TOLERANCE' };
        }
        // Excursions include only this declared sampled label window, including endpoint tolerance.
        const path = eligible.filter(p => p.timestampMs <= labelEnd);
        let maxPrice = entryPrice, minPrice = entryPrice, peak = entryTimeMs;
        let failure;
        for (const p of path) {
            if (p.priceUsd > maxPrice) {
                maxPrice = p.priceUsd;
                peak = p.timestampMs;
            }
            minPrice = Math.min(minPrice, p.priceUsd);
            if (failure === undefined && (percent(p.priceUsd, entryPrice) <= -80
                || (initialLiquidity > 0 && p.liquidityUsd / initialLiquidity <= 0.15)))
                failure = p.timestampMs;
        }
        const mfe = path.length ? percent(maxPrice, entryPrice) : null;
        const mae = path.length ? -percent(minPrice, entryPrice) : null;
        let observed = null;
        if (mfe !== null && mae !== null) {
            observed = failure !== undefined && minPrice < entryPrice * 0.1 ? 'RUG'
                : mae >= 65 && mfe < 20 ? 'HARD_DUMP' : mfe >= 300 ? 'MAJOR_RUNNER'
                    : mfe >= 100 ? 'RUNNER' : mfe >= 20 && mae < 30 ? 'SURVIVED' : mae > 35 ? 'FAILED' : 'FLAT';
        }
        const reasons = [];
        if (!path.length)
            reasons.push('NO_OBSERVATIONS');
        if (options === undefined)
            reasons.push('INFERRED_CUTOFF');
        if (cutoff < labelEnd)
            reasons.push('LABEL_WINDOW_OPEN');
        if (Object.keys(HORIZON_MS_MAP).some(h => HORIZON_MS_MAP[h] <= HORIZON_MS_MAP[labelHorizon] && checkpoints[h].status !== 'OBSERVED'))
            reasons.push('INCOMPLETE_CHECKPOINT_COVERAGE');
        const status = !path.length ? 'UNOBSERVED' : reasons.length ? 'CENSORED' : 'RESOLVED';
        return {
            schemaVersion: '2.0.0', mint, entryTimestampMs: entryTimeMs, entryPriceUsd: entryPrice,
            initialLiquidityUsd: initialLiquidity, evaluationCutoffMs: cutoff,
            cutoffSource: options === undefined ? 'INFERRED_FROM_TRAJECTORY' : 'EXPLICIT',
            checkpointToleranceMs: tolerance, labelHorizon, labelWindowEndMs: labelEnd,
            observationCount: path.length, lastObservedTimestampMs: path.at(-1)?.timestampMs ?? null,
            excludedPreEntryCount: points.filter(p => p.timestampMs < entryTimeMs).length,
            excludedPostCutoffCount: points.filter(p => p.timestampMs > cutoff).length,
            checkpoints, mfePct: mfe, maePct: mae === 0 ? 0 : mae, timeToPeakMs: path.length ? peak - entryTimeMs : null,
            ...(failure === undefined ? {} : { timeToFailureMs: failure - entryTimeMs, failureObservedTimestampMs: failure }),
            observedPathLabel: observed, primaryLabel: status === 'RESOLVED' ? observed : null,
            labelStatus: status, censoringReasons: reasons, labelVersion: 'outcome_label_v2_bounded_observation',
        };
    }
}
//# sourceMappingURL=outcome-truth.js.map
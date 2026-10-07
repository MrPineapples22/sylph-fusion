import { types as utilTypes } from 'node:util';
const MAX_PRICE_TICKS = 1_000_000;
function requirePositiveFinite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be positive and finite`);
    }
}
function validateTicks(ticks) {
    if (utilTypes.isProxy(ticks) || !Array.isArray(ticks) || ticks.length > MAX_PRICE_TICKS) {
        throw new RangeError('ticks must be an array with at most 1,000,000 observations');
    }
    if (Object.getPrototypeOf(ticks) !== Array.prototype) {
        throw new TypeError('ticks must use the standard array prototype');
    }
    let priorTimestampMs = -1;
    const snapshot = [];
    for (let index = 0; index < ticks.length; index++) {
        const tickDescriptor = Object.getOwnPropertyDescriptor(ticks, String(index));
        if (!tickDescriptor || !tickDescriptor.enumerable || !('value' in tickDescriptor)) {
            throw new TypeError('ticks must contain only own enumerable data elements');
        }
        const input = tickDescriptor.value;
        if (input === null || typeof input !== 'object' || Array.isArray(input) || utilTypes.isProxy(input)) {
            throw new TypeError(`ticks[${index}] must be an observation object`);
        }
        const prototype = Object.getPrototypeOf(input);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`ticks[${index}] must be a plain data object`);
        }
        const readData = (key) => {
            const descriptor = Object.getOwnPropertyDescriptor(input, key);
            if (!descriptor || !('value' in descriptor))
                throw new TypeError(`ticks[${index}].${key} must be an own data property`);
            return descriptor.value;
        };
        const tick = {
            priceSol: readData('priceSol'),
            priceUsd: readData('priceUsd'),
            timestampMs: readData('timestampMs'),
            slot: readData('slot'),
            quoteReservesLamports: readData('quoteReservesLamports'),
        };
        requirePositiveFinite(tick.priceSol, `ticks[${index}].priceSol`);
        requirePositiveFinite(tick.priceUsd, `ticks[${index}].priceUsd`);
        if (!Number.isSafeInteger(tick.timestampMs) || tick.timestampMs < 0 || tick.timestampMs < priorTimestampMs) {
            throw new RangeError(`ticks[${index}].timestampMs must be a nondecreasing safe timestamp`);
        }
        if (typeof tick.slot !== 'bigint' || tick.slot < 0n) {
            throw new TypeError(`ticks[${index}].slot must be a nonnegative bigint`);
        }
        if (typeof tick.quoteReservesLamports !== 'bigint' || tick.quoteReservesLamports < 0n) {
            throw new TypeError(`ticks[${index}].quoteReservesLamports must be a nonnegative bigint`);
        }
        priorTimestampMs = tick.timestampMs;
        snapshot.push(Object.freeze(tick));
    }
    return snapshot;
}
export class EconomicFreshnessEngine {
    static analyzeTrajectory(initialPriceSol, ticks) {
        requirePositiveFinite(initialPriceSol, 'initialPriceSol');
        const observations = validateTicks(ticks);
        if (observations.length === 0) {
            return {
                status: 'NO_OBSERVATIONS',
                evidenceClass: 'OBSERVED_PRICE_PATH_ONLY',
                observedPeakMultiple: null,
                peakEvidenceSource: null,
                executablePeakMultiple: null,
                executablePeakStatus: 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE',
                timeToPeakSeconds: null,
                postPeakDrop50Seconds: null,
                peakTimestampMs: null,
                quoteReservesLamportsAtObservedPeak: null,
                isOutlierPeak: false,
            };
        }
        const firstObservedAtMs = observations[0].timestampMs;
        let peakPriceSol = initialPriceSol;
        let peakTimestampMs = firstObservedAtMs;
        let peakTickIndex = -1;
        let quoteReservesLamportsAtObservedPeak = null;
        for (let index = 0; index < observations.length; index++) {
            const tick = observations[index];
            if (tick.priceSol > peakPriceSol) {
                peakPriceSol = tick.priceSol;
                peakTimestampMs = tick.timestampMs;
                peakTickIndex = index;
                quoteReservesLamportsAtObservedPeak = tick.quoteReservesLamports;
            }
        }
        const observedPeakMultiple = peakPriceSol / initialPriceSol;
        if (!Number.isFinite(observedPeakMultiple))
            throw new RangeError('observed peak multiple is not finite');
        let postPeakDrop50Seconds;
        const halfPeakPriceSol = peakPriceSol * 0.5;
        const firstDropIndex = peakTickIndex >= 0 ? peakTickIndex + 1 : 0;
        for (let index = firstDropIndex; index < observations.length; index++) {
            const tick = observations[index];
            // The baseline peak has no own timestamp; begin measuring only after the
            // first observed timestamp. A price-tick peak has explicit array order.
            if (peakTickIndex < 0 && tick.timestampMs <= peakTimestampMs)
                continue;
            if (tick.priceSol <= halfPeakPriceSol) {
                postPeakDrop50Seconds = (tick.timestampMs - peakTimestampMs) / 1000;
                if (!Number.isFinite(postPeakDrop50Seconds))
                    throw new RangeError('post-peak duration is not finite');
                break;
            }
        }
        return {
            status: 'OBSERVED_ONLY',
            evidenceClass: 'OBSERVED_PRICE_PATH_ONLY',
            observedPeakMultiple,
            peakEvidenceSource: peakTickIndex >= 0 ? 'PRICE_TICK' : 'INPUT_BASELINE',
            executablePeakMultiple: null,
            executablePeakStatus: 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE',
            timeToPeakSeconds: Math.max(0, (peakTimestampMs - firstObservedAtMs) / 1000),
            postPeakDrop50Seconds,
            peakTimestampMs,
            quoteReservesLamportsAtObservedPeak,
            isOutlierPeak: observedPeakMultiple > 1000,
        };
    }
}
//# sourceMappingURL=economic-freshness.js.map
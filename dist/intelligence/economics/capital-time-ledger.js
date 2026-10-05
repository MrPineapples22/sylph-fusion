/**
 * SYLPH FUSION — CAPITAL-TIME ECONOMICS & VELOCITY OBSERVABILITY
 * Specifications: Blueprint Section 50
 *
 * Status: RESEARCH_ONLY. This computes an event-interval capital occupancy
 * diagnostic and realized P&L; it is neither an investment return nor authority.
 * Callers must supply intervals derived from an authoritative, finalized event
 * history. This class does not infer lifecycle state from transaction labels.
 */
const STATES = ['RESERVED', 'UNKNOWN', 'INVESTED'];
function validTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
export class CapitalTimeLedger {
    records = new Map();
    fingerprints = new Map();
    recordTradeLifecycle(obs) {
        if (!obs.tradeId.trim() || !obs.economicFactId.trim()) {
            throw new Error('CAPITAL_TIME_INVALID_ID');
        }
        if (!Array.isArray(obs.segments) || obs.segments.length === 0) {
            throw new Error('CAPITAL_TIME_SEGMENTS_REQUIRED');
        }
        if (!validTimestamp(obs.unencumberedAtMs) || !validTimestamp(obs.settledAtMs) ||
            obs.unencumberedAtMs > obs.settledAtMs) {
            throw new Error('CAPITAL_TIME_INVALID_SETTLEMENT_TIMES');
        }
        for (const amount of [obs.grossProceedsLamports, obs.basisRelievedLamports, obs.totalFrictionLamports]) {
            if (typeof amount !== 'bigint' || amount < 0n)
                throw new Error('CAPITAL_TIME_INVALID_AMOUNT');
        }
        const segments = [...obs.segments];
        const segmentIds = new Set();
        const stateTimes = { RESERVED: 0n, UNKNOWN: 0n, INVESTED: 0n };
        const bySlice = new Map();
        for (const segment of segments) {
            if (!segment.segmentId.trim() || !segment.capitalSliceId.trim() || segmentIds.has(segment.segmentId)) {
                throw new Error('CAPITAL_TIME_INVALID_OR_DUPLICATE_SEGMENT_ID');
            }
            segmentIds.add(segment.segmentId);
            if (typeof segment.state !== 'string' || !STATES.includes(segment.state) || !validTimestamp(segment.startMs) || !validTimestamp(segment.endMs) ||
                segment.endMs <= segment.startMs || typeof segment.amountLamports !== 'bigint' || segment.amountLamports <= 0n) {
                throw new Error('CAPITAL_TIME_INVALID_SEGMENT');
            }
            const state = segment.state;
            if (segment.endMs > obs.settledAtMs)
                throw new Error('CAPITAL_TIME_SEGMENT_AFTER_SETTLEMENT');
            if (state === 'RESERVED') {
                stateTimes.RESERVED += segment.amountLamports * BigInt(segment.endMs - segment.startMs);
            }
            else if (state === 'INVESTED') {
                stateTimes.INVESTED += segment.amountLamports * BigInt(segment.endMs - segment.startMs);
            }
            else {
                stateTimes.UNKNOWN += segment.amountLamports * BigInt(segment.endMs - segment.startMs);
            }
            const slice = bySlice.get(segment.capitalSliceId) ?? [];
            slice.push(segment);
            bySlice.set(segment.capitalSliceId, slice);
        }
        for (const slice of bySlice.values()) {
            slice.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
            for (let i = 1; i < slice.length; i++) {
                if (slice[i].startMs < slice[i - 1].endMs) {
                    throw new Error('CAPITAL_TIME_OVERLAPPING_SLICE_INTERVALS');
                }
            }
        }
        const fingerprint = JSON.stringify({
            economicFactId: obs.economicFactId,
            segments: [...segments].sort((a, b) => a.segmentId.localeCompare(b.segmentId)).map((s) => ({
                segmentId: s.segmentId, capitalSliceId: s.capitalSliceId, state: s.state,
                startMs: s.startMs, endMs: s.endMs, amountLamports: s.amountLamports.toString(),
            })),
            grossProceedsLamports: obs.grossProceedsLamports.toString(),
            basisRelievedLamports: obs.basisRelievedLamports.toString(),
            totalFrictionLamports: obs.totalFrictionLamports.toString(),
            unencumberedAtMs: obs.unencumberedAtMs,
            settledAtMs: obs.settledAtMs,
        });
        const existing = this.records.get(obs.tradeId);
        if (existing) {
            if (this.fingerprints.get(obs.tradeId) === fingerprint)
                return existing;
            throw new Error('CAPITAL_TIME_DUPLICATE_OBSERVATION_CONFLICT');
        }
        const totalLamportMilliseconds = stateTimes.RESERVED + stateTimes.UNKNOWN + stateTimes.INVESTED;
        const lifecycleStartMs = segments.reduce((start, s) => Math.min(start, s.startMs), Number.MAX_SAFE_INTEGER);
        if (obs.unencumberedAtMs < lifecycleStartMs) {
            throw new Error('CAPITAL_TIME_CASH_PRECEDES_OCCUPANCY');
        }
        const realizedNetPnlLamports = obs.grossProceedsLamports - obs.basisRelievedLamports - obs.totalFrictionLamports;
        const capitalTimeEfficiencyPerSecondBps = totalLamportMilliseconds > 0n
            ? Number((realizedNetPnlLamports * 10000000n) / totalLamportMilliseconds)
            : null;
        const metrics = Object.freeze({
            tradeId: obs.tradeId,
            economicFactId: obs.economicFactId,
            lamportMillisecondsByState: Object.freeze({ ...stateTimes }),
            totalLamportMilliseconds,
            timeToCashMs: obs.unencumberedAtMs - lifecycleStartMs,
            timeToFinalSettlementMs: obs.settledAtMs - lifecycleStartMs,
            realizedNetPnlLamports,
            capitalTimeEfficiencyPerSecondBps,
            status: 'RESEARCH_ONLY',
            reportId: `cap_time_${obs.tradeId}_${obs.economicFactId}`,
        });
        this.records.set(obs.tradeId, metrics);
        this.fingerprints.set(obs.tradeId, fingerprint);
        return metrics;
    }
    getMetrics(tradeId) {
        return this.records.get(tradeId);
    }
    getAllMetrics() {
        return Object.freeze(Array.from(this.records.values()));
    }
}
//# sourceMappingURL=capital-time-ledger.js.map
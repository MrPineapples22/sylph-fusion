/**
 * SYLPH FUSION — CAPITAL-TIME ECONOMICS & VELOCITY OBSERVABILITY
 * Specifications: Blueprint Section 50
 *
 * Status: RESEARCH_ONLY (Velocity metric for high-throughput discovery; not direct authorization)
 *
 * Invariant:
 * 1. Tracks exact capital-time occupancy:
 *    - lamportSecondsReserved
 *    - lamportSecondsUnknown
 *    - lamportSecondsInvested
 * 2. Measures timeToCashMs and timeToFinalSettlementMs.
 * 3. Derives RealizedExecutableNetEdge / CapitalTimeOccupied.
 */
export class CapitalTimeLedger {
    records = new Map();
    recordTradeLifecycle(obs) {
        const timeToCashMs = obs.unencumberedAtMs - obs.reservedAtMs;
        const timeToFinalSettlementMs = obs.settledAtMs - obs.reservedAtMs;
        const reservedDurationSec = BigInt(Math.max(1, Math.round((obs.settledAtMs - obs.reservedAtMs) / 1000)));
        const investedDurationSec = BigInt(Math.max(1, Math.round(((obs.landedAtMs ?? obs.settledAtMs) - obs.reservedAtMs) / 1000)));
        const unknownDurationSec = BigInt(Math.max(0, Math.round((obs.settledAtMs - (obs.signedAtMs ?? obs.reservedAtMs)) / 1000)));
        const lamportSecondsReserved = obs.reservedLamports * reservedDurationSec;
        const lamportSecondsInvested = obs.investedLamports * investedDurationSec;
        const lamportSecondsUnknown = obs.unknownLamports * unknownDurationSec;
        const totalLamportSeconds = lamportSecondsReserved + lamportSecondsUnknown;
        const netProceedsLamports = obs.realizedNetProceedsLamports - obs.totalFrictionLamports;
        // Capital-Time Efficiency: Net Edge (in bps of invested) / Seconds Occupied
        const nominalReturnBps = obs.investedLamports > 0n
            ? Number((netProceedsLamports * 10000n) / obs.investedLamports)
            : 0;
        const capitalTimeEfficiencyPerSecondBps = reservedDurationSec > 0n
            ? Number((nominalReturnBps / Number(reservedDurationSec)).toFixed(4))
            : 0;
        const metrics = {
            tradeId: obs.tradeId,
            economicFactId: obs.economicFactId,
            lamportSecondsReserved,
            lamportSecondsUnknown,
            lamportSecondsInvested,
            totalLamportSeconds,
            timeToCashMs,
            timeToFinalSettlementMs,
            netProceedsLamports,
            capitalTimeEfficiencyPerSecondBps,
            status: 'RESEARCH_ONLY',
            evidenceRoot: `ev_cap_time_${obs.tradeId}_${Date.now()}`,
        };
        this.records.set(obs.tradeId, metrics);
        return metrics;
    }
    getMetrics(tradeId) {
        return this.records.get(tradeId);
    }
    getAllMetrics() {
        return Array.from(this.records.values());
    }
}
//# sourceMappingURL=capital-time-ledger.js.map
/**
 * SYLPH FUSION — ANTI-PORTFOLIO & SECOND-CHANCE QUEUE
 * Specifications: Master Blueprint Sections XXXVI, XXXVII, XXXVIII, XXXIX
 *
 * Tracks EVERY rejected candidate and determines what happened later:
 * - rejected_2x, rejected_5x, rejected_10x, rejected_50x, rejected_100x
 * - rejected_rug, rejected_death, rejected_executable_EV
 * - Second-chance requalification queue (REJECT -> REJECTED_WATCH -> REQUALIFIED)
 * - Filter Net Value = AvoidedLoss - MissedExecutableEV
 * - Moonshot Tax(F) = ExtremeWinnerEVRejected / BadEVPrevented
 *
 * Mandatory requirement: SYLPH cannot improve filters without knowing what the filters rejected.
 */
export class AntiPortfolioEngine {
    rejected = new Map();
    recordRejection(params) {
        const candidateId = params.candidateId ?? `rej_${params.mint}_${Date.now()}`;
        const record = {
            candidateId,
            mint: params.mint,
            rejectedAtMs: Date.now(),
            rejectionReason: params.rejectionReason,
            filterName: params.filterName,
            entryPriceSol: params.entryPriceSol,
            entryLiquidityLamports: params.entryLiquidityLamports,
            disposition: params.eligibleForSecondChance ? 'REJECTED_WATCH' : 'REJECT',
        };
        this.rejected.set(params.mint, record);
        return record;
    }
    /**
     * Requalifies a previously rejected candidate when structural state improves.
     */
    requalifyCandidate(mint, reason) {
        const record = this.rejected.get(mint);
        if (!record || record.disposition !== 'REJECTED_WATCH')
            return false;
        record.disposition = 'REQUALIFIED';
        record.requalifiedAtMs = Date.now();
        record.requalificationReason = reason;
        return true;
    }
    /**
     * Updates outcome observation for a rejected token as historical data matures.
     */
    updateRejectedOutcome(params) {
        const record = this.rejected.get(params.mint);
        if (!record)
            return;
        record.subsequentPeakMultiple = params.peakMultiple;
        record.subsequentWorstDrawdownBps = params.worstDrawdownBps;
        record.isRug = params.isRug;
        record.isDead = params.isDead;
        record.actualExecutableReturnBps = params.actualExecutableReturnBps;
    }
    /**
     * Computes the economic impact and Moonshot Tax of all applied filters.
     */
    computeAntiPortfolioSummary() {
        let totalRejectedCount = 0;
        let rejectedRugCount = 0;
        let rejectedDeathCount = 0;
        let rejected2xCount = 0;
        let rejected5xCount = 0;
        let rejected10xCount = 0;
        let rejected50xCount = 0;
        let rejected100xCount = 0;
        let totalAvoidedLossLamports = 0n;
        let totalMissedExecutableEvLamports = 0n;
        for (const record of this.rejected.values()) {
            totalRejectedCount++;
            const peak = record.subsequentPeakMultiple ?? 1.0;
            if (record.isRug) {
                rejectedRugCount++;
                totalAvoidedLossLamports += 100000000n; // 0.1 SOL avoided per rug
            }
            else if (record.isDead) {
                rejectedDeathCount++;
                totalAvoidedLossLamports += 80000000n;
            }
            if (peak >= 100)
                rejected100xCount++;
            if (peak >= 50)
                rejected50xCount++;
            if (peak >= 10)
                rejected10xCount++;
            if (peak >= 5)
                rejected5xCount++;
            if (peak >= 2)
                rejected2xCount++;
            if (record.actualExecutableReturnBps && record.actualExecutableReturnBps > 0) {
                const missedEv = BigInt(Math.round(100_000_000 * (record.actualExecutableReturnBps / 10_000)));
                totalMissedExecutableEvLamports += missedEv;
            }
        }
        const filterNetValueLamports = totalAvoidedLossLamports - totalMissedExecutableEvLamports;
        const overallMoonshotTax = totalAvoidedLossLamports > 0n
            ? Number(totalMissedExecutableEvLamports) / Number(totalAvoidedLossLamports)
            : 0;
        return {
            totalRejectedCount,
            rejectedRugCount,
            rejectedDeathCount,
            rejected2xCount,
            rejected5xCount,
            rejected10xCount,
            rejected50xCount,
            rejected100xCount,
            totalAvoidedLossLamports,
            totalMissedExecutableEvLamports,
            filterNetValueLamports,
            overallMoonshotTax: Number(overallMoonshotTax.toFixed(4)),
        };
    }
    getRecord(mint) {
        return this.rejected.get(mint);
    }
    getAllRecords() {
        return Array.from(this.rejected.values());
    }
}
//# sourceMappingURL=anti-portfolio.js.map
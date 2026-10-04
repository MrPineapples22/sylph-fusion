/**
 * SYLPH FUSION — EVACUATION-X: PORTFOLIO EVACUATION CERTIFICATE
 * Specifications: Master Blueprint Section XXVI (Portfolio Evacuation Certificate)
 */
import { createHash } from 'node:crypto';
export function certifyPortfolioEvacuation(slot, analysis, maxAllowableP95CostBps = 1000) {
    const issuedAtMs = Date.now();
    const clearanceFeasible = analysis.p95CostBps <= maxAllowableP95CostBps && analysis.recoverableCapitalByDeadlineUsd > 0;
    const unsigned = {
        slot: slot.toString(),
        totalValueUsd: analysis.totalPositionValueUsd,
        recoverableUsd: analysis.recoverableCapitalByDeadlineUsd,
        p95CostBps: analysis.p95CostBps,
        bottlenecks: analysis.sharedBottlenecks,
        clearanceFeasible,
        issuedAtMs,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    const certificateId = `pec_${certificateHash.slice(0, 16)}`;
    return {
        certificateId,
        slot,
        totalValueUsd: analysis.totalPositionValueUsd,
        recoverableCapitalByDeadlineUsd: analysis.recoverableCapitalByDeadlineUsd,
        p50CostBps: analysis.p50CostBps,
        p95CostBps: analysis.p95CostBps,
        p99CostBps: analysis.p99CostBps,
        survivalDeficitUsd: analysis.survivalDeficitUsd,
        sharedBottlenecks: analysis.sharedBottlenecks,
        clearanceFeasible,
        certificateHash,
        issuedAtMs,
    };
}
//# sourceMappingURL=portfolio-evacuation-certificate.js.map
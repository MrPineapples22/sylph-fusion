/**
 * SYLPH FUSION — ALPHA REALITY-X: CANDIDATE COHORTS
 * Specifications: Master Blueprint Section XIII (Point-in-Time Candidate Cohorts)
 *
 * Invariant: To prevent survivorship and selection bias, evaluations must span
 * ALL candidates (traded + rejected + watched + abstained).
 */
export class CandidateCohortTracker {
    items = new Map();
    recordCandidate(item) {
        this.items.set(item.candidateId, item);
    }
    recordRealizedOutcome(candidateId, realizedGrossBps, realizedExecutionCostBps) {
        const existing = this.items.get(candidateId);
        if (!existing)
            return;
        this.items.set(candidateId, {
            ...existing,
            realizedGrossReturnBps: realizedGrossBps,
            realizedExecutionCostBps,
            realizedNetReturnBps: realizedGrossBps - realizedExecutionCostBps,
        });
    }
    sealCohort(cohortId, startSlot, endSlot) {
        const list = [...this.items.values()];
        const tradedCount = list.filter((i) => i.disposition === 'TRADED').length;
        const rejectedCount = list.filter((i) => i.disposition === 'REJECTED').length;
        const watchedCount = list.filter((i) => i.disposition === 'WATCHED').length;
        const abstainedCount = list.filter((i) => i.disposition === 'ABSTAINED').length;
        return {
            cohortId,
            startSlot,
            endSlot,
            items: Object.freeze(list),
            totalCandidates: list.length,
            tradedCount,
            rejectedCount,
            watchedCount,
            abstainedCount,
        };
    }
}
//# sourceMappingURL=candidate-cohort.js.map
/**
 * SYLPH FUSION — SIDE-EFFECT FENCING
 * Specifications: Blueprint Section 26 (Side-Effect Fencing)
 * Workbook: #971 Preemption Fencing, #983 In-Flight Fact Carryover, #995 Stale-Proposal Rejection
 *
 * Invariant: Before any non-idempotent external side effect (signing, RPC, Jito, TPU, settlement):
 *   1. Durably claim the fence.
 *   2. Perform the external action.
 *   3. Durably record the outcome.
 *
 * If a process restarts during IN_FLIGHT, it enters RECOVERY_AMBIGUOUS and MUST reconcile.
 * It may NEVER automatically retry a new economic effect.
 */
export class SideEffectFenceManager {
    fences = new Map();
    claim(params) {
        const existing = this.fences.get(params.fenceId);
        if (existing && existing.state !== 'UNCLAIMED') {
            throw new Error(`FENCE_PREEMPTION_ERROR: Fence ${params.fenceId} already in state ${existing.state}`);
        }
        const record = {
            ...params,
            state: 'CLAIMED',
            claimedAtMs: Date.now(),
        };
        this.fences.set(params.fenceId, record);
        return record;
    }
    markInFlight(fenceId) {
        const record = this.fences.get(fenceId);
        if (!record || record.state !== 'CLAIMED') {
            throw new Error(`FENCE_INVALID_TRANSITION: Cannot transition ${fenceId} to IN_FLIGHT from ${record?.state}`);
        }
        const updated = {
            ...record,
            state: 'IN_FLIGHT',
        };
        this.fences.set(fenceId, updated);
        return updated;
    }
    recordSuccess(fenceId, outcomeHash) {
        const record = this.fences.get(fenceId);
        if (!record || record.state !== 'IN_FLIGHT') {
            throw new Error(`FENCE_INVALID_TRANSITION: Cannot complete ${fenceId} from state ${record?.state}`);
        }
        const updated = {
            ...record,
            state: 'SUCCEEDED',
            completedAtMs: Date.now(),
            outcomeHash,
        };
        this.fences.set(fenceId, updated);
        return updated;
    }
    recordFailure(fenceId, reason) {
        const record = this.fences.get(fenceId);
        if (!record || record.state !== 'IN_FLIGHT') {
            throw new Error(`FENCE_INVALID_TRANSITION: Cannot fail ${fenceId} from state ${record?.state}`);
        }
        const updated = {
            ...record,
            state: 'FAILED',
            completedAtMs: Date.now(),
            failureReason: reason,
        };
        this.fences.set(fenceId, updated);
        return updated;
    }
    handleRecoveryCrash(fenceId) {
        const record = this.fences.get(fenceId);
        if (record && record.state === 'IN_FLIGHT') {
            const recovered = {
                ...record,
                state: 'RECOVERY_AMBIGUOUS',
            };
            this.fences.set(fenceId, recovered);
            return recovered;
        }
        return record;
    }
}
//# sourceMappingURL=side-effect-fence.js.map
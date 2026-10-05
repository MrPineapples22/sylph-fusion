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

export type SideEffectFenceState =
  | 'UNCLAIMED'
  | 'CLAIMED'
  | 'IN_FLIGHT'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECOVERY_AMBIGUOUS';

export interface SideEffectFenceRecord {
  readonly fenceId: string;
  readonly operationType: 'SIGNING' | 'RPC_SUBMIT' | 'TPU_SUBMIT' | 'JITO_SUBMIT' | 'SETTLEMENT' | 'RESERVATION_RELEASE';
  readonly economicFactId: string;
  readonly executionGenerationId: string;
  readonly state: SideEffectFenceState;
  readonly claimedAtMs: number;
  readonly completedAtMs?: number;
  readonly outcomeHash?: string;
  readonly failureReason?: string;
}

export class SideEffectFenceManager {
  private readonly fences = new Map<string, SideEffectFenceRecord>();

  public claim(params: {
    fenceId: string;
    operationType: SideEffectFenceRecord['operationType'];
    economicFactId: string;
    executionGenerationId: string;
  }): SideEffectFenceRecord {
    const existing = this.fences.get(params.fenceId);
    if (existing && existing.state !== 'UNCLAIMED') {
      throw new Error(`FENCE_PREEMPTION_ERROR: Fence ${params.fenceId} already in state ${existing.state}`);
    }

    const record: SideEffectFenceRecord = {
      ...params,
      state: 'CLAIMED',
      claimedAtMs: Date.now(),
    };

    this.fences.set(params.fenceId, record);
    return record;
  }

  public markInFlight(fenceId: string): SideEffectFenceRecord {
    const record = this.fences.get(fenceId);
    if (!record || record.state !== 'CLAIMED') {
      throw new Error(`FENCE_INVALID_TRANSITION: Cannot transition ${fenceId} to IN_FLIGHT from ${record?.state}`);
    }

    const updated: SideEffectFenceRecord = {
      ...record,
      state: 'IN_FLIGHT',
    };
    this.fences.set(fenceId, updated);
    return updated;
  }

  public recordSuccess(fenceId: string, outcomeHash: string): SideEffectFenceRecord {
    const record = this.fences.get(fenceId);
    if (!record || record.state !== 'IN_FLIGHT') {
      throw new Error(`FENCE_INVALID_TRANSITION: Cannot complete ${fenceId} from state ${record?.state}`);
    }

    const updated: SideEffectFenceRecord = {
      ...record,
      state: 'SUCCEEDED',
      completedAtMs: Date.now(),
      outcomeHash,
    };
    this.fences.set(fenceId, updated);
    return updated;
  }

  public recordFailure(fenceId: string, reason: string): SideEffectFenceRecord {
    const record = this.fences.get(fenceId);
    if (!record || record.state !== 'IN_FLIGHT') {
      throw new Error(`FENCE_INVALID_TRANSITION: Cannot fail ${fenceId} from state ${record?.state}`);
    }

    const updated: SideEffectFenceRecord = {
      ...record,
      state: 'FAILED',
      completedAtMs: Date.now(),
      failureReason: reason,
    };
    this.fences.set(fenceId, updated);
    return updated;
  }

  public handleRecoveryCrash(fenceId: string): SideEffectFenceRecord {
    const record = this.fences.get(fenceId);
    if (record && record.state === 'IN_FLIGHT') {
      const recovered: SideEffectFenceRecord = {
        ...record,
        state: 'RECOVERY_AMBIGUOUS',
      };
      this.fences.set(fenceId, recovered);
      return recovered;
    }
    return record!;
  }
}

/**
 * SYLPH FUSION — ALPHA REALITY-X: CANDIDATE COHORTS
 * Specifications: Master Blueprint Section XIII (Point-in-Time Candidate Cohorts)
 *
 * Invariant: To prevent survivorship and selection bias, evaluations must span
 * ALL candidates (traded + rejected + watched + abstained).
 */

export type CohortDisposition = 'TRADED' | 'REJECTED' | 'WATCHED' | 'ABSTAINED';

export interface CandidateCohortItem {
  readonly candidateId: string;
  readonly mint: string;
  readonly observedSlot: bigint;
  readonly observedAtMs: number;
  readonly disposition: CohortDisposition;
  readonly rejectionReason?: string;
  readonly predictedReturnBps: number;
  readonly realizedGrossReturnBps?: number;
  readonly realizedNetReturnBps?: number;
  readonly realizedExecutionCostBps?: number;
}

export interface CandidateCohort {
  readonly cohortId: string;
  readonly startSlot: bigint;
  readonly endSlot: bigint;
  readonly items: readonly CandidateCohortItem[];
  readonly totalCandidates: number;
  readonly tradedCount: number;
  readonly rejectedCount: number;
  readonly watchedCount: number;
  readonly abstainedCount: number;
}

export class CandidateCohortTracker {
  private items = new Map<string, CandidateCohortItem>();

  public recordCandidate(item: CandidateCohortItem): void {
    this.items.set(item.candidateId, item);
  }

  public recordRealizedOutcome(
    candidateId: string,
    realizedGrossBps: number,
    realizedExecutionCostBps: number
  ): void {
    const existing = this.items.get(candidateId);
    if (!existing) return;
    this.items.set(candidateId, {
      ...existing,
      realizedGrossReturnBps: realizedGrossBps,
      realizedExecutionCostBps,
      realizedNetReturnBps: realizedGrossBps - realizedExecutionCostBps,
    });
  }

  public sealCohort(cohortId: string, startSlot: bigint, endSlot: bigint): CandidateCohort {
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

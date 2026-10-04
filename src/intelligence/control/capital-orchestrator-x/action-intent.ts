/**
 * SYLPH FUSION — CAPITAL ORCHESTRATOR-X: ACTION INTENT
 * Specifications: Master Blueprint Section XXXII, XXXIII (Allowed Actions)
 *
 * Invariant: Emits exactly NEXT ActionIntent (never an uncontrolled multi-action plan).
 */

export type OrchestratorAction =
  | 'HOLD_CASH'
  | 'OPEN'
  | 'INCREASE'
  | 'REDUCE'
  | 'CLOSE'
  | 'ROTATE'
  | 'HARVEST_PROFIT'
  | 'RESERVE_FOR_EXIT'
  | 'RELEASE_RESERVE'
  | 'EXPERIMENT'
  | 'CANCEL'
  | 'EVACUATE'
  | 'RECONCILE';

export interface ActionIntent {
  readonly intentId: string;
  readonly action: OrchestratorAction;
  readonly subjectMint?: string;
  readonly allocationSol: number;
  readonly objectivePriority: number; // 0=Truth, 1=Survival, 2=Maneuverability, 3=Growth, 4=Info, 5=Efficiency
  readonly rationale: string;
  readonly proofArtifactRoot: string;
  readonly emittedAtMs: number;
  readonly validUntilSlot: bigint;
}

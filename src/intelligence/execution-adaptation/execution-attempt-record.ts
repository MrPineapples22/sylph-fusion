/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: ATTEMPT RECORDING
 * Specifications: Master Blueprint Section XX (Execution Adaptation-X)
 *
 * Invariant: Record EVERY execution attempt across all terminal and intermediate outcomes.
 * Never train models solely on landed transactions (selection/survivorship hazard).
 */

import type { ExecutionActionVector } from './action-vector.js';

export type ExecutionAttemptOutcome =
  | 'FINALIZED_SUCCESS'
  | 'FINALIZED_INSTRUCTION_FAILURE'
  | 'SLIPPAGE_REJECTED'
  | 'DELIVERY_FAILED'
  | 'BLOCKHASH_EXPIRED'
  | 'CERTIFIED_NO_LAND'
  | 'UNKNOWN';

export interface ExecutionAttemptRecord {
  readonly attemptId: string;
  readonly intentId: string;
  readonly actionVector: ExecutionActionVector;
  readonly outcome: ExecutionAttemptOutcome;
  readonly submissionSlot: bigint;
  readonly landedSlot?: bigint;
  readonly transactionSignature?: string;
  readonly realizedSlippageBps?: number;
  readonly realizedCuConsumed?: number;
  readonly realizedTotalFeeLamports?: bigint;
  readonly errorDetails?: string;
  readonly recordedAtMs: number;
}

export class ExecutionAttemptLedger {
  private attempts: ExecutionAttemptRecord[] = [];

  public recordAttempt(attempt: ExecutionAttemptRecord): void {
    this.attempts.push(attempt);
  }

  public getAllAttempts(): readonly ExecutionAttemptRecord[] {
    return Object.freeze([...this.attempts]);
  }

  public getAttemptsByOutcome(outcome: ExecutionAttemptOutcome): readonly ExecutionAttemptRecord[] {
    return Object.freeze(this.attempts.filter((a) => a.outcome === outcome));
  }
}

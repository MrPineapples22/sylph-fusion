/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: ATTEMPT RECORDING
 * Specifications: Master Blueprint Section XX (Execution Adaptation-X) & Section XXI (Execution Action Vector)
 *
 * Invariant: Record EVERY execution attempt across all terminal and intermediate outcomes.
 * Never train models or compute landing probabilities solely on landed transactions (selection/survivorship hazard).
 * All 7 canonical outcomes are strictly typed and accounted for in the denominator.
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

export const CANONICAL_EXECUTION_OUTCOMES: readonly ExecutionAttemptOutcome[] = Object.freeze([
  'FINALIZED_SUCCESS',
  'FINALIZED_INSTRUCTION_FAILURE',
  'SLIPPAGE_REJECTED',
  'DELIVERY_FAILED',
  'BLOCKHASH_EXPIRED',
  'CERTIFIED_NO_LAND',
  'UNKNOWN',
]);

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

export interface ExecutionAttemptStats {
  readonly totalAttempts: number;
  readonly landedCount: number;
  readonly successCount: number;
  readonly instructionFailureCount: number;
  readonly slippageRejectedCount: number;
  readonly deliveryFailedCount: number;
  readonly blockhashExpiredCount: number;
  readonly certifiedNoLandCount: number;
  readonly unknownCount: number;
  readonly landingRatePct: number;
  readonly executionSuccessRatePct: number;
  readonly meanRealizedSlippageBps: number;
  readonly meanCuConsumed: number;
  readonly meanTotalFeeLamports: bigint;
  readonly outcomeDistribution: Readonly<Record<ExecutionAttemptOutcome, number>>;
}

export class ExecutionAttemptLedger {
  private readonly attempts: ExecutionAttemptRecord[] = [];
  private readonly attemptIdIndex: Set<string> = new Set();

  public recordAttempt(attempt: ExecutionAttemptRecord): void {
    if (!attempt || typeof attempt !== 'object') {
      throw new Error('INVALID_ATTEMPT_RECORD: attempt must be a non-null object');
    }
    if (!attempt.attemptId || typeof attempt.attemptId !== 'string') {
      throw new Error('INVALID_ATTEMPT_ID: attemptId must be a non-empty string');
    }
    if (this.attemptIdIndex.has(attempt.attemptId)) {
      throw new Error(`DUPLICATE_ATTEMPT_ID: attemptId "${attempt.attemptId}" already recorded`);
    }
    if (!attempt.intentId || typeof attempt.intentId !== 'string') {
      throw new Error('INVALID_INTENT_ID: intentId must be a non-empty string');
    }
    if (!CANONICAL_EXECUTION_OUTCOMES.includes(attempt.outcome)) {
      throw new Error(`INVALID_OUTCOME: outcome "${attempt.outcome}" is not a canonical outcome`);
    }
    if (attempt.submissionSlot < 0n) {
      throw new Error('INVALID_SUBMISSION_SLOT: submissionSlot must be non-negative');
    }
    if (attempt.landedSlot !== undefined && attempt.landedSlot < attempt.submissionSlot) {
      throw new Error('TEMPORAL_PARADOX: landedSlot cannot precede submissionSlot');
    }

    this.attempts.push(Object.freeze({ ...attempt }));
    this.attemptIdIndex.add(attempt.attemptId);
  }

  public getAllAttempts(): readonly ExecutionAttemptRecord[] {
    return Object.freeze([...this.attempts]);
  }

  public getAttemptsByOutcome(outcome: ExecutionAttemptOutcome): readonly ExecutionAttemptRecord[] {
    return Object.freeze(this.attempts.filter((a) => a.outcome === outcome));
  }

  public getAttemptsByIntent(intentId: string): readonly ExecutionAttemptRecord[] {
    return Object.freeze(this.attempts.filter((a) => a.intentId === intentId));
  }

  public getStats(): ExecutionAttemptStats {
    const totalAttempts = this.attempts.length;
    const distribution: Record<ExecutionAttemptOutcome, number> = {
      FINALIZED_SUCCESS: 0,
      FINALIZED_INSTRUCTION_FAILURE: 0,
      SLIPPAGE_REJECTED: 0,
      DELIVERY_FAILED: 0,
      BLOCKHASH_EXPIRED: 0,
      CERTIFIED_NO_LAND: 0,
      UNKNOWN: 0,
    };

    let totalSlippageBps = 0;
    let slippageSamples = 0;
    let totalCu = 0;
    let cuSamples = 0;
    let totalFeeLamports = 0n;

    for (const a of this.attempts) {
      distribution[a.outcome] = (distribution[a.outcome] || 0) + 1;
      if (a.realizedSlippageBps !== undefined && !Number.isNaN(a.realizedSlippageBps)) {
        totalSlippageBps += a.realizedSlippageBps;
        slippageSamples++;
      }
      if (a.realizedCuConsumed !== undefined && !Number.isNaN(a.realizedCuConsumed)) {
        totalCu += a.realizedCuConsumed;
        cuSamples++;
      }
      if (a.realizedTotalFeeLamports !== undefined) {
        totalFeeLamports += a.realizedTotalFeeLamports;
      }
    }

    const landedCount = distribution.FINALIZED_SUCCESS + distribution.FINALIZED_INSTRUCTION_FAILURE;
    const landingRatePct = totalAttempts > 0 ? (landedCount / totalAttempts) * 100 : 0;
    const executionSuccessRatePct = totalAttempts > 0 ? (distribution.FINALIZED_SUCCESS / totalAttempts) * 100 : 0;
    const meanRealizedSlippageBps = slippageSamples > 0 ? totalSlippageBps / slippageSamples : 0;
    const meanCuConsumed = cuSamples > 0 ? totalCu / cuSamples : 0;
    const meanTotalFeeLamports = totalAttempts > 0 ? totalFeeLamports / BigInt(totalAttempts) : 0n;

    return Object.freeze({
      totalAttempts,
      landedCount,
      successCount: distribution.FINALIZED_SUCCESS,
      instructionFailureCount: distribution.FINALIZED_INSTRUCTION_FAILURE,
      slippageRejectedCount: distribution.SLIPPAGE_REJECTED,
      deliveryFailedCount: distribution.DELIVERY_FAILED,
      blockhashExpiredCount: distribution.BLOCKHASH_EXPIRED,
      certifiedNoLandCount: distribution.CERTIFIED_NO_LAND,
      unknownCount: distribution.UNKNOWN,
      landingRatePct,
      executionSuccessRatePct,
      meanRealizedSlippageBps,
      meanCuConsumed,
      meanTotalFeeLamports,
      outcomeDistribution: Object.freeze(distribution),
    });
  }

  public clear(): void {
    this.attempts.length = 0;
    this.attemptIdIndex.clear();
  }
}


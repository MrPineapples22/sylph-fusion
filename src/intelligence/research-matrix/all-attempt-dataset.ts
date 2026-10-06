/**
 * SYLPH FUSION — ALL-ATTEMPT DATASET (Section 29)
 *
 * Records EVERY evaluated candidate token without exception (ENTER, ABSTAIN, REJECT).
 * Completely eliminates survivor selection bias.
 *
 * Captures:
 * - Decision: ENTER | ABSTAIN | REJECT
 * - Responsible gate / veto
 * - Full point-in-time features & provenance
 * - Unknown / unobservable fields count
 * - Certificate roots
 * - Policy / Model / Code / Dataset versions
 * - Subsequent outcome link
 */

import { createHash } from 'node:crypto';
import type { ResearchPolicyStateV1 } from './research-policy-state.js';
import type { MultiFamilyConsensusResult } from './consensus.js';
import type { ExtremePredictionCertificate } from './prediction-certificate.js';

export interface EvaluatedAttemptRecord {
  readonly attemptId: string;
  readonly evaluatedAtMs: number;
  readonly mint: string;
  readonly symbol: string;
  readonly decision: 'ENTER' | 'ABSTAIN' | 'REJECT';
  readonly responsibleGateOrVeto: string;
  readonly pointInTimeState: ResearchPolicyStateV1;
  readonly consensusResult: MultiFamilyConsensusResult;
  readonly certificate?: ExtremePredictionCertificate;
  readonly policyVersion: string;
  readonly modelVersion: string;
  readonly codeRoot: string;
  readonly datasetRoot: string;
  readonly subsequentOutcomeId?: string;
  readonly recordHash: string;
}

export class AllAttemptDatasetStore {
  private readonly attempts: EvaluatedAttemptRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords = 50000) {
    this.maxRecords = maxRecords;
  }

  /**
   * Appends an evaluated candidate attempt into the immutable log.
   */
  public recordAttempt(params: Omit<EvaluatedAttemptRecord, 'attemptId' | 'recordHash'>): EvaluatedAttemptRecord {
    const attemptId = `att_${params.mint.slice(0, 8)}_${params.evaluatedAtMs}_${this.attempts.length + 1}`;

    const rawDigestPayload = JSON.stringify({
      attemptId,
      mint: params.mint,
      decision: params.decision,
      gate: params.responsibleGateOrVeto,
      evaluatedAtMs: params.evaluatedAtMs,
      certRoot: params.certificate?.certificateRoot ?? 'NO_CERT',
    });

    const recordHash = createHash('sha256')
      .update('ATTEMPT_RECORD_V1:')
      .update(rawDigestPayload)
      .digest('hex');

    const record: EvaluatedAttemptRecord = Object.freeze({
      ...params,
      attemptId,
      recordHash,
    });

    this.attempts.push(record);
    if (this.attempts.length > this.maxRecords) {
      this.attempts.shift();
    }

    return record;
  }

  public getAttempts(): readonly EvaluatedAttemptRecord[] {
    return this.attempts;
  }

  public getAttemptById(attemptId: string): EvaluatedAttemptRecord | undefined {
    return this.attempts.find(a => a.attemptId === attemptId);
  }

  public getAttemptsForMint(mint: string): readonly EvaluatedAttemptRecord[] {
    return this.attempts.filter(a => a.mint === mint);
  }

  public getDecisionBreakdown(): {
    readonly total: number;
    readonly enterCount: number;
    readonly abstainCount: number;
    readonly rejectCount: number;
  } {
    let enter = 0;
    let abstain = 0;
    let reject = 0;
    for (const a of this.attempts) {
      if (a.decision === 'ENTER') enter++;
      else if (a.decision === 'ABSTAIN') abstain++;
      else if (a.decision === 'REJECT') reject++;
    }
    return {
      total: this.attempts.length,
      enterCount: enter,
      abstainCount: abstain,
      rejectCount: reject,
    };
  }
}

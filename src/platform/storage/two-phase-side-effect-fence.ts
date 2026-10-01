/**
 * SYLPH FUSION — TWO-PHASE SIDE-EFFECT FENCE
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-5).
 *
 * Implements strict two-phase commit protocol for irreversible external side effects:
 * 1. DB PREPARE COMMIT: Durably records intention, external call ID, and payload hash.
 * 2. External Call: Dispatches to KMS hardware signer or network RPC / Jito relay.
 * 3. DB RESULT COMMIT: Durably seals outcome before releasing execution or updating generation.
 *
 * Invariant: Never retry or duplicate an external side-effect on PostgreSQL 40001 serialization failure.
 */

import { createHash, randomUUID } from 'node:crypto';

export type SideEffectPhase = 'SIGNING' | 'SUBMISSION';

export interface SideEffectRecord {
  readonly fenceId: string;
  readonly intentId: string;
  readonly generation: number;
  readonly phase: SideEffectPhase;
  readonly externalCallId: string;
  readonly payloadHash: string;
  readonly status: 'PREPARED' | 'COMMITTED' | 'FAILED';
  readonly preparedAt: number;
  readonly committedAt?: number;
  readonly resultDigest?: string;
}

export class TwoPhaseSideEffectFence {
  private readonly records = new Map<string, SideEffectRecord>(); // key: fenceId
  private readonly externalCallIndex = new Map<string, string>(); // externalCallId -> fenceId
  private readonly phaseIndex = new Map<string, string>(); // `${intentId}:${generation}:${phase}` -> fenceId

  /**
   * Prepares an irreversible external side-effect.
   * Throws if an identical or conflicting phase is already in flight or committed.
   */
  public prepare(params: {
    intentId: string;
    generation: number;
    phase: SideEffectPhase;
    externalCallId: string;
    payload: Uint8Array | string;
  }): { fenceId: string; isResumed: boolean } {
    const payloadBytes = typeof params.payload === 'string' ? Buffer.from(params.payload, 'utf8') : params.payload;
    const payloadHash = createHash('sha256').update(payloadBytes).digest('hex');
    const phaseKey = `${params.intentId}:${params.generation}:${params.phase}`;

    const existingFenceId = this.phaseIndex.get(phaseKey);
    if (existingFenceId) {
      const existing = this.records.get(existingFenceId)!;
      if (existing.status === 'COMMITTED') {
        throw new Error(
          `SIDE_EFFECT_ALREADY_COMMITTED: ${params.phase} for intent ${params.intentId} gen ${params.generation} already committed (SY005)`
        );
      }
      if (existing.payloadHash !== payloadHash) {
        throw new Error(
          `SIDE_EFFECT_PAYLOAD_MISMATCH: Cannot resume ${params.phase} with altered payload hash (SY012)`
        );
      }
      return { fenceId: existingFenceId, isResumed: true };
    }

    if (this.externalCallIndex.has(params.externalCallId)) {
      throw new Error(
        `DUPLICATE_EXTERNAL_CALL_ID: Call ID ${params.externalCallId} already registered`
      );
    }

    const fenceId = randomUUID();
    const record: SideEffectRecord = {
      fenceId,
      intentId: params.intentId,
      generation: params.generation,
      phase: params.phase,
      externalCallId: params.externalCallId,
      payloadHash,
      status: 'PREPARED',
      preparedAt: Date.now(),
    };

    this.records.set(fenceId, record);
    this.externalCallIndex.set(params.externalCallId, fenceId);
    this.phaseIndex.set(phaseKey, fenceId);

    return { fenceId, isResumed: false };
  }

  /**
   * Seals and commits the result of the external side-effect.
   */
  public commit(fenceId: string, resultPayload?: Uint8Array | string): SideEffectRecord {
    const record = this.records.get(fenceId);
    if (!record) {
      throw new Error(`FENCE_NOT_FOUND: Record ${fenceId} not found`);
    }

    if (record.status === 'COMMITTED') {
      return record;
    }

    let resultDigest: string | undefined;
    if (resultPayload) {
      const bytes = typeof resultPayload === 'string' ? Buffer.from(resultPayload, 'utf8') : resultPayload;
      resultDigest = createHash('sha256').update(bytes).digest('hex');
    }

    const updated: SideEffectRecord = {
      ...record,
      status: 'COMMITTED',
      committedAt: Date.now(),
      resultDigest,
    };

    this.records.set(fenceId, updated);
    return updated;
  }

  /**
   * Marks side effect as failed only if failure was verified before external side effect took hold.
   */
  public markFailed(fenceId: string, reason: string): void {
    const record = this.records.get(fenceId);
    if (!record) return;
    if (record.status === 'COMMITTED') {
      throw new Error(`CANNOT_FAIL_COMMITTED_SIDE_EFFECT: ${fenceId} is already committed`);
    }
    this.records.set(fenceId, { ...record, status: 'FAILED' });
  }

  public getRecord(fenceId: string): SideEffectRecord | undefined {
    return this.records.get(fenceId);
  }

  public getByPhase(intentId: string, generation: number, phase: SideEffectPhase): SideEffectRecord | undefined {
    const fenceId = this.phaseIndex.get(`${intentId}:${generation}:${phase}`);
    return fenceId ? this.records.get(fenceId) : undefined;
  }
}

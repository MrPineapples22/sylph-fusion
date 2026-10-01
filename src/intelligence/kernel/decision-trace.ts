/**
 * SOL-SYLPH Master Production Intelligence - Decision Tracing Engine
 * Specifications: Section 92 (Distributed Tracing).
 *
 * Rules:
 * 1. Propagate trace_id, event_id, snapshot_id, decision_id, order_intent_id, execution_id.
 * 2. Every production decision must be reconstructable end-to-end.
 * 3. Traces must support cryptographic sealing (finalize) to prevent post-hoc mutation.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DecisionTraceContext, DecisionTraceStep } from './types.js';

export class DecisionTrace {
  public readonly context: DecisionTraceContext;
  private readonly steps: DecisionTraceStep[] = [];
  private isFinalized = false;
  private finalizedAtMs?: number;
  private sealedHash?: string;

  constructor(context: Partial<DecisionTraceContext> = {}) {
    this.context = {
      traceId: context.traceId ?? `trc_${randomUUID()}`,
      eventId: context.eventId,
      snapshotId: context.snapshotId,
      decisionId: context.decisionId,
      orderIntentId: context.orderIntentId,
      executionId: context.executionId,
      positionId: context.positionId,
      rootTimestampMs: context.rootTimestampMs ?? Date.now(),
    };
  }

  public recordStep(params: {
    stepName: string;
    componentId: string;
    durationMs: number;
    inputs: unknown;
    outputs: unknown;
    status: 'PASS' | 'WARN' | 'FAIL' | 'ABSTAIN' | 'BLOCK' | 'DEGRADED';
    details?: Record<string, unknown>;
  }): DecisionTraceStep {
    if (this.isFinalized) {
      throw new Error(`[DecisionTrace] Trace ${this.context.traceId} is finalized and sealed against mutation.`);
    }

    const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
    const inputsHash = createHash('sha256')
      .update(JSON.stringify(params.inputs, bigintReplacer))
      .digest('hex');
    const outputsHash = createHash('sha256')
      .update(JSON.stringify(params.outputs, bigintReplacer))
      .digest('hex');

    const step: DecisionTraceStep = {
      stepName: params.stepName,
      componentId: params.componentId,
      timestampMs: Date.now(),
      durationMs: params.durationMs,
      inputsHash,
      outputsHash,
      status: params.status,
      details: params.details,
    };

    this.steps.push(step);
    return step;
  }

  public getSteps(): readonly DecisionTraceStep[] {
    return this.steps;
  }

  public serializeTrace(): {
    context: DecisionTraceContext;
    steps: readonly DecisionTraceStep[];
    totalDurationMs: number;
    overallStatus: 'PASS' | 'WARN' | 'FAIL' | 'ABSTAIN' | 'BLOCK' | 'DEGRADED';
  } {
    const now = Date.now();
    const hasBlock = this.steps.some((s) => s.status === 'BLOCK');
    const hasFail = this.steps.some((s) => s.status === 'FAIL');
    const hasDegraded = this.steps.some((s) => s.status === 'DEGRADED');
    const hasAbstain = this.steps.some((s) => s.status === 'ABSTAIN');
    const hasWarn = this.steps.some((s) => s.status === 'WARN');
    const overallStatus = hasBlock ? 'BLOCK' : hasFail ? 'FAIL' : hasDegraded ? 'DEGRADED' : hasAbstain ? 'ABSTAIN' : hasWarn ? 'WARN' : 'PASS';

    return {
      context: this.context,
      steps: this.steps,
      totalDurationMs: this.finalizedAtMs
        ? this.finalizedAtMs - this.context.rootTimestampMs
        : now - this.context.rootTimestampMs,
      overallStatus,
    };
  }

  /**
   * Cryptographically seals the decision trace, computing the final digest
   * and preventing any subsequent step recording.
   */
  public finalize(): {
    context: DecisionTraceContext;
    steps: readonly DecisionTraceStep[];
    totalDurationMs: number;
    overallStatus: 'PASS' | 'WARN' | 'FAIL' | 'ABSTAIN' | 'BLOCK' | 'DEGRADED';
    finalizedAtMs: number;
    traceHash: string;
  } {
    if (this.isFinalized && this.sealedHash && this.finalizedAtMs) {
      return {
        ...this.serializeTrace(),
        finalizedAtMs: this.finalizedAtMs,
        traceHash: this.sealedHash,
      };
    }

    this.finalizedAtMs = Date.now();
    this.isFinalized = true;
    const base = this.serializeTrace();
    const payload = JSON.stringify({
      context: base.context,
      steps: base.steps,
      totalDurationMs: this.finalizedAtMs - this.context.rootTimestampMs,
      overallStatus: base.overallStatus,
      finalizedAtMs: this.finalizedAtMs,
    });
    this.sealedHash = createHash('sha256').update(payload).digest('hex');

    return {
      ...base,
      totalDurationMs: this.finalizedAtMs - this.context.rootTimestampMs,
      finalizedAtMs: this.finalizedAtMs,
      traceHash: this.sealedHash,
    };
  }

  public getTraceHash(): string {
    if (this.sealedHash) return this.sealedHash;
    const serialized = JSON.stringify(this.serializeTrace());
    return createHash('sha256').update(serialized).digest('hex');
  }

  public isSealed(): boolean {
    return this.isFinalized;
  }
}

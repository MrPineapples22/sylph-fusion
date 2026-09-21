/**
 * SOL-SYLPH Master Production Intelligence - Decision Tracing Engine
 * Specifications: Section 92 (Distributed Tracing).
 *
 * Rules:
 * 1. Propagate trace_id, event_id, snapshot_id, decision_id, order_intent_id, execution_id.
 * 2. Every production decision must be reconstructable end-to-end.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DecisionTraceContext, DecisionTraceStep } from './types.js';

export class DecisionTrace {
  public readonly context: DecisionTraceContext;
  private readonly steps: DecisionTraceStep[] = [];

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
    status: 'PASS' | 'WARN' | 'FAIL' | 'VETO';
    details?: Record<string, unknown>;
  }): DecisionTraceStep {
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
    overallStatus: 'PASS' | 'WARN' | 'FAIL' | 'VETO';
  } {
    const now = Date.now();
    const hasVeto = this.steps.some((s) => s.status === 'VETO');
    const hasFail = this.steps.some((s) => s.status === 'FAIL');
    const hasWarn = this.steps.some((s) => s.status === 'WARN');
    const overallStatus = hasVeto ? 'VETO' : hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';

    return {
      context: this.context,
      steps: this.steps,
      totalDurationMs: now - this.context.rootTimestampMs,
      overallStatus,
    };
  }

  public getTraceHash(): string {
    const serialized = JSON.stringify(this.serializeTrace());
    return createHash('sha256').update(serialized).digest('hex');
  }
}

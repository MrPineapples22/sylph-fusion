/**
 * PHASE 37 & 38 — VETO-LIVENESS & VETO-QOS
 *
 * Implements:
 * - LivenessScheduler: Explicit wake triggers for WAIT decisions; timeout to ARCHIVED_UNRESOLVED
 * - VetoQoSController: Priority-ranked evaluation capacity; ProofCostEnvelope budget exhaustion yields UNKNOWN
 */

import { MintIdentity } from './types.js';

export type WakeTrigger =
  | 'PROVIDER_RECOVERED'
  | 'NEW_EVIDENCE_ARRIVED'
  | 'CONFLICT_RESOLVED'
  | 'POLICY_CHANGED'
  | 'PROTOCOL_CERTIFIED'
  | 'BANK_CHANGED'
  | 'TIMEOUT_SAFETY_NET';

export interface PendingDecisionWait {
  readonly subject: MintIdentity;
  readonly waitingFor: readonly WakeTrigger[];
  readonly registeredAtUnixMs: number;
  readonly maxWaitDurationMs: number;
  readonly decisionGeneration: bigint;
}

export class VetoLivenessScheduler {
  private readonly pendingWaits = new Map<string, PendingDecisionWait>();

  private key(subject: MintIdentity): string {
    return `${subject.clusterGenesisHash}:${subject.mint}`;
  }

  public registerWait(
    subject: MintIdentity,
    waitingFor: readonly WakeTrigger[],
    maxWaitDurationMs: number = 30_000,
    decisionGeneration: bigint = 0n
  ): void {
    this.pendingWaits.set(this.key(subject), {
      subject,
      waitingFor,
      registeredAtUnixMs: Date.now(),
      maxWaitDurationMs,
      decisionGeneration,
    });
  }

  public notifyTrigger(trigger: WakeTrigger): readonly MintIdentity[] {
    const awoken: MintIdentity[] = [];
    for (const [key, wait] of this.pendingWaits.entries()) {
      if (wait.waitingFor.includes(trigger)) {
        awoken.push(wait.subject);
        this.pendingWaits.delete(key);
      }
    }
    return awoken;
  }

  public sweepTimeouts(): readonly { subject: MintIdentity; status: 'ARCHIVED_UNRESOLVED' }[] {
    const now = Date.now();
    const timeouts: { subject: MintIdentity; status: 'ARCHIVED_UNRESOLVED' }[] = [];

    for (const [key, wait] of this.pendingWaits.entries()) {
      if (now - wait.registeredAtUnixMs > wait.maxWaitDurationMs) {
        timeouts.push({ subject: wait.subject, status: 'ARCHIVED_UNRESOLVED' });
        this.pendingWaits.delete(key);
      }
    }

    return timeouts;
  }
}

export interface ProofCostEnvelope {
  readonly maxExecutionTimeMs: number;
  readonly maxDagDepth: number;
  readonly maxEvidenceRoots: number;
}

export class VetoQosController {
  private inFlightVerifications: number = 0;
  private readonly maxConcurrentVerifications: number;

  constructor(maxConcurrentVerifications: number = 16) {
    this.maxConcurrentVerifications = maxConcurrentVerifications;
  }

  public canAdmitVerification(): boolean {
    return this.inFlightVerifications < this.maxConcurrentVerifications;
  }

  public acquireSlot(): boolean {
    if (this.canAdmitVerification()) {
      this.inFlightVerifications++;
      return true;
    }
    return false;
  }

  public releaseSlot(): void {
    if (this.inFlightVerifications > 0) {
      this.inFlightVerifications--;
    }
  }

  /**
   * Evaluates if a ProofCostEnvelope is within safety margins.
   * If budget is exhausted, MUST yield UNKNOWN, never FAIL!
   */
  public evaluateCostBudget(
    envelope: ProofCostEnvelope,
    actualElapsedMs: number,
    actualRootsCount: number
  ): { readonly withinBudget: boolean; readonly fallbackDisposition: 'UNKNOWN' } {
    if (actualElapsedMs > envelope.maxExecutionTimeMs || actualRootsCount > envelope.maxEvidenceRoots) {
      return { withinBudget: false, fallbackDisposition: 'UNKNOWN' };
    }
    return { withinBudget: true, fallbackDisposition: 'UNKNOWN' };
  }
}

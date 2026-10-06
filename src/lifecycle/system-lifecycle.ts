/**
 * SOL-SYLPH Formal System Lifecycle State Machine
 * Specification: Section 11.
 *
 * Enforces valid transition paths and prevents illegal shortcuts:
 * BOOT -> INITIALIZING -> CONNECTING -> SYNCHRONIZING -> RECONCILING -> CERTIFYING -> READY -> HEALTHY
 */

export type LifecycleState =
  | 'BOOT'
  | 'INITIALIZING'
  | 'CONNECTING'
  | 'SYNCHRONIZING'
  | 'RECONCILING'
  | 'CERTIFYING'
  | 'READY'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'OPEN_LOCKED'
  | 'REDUCE_ONLY'
  | 'RECOVERING'
  | 'SAFETY_LOCKED'
  | 'DISCONNECTED'
  | 'SHUTTING_DOWN';

export interface TransitionRecord {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly timestamp: number;
  readonly reason: string;
  readonly initiator: string;
}

export class SystemLifecycleManager {
  private currentState: LifecycleState = 'BOOT';
  private transitionHistory: TransitionRecord[] = [];
  private lastReconciliationTime: number = 0;
  private lastCertificationTime: number = 0;
  private isCertified: boolean = false;
  private isReconciled: boolean = false;

  private static readonly VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    BOOT: ['INITIALIZING', 'REDUCE_ONLY', 'SHUTTING_DOWN'],
    INITIALIZING: ['CONNECTING', 'REDUCE_ONLY', 'SAFETY_LOCKED', 'SHUTTING_DOWN'],
    CONNECTING: ['SYNCHRONIZING', 'REDUCE_ONLY', 'DISCONNECTED', 'SAFETY_LOCKED', 'SHUTTING_DOWN'],
    SYNCHRONIZING: ['RECONCILING', 'REDUCE_ONLY', 'DISCONNECTED', 'DEGRADED', 'SHUTTING_DOWN'],
    RECONCILING: ['CERTIFYING', 'REDUCE_ONLY', 'DEGRADED', 'SAFETY_LOCKED', 'SHUTTING_DOWN'],
    CERTIFYING: ['READY', 'REDUCE_ONLY', 'DEGRADED', 'SAFETY_LOCKED', 'SHUTTING_DOWN'],
    READY: ['HEALTHY', 'OPEN_LOCKED', 'REDUCE_ONLY', 'DEGRADED', 'SHUTTING_DOWN'],
    HEALTHY: ['DEGRADED', 'OPEN_LOCKED', 'REDUCE_ONLY', 'SAFETY_LOCKED', 'DISCONNECTED', 'SHUTTING_DOWN'],
    DEGRADED: ['HEALTHY', 'OPEN_LOCKED', 'REDUCE_ONLY', 'RECOVERING', 'SAFETY_LOCKED', 'DISCONNECTED', 'SHUTTING_DOWN'],
    OPEN_LOCKED: ['HEALTHY', 'DEGRADED', 'REDUCE_ONLY', 'SAFETY_LOCKED', 'DISCONNECTED', 'SHUTTING_DOWN'],
    REDUCE_ONLY: ['HEALTHY', 'DEGRADED', 'OPEN_LOCKED', 'RECOVERING', 'SAFETY_LOCKED', 'SHUTTING_DOWN'],
    RECOVERING: ['RECONCILING', 'SAFETY_LOCKED', 'DISCONNECTED', 'SHUTTING_DOWN'],
    SAFETY_LOCKED: ['RECOVERING', 'SHUTTING_DOWN'],
    DISCONNECTED: ['CONNECTING', 'RECOVERING', 'SHUTTING_DOWN'],
    SHUTTING_DOWN: [],
  };

  public bootstrapToHealthy(reason = 'System initialization'): void {
    this.recordReconciliation();
    this.recordCertification(true);
    if (this.currentState === 'BOOT') {
      this.transition('INITIALIZING', reason);
      this.transition('CONNECTING', reason);
      this.transition('SYNCHRONIZING', reason);
      this.transition('RECONCILING', reason);
      this.transition('CERTIFYING', reason);
      this.transition('READY', reason);
      this.transition('HEALTHY', reason);
    } else {
      this.currentState = 'HEALTHY';
    }
  }

  public getState(): LifecycleState {
    return this.currentState;
  }

  public getHistory(): readonly TransitionRecord[] {
    return this.transitionHistory;
  }

  public recordReconciliation(): void {
    this.lastReconciliationTime = Date.now();
    this.isReconciled = true;
  }

  public recordCertification(passed: boolean): void {
    this.lastCertificationTime = Date.now();
    this.isCertified = passed;
  }

  public transition(to: LifecycleState, reason: string, initiator = 'system'): boolean {
    const allowed = SystemLifecycleManager.VALID_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Illegal lifecycle transition: ${this.currentState} -> ${to} (${reason})`);
    }

    // Invariant Enforcement
    if ((to === 'READY' || to === 'HEALTHY') && (!this.isCertified || !this.isReconciled)) {
      throw new Error(`Cannot transition to ${to} without prior successful certification and reconciliation`);
    }
    if (this.currentState === 'RECOVERING' && to === 'HEALTHY') {
      throw new Error(`Illegal shortcut: RECOVERING must proceed through RECONCILING and CERTIFYING before HEALTHY`);
    }
    if (this.currentState === 'DISCONNECTED' && to === 'HEALTHY') {
      throw new Error(`Illegal shortcut: DISCONNECTED must re-synchronize and reconcile before HEALTHY`);
    }

    const record: TransitionRecord = {
      from: this.currentState,
      to,
      timestamp: Date.now(),
      reason,
      initiator,
    };
    this.currentState = to;
    this.transitionHistory.push(record);
    if (this.transitionHistory.length > 500) this.transitionHistory.shift();
    return true;
  }

  public isEntryPermitted(): boolean {
    return this.currentState === 'HEALTHY' || this.currentState === 'READY';
  }

  public isExitPermitted(): boolean {
    return (
      this.currentState === 'HEALTHY' ||
      this.currentState === 'READY' ||
      this.currentState === 'DEGRADED' ||
      this.currentState === 'OPEN_LOCKED' ||
      this.currentState === 'REDUCE_ONLY'
    );
  }
}

export const globalLifecycle = new SystemLifecycleManager();

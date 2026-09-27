/**
 * SYLPH FUSION — ORCHESTRA-X: Conflict-Aware Execution Scheduler
 * Specifications: Sections 34 (Lanes), 35 (CancelTree), 36 (Faraday LockGraph), 103 (Invariant 17)
 *
 * Replaces monolithic single-slot execution locking with prioritized execution lanes:
 * EMERGENCY_CLOSE (0) > CLOSE (1) > REDUCE (2) > OPEN (3) > INCREASE (4)
 *
 * Distinguishes economic conflicts (shared writable accounts) from network contention,
 * allowing non-interfering token executions to run concurrently.
 * Enforces CancelTree hierarchy and non-negotiable incident asymmetry:
 * Risk-increasing operations NEVER block an emergency exit.
 */

export type ExecutionLanePriority = 0 | 1 | 2 | 3 | 4;

export type ExecutionActionLane =
  | 'EMERGENCY_CLOSE' // Priority 0
  | 'CLOSE'           // Priority 1
  | 'REDUCE'          // Priority 2
  | 'OPEN'            // Priority 3
  | 'INCREASE';       // Priority 4

export const LANE_PRIORITIES: Record<ExecutionActionLane, ExecutionLanePriority> = {
  EMERGENCY_CLOSE: 0,
  CLOSE: 1,
  REDUCE: 2,
  OPEN: 3,
  INCREASE: 4,
};

export interface LockFingerprint {
  readonly transactionId: string;
  readonly mint: string;
  readonly lane: ExecutionActionLane;
  readonly writableAccounts: ReadonlySet<string>;
  readonly readOnlyAccounts: ReadonlySet<string>;
}

export type CancelTreeScope = 'SYSTEM' | 'STRATEGY' | 'TOKEN' | 'INTENT' | 'SIMULATION';

export class CancelTreeNode {
  private controller: AbortController = new AbortController();
  private children = new Map<string, CancelTreeNode>();

  constructor(readonly scope: CancelTreeScope, readonly id: string) {}

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get isAborted(): boolean {
    return this.controller.signal.aborted;
  }

  public createChild(scope: CancelTreeScope, childId: string): CancelTreeNode {
    const existing = this.children.get(childId);
    if (existing) return existing;

    const child = new CancelTreeNode(scope, childId);
    this.children.set(childId, child);

    // If parent is already aborted, immediately abort child
    if (this.controller.signal.aborted) {
      child.abort('Parent scope already cancelled');
    }

    return child;
  }

  public getChild(childId: string): CancelTreeNode | undefined {
    return this.children.get(childId);
  }

  public abort(reason: string): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(reason);
      for (const child of this.children.values()) {
        child.abort(reason);
      }
    }
  }

  public prune(childId: string): void {
    this.children.delete(childId);
  }
}

export interface InFlightTask {
  readonly taskId: string;
  readonly mint: string;
  readonly lane: ExecutionActionLane;
  readonly fingerprint: LockFingerprint;
  readonly submittedAtMs: number;
  readonly cancelNode: CancelTreeNode;
}

export class OrchestraXScheduler {
  private inFlightTasks = new Map<string, InFlightTask>();
  private rootCancelTree: CancelTreeNode = new CancelTreeNode('SYSTEM', 'ROOT');

  public getRootCancelTree(): CancelTreeNode {
    return this.rootCancelTree;
  }

  public getInFlightCount(): number {
    return this.inFlightTasks.size;
  }

  public getInFlightForMint(mint: string): InFlightTask | undefined {
    for (const task of this.inFlightTasks.values()) {
      if (task.mint === mint) return task;
    }
    return undefined;
  }

  /**
   * Evaluates Faraday lock conflicts:
   * Returns true if candidate's writable accounts conflict with any active task's writable/read accounts.
   */
  public hasLockConflict(candidate: LockFingerprint): {
    readonly hasConflict: boolean;
    readonly conflictingTaskId?: string;
    readonly conflictingAccount?: string;
  } {
    for (const task of this.inFlightTasks.values()) {
      const active = task.fingerprint;

      // Check writable-writable intersection
      for (const wAccount of candidate.writableAccounts) {
        if (active.writableAccounts.has(wAccount)) {
          return { hasConflict: true, conflictingTaskId: task.taskId, conflictingAccount: wAccount };
        }
        if (active.readOnlyAccounts.has(wAccount)) {
          return { hasConflict: true, conflictingTaskId: task.taskId, conflictingAccount: wAccount };
        }
      }

      // Check candidate read against active write
      for (const rAccount of candidate.readOnlyAccounts) {
        if (active.writableAccounts.has(rAccount)) {
          return { hasConflict: true, conflictingTaskId: task.taskId, conflictingAccount: rAccount };
        }
      }
    }

    return { hasConflict: false };
  }

  /**
   * Schedules a task into an execution lane.
   * Enforces priority scheduling:
   * - EMERGENCY_CLOSE immediately aborts any non-emergency pending task for that mint.
   * - Non-conflicting tokens execute concurrently.
   * - Conflicting accounts are rejected or queued.
   */
  public schedule(params: {
    taskId: string;
    mint: string;
    lane: ExecutionActionLane;
    writableAccounts: readonly string[];
    readOnlyAccounts?: readonly string[];
  }): {
    readonly admitted: boolean;
    readonly cancelSignal: AbortSignal;
    readonly reason: string;
  } {
    const { taskId, mint, lane, writableAccounts } = params;
    const readOnlyAccounts = params.readOnlyAccounts ?? [];

    const fingerprint: LockFingerprint = {
      transactionId: taskId,
      mint,
      lane,
      writableAccounts: new Set(writableAccounts),
      readOnlyAccounts: new Set(readOnlyAccounts),
    };

    const priority = LANE_PRIORITIES[lane];

    // Check if an existing task for this mint is active
    const existing = this.getInFlightForMint(mint);
    if (existing) {
      const existingPriority = LANE_PRIORITIES[existing.lane];

      if (priority === 0 && existingPriority > 0) {
        // EMERGENCY_CLOSE preempts any lower-priority task
        existing.cancelNode.abort(`Preempted by EMERGENCY_CLOSE for mint ${mint}`);
        this.inFlightTasks.delete(existing.taskId);
      } else {
        return {
          admitted: false,
          cancelSignal: new AbortController().signal,
          reason: `LANE_CONTENTION: Mint ${mint} already has an active task ${existing.taskId} in lane ${existing.lane}`,
        };
      }
    }

    // Check Faraday lock conflict across all active transactions
    const conflict = this.hasLockConflict(fingerprint);
    if (conflict.hasConflict) {
      if (priority === 0) {
        // For emergency close, abort the conflicting non-emergency task
        const conflictingTask = this.inFlightTasks.get(conflict.conflictingTaskId!);
        if (conflictingTask && LANE_PRIORITIES[conflictingTask.lane] > 0) {
          conflictingTask.cancelNode.abort(`Preempted by conflicting EMERGENCY_CLOSE`);
          this.inFlightTasks.delete(conflictingTask.taskId);
        } else {
          return {
            admitted: false,
            cancelSignal: new AbortController().signal,
            reason: `LOCK_CONFLICT: Writable lock conflict on account ${conflict.conflictingAccount} with emergency task ${conflict.conflictingTaskId}`,
          };
        }
      } else {
        return {
          admitted: false,
          cancelSignal: new AbortController().signal,
          reason: `FARADAY_LOCK_CONFLICT: Account ${conflict.conflictingAccount} locked by active task ${conflict.conflictingTaskId}`,
        };
      }
    }

    // Build CancelTreeNode hierarchy
    const tokenNode = this.rootCancelTree.createChild('TOKEN', mint);
    const intentNode = tokenNode.createChild('INTENT', taskId);

    const task: InFlightTask = {
      taskId,
      mint,
      lane,
      fingerprint,
      submittedAtMs: Date.now(),
      cancelNode: intentNode,
    };

    this.inFlightTasks.set(taskId, task);

    return {
      admitted: true,
      cancelSignal: intentNode.signal,
      reason: `Admitted to execution lane ${lane} (Priority ${priority})`,
    };
  }

  /**
   * Releases an execution slot upon fill or finalized confirmation.
   */
  public release(taskId: string): void {
    const task = this.inFlightTasks.get(taskId);
    if (task) {
      const tokenNode = this.rootCancelTree.getChild(task.mint);
      if (tokenNode) {
        tokenNode.prune(taskId);
      }
      this.inFlightTasks.delete(taskId);
    }
  }
}

export const globalOrchestraX = new OrchestraXScheduler();

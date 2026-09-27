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
export const LANE_PRIORITIES = {
    EMERGENCY_CLOSE: 0,
    CLOSE: 1,
    REDUCE: 2,
    OPEN: 3,
    INCREASE: 4,
};
export class CancelTreeNode {
    scope;
    id;
    controller = new AbortController();
    children = new Map();
    constructor(scope, id) {
        this.scope = scope;
        this.id = id;
    }
    get signal() {
        return this.controller.signal;
    }
    get isAborted() {
        return this.controller.signal.aborted;
    }
    createChild(scope, childId) {
        const existing = this.children.get(childId);
        if (existing)
            return existing;
        const child = new CancelTreeNode(scope, childId);
        this.children.set(childId, child);
        // If parent is already aborted, immediately abort child
        if (this.controller.signal.aborted) {
            child.abort('Parent scope already cancelled');
        }
        return child;
    }
    getChild(childId) {
        return this.children.get(childId);
    }
    abort(reason) {
        if (!this.controller.signal.aborted) {
            this.controller.abort(reason);
            for (const child of this.children.values()) {
                child.abort(reason);
            }
        }
    }
    prune(childId) {
        this.children.delete(childId);
    }
}
export class OrchestraXScheduler {
    inFlightTasks = new Map();
    rootCancelTree = new CancelTreeNode('SYSTEM', 'ROOT');
    getRootCancelTree() {
        return this.rootCancelTree;
    }
    getInFlightCount() {
        return this.inFlightTasks.size;
    }
    getInFlightForMint(mint) {
        for (const task of this.inFlightTasks.values()) {
            if (task.mint === mint)
                return task;
        }
        return undefined;
    }
    /**
     * Evaluates Faraday lock conflicts:
     * Returns true if candidate's writable accounts conflict with any active task's writable/read accounts.
     */
    hasLockConflict(candidate) {
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
    schedule(params) {
        const { taskId, mint, lane, writableAccounts } = params;
        const readOnlyAccounts = params.readOnlyAccounts ?? [];
        const fingerprint = {
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
            }
            else {
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
                const conflictingTask = this.inFlightTasks.get(conflict.conflictingTaskId);
                if (conflictingTask && LANE_PRIORITIES[conflictingTask.lane] > 0) {
                    conflictingTask.cancelNode.abort(`Preempted by conflicting EMERGENCY_CLOSE`);
                    this.inFlightTasks.delete(conflictingTask.taskId);
                }
                else {
                    return {
                        admitted: false,
                        cancelSignal: new AbortController().signal,
                        reason: `LOCK_CONFLICT: Writable lock conflict on account ${conflict.conflictingAccount} with emergency task ${conflict.conflictingTaskId}`,
                    };
                }
            }
            else {
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
        const task = {
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
    release(taskId) {
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
//# sourceMappingURL=orchestra-x.js.map
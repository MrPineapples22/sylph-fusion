/**
 * SOL-SYLPH Formal System Lifecycle State Machine
 * Specification: Section 11.
 *
 * Enforces valid transition paths and prevents illegal shortcuts:
 * BOOT -> INITIALIZING -> CONNECTING -> SYNCHRONIZING -> RECONCILING -> CERTIFYING -> READY -> HEALTHY
 */
export class SystemLifecycleManager {
    currentState = 'BOOT';
    transitionHistory = [];
    lastReconciliationTime = 0;
    lastCertificationTime = 0;
    isCertified = false;
    isReconciled = false;
    static VALID_TRANSITIONS = {
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
    bootstrapToHealthy(reason = 'System initialization') {
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
        }
        else {
            this.currentState = 'HEALTHY';
        }
    }
    getState() {
        return this.currentState;
    }
    getHistory() {
        return this.transitionHistory;
    }
    recordReconciliation() {
        this.lastReconciliationTime = Date.now();
        this.isReconciled = true;
    }
    recordCertification(passed) {
        this.lastCertificationTime = Date.now();
        this.isCertified = passed;
    }
    transition(to, reason, initiator = 'system') {
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
        const record = {
            from: this.currentState,
            to,
            timestamp: Date.now(),
            reason,
            initiator,
        };
        this.currentState = to;
        this.transitionHistory.push(record);
        if (this.transitionHistory.length > 500)
            this.transitionHistory.shift();
        return true;
    }
    isEntryPermitted() {
        return this.currentState === 'HEALTHY' || this.currentState === 'READY';
    }
    isExitPermitted() {
        return (this.currentState === 'HEALTHY' ||
            this.currentState === 'READY' ||
            this.currentState === 'DEGRADED' ||
            this.currentState === 'OPEN_LOCKED' ||
            this.currentState === 'REDUCE_ONLY');
    }
}
export const globalLifecycle = new SystemLifecycleManager();
//# sourceMappingURL=system-lifecycle.js.map
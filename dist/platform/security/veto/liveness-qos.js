/**
 * PHASE 37 & 38 — VETO-LIVENESS & VETO-QOS
 *
 * Implements:
 * - LivenessScheduler: Explicit wake triggers for WAIT decisions; timeout to ARCHIVED_UNRESOLVED
 * - VetoQoSController: Priority-ranked evaluation capacity; ProofCostEnvelope budget exhaustion yields UNKNOWN
 */
export class VetoLivenessScheduler {
    pendingWaits = new Map();
    key(subject) {
        return `${subject.clusterGenesisHash}:${subject.mint}`;
    }
    registerWait(subject, waitingFor, maxWaitDurationMs = 30_000, decisionGeneration = 0n) {
        this.pendingWaits.set(this.key(subject), {
            subject,
            waitingFor,
            registeredAtUnixMs: Date.now(),
            maxWaitDurationMs,
            decisionGeneration,
        });
    }
    notifyTrigger(trigger) {
        const awoken = [];
        for (const [key, wait] of this.pendingWaits.entries()) {
            if (wait.waitingFor.includes(trigger)) {
                awoken.push(wait.subject);
                this.pendingWaits.delete(key);
            }
        }
        return awoken;
    }
    sweepTimeouts() {
        const now = Date.now();
        const timeouts = [];
        for (const [key, wait] of this.pendingWaits.entries()) {
            if (now - wait.registeredAtUnixMs > wait.maxWaitDurationMs) {
                timeouts.push({ subject: wait.subject, status: 'ARCHIVED_UNRESOLVED' });
                this.pendingWaits.delete(key);
            }
        }
        return timeouts;
    }
}
export class VetoQosController {
    inFlightVerifications = 0;
    maxConcurrentVerifications;
    constructor(maxConcurrentVerifications = 16) {
        this.maxConcurrentVerifications = maxConcurrentVerifications;
    }
    canAdmitVerification() {
        return this.inFlightVerifications < this.maxConcurrentVerifications;
    }
    acquireSlot() {
        if (this.canAdmitVerification()) {
            this.inFlightVerifications++;
            return true;
        }
        return false;
    }
    releaseSlot() {
        if (this.inFlightVerifications > 0) {
            this.inFlightVerifications--;
        }
    }
    /**
     * Evaluates if a ProofCostEnvelope is within safety margins.
     * If budget is exhausted, MUST yield UNKNOWN, never FAIL!
     */
    evaluateCostBudget(envelope, actualElapsedMs, actualRootsCount) {
        if (actualElapsedMs > envelope.maxExecutionTimeMs || actualRootsCount > envelope.maxEvidenceRoots) {
            return { withinBudget: false, fallbackDisposition: 'UNKNOWN' };
        }
        return { withinBudget: true, fallbackDisposition: 'UNKNOWN' };
    }
}
//# sourceMappingURL=liveness-qos.js.map
/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: ATTEMPT RECORDING
 * Specifications: Master Blueprint Section XX (Execution Adaptation-X)
 *
 * Invariant: Record EVERY execution attempt across all terminal and intermediate outcomes.
 * Never train models solely on landed transactions (selection/survivorship hazard).
 */
export class ExecutionAttemptLedger {
    attempts = [];
    recordAttempt(attempt) {
        this.attempts.push(attempt);
    }
    getAllAttempts() {
        return Object.freeze([...this.attempts]);
    }
    getAttemptsByOutcome(outcome) {
        return Object.freeze(this.attempts.filter((a) => a.outcome === outcome));
    }
}
//# sourceMappingURL=execution-attempt-record.js.map
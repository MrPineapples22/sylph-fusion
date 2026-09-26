/**
 * SOL-SYLPH State Epochs & Fencing Tokens
 * Blueprint Part LXVIII & Phase 2
 *
 * Every critical state mutation increments a state epoch/version.
 * Background tasks carry fencing tokens. Stale tasks must not:
 * overwrite newer state, issue permits, execute, or modify risk reservations.
 */
export class StateEpochEngine {
    currentEpoch = 1;
    activeFences = new Map();
    getCurrentEpoch() {
        return this.currentEpoch;
    }
    incrementEpoch(reason) {
        this.currentEpoch += 1;
        return this.currentEpoch;
    }
    issueFencingToken(taskId, operation) {
        const token = {
            epoch: this.currentEpoch,
            issuedAtMs: Date.now(),
            taskId,
            operation,
        };
        this.activeFences.set(taskId, token);
        return token;
    }
    validateFencingToken(token) {
        if (token.epoch < this.currentEpoch) {
            return {
                valid: false,
                currentEpoch: this.currentEpoch,
                reason: `FENCING_VIOLATION: Token epoch ${token.epoch} is stale compared to current epoch ${this.currentEpoch}`,
            };
        }
        if (Date.now() - token.issuedAtMs > 10000) {
            return {
                valid: false,
                currentEpoch: this.currentEpoch,
                reason: `FENCING_TIMEOUT: Token expired (${Date.now() - token.issuedAtMs}ms old)`,
            };
        }
        return { valid: true, currentEpoch: this.currentEpoch };
    }
}
//# sourceMappingURL=state-epochs.js.map
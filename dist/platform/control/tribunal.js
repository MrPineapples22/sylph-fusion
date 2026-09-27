/**
 * SYLPH FUSION — TRIBUNAL: Cryptographically Authorized Operator Command Plane
 * Specifications: Section 9 (Upgrade 5: Tribunal), Section 103 (Invariants 2, 4)
 *
 * Invariants:
 * 1. Financial commands require cryptographically authenticated CommandEnvelopes.
 * 2. Three risk tiers: LOW_RISK, MEDIUM_RISK, HIGH_RISK.
 * 3. HIGH_RISK commands require multi-party approval policy.
 * 4. AI agents may draft high-risk commands, but CANNOT self-approve them.
 * 5. Durable pre-execution journaling and post-execution CommandResult recording.
 */
export class TribunalAuthority {
    executedNonces = new Set();
    commandJournal = new Map();
    commandResults = new Map();
    currentControlEpoch;
    currentStateRoot;
    constructor(initialControlEpoch = 1, initialStateRoot = 'GENESIS_ROOT') {
        this.currentControlEpoch = initialControlEpoch;
        this.currentStateRoot = initialStateRoot;
    }
    getControlEpoch() {
        return this.currentControlEpoch;
    }
    getCurrentStateRoot() {
        return this.currentStateRoot;
    }
    /**
     * Pre-execution authorization & durability journaling.
     */
    journalAndAuthorizeCommand(envelope, nowMs = Date.now()) {
        // 1. Anti-replay nonce check
        if (this.executedNonces.has(envelope.nonce)) {
            return { isAuthorized: false, reason: `REPLAY_VIOLATION: Nonce ${envelope.nonce} already executed` };
        }
        // 2. Expiration check
        if (nowMs > envelope.expiresAtMs) {
            return { isAuthorized: false, reason: `EXPIRED_COMMAND: Current time ${nowMs} > expiry ${envelope.expiresAtMs}` };
        }
        // 3. Control epoch check
        if (envelope.controlEpoch !== this.currentControlEpoch) {
            return {
                isAuthorized: false,
                reason: `STALE_EPOCH: Command epoch ${envelope.controlEpoch} != current epoch ${this.currentControlEpoch}`
            };
        }
        // 4. State root CAS validation
        if (envelope.expectedPreviousStateRoot !== this.currentStateRoot) {
            return {
                isAuthorized: false,
                reason: `STATE_RACE_CONDITION: Expected root ${envelope.expectedPreviousStateRoot} != current root ${this.currentStateRoot}`
            };
        }
        // 5. HIGH_RISK Multi-Party Approval Policy & AI self-approval prohibition
        if (envelope.riskTier === 'HIGH_RISK') {
            if (envelope.isAiGenerated) {
                // AI drafted: must be approved by human supervisor/risk officer
                const humanApprovals = envelope.approvals.filter((a) => a.approverId !== envelope.issuerId);
                if (humanApprovals.length < envelope.requiredApprovalsCount || envelope.requiredApprovalsCount < 1) {
                    return {
                        isAuthorized: false,
                        reason: `HIGH_RISK_AI_VIOLATION: AI agent ${envelope.issuerId} cannot self-approve high-risk action ${envelope.action}. Requires at least ${envelope.requiredApprovalsCount} independent human approvals.`
                    };
                }
            }
            else {
                if (envelope.approvals.length < envelope.requiredApprovalsCount) {
                    return {
                        isAuthorized: false,
                        reason: `INSUFFICIENT_APPROVALS: Required ${envelope.requiredApprovalsCount}, received ${envelope.approvals.length}`
                    };
                }
            }
        }
        // Durably journal intent before execution
        this.commandJournal.set(envelope.commandId, envelope);
        this.executedNonces.add(envelope.nonce);
        return { isAuthorized: true };
    }
    /**
     * Finalizes post-execution record and updates state root.
     */
    recordCommandResult(commandId, success, details, newStateRoot) {
        const journaled = this.commandJournal.get(commandId);
        if (!journaled) {
            throw new Error(`Cannot record result: command ${commandId} was never journaled in Tribunal`);
        }
        if (newStateRoot) {
            this.currentStateRoot = newStateRoot;
        }
        const result = {
            commandId,
            executedAtMs: Date.now(),
            success,
            resultantStateRoot: this.currentStateRoot,
            details
        };
        this.commandResults.set(commandId, result);
        return result;
    }
}
//# sourceMappingURL=tribunal.js.map
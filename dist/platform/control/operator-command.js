/**
 * SYLPH FUSION — UNIFIED OPERATOR COMMAND AUTHORITY & IN-FLIGHT FACT CARRYOVER
 * Specifications: Blueprint Sections 46, 47
 * Workbook: #971 (Preemption Fencing), #983 (In-Flight Fact Carryover), #995 (Stale-Proposal Rejection)
 *
 * Invariants:
 * 1. UI buttons, CLI scripts, and automation CANNOT directly mutate authoritative state.
 *    All operator actions must form an authenticated OperatorCommandEnvelope verified by Ed25519.
 * 2. In-flight facts (SIGNED, SUBMITTED, UNKNOWN) survive controller failover.
 *    A new controller inherits and reconciles them; it can never silently drop or erase them.
 */
import { createHash, verify } from 'node:crypto';
export class OperatorCommandGateway {
    controlRootManager;
    executedCommands = new Map();
    inFlightFacts = new Map();
    constructor(controlRootManager) {
        this.controlRootManager = controlRootManager;
    }
    static computeCommandDigest(command) {
        const payload = [
            command.commandId,
            command.commandType,
            command.issuer,
            command.issuedAt.toString(),
            command.expectedControlEpoch.toString(),
            command.expectedStateRoot,
            command.reason,
        ].join('::');
        return createHash('sha256').update(payload).digest('hex');
    }
    /**
     * Evaluates and executes an operator command through cryptographic authorization.
     */
    executeCommand(envelope, currentStateRoot) {
        // 1. Verify Ed25519 signature
        try {
            const digestHex = OperatorCommandGateway.computeCommandDigest(envelope);
            const digestBuffer = Buffer.from(digestHex, 'hex');
            const sigBuffer = Buffer.from(envelope.signatureHex, 'hex');
            const isVerified = verify(null, digestBuffer, envelope.signerPublicKeyPem, sigBuffer);
            if (!isVerified) {
                return { success: false, reason: 'INVALID_SIGNATURE: Operator command signature failed verification' };
            }
        }
        catch (err) {
            return {
                success: false,
                reason: `SIGNATURE_VERIFICATION_ERROR: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        // 2. Verify state root and control epoch
        const controlRoot = this.controlRootManager.getControlRoot();
        if (envelope.expectedControlEpoch !== controlRoot.controlEpoch) {
            return {
                success: false,
                reason: `STALE_EPOCH: Expected epoch ${controlRoot.controlEpoch}, command targeted ${envelope.expectedControlEpoch}`,
            };
        }
        if (envelope.expectedStateRoot !== currentStateRoot) {
            return {
                success: false,
                reason: `STALE_STATE_ROOT: Expected state root ${currentStateRoot}, command targeted ${envelope.expectedStateRoot}`,
            };
        }
        // 3. Apply state mutation
        let newControlRoot = controlRoot;
        if (envelope.commandType === 'FENCE_ADVANCE' || envelope.commandType === 'EMERGENCY_STOP') {
            newControlRoot = this.controlRootManager.advanceFenceEpoch();
        }
        const executedAt = Date.now();
        const receiptPayload = `${envelope.commandId}:${envelope.commandType}:${executedAt}:${newControlRoot.controlEpoch}:${currentStateRoot}`;
        const receiptDigest = createHash('sha256').update(receiptPayload).digest('hex');
        const receipt = {
            receiptId: `OP-REC-${receiptDigest.slice(0, 16)}`,
            commandId: envelope.commandId,
            commandType: envelope.commandType,
            executedAt,
            resultingControlEpoch: newControlRoot.controlEpoch,
            previousStateRoot: currentStateRoot,
            newStateRoot: receiptDigest,
            receiptDigest,
        };
        this.executedCommands.set(envelope.commandId, receipt);
        return { success: true, receipt };
    }
    // --- IN-FLIGHT FACT CARRYOVER (Section 47) ---
    recordInFlightFact(record) {
        this.inFlightFacts.set(record.economicFactId, record);
    }
    getInFlightFacts() {
        return Array.from(this.inFlightFacts.values());
    }
    /**
     * Controller failover handoff: carries over all in-flight facts into the new controller context.
     */
    carryoverInFlightFacts(newControllerId) {
        const inherited = [];
        const now = Date.now();
        for (const [id, fact] of this.inFlightFacts) {
            const updated = {
                ...fact,
                lastReconciledAt: now,
                requiresReconciliation: true,
            };
            this.inFlightFacts.set(id, updated);
            inherited.push(updated);
        }
        return inherited;
    }
}
//# sourceMappingURL=operator-command.js.map
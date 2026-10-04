/**
 * SYLPH FUSION — CONTROLROOT, COMMANDSEAL & CONFIGSEAL
 * Specifications: Sections 44 (ControlRoot), 45 (CommandSeal), 46 (ConfigSeal), 103 (Invariants 2, 4)
 *
 * Invariants:
 * 1. NO EXECUTION WITHOUT AN ECONOMIC INTENT (Invariant 2).
 * 2. NO STALE FENCE CAN SIGN (Invariant 4).
 * 3. All consequential commands require a signed CommandEnvelope with anti-replay nonce,
 *    operator role, fence epoch, config root, and expected state root.
 * 4. No caller-provided string (like `requestedBy`) is sufficient authentication.
 * 5. ConfigurationBundle is hashed; permits issued under old config are invalidated.
 */
import { createHash, createHmac } from 'node:crypto';
export function createConfigSeal(configEpoch, bundle) {
    const serialized = JSON.stringify(bundle);
    const bundleHash = createHash('sha256').update(serialized).digest('hex');
    return {
        configEpoch,
        bundle,
        bundleHash,
        sealedAtMs: Date.now()
    };
}
export function signCommandEnvelope(params, signingKey) {
    const payloadHash = createHash('sha256').update(JSON.stringify(params.payload)).digest('hex');
    const digestPayload = `${params.commandId}:${params.operatorId}:${params.role}:${params.action}:${payloadHash}:${params.issuedAtMs}:${params.expiresAtMs}:${params.nonce}:${params.controlEpoch}:${params.fenceEpoch}:${params.releaseRoot}:${params.configRoot}:${params.expectedStateRoot}`;
    const envelopeDigest = createHash('sha256').update(digestPayload).digest('hex');
    const signature = createHmac('sha256', signingKey).update(envelopeDigest).digest('hex');
    return {
        ...params,
        payloadHash,
        signature,
        envelopeDigest
    };
}
export class ControlRootKernel {
    controlEpoch = 1;
    currentFenceEpoch;
    activeConfigSeal;
    currentReleaseRoot;
    seenNonces = new Set();
    registeredOperators = new Map();
    constructor(params) {
        this.currentFenceEpoch = params.initialFenceEpoch;
        this.activeConfigSeal = params.initialConfigSeal;
        this.currentReleaseRoot = params.currentReleaseRoot;
    }
    registerOperator(operator) {
        this.registeredOperators.set(operator.operatorId, operator);
    }
    advanceFenceEpoch(newFenceEpoch) {
        if (newFenceEpoch <= this.currentFenceEpoch) {
            throw new Error(`Cannot regress fence epoch from ${this.currentFenceEpoch} to ${newFenceEpoch}`);
        }
        this.currentFenceEpoch = newFenceEpoch;
    }
    updateConfiguration(newBundle) {
        const nextEpoch = this.activeConfigSeal.configEpoch + 1;
        this.activeConfigSeal = createConfigSeal(nextEpoch, newBundle);
        return this.activeConfigSeal;
    }
    getActiveConfigSeal() {
        return this.activeConfigSeal;
    }
    getFenceEpoch() {
        return this.currentFenceEpoch;
    }
    /**
     * Authoritative Command Envelope Verification & Anti-Replay Validation
     * Specifications: Section LVIII (Command Seal Fix)
     */
    verifyAndAuthorizeCommand(envelope, currentStateRoot, nowMs) {
        // 1. Recompute payloadHash
        const recomputedPayloadHash = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
        if (envelope.payloadHash !== recomputedPayloadHash) {
            return {
                authorized: false,
                reason: `PAYLOAD_HASH_MISMATCH: Embedded payloadHash ${envelope.payloadHash} does not match computed ${recomputedPayloadHash}`
            };
        }
        // 2. Reconstruct canonical envelope digest
        const digestPayload = `${envelope.commandId}:${envelope.operatorId}:${envelope.role}:${envelope.action}:${recomputedPayloadHash}:${envelope.issuedAtMs}:${envelope.expiresAtMs}:${envelope.nonce}:${envelope.controlEpoch}:${envelope.fenceEpoch}:${envelope.releaseRoot}:${envelope.configRoot}:${envelope.expectedStateRoot}`;
        const reconstructedDigest = createHash('sha256').update(digestPayload).digest('hex');
        // 3. Ensure reconstructed digest equals embedded digest
        if (reconstructedDigest !== envelope.envelopeDigest) {
            return {
                authorized: false,
                reason: `ENVELOPE_DIGEST_MISMATCH: Embedded digest ${envelope.envelopeDigest} does not match reconstructed ${reconstructedDigest}`
            };
        }
        // 4. Verify Operator Identity & Role
        const operator = this.registeredOperators.get(envelope.operatorId);
        if (!operator) {
            return { authorized: false, reason: `Unknown operatorId: ${envelope.operatorId}` };
        }
        if (operator.role !== envelope.role) {
            return { authorized: false, reason: `Operator role mismatch: expected ${operator.role}, received ${envelope.role}` };
        }
        // 5. Verify Digital Signature against Reconstructed Digest (never against caller-supplied digest alone)
        const expectedSig = createHmac('sha256', operator.secretOrKey).update(reconstructedDigest).digest('hex');
        if (expectedSig !== envelope.signature) {
            return { authorized: false, reason: 'INVALID_SIGNATURE: Command cryptographic envelope signature verification failed' };
        }
        // 6. Anti-Replay Nonce Check
        if (this.seenNonces.has(envelope.nonce)) {
            return { authorized: false, reason: `ANTI-REPLAY VIOLATION: Nonce ${envelope.nonce} has already been executed` };
        }
        // 7. Expiration Check
        if (nowMs > envelope.expiresAtMs) {
            return { authorized: false, reason: `Command expired: current time ${nowMs} > expiry ${envelope.expiresAtMs}` };
        }
        // 8. Epochs & Roots Validation (Section 42 & Invariant 4)
        if (envelope.fenceEpoch !== this.currentFenceEpoch) {
            return {
                authorized: false,
                reason: `STALE FENCE REJECTION: Command fence epoch ${envelope.fenceEpoch} does not match active epoch ${this.currentFenceEpoch}`
            };
        }
        if (envelope.releaseRoot !== this.currentReleaseRoot) {
            return {
                authorized: false,
                reason: `RELEASE ROOT MISMATCH: Command built against ${envelope.releaseRoot}, current release is ${this.currentReleaseRoot}`
            };
        }
        const isRiskIncreasing = envelope.action.startsWith('OPEN') || envelope.action.startsWith('INCREASE');
        if (isRiskIncreasing && envelope.configRoot !== this.activeConfigSeal.bundleHash) {
            return {
                authorized: false,
                reason: `CONFIG STALENESS VIOLATION: Risk-increasing command was authorized under obsolete config root ${envelope.configRoot}`
            };
        }
        if (envelope.expectedStateRoot !== currentStateRoot) {
            return {
                authorized: false,
                reason: `STATE CONFLICT: Expected state root ${envelope.expectedStateRoot}, actual state root ${currentStateRoot}`
            };
        }
        // Mark nonce as executed
        this.seenNonces.add(envelope.nonce);
        return { authorized: true };
    }
}
//# sourceMappingURL=command-seal.js.map
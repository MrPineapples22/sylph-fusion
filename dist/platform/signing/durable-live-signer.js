import { createHash } from 'node:crypto';
export function signingMessageHash(message) {
    return createHash('sha256').update(message).digest('hex');
}
/**
 * Fail-closed bridge between a durable capital grant and an isolated signer.
 * The journal commit always precedes the first call across the signing boundary.
 */
export class DurableLiveSigner {
    signer;
    journal;
    currentControlEpoch;
    now;
    constructor(signer, journal, currentControlEpoch, now = Date.now) {
        this.signer = signer;
        this.journal = journal;
        this.currentControlEpoch = currentControlEpoch;
        this.now = now;
    }
    async sign(grant, message) {
        if (!(message instanceof Uint8Array) || message.byteLength === 0)
            throw new Error('SIGNING_MESSAGE_INVALID');
        // TypeScript readonly does not prevent a caller from mutating inputs while
        // durability is pending. Own both the authorization and bytes before await.
        grant = Object.freeze({ ...grant });
        const authorizedMessage = Buffer.from(message);
        const now = this.now();
        if (!Number.isSafeInteger(now) || now < 0)
            throw new Error('SIGNING_CLOCK_INVALID');
        if (!grant.grantId || !grant.economicIntentId)
            throw new Error('SIGNING_GRANT_IDENTITY_INVALID');
        if (grant.wallet !== this.signer.wallet)
            throw new Error('SIGNING_GRANT_WALLET_MISMATCH');
        if (!Number.isSafeInteger(grant.issuedAtMs) || !Number.isSafeInteger(grant.expiresAtMs) ||
            grant.issuedAtMs > now || grant.expiresAtMs <= now)
            throw new Error('SIGNING_GRANT_STALE');
        if (!Number.isSafeInteger(grant.controlEpoch) || grant.controlEpoch < 0 ||
            grant.controlEpoch !== this.currentControlEpoch())
            throw new Error('SIGNING_GRANT_EPOCH_STALE');
        const messageSha256 = signingMessageHash(authorizedMessage);
        if (grant.messageSha256 !== messageSha256)
            throw new Error('SIGNING_MESSAGE_ALTERED');
        await this.journal.prepareSigningIntent({
            economicIntentId: grant.economicIntentId,
            grantId: grant.grantId,
            wallet: grant.wallet,
            messageSha256,
            controlEpoch: grant.controlEpoch,
            preparedAtMs: now,
        });
        // Recheck authority after the durability boundary: a revocation may race the fsync.
        const signingTime = this.now();
        if (!Number.isSafeInteger(signingTime) || signingTime < now ||
            grant.expiresAtMs <= signingTime || grant.controlEpoch !== this.currentControlEpoch()) {
            throw new Error('SIGNING_GRANT_REVOKED_AFTER_PREPARE');
        }
        const signature = await this.signer.signAuthorizedMessage(authorizedMessage);
        if (!(signature instanceof Uint8Array) || signature.byteLength !== 64)
            throw new Error('SIGNER_RESPONSE_INVALID');
        const committedSignature = Uint8Array.from(signature);
        await this.journal.markSigningIntentSigned(grant.economicIntentId, messageSha256, Buffer.from(committedSignature).toString('base64'));
        return committedSignature;
    }
}
export class KmsSigningStateMachine {
    fenceCoordinator;
    records = new Map();
    constructor(fenceCoordinator) {
        this.fenceCoordinator = fenceCoordinator;
    }
    /**
     * Phase 1: PREPARED (Intent recorded before any KMS communication)
     */
    prepareIntent(params) {
        const { economicIntentId, messageSha256, wallet, fenceEpoch } = params;
        // Invariant 4: No stale fence can sign
        if (!this.fenceCoordinator.isFenceValid(fenceEpoch)) {
            throw new Error(`FENCEGRID_STALE_EPOCH: fenceEpoch ${fenceEpoch} is no longer valid (current ${this.fenceCoordinator.getCurrentFenceEpoch()})`);
        }
        if (this.records.has(economicIntentId)) {
            const existing = this.records.get(economicIntentId);
            if (existing.stage === 'SIGNED') {
                throw new Error(`DUPLICATE_INTENT_ALREADY_SIGNED: intent ${economicIntentId} is already signed`);
            }
            if (existing.stage === 'SIGNING_IN_FLIGHT') {
                throw new Error(`KMS_SIGNING_IN_FLIGHT_CONFLICT: intent ${economicIntentId} is currently dispatched to KMS`);
            }
        }
        const record = {
            economicIntentId,
            messageSha256,
            wallet,
            fenceEpoch,
            stage: 'PREPARED',
            preparedAtMs: Date.now(),
        };
        this.records.set(economicIntentId, record);
        return record;
    }
    /**
     * Phase 2: SIGNING_IN_FLIGHT (Persisted immediately before dispatching to KMS)
     */
    markInFlight(economicIntentId, fenceEpoch) {
        const record = this.records.get(economicIntentId);
        if (!record)
            throw new Error(`UNKNOWN_SIGNING_INTENT: ${economicIntentId}`);
        if (record.stage !== 'PREPARED') {
            throw new Error(`INVALID_STAGE_TRANSITION: Cannot transition ${record.stage} -> SIGNING_IN_FLIGHT`);
        }
        // Double-check fence immediately before remote call
        if (!this.fenceCoordinator.isFenceValid(fenceEpoch)) {
            throw new Error(`FENCEGRID_EPOCH_EXPIRED_PRE_DISPATCH: epoch ${fenceEpoch} expired during prepare`);
        }
        record.stage = 'SIGNING_IN_FLIGHT';
        record.inFlightAtMs = Date.now();
    }
    /**
     * Phase 3: SIGNED (Committed upon durable receipt of signature)
     */
    markSigned(economicIntentId, signatureBase64) {
        const record = this.records.get(economicIntentId);
        if (!record)
            throw new Error(`UNKNOWN_SIGNING_INTENT: ${economicIntentId}`);
        if (record.stage !== 'SIGNING_IN_FLIGHT') {
            throw new Error(`INVALID_STAGE_TRANSITION: Cannot transition ${record.stage} -> SIGNED`);
        }
        record.stage = 'SIGNED';
        record.signatureBase64 = signatureBase64;
        record.signedAtMs = Date.now();
    }
    /**
     * Recovery Protocol: Distinguishes safe retry from ambiguous in-flight signatures (Section 40).
     */
    analyzeRecoveryState(economicIntentId) {
        const record = this.records.get(economicIntentId);
        if (!record) {
            return {
                stage: 'PREPARED',
                canSafeRetry: true,
                requiresOnChainReconciliation: false,
                reason: 'Sign request was never initiated; safe to generate intent',
            };
        }
        if (record.stage === 'PREPARED') {
            return {
                stage: 'PREPARED',
                canSafeRetry: true,
                requiresOnChainReconciliation: false,
                reason: 'Crash occurred before KMS dispatch; safe to re-prepare or abort',
            };
        }
        if (record.stage === 'SIGNING_IN_FLIGHT') {
            // Invariant: Never casually issue a second signature after an ambiguous KMS response
            return {
                stage: 'RECOVERY_AMBIGUOUS',
                canSafeRetry: false,
                requiresOnChainReconciliation: true,
                reason: 'Crash occurred while request was in-flight to KMS. Signature may have landed on-chain. Must reconcile whole wallet before retrying.',
            };
        }
        return {
            stage: 'SIGNED',
            canSafeRetry: false,
            requiresOnChainReconciliation: false,
            reason: 'Signature is already durably persisted',
        };
    }
    getRecord(economicIntentId) {
        return this.records.get(economicIntentId);
    }
}
//# sourceMappingURL=durable-live-signer.js.map
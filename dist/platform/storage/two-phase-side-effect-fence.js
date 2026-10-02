/**
 * SYLPH FUSION — PROCESS-LOCAL SIDE-EFFECT FENCE PROTOTYPE
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1-5).
 *
 * Stores prepare/commit records in volatile Maps. It performs no database commit,
 * external dispatch, durable recovery or cross-process exclusion. Result digests
 * do not preserve recoverable result bytes; callers own external invocation.
 *
 * Intended future adapter contract: durable claim -> external call -> durable result.
 * External calls must stay outside PostgreSQL 40001 transaction-retry closures;
 * this helper does not implement or verify that database contract.
 */
import { createHash, randomUUID } from 'node:crypto';
export class TwoPhaseSideEffectFence {
    records = new Map(); // key: fenceId
    externalCallIndex = new Map(); // externalCallId -> fenceId
    phaseIndex = new Map(); // `${intentId}:${generation}:${phase}` -> fenceId
    /**
     * Records a process-local phase or reports a same-payload existing phase.
     * Committed phases and conflicting payloads throw. A resumed phase is not
     * evidence of non-dispatch and must not itself authorize an external retry.
     */
    prepare(params) {
        const payloadBytes = typeof params.payload === 'string' ? Buffer.from(params.payload, 'utf8') : params.payload;
        const payloadHash = createHash('sha256').update(payloadBytes).digest('hex');
        const phaseKey = `${params.intentId}:${params.generation}:${params.phase}`;
        const existingFenceId = this.phaseIndex.get(phaseKey);
        if (existingFenceId) {
            const existing = this.records.get(existingFenceId);
            if (existing.status === 'COMMITTED') {
                throw new Error(`SIDE_EFFECT_ALREADY_COMMITTED: ${params.phase} for intent ${params.intentId} gen ${params.generation} already committed (SY005)`);
            }
            if (existing.payloadHash !== payloadHash) {
                throw new Error(`SIDE_EFFECT_PAYLOAD_MISMATCH: Cannot resume ${params.phase} with altered payload hash (SY012)`);
            }
            return { fenceId: existingFenceId, isResumed: true };
        }
        if (this.externalCallIndex.has(params.externalCallId)) {
            throw new Error(`DUPLICATE_EXTERNAL_CALL_ID: Call ID ${params.externalCallId} already registered`);
        }
        const fenceId = randomUUID();
        const record = {
            fenceId,
            intentId: params.intentId,
            generation: params.generation,
            phase: params.phase,
            externalCallId: params.externalCallId,
            payloadHash,
            status: 'PREPARED',
            preparedAt: Date.now(),
        };
        this.records.set(fenceId, record);
        this.externalCallIndex.set(params.externalCallId, fenceId);
        this.phaseIndex.set(phaseKey, fenceId);
        return { fenceId, isResumed: false };
    }
    /**
     * Marks the in-memory record committed and optionally keeps a result digest.
     * This is not a durable commit or recoverable artifact store.
     */
    commit(fenceId, resultPayload) {
        const record = this.records.get(fenceId);
        if (!record) {
            throw new Error(`FENCE_NOT_FOUND: Record ${fenceId} not found`);
        }
        if (record.status === 'COMMITTED') {
            return record;
        }
        let resultDigest;
        if (resultPayload) {
            const bytes = typeof resultPayload === 'string' ? Buffer.from(resultPayload, 'utf8') : resultPayload;
            resultDigest = createHash('sha256').update(bytes).digest('hex');
        }
        const updated = {
            ...record,
            status: 'COMMITTED',
            committedAt: Date.now(),
            resultDigest,
        };
        this.records.set(fenceId, updated);
        return updated;
    }
    /**
     * Marks an uncommitted in-memory record failed. This method does not verify
     * non-dispatch evidence or preserve the supplied reason.
     */
    markFailed(fenceId, reason) {
        const record = this.records.get(fenceId);
        if (!record)
            return;
        if (record.status === 'COMMITTED') {
            throw new Error(`CANNOT_FAIL_COMMITTED_SIDE_EFFECT: ${fenceId} is already committed`);
        }
        this.records.set(fenceId, { ...record, status: 'FAILED' });
    }
    getRecord(fenceId) {
        return this.records.get(fenceId);
    }
    getByPhase(intentId, generation, phase) {
        const fenceId = this.phaseIndex.get(`${intentId}:${generation}:${phase}`);
        return fenceId ? this.records.get(fenceId) : undefined;
    }
}
//# sourceMappingURL=two-phase-side-effect-fence.js.map
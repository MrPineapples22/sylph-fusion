import { Worker } from 'node:worker_threads';
import { serializeRecoveryCertificate } from './platform/ingestion/recovery-certificate.js';
import { GenerationStorageError, snapshotRegistration, validateGenerationId, storageErrorCodes } from './platform/storage/generation-identity.js';
export class Store {
    worker;
    seq = 0;
    failure = null;
    closing = false;
    closePromise = null;
    calls = new Map();
    constructor(path) {
        this.worker = new Worker(new URL('./db-worker.js', import.meta.url), { workerData: { path } });
        this.worker.on('message', m => {
            const error = storageErrorCodes.includes(m.code) ? new GenerationStorageError(m.code, Number.isSafeInteger(m.sqliteCode) && m.sqliteCode >= 0 && m.sqliteCode <= 0x7fffffff ? m.sqliteCode : undefined) : new Error(m.error);
            if (m.fatal) {
                this.fail(error, true);
                return;
            }
            const call = this.calls.get(m.id);
            this.calls.delete(m.id);
            if (m.error)
                call?.reject(error);
            else
                call?.resolve(m.value);
        });
        this.worker.on('error', e => this.fail(e));
        this.worker.on('exit', () => this.fail(new Error('database worker exited')));
    }
    fail(error, knownFailure = false) {
        this.failure ??= error;
        for (const c of this.calls.values())
            c.reject(!knownFailure && c.op === 'register-initial-generation'
                ? new GenerationStorageError('STORAGE_OUTCOME_UNKNOWN') : this.failure);
        this.calls.clear();
    }
    call(op, body, event, eventId) {
        if (this.closing && op !== 'close')
            return Promise.reject(new Error('Database is closing; request rejected'));
        if (this.failure)
            return Promise.reject(this.failure);
        // Bound queued snapshots when disk throughput falls behind producers.
        if (op !== 'close' && this.calls.size >= 128)
            return Promise.reject(new Error('Database request queue full; retry after pending writes complete'));
        return new Promise((resolve, reject) => {
            const id = ++this.seq;
            this.calls.set(id, { op, resolve, reject });
            try {
                this.worker.postMessage({ id, op, body, event, eventId });
            }
            catch (e) {
                this.calls.delete(id);
                reject(e);
            }
        });
    }
    async load() { const text = await this.call('load'); return text ? JSON.parse(text) : null; }
    async appendAuditEvent(event, payload, stableEventId) {
        if (typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event))
            throw new Error('Invalid audit event name');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            throw new Error('Invalid audit event payload');
        if (stableEventId !== undefined && (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId))) {
            throw new Error('Invalid audit event id');
        }
        const body = JSON.stringify(payload, (_, value) => typeof value === 'bigint' ? value.toString() : value);
        if (typeof body !== 'string' || Buffer.byteLength(body) > 65_536)
            throw new Error('Audit event payload exceeds size limit');
        const result = await this.call('append-audit-event', body, event, stableEventId);
        return result ? JSON.parse(result) : { inserted: true };
    }
    async getAuditEvents(event, limit = 1000) {
        if (typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event))
            throw new Error('Invalid audit event name');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
            throw new Error('Invalid audit event limit');
        const text = await this.call('get-audit-events', JSON.stringify({ event, limit }));
        return Object.freeze(text ? JSON.parse(text) : []);
    }
    async getAuditEventByStableId(stableEventId) {
        if (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId))
            throw new Error('Invalid audit event id');
        const text = await this.call('get-audit-event-by-stable-id', stableEventId);
        return text ? JSON.parse(text) : null;
    }
    async registerInitialGeneration(input) {
        const request = snapshotRegistration(input);
        return JSON.parse((await this.call('register-initial-generation', JSON.stringify(request))));
    }
    async readGenerationIdentity(intentId) {
        validateGenerationId(intentId);
        return JSON.parse((await this.call('read-generation-identity', intentId)));
    }
    async save(state, event) {
        if (event !== undefined && (typeof event !== 'string' || event.length < 1 || event.length > 256))
            throw new Error('Invalid state audit event');
        await this.call('save', JSON.stringify(state), event);
    }
    async prepareSigningIntent(intent) {
        await this.call('prepare-signing', JSON.stringify(intent));
    }
    async markSigningIntentSigned(economicIntentId, messageSha256, signatureBase64) {
        await this.call('mark-signed', JSON.stringify({ economicIntentId, messageSha256, signatureBase64 }));
    }
    async getSigningIntent(economicIntentId) {
        if (typeof economicIntentId !== 'string' || economicIntentId.length < 1 || economicIntentId.length > 256) {
            throw new Error('Invalid signing intent lookup');
        }
        const text = await this.call('get-signing-intent', economicIntentId);
        if (!text)
            return null;
        let row;
        try {
            row = JSON.parse(text);
        }
        catch {
            throw new Error('SIGNING_INTENT_ROW_INCONSISTENT');
        }
        if (row === null)
            return null;
        if (!row || typeof row !== 'object' || Array.isArray(row))
            throw new Error('SIGNING_INTENT_ROW_INCONSISTENT');
        const value = row;
        if (value.economicIntentId !== economicIntentId || typeof value.wallet !== 'string' || value.wallet.length < 1 ||
            typeof value.messageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.messageSha256) ||
            (value.state !== 'PREPARED' && value.state !== 'SIGNED') ||
            (value.state === 'PREPARED' && value.signatureBase64 !== null) ||
            (value.state === 'SIGNED' && (typeof value.signatureBase64 !== 'string' ||
                Buffer.from(value.signatureBase64, 'base64').byteLength !== 64 ||
                Buffer.from(value.signatureBase64, 'base64').toString('base64') !== value.signatureBase64))) {
            throw new Error('SIGNING_INTENT_ROW_INCONSISTENT');
        }
        return Object.freeze({
            economicIntentId, wallet: value.wallet, messageSha256: value.messageSha256,
            state: value.state, signatureBase64: value.signatureBase64,
        });
    }
    async saveCapitalCommit(commit) {
        await this.call('save-capital-commit', JSON.stringify(commit, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async appendCapitalEvent(event) {
        await this.call('append-capital-event', JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async saveRecoveryCertificate(cert) {
        // Legacy signed-row format; new range-bound certificates use the v2 journal below.
        await this.call('save-recovery-certificate', JSON.stringify(cert));
    }
    async saveVerifiedRecoveryCertificate(certificate) {
        const serialized = serializeRecoveryCertificate(certificate);
        if (!serialized)
            throw new Error('RECOVERY_CERTIFICATE_INVALID');
        await this.call('save-verified-recovery-certificate', JSON.stringify({
            certificateJson: serialized.certificateJson,
            certificateSha256: serialized.certificateSha256,
        }));
    }
    async getVerifiedRecoveryCertificate(certificateIdOrGapId) {
        if (typeof certificateIdOrGapId !== 'string' || certificateIdOrGapId.length < 1 || certificateIdOrGapId.length > 256) {
            throw new Error('RECOVERY_CERTIFICATE_LOOKUP_INVALID');
        }
        const text = await this.call('get-verified-recovery-certificate', certificateIdOrGapId);
        if (!text)
            return null;
        let certificate;
        try {
            certificate = JSON.parse(text);
        }
        catch {
            throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT');
        }
        const serialized = serializeRecoveryCertificate(certificate);
        if (!serialized || serialized.certificateJson !== text)
            throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT');
        return serialized.certificate;
    }
    async getRecoveryCertificate(certificateIdOrGapId) {
        const text = await this.call('get-recovery-certificate', certificateIdOrGapId);
        return text ? JSON.parse(text) : null;
    }
    async saveCoverageFrontier(frontier) {
        await this.call('save-coverage-frontier', JSON.stringify(frontier));
    }
    async getCoverageFrontier(lane) {
        const text = await this.call('get-coverage-frontier', lane);
        return text ? JSON.parse(text) : null;
    }
    async saveContractCanary(health) {
        await this.call('save-contract-canary', JSON.stringify(health));
    }
    async getContractCanary(providerId) {
        const text = await this.call('get-contract-canary', providerId);
        return text ? JSON.parse(text) : null;
    }
    async getAllContractCanaries() {
        const text = await this.call('get-all-contract-canaries');
        return text ? JSON.parse(text) : [];
    }
    async saveProviderQuota(quota) {
        await this.call('save-provider-quota', JSON.stringify(quota));
    }
    async getProviderQuota(providerId) {
        const text = await this.call('get-provider-quota', providerId);
        return text ? JSON.parse(text) : null;
    }
    async getAllProviderQuotas() {
        const text = await this.call('get-all-provider-quotas');
        return text ? JSON.parse(text) : [];
    }
    async saveCounterfactualEvaluation(evaluation) {
        await this.call('save-counterfactual-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getCounterfactualEvaluation(evaluationId) {
        const text = await this.call('get-counterfactual-evaluation', evaluationId);
        return text ? JSON.parse(text) : null;
    }
    async getCounterfactualEvaluationsForToken(tokenId) {
        const text = await this.call('get-counterfactual-evaluations-for-token', tokenId);
        return text ? JSON.parse(text) : [];
    }
    async saveFalsificationReport(report) {
        await this.call('save-falsification-report', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getFalsificationReport(reportId) {
        const text = await this.call('get-falsification-report', reportId);
        return text ? JSON.parse(text) : null;
    }
    async saveEntityControlEvaluation(evaluation) {
        await this.call('save-entity-control-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getEntityControlEvaluation(mint) {
        const text = await this.call('get-entity-control-evaluation', mint);
        return text ? JSON.parse(text) : null;
    }
    async backup(destinationPath) { await this.call('backup', destinationPath); }
    async pruneAudit(maxAgeMs) {
        if (maxAgeMs !== undefined && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10 * 365 * 86_400_000)) {
            throw new Error('Invalid audit retention age');
        }
        const text = await this.call('prune', maxAgeMs === undefined ? undefined : String(maxAgeMs));
        const result = JSON.parse(text ?? 'null');
        if (!result || !Number.isSafeInteger(result.prunedRowCount) || result.prunedRowCount < 0 || !Array.isArray(result.idRanges) || typeof result.limitReached !== 'boolean') {
            throw new Error('Invalid audit prune result');
        }
        return Object.freeze({ prunedRowCount: result.prunedRowCount, limitReached: result.limitReached, idRanges: Object.freeze(result.idRanges.map((range) => {
                if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0]) {
                    throw new Error('Invalid audit prune ranges');
                }
                return Object.freeze([range[0], range[1]]);
            })) });
    }
    close() {
        if (this.closePromise)
            return this.closePromise;
        this.closing = true;
        // Worker message ordering drains accepted writes before the close request.
        this.closePromise = (async () => { try {
            await this.call('close');
        }
        finally {
            await this.worker.terminate();
        } })();
        return this.closePromise;
    }
}
//# sourceMappingURL=store.js.map
import { Worker } from 'node:worker_threads';
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
    call(op, body, event) {
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
                this.worker.postMessage({ id, op, body, event });
            }
            catch (e) {
                this.calls.delete(id);
                reject(e);
            }
        });
    }
    async load() { const text = await this.call('load'); return text ? JSON.parse(text) : null; }
    async registerInitialGeneration(input) {
        const request = snapshotRegistration(input);
        return JSON.parse((await this.call('register-initial-generation', JSON.stringify(request))));
    }
    async readGenerationIdentity(intentId) {
        validateGenerationId(intentId);
        return JSON.parse((await this.call('read-generation-identity', intentId)));
    }
    async save(state, event) { await this.call('save', JSON.stringify(state), event); }
    async prepareSigningIntent(intent) {
        await this.call('prepare-signing', JSON.stringify(intent));
    }
    async markSigningIntentSigned(economicIntentId, messageSha256, signatureBase64) {
        await this.call('mark-signed', JSON.stringify({ economicIntentId, messageSha256, signatureBase64 }));
    }
    async saveCapitalCommit(commit) {
        await this.call('save-capital-commit', JSON.stringify(commit, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async appendCapitalEvent(event) {
        await this.call('append-capital-event', JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async saveRecoveryCertificate(cert) {
        await this.call('save-recovery-certificate', JSON.stringify(cert));
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
    async pruneAudit(maxAgeMs) { await this.call('prune', maxAgeMs ? String(maxAgeMs) : undefined); }
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
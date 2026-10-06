import { Worker } from 'node:worker_threads';
import { canonicalSylphJcs1Snapshot } from './paper-account-v3-codec.js';
/**
 * Isolated schema/migration store with one explicit bootstrap-only operation.
 * It cannot append later events, acquire a lease, activate, admit, or recover an account.
 */
export class PaperAccountV3BootstrapStore {
    worker;
    sequence = 0;
    closed = false;
    failure = null;
    readyResolve;
    readyReject;
    readyPromise;
    calls = new Map();
    closePromise = null;
    constructor(path) {
        if (typeof path !== 'string' || !path || path === ':memory:')
            throw new Error('PAPER_ACCOUNT_V3_FILE_DATABASE_REQUIRED');
        this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
        this.worker = new Worker(new URL('./paper-account-v3-worker.js', import.meta.url), { workerData: { path } });
        this.worker.on('message', (message) => {
            if (message.kind === 'ready') {
                this.readyResolve(message.status);
                return;
            }
            if (message.kind === 'fatal') {
                const error = new Error(message.error ?? 'PAPER_ACCOUNT_V3_WORKER_FAILED');
                this.fail(error);
                return;
            }
            if (typeof message.id !== 'number')
                return;
            const call = this.calls.get(message.id);
            if (!call)
                return;
            this.calls.delete(message.id);
            if (message.error)
                call.reject(new Error(message.error));
            else
                call.resolve(message.value ?? null);
        });
        this.worker.on('error', error => this.fail(error));
        this.worker.on('exit', code => { if (!this.closed && code !== 0)
            this.fail(new Error('PAPER_ACCOUNT_V3_WORKER_EXITED')); });
    }
    fail(error) {
        this.failure ??= error;
        this.readyReject(this.failure);
        for (const pending of this.calls.values())
            pending.reject(this.failure);
        this.calls.clear();
    }
    call(op, input) {
        if (this.closed || this.failure)
            return Promise.reject(this.failure ?? new Error('PAPER_ACCOUNT_V3_CLOSED'));
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            this.calls.set(id, { resolve, reject });
            try {
                this.worker.postMessage({ id, op, input });
            }
            catch (error) {
                this.calls.delete(id);
                reject(error instanceof Error ? error : new Error('PAPER_ACCOUNT_V3_WORKER_FAILED'));
            }
        });
    }
    ready() { return this.readyPromise; }
    async inspect() {
        await this.readyPromise;
        return JSON.parse((await this.call('inspect')));
    }
    /**
     * Records the supplied operator identity; it does not authenticate credentials or activate/admit the account.
     * A production caller must already hold the same-host startup OS process lock. SQLite's immediate transaction
     * serializes database writers and makes exact retries safe, but does not implement or replace that lifecycle lock.
     */
    async bootstrap(genesisBytes, operatorAuthorization, recordedAtMs) {
        await this.readyPromise;
        if (typeof operatorAuthorization !== 'string' || operatorAuthorization.length === 0)
            throw new Error('PAPER_ACCOUNT_V3_BOOTSTRAP_AUTHORIZATION_IDENTITY_INVALID');
        if (typeof recordedAtMs !== 'number' || !Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0 || recordedAtMs >= Number.MAX_SAFE_INTEGER)
            throw new Error('PAPER_ACCOUNT_V3_BOOTSTRAP_RECORDED_TIME_INVALID');
        const stable = canonicalSylphJcs1Snapshot(genesisBytes);
        return JSON.parse((await this.call('bootstrap', { genesisBytes: stable.bytes, operatorAuthorization, recordedAtMs })));
    }
    async close() {
        if (this.closePromise)
            return this.closePromise;
        this.closed = true;
        if (this.failure) {
            this.closePromise = this.worker.terminate().then(() => undefined);
            return this.closePromise;
        }
        this.closePromise = new Promise((resolve, reject) => {
            const id = ++this.sequence;
            this.calls.set(id, { resolve: () => resolve(), reject });
            try {
                this.worker.postMessage({ id, op: 'close' });
            }
            catch (error) {
                this.calls.delete(id);
                reject(error);
            }
        }).finally(async () => { await this.worker.terminate(); });
        return this.closePromise;
    }
}
//# sourceMappingURL=paper-account-v3-store.js.map
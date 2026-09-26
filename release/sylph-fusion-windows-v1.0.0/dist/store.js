import { Worker } from 'node:worker_threads';
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
            const call = this.calls.get(m.id);
            this.calls.delete(m.id);
            if (m.error)
                call?.reject(new Error(m.error));
            else
                call?.resolve(m.value);
        });
        this.worker.on('error', e => { this.failure = e; for (const c of this.calls.values())
            c.reject(e); this.calls.clear(); });
        this.worker.on('exit', () => { this.failure = new Error('database worker exited'); for (const c of this.calls.values())
            c.reject(this.failure); this.calls.clear(); });
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
            this.calls.set(id, { resolve, reject });
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
    async save(state, event) { await this.call('save', JSON.stringify(state), event); }
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
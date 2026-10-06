import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
function canonical(value, depth = 0) {
    if (depth > 32)
        throw new Error('PAPER_LEDGER_REQUEST_TOO_DEEP');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error('PAPER_LEDGER_NUMBERS_MUST_BE_SAFE_INTEGERS');
        return String(value);
    }
    if (Array.isArray(value)) {
        const items = [];
        for (let index = 0; index < value.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
                throw new Error('PAPER_LEDGER_REQUEST_INVALID');
            items.push(canonical(descriptor.value, depth + 1));
        }
        if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))
            throw new Error('PAPER_LEDGER_REQUEST_INVALID');
        return `[${items.join(',')}]`;
    }
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('PAPER_LEDGER_REQUEST_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string'))
        throw new Error('PAPER_LEDGER_REQUEST_INVALID');
    const entries = keys.sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
            throw new Error('PAPER_LEDGER_REQUEST_INVALID');
        return `${JSON.stringify(key)}:${canonical(descriptor.value, depth + 1)}`;
    });
    return `{${entries.join(',')}}`;
}
function requireScope(scope) {
    if (!scope || !validId(scope.accountId) || !validId(scope.generationId))
        throw new Error('PAPER_LEDGER_SCOPE_INVALID');
}
function snapshotInput(value) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('PAPER_LEDGER_INPUT_INVALID');
    const copy = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string')
            throw new Error('PAPER_LEDGER_INPUT_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
            throw new Error('PAPER_LEDGER_INPUT_INVALID');
        copy[key] = descriptor.value;
    }
    return copy;
}
function requireAmount(value, field) {
    if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value) || value.length > 80)
        throw new Error(`PAPER_LEDGER_${field}_INVALID`);
}
/** Isolated append-only paper journal. This is storage infrastructure only; it does not execute, settle, or reconcile orders. */
export class PaperLedgerStore {
    worker;
    seq = 0;
    failure = null;
    closing = false;
    closePromise = null;
    calls = new Map();
    constructor(path) {
        if (!path || path === ':memory:')
            throw new Error('PAPER_LEDGER_REQUIRES_FILE_BACKED_DATABASE');
        this.worker = new Worker(new URL('./paper-ledger-worker.js', import.meta.url), { workerData: { path } });
        this.worker.on('message', message => {
            if (message.fatal) {
                this.fail(new Error(message.error || 'PAPER_LEDGER_WORKER_FAILED'));
                return;
            }
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
        this.worker.on('exit', code => { if (!this.closing && code !== 0)
            this.fail(new Error('PAPER_LEDGER_WORKER_EXITED')); });
    }
    fail(error) {
        this.failure ??= error;
        for (const call of this.calls.values())
            call.reject(this.failure);
        this.calls.clear();
    }
    call(op, body) {
        if (this.closing || this.failure)
            return Promise.reject(this.failure ?? new Error('PAPER_LEDGER_CLOSED'));
        if (this.calls.size >= 128)
            return Promise.reject(new Error('PAPER_LEDGER_QUEUE_FULL'));
        return new Promise((resolve, reject) => {
            const id = ++this.seq;
            this.calls.set(id, { op, resolve, reject });
            try {
                this.worker.postMessage({ id, op, body: body === undefined ? undefined : JSON.stringify(body) });
            }
            catch (error) {
                this.calls.delete(id);
                reject(error);
            }
        });
    }
    async createGeneration(input) {
        input = snapshotInput(input);
        requireScope(input);
        requireAmount(input.openingCashLamports, 'OPENING_CASH');
        if (input.openingCashLamports.startsWith('-') || !Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0)
            throw new Error('PAPER_LEDGER_GENERATION_INVALID');
        return JSON.parse((await this.call('create-generation', input)));
    }
    async beginCommand(input) {
        input = snapshotInput(input);
        requireScope(input);
        if (!validId(input.commandId) || !Number.isSafeInteger(input.acceptedAtMs) || input.acceptedAtMs < 0)
            throw new Error('PAPER_LEDGER_COMMAND_INVALID');
        const requestJson = canonical(input.request);
        const requestFingerprint = createHash('sha256').update(requestJson).digest('hex');
        const { request: _request, ...safeInput } = input;
        const result = await this.call('begin-command', { ...safeInput, requestJson, requestFingerprint });
        return JSON.parse(result);
    }
    /** First successful report bytes and recordedAtMs are canonical; identical retries are no-ops even if their retry timestamp differs. */
    async recordSimulation(scope) {
        scope = snapshotInput(scope);
        requireScope(scope);
        if (!validId(scope.commandId) || !Number.isSafeInteger(scope.recordedAtMs) || scope.recordedAtMs < 0)
            throw new Error('PAPER_LEDGER_SIMULATION_INVALID');
        const reportJson = canonical(scope.report);
        const reportFingerprint = createHash('sha256').update(reportJson).digest('hex');
        const { report: _report, ...safeScope } = scope;
        await this.call('record-simulation', { ...safeScope, reportJson, reportFingerprint });
    }
    async appendFill(input) {
        input = snapshotInput(input);
        requireScope(input);
        if (!validId(input.commandId) || !validId(input.fillId) || !validId(input.mint) || !Number.isSafeInteger(input.filledAtMs) || input.filledAtMs < 0)
            throw new Error('PAPER_LEDGER_FILL_INVALID');
        requireAmount(input.cashDeltaLamports, 'CASH_DELTA');
        requireAmount(input.tokenDeltaRaw, 'TOKEN_DELTA');
        const reportJson = canonical(input.simulationReport);
        const reportFingerprint = createHash('sha256').update(reportJson).digest('hex');
        const { simulationReport: _simulationReport, ...safeInput } = input;
        return JSON.parse((await this.call('append-fill', { ...safeInput, reportJson, reportFingerprint })));
    }
    async markUnresolved(scope) {
        scope = snapshotInput(scope);
        requireScope(scope);
        if (!validId(scope.commandId) || !validId(scope.reasonCode) || !Number.isSafeInteger(scope.atMs) || scope.atMs < 0)
            throw new Error('PAPER_LEDGER_UNRESOLVED_INVALID');
        await this.call('mark-unresolved', scope);
    }
    async getCommand(scope) {
        scope = snapshotInput(scope);
        requireScope(scope);
        if (!validId(scope.commandId))
            throw new Error('PAPER_LEDGER_COMMAND_INVALID');
        const result = await this.call('get-command', scope);
        return result ? JSON.parse(result) : null;
    }
    async listCommands(scope) {
        scope = snapshotInput(scope);
        requireScope(scope);
        return JSON.parse((await this.call('list-commands', scope)));
    }
    async listFills(scope) {
        scope = snapshotInput(scope);
        requireScope(scope);
        return JSON.parse((await this.call('list-fills', scope)));
    }
    async close() {
        if (this.closePromise)
            return this.closePromise;
        if (this.failure) {
            this.closing = true;
            this.closePromise ??= this.worker.terminate().then(() => undefined);
            return this.closePromise;
        }
        this.closing = true;
        this.closePromise = new Promise((resolve, reject) => {
            const id = ++this.seq;
            this.calls.set(id, { op: 'close', resolve: () => resolve(), reject });
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
export function createPaperLedgerGenerationId() { return randomUUID(); }
//# sourceMappingURL=paper-ledger.js.map
import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';

export type PaperCommandState = 'ACCEPTED' | 'SIMULATED' | 'SETTLED' | 'REJECTED' | 'UNRESOLVED';
export interface PaperLedgerScope { readonly accountId: string; readonly generationId: string }
export interface PaperCommandInput extends PaperLedgerScope {
  readonly commandId: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly acceptedAtMs: number;
}
export interface PaperFillInput extends PaperLedgerScope {
  readonly commandId: string;
  readonly fillId: string;
  readonly filledAtMs: number;
  readonly cashDeltaLamports: string;
  readonly tokenDeltaRaw: string;
  readonly mint: string;
  readonly simulationReport: Readonly<Record<string, unknown>>;
}
export interface PaperCommandRecord extends PaperLedgerScope {
  readonly commandId: string;
  readonly requestFingerprint: string;
  readonly requestJson: string;
  readonly acceptedAtMs: number;
  readonly state: PaperCommandState;
  readonly simulationReportJson: string | null;
  readonly fillId: string | null;
}
export interface PaperFillRecord extends PaperLedgerScope {
  readonly commandId: string;
  readonly fillId: string;
  readonly filledAtMs: number;
  readonly cashDeltaLamports: string;
  readonly tokenDeltaRaw: string;
  readonly mint: string;
  readonly simulationReportJson: string;
}
export type BeginCommandResult = { readonly disposition: 'CREATED' | 'EXISTING'; readonly command: PaperCommandRecord };

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('PAPER_LEDGER_REQUEST_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('PAPER_LEDGER_NUMBERS_MUST_BE_SAFE_INTEGERS');
    return String(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('PAPER_LEDGER_REQUEST_INVALID');
      items.push(canonical(descriptor.value, depth + 1));
    }
    if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw new Error('PAPER_LEDGER_REQUEST_INVALID');
    return `[${items.join(',')}]`;
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('PAPER_LEDGER_REQUEST_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('PAPER_LEDGER_REQUEST_INVALID');
  const entries = (keys as string[]).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('PAPER_LEDGER_REQUEST_INVALID');
    return `${JSON.stringify(key)}:${canonical(descriptor.value, depth + 1)}`;
  });
  return `{${entries.join(',')}}`;
}
function requireScope(scope: PaperLedgerScope): void {
  if (!scope || !validId(scope.accountId) || !validId(scope.generationId)) throw new Error('PAPER_LEDGER_SCOPE_INVALID');
}
function snapshotInput<T extends object>(value: T): T {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('PAPER_LEDGER_INPUT_INVALID');
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error('PAPER_LEDGER_INPUT_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('PAPER_LEDGER_INPUT_INVALID');
    copy[key] = descriptor.value;
  }
  return copy as T;
}
function requireAmount(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value) || value.length > 80) throw new Error(`PAPER_LEDGER_${field}_INVALID`);
}

/** Isolated append-only paper journal. This is storage infrastructure only; it does not execute, settle, or reconcile orders. */
export class PaperLedgerStore {
  private readonly worker: Worker;
  private seq = 0;
  private failure: Error | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private readonly calls = new Map<number, {op: string; resolve: (value: string | null) => void; reject: (error: Error) => void}>();

  constructor(path: string) {
    if (!path || path === ':memory:') throw new Error('PAPER_LEDGER_REQUIRES_FILE_BACKED_DATABASE');
    this.worker = new Worker(new URL('./paper-ledger-worker.js', import.meta.url), { workerData: { path } });
    this.worker.on('message', message => {
      if (message.fatal) { this.fail(new Error(message.error || 'PAPER_LEDGER_WORKER_FAILED')); return; }
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value ?? null);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (!this.closing && code !== 0) this.fail(new Error('PAPER_LEDGER_WORKER_EXITED')); });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const call of this.calls.values()) call.reject(this.failure);
    this.calls.clear();
  }

  private call(op: string, body?: unknown): Promise<string | null> {
    if (this.closing || this.failure) return Promise.reject(this.failure ?? new Error('PAPER_LEDGER_CLOSED'));
    if (this.calls.size >= 128) return Promise.reject(new Error('PAPER_LEDGER_QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.calls.set(id, {op, resolve, reject});
      try { this.worker.postMessage({id, op, body: body === undefined ? undefined : JSON.stringify(body)}); }
      catch (error) { this.calls.delete(id); reject(error); }
    });
  }

  async createGeneration(input: PaperLedgerScope & {readonly openingCashLamports: string; readonly createdAtMs: number}): Promise<'CREATED' | 'EXISTING'> {
    input = snapshotInput(input);
    requireScope(input);
    requireAmount(input.openingCashLamports, 'OPENING_CASH');
    if (input.openingCashLamports.startsWith('-') || !Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) throw new Error('PAPER_LEDGER_GENERATION_INVALID');
    return JSON.parse((await this.call('create-generation', input))!) as 'CREATED' | 'EXISTING';
  }

  async beginCommand(input: PaperCommandInput): Promise<BeginCommandResult> {
    input = snapshotInput(input);
    requireScope(input);
    if (!validId(input.commandId) || !Number.isSafeInteger(input.acceptedAtMs) || input.acceptedAtMs < 0) throw new Error('PAPER_LEDGER_COMMAND_INVALID');
    const requestJson = canonical(input.request);
    const requestFingerprint = createHash('sha256').update(requestJson).digest('hex');
    const {request: _request, ...safeInput} = input;
    const result = await this.call('begin-command', {...safeInput, requestJson, requestFingerprint});
    return JSON.parse(result!);
  }

  /** First successful report bytes and recordedAtMs are canonical; identical retries are no-ops even if their retry timestamp differs. */
  async recordSimulation(scope: PaperLedgerScope & {readonly commandId: string; readonly report: Readonly<Record<string, unknown>>; readonly recordedAtMs: number}): Promise<void> {
    scope = snapshotInput(scope);
    requireScope(scope);
    if (!validId(scope.commandId) || !Number.isSafeInteger(scope.recordedAtMs) || scope.recordedAtMs < 0) throw new Error('PAPER_LEDGER_SIMULATION_INVALID');
    const reportJson = canonical(scope.report);
    const reportFingerprint = createHash('sha256').update(reportJson).digest('hex');
    const {report: _report, ...safeScope} = scope;
    await this.call('record-simulation', {...safeScope, reportJson, reportFingerprint});
  }

  async appendFill(input: PaperFillInput): Promise<'APPENDED' | 'EXISTING'> {
    input = snapshotInput(input);
    requireScope(input);
    if (!validId(input.commandId) || !validId(input.fillId) || !validId(input.mint) || !Number.isSafeInteger(input.filledAtMs) || input.filledAtMs < 0) throw new Error('PAPER_LEDGER_FILL_INVALID');
    requireAmount(input.cashDeltaLamports, 'CASH_DELTA');
    requireAmount(input.tokenDeltaRaw, 'TOKEN_DELTA');
    const reportJson = canonical(input.simulationReport);
    const reportFingerprint = createHash('sha256').update(reportJson).digest('hex');
    const {simulationReport: _simulationReport, ...safeInput} = input;
    return JSON.parse((await this.call('append-fill', {...safeInput, reportJson, reportFingerprint}))!) as 'APPENDED' | 'EXISTING';
  }

  async markUnresolved(scope: PaperLedgerScope & {readonly commandId: string; readonly reasonCode: string; readonly atMs: number}): Promise<void> {
    scope = snapshotInput(scope);
    requireScope(scope);
    if (!validId(scope.commandId) || !validId(scope.reasonCode) || !Number.isSafeInteger(scope.atMs) || scope.atMs < 0) throw new Error('PAPER_LEDGER_UNRESOLVED_INVALID');
    await this.call('mark-unresolved', scope);
  }

  async getCommand(scope: PaperLedgerScope & {readonly commandId: string}): Promise<PaperCommandRecord | null> {
    scope = snapshotInput(scope);
    requireScope(scope);
    if (!validId(scope.commandId)) throw new Error('PAPER_LEDGER_COMMAND_INVALID');
    const result = await this.call('get-command', scope);
    return result ? JSON.parse(result) : null;
  }

  async listCommands(scope: PaperLedgerScope): Promise<readonly PaperCommandRecord[]> {
    scope = snapshotInput(scope);
    requireScope(scope);
    return JSON.parse((await this.call('list-commands', scope))!);
  }

  async listFills(scope: PaperLedgerScope): Promise<readonly PaperFillRecord[]> {
    scope = snapshotInput(scope);
    requireScope(scope);
    return JSON.parse((await this.call('list-fills', scope))!);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.failure) {
      this.closing = true;
      this.closePromise ??= this.worker.terminate().then(() => undefined);
      return this.closePromise;
    }
    this.closing = true;
    this.closePromise = new Promise<void>((resolve, reject) => {
      const id = ++this.seq;
      this.calls.set(id, {op: 'close', resolve: () => resolve(), reject});
      try { this.worker.postMessage({id, op: 'close'}); } catch (error) { this.calls.delete(id); reject(error); }
    }).finally(async () => { await this.worker.terminate(); });
    return this.closePromise;
  }
}

export function createPaperLedgerGenerationId(): string { return randomUUID(); }

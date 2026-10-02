import { Worker } from 'node:worker_threads';
import type { State } from './core.js';
import type { DurableSigningJournal, PreparedSigningIntent } from './platform/signing/durable-live-signer.js';
import { GenerationStorageError, snapshotRegistration, validateGenerationId, storageErrorCodes,
  type InitialGenerationRegistration, type RegistrationResult, type GenerationIdentityRead,
  type LocalGenerationIdentityStore, type StorageErrorCode } from './platform/storage/generation-identity.js';
export class Store implements
  LocalGenerationIdentityStore,
  DurableSigningJournal,
  DurableCapitalJournal,
  DurableRecoveryJournal,
  DurableContractCanaryJournal,
  DurableProviderQuotaJournal,
  DurableRegretJournal,
  DurableFalsificationJournal,
  DurableEntityControlJournal {
  private worker: Worker;
  private seq = 0;
  private failure: Error | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private calls = new Map<number, { op: string; resolve: (value: string | null) => void; reject: (e: Error) => void }>();
  constructor(path: string) {
    this.worker = new Worker(new URL('./db-worker.js', import.meta.url), { workerData: { path } });
    this.worker.on('message', m => {
      const error = storageErrorCodes.includes(m.code) ? new GenerationStorageError(m.code as StorageErrorCode,
        Number.isSafeInteger(m.sqliteCode) && m.sqliteCode >= 0 && m.sqliteCode <= 0x7fffffff ? m.sqliteCode : undefined) : new Error(m.error);
      if (m.fatal) { this.fail(error, true); return; }
      const call = this.calls.get(m.id); this.calls.delete(m.id);
      if (m.error) call?.reject(error); else call?.resolve(m.value);
    });
    this.worker.on('error', e => this.fail(e));
    this.worker.on('exit', () => this.fail(new Error('database worker exited')));
  }
  private fail(error: Error, knownFailure = false): void {
    this.failure ??= error;
    for (const c of this.calls.values()) c.reject(!knownFailure && c.op === 'register-initial-generation'
      ? new GenerationStorageError('STORAGE_OUTCOME_UNKNOWN') : this.failure);
    this.calls.clear();
  }
  private call(op: string, body?: string, event?: string): Promise<string | null> {
    if (this.closing && op !== 'close') return Promise.reject(new Error('Database is closing; request rejected'));
    if (this.failure) return Promise.reject(this.failure);
    // Bound queued snapshots when disk throughput falls behind producers.
    if (op !== 'close' && this.calls.size >= 128) return Promise.reject(new Error('Database request queue full; retry after pending writes complete'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq; this.calls.set(id, { op, resolve, reject });
      try { this.worker.postMessage({ id, op, body, event }); }
      catch (e) { this.calls.delete(id); reject(e); }
    });
  }
  async load(): Promise<State | null> { const text = await this.call('load'); return text ? JSON.parse(text) : null; }
  async registerInitialGeneration(input: InitialGenerationRegistration): Promise<RegistrationResult> {
    const request = snapshotRegistration(input);
    return JSON.parse((await this.call('register-initial-generation', JSON.stringify(request)))!);
  }
  async readGenerationIdentity(intentId: string): Promise<GenerationIdentityRead> {
    validateGenerationId(intentId);
    return JSON.parse((await this.call('read-generation-identity', intentId))!);
  }
  async save(state: State, event?: string) { await this.call('save', JSON.stringify(state), event); }
  async prepareSigningIntent(intent: PreparedSigningIntent): Promise<void> {
    await this.call('prepare-signing', JSON.stringify(intent));
  }
  async markSigningIntentSigned(economicIntentId: string, messageSha256: string, signatureBase64: string): Promise<void> {
    await this.call('mark-signed', JSON.stringify({ economicIntentId, messageSha256, signatureBase64 }));
  }
  async saveCapitalCommit(commit: { intentId: string; reservationId: string; certificateId: string; capitalStateRoot: string; certificateHash: string }): Promise<void> {
    await this.call('save-capital-commit', JSON.stringify(commit, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async appendCapitalEvent(event: Record<string, unknown>): Promise<void> {
    await this.call('append-capital-event', JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async saveRecoveryCertificate(cert: Record<string, unknown>): Promise<void> {
    await this.call('save-recovery-certificate', JSON.stringify(cert));
  }
  async getRecoveryCertificate(certificateIdOrGapId: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-recovery-certificate', certificateIdOrGapId);
    return text ? JSON.parse(text) : null;
  }
  async saveCoverageFrontier(frontier: { lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string }): Promise<void> {
    await this.call('save-coverage-frontier', JSON.stringify(frontier));
  }
  async getCoverageFrontier(lane: string): Promise<{ lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string } | null> {
    const text = await this.call('get-coverage-frontier', lane);
    return text ? JSON.parse(text) : null;
  }
  async saveContractCanary(health: Record<string, unknown>): Promise<void> {
    await this.call('save-contract-canary', JSON.stringify(health));
  }
  async getContractCanary(providerId: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-contract-canary', providerId);
    return text ? JSON.parse(text) : null;
  }
  async getAllContractCanaries(): Promise<Record<string, unknown>[]> {
    const text = await this.call('get-all-contract-canaries');
    return text ? JSON.parse(text) : [];
  }
  async saveProviderQuota(quota: Record<string, unknown>): Promise<void> {
    await this.call('save-provider-quota', JSON.stringify(quota));
  }
  async getProviderQuota(providerId: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-provider-quota', providerId);
    return text ? JSON.parse(text) : null;
  }
  async getAllProviderQuotas(): Promise<Record<string, unknown>[]> {
    const text = await this.call('get-all-provider-quotas');
    return text ? JSON.parse(text) : [];
  }
  async saveCounterfactualEvaluation(evaluation: Record<string, unknown>): Promise<void> {
    await this.call('save-counterfactual-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getCounterfactualEvaluation(evaluationId: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-counterfactual-evaluation', evaluationId);
    return text ? JSON.parse(text) : null;
  }
  async getCounterfactualEvaluationsForToken(tokenId: string): Promise<Record<string, unknown>[]> {
    const text = await this.call('get-counterfactual-evaluations-for-token', tokenId);
    return text ? JSON.parse(text) : [];
  }
  async saveFalsificationReport(report: Record<string, unknown>): Promise<void> {
    await this.call('save-falsification-report', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getFalsificationReport(reportId: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-falsification-report', reportId);
    return text ? JSON.parse(text) : null;
  }
  async saveEntityControlEvaluation(evaluation: Record<string, unknown>): Promise<void> {
    await this.call('save-entity-control-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getEntityControlEvaluation(mint: string): Promise<Record<string, unknown> | null> {
    const text = await this.call('get-entity-control-evaluation', mint);
    return text ? JSON.parse(text) : null;
  }
  async backup(destinationPath: string): Promise<void> { await this.call('backup', destinationPath); }
  async pruneAudit(maxAgeMs?: number): Promise<void> { await this.call('prune', maxAgeMs ? String(maxAgeMs) : undefined); }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    // Worker message ordering drains accepted writes before the close request.
    this.closePromise = (async () => { try { await this.call('close'); } finally { await this.worker.terminate(); } })();
    return this.closePromise;
  }
}

export interface DurableCapitalJournal {
  saveCapitalCommit(commit: { intentId: string; reservationId: string; certificateId: string; capitalStateRoot: string; certificateHash: string }): Promise<void>;
  appendCapitalEvent(event: Record<string, unknown>): Promise<void>;
}

export interface DurableRecoveryJournal {
  saveRecoveryCertificate(cert: Record<string, unknown>): Promise<void>;
  getRecoveryCertificate(certificateIdOrGapId: string): Promise<Record<string, unknown> | null>;
  saveCoverageFrontier(frontier: { lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string }): Promise<void>;
  getCoverageFrontier(lane: string): Promise<{ lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string } | null>;
}

export interface DurableContractCanaryJournal {
  saveContractCanary(health: Record<string, unknown>): Promise<void>;
  getContractCanary(providerId: string): Promise<Record<string, unknown> | null>;
  getAllContractCanaries(): Promise<Record<string, unknown>[]>;
}

export interface DurableProviderQuotaJournal {
  saveProviderQuota(quota: Record<string, unknown>): Promise<void>;
  getProviderQuota(providerId: string): Promise<Record<string, unknown> | null>;
  getAllProviderQuotas(): Promise<Record<string, unknown>[]>;
}

export interface DurableRegretJournal {
  saveCounterfactualEvaluation(evaluation: Record<string, unknown>): Promise<void>;
  getCounterfactualEvaluation(evaluationId: string): Promise<Record<string, unknown> | null>;
  getCounterfactualEvaluationsForToken(tokenId: string): Promise<Record<string, unknown>[]>;
}

export interface DurableFalsificationJournal {
  saveFalsificationReport(report: Record<string, unknown>): Promise<void>;
  getFalsificationReport(reportId: string): Promise<Record<string, unknown> | null>;
}

export interface DurableEntityControlJournal {
  saveEntityControlEvaluation(evaluation: Record<string, unknown>): Promise<void>;
  getEntityControlEvaluation(mint: string): Promise<Record<string, unknown> | null>;
}

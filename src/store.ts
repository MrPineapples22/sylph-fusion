import { Worker } from 'node:worker_threads';
import type { State } from './core.js';
import type { DurableSigningJournal, PersistedSigningIntent, PreparedSigningIntent } from './platform/signing/durable-live-signer.js';
import type { RecoveryCertificate } from './platform/ingestion/types.js';
import { serializeRecoveryCertificate } from './platform/ingestion/recovery-certificate.js';
import { GenerationStorageError, snapshotRegistration, validateGenerationId, storageErrorCodes,
  type InitialGenerationRegistration, type RegistrationResult, type GenerationIdentityRead,
  type LocalGenerationIdentityStore, type StorageErrorCode } from './platform/storage/generation-identity.js';
export interface StoreIngressCapability {
  assertDurable(): Promise<void>;
  appendAuditEvent(event: string, payload: Readonly<Record<string, unknown>>, stableEventId?: string): Promise<{ inserted: boolean; auditId?: number }>;
  getAuditEventByStableId(stableEventId: string): Promise<{ id: number; at: number; event: string | null; body: string | null; pruned?: boolean; eventHash?: string } | null>;
  getPendingIngress(afterSequence: number, limit: number): Promise<readonly { id: number; at: number; body: string; eventHash: string }[]>;
  acknowledgeIngress(observationId: string, sequence: number, entryHash: string): Promise<void>;
}
const storeIngressCapabilities = new WeakMap<object, StoreIngressCapability>();

export function getStoreIngressCapability(value: unknown): StoreIngressCapability | null {
  if (!value || typeof value !== 'object') return null;
  return storeIngressCapabilities.get(value as object) ?? null;
}

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
  #worker: Worker;
  #seq = 0;
  #failure: Error | null = null;
  #closing = false;
  #closePromise: Promise<void> | null = null;
  #calls = new Map<number, { op: string; resolve: (value: string | null) => void; reject: (e: Error) => void }>();
  constructor(path: string) {
    this.#worker = new Worker(new URL('./db-worker.js', import.meta.url), { workerData: { path } });
    this.#worker.on('message', m => {
      const error = storageErrorCodes.includes(m.code) ? new GenerationStorageError(m.code as StorageErrorCode,
        Number.isSafeInteger(m.sqliteCode) && m.sqliteCode >= 0 && m.sqliteCode <= 0x7fffffff ? m.sqliteCode : undefined) : new Error(m.error);
      if (m.fatal) { this.#fail(error, true); return; }
      const call = this.#calls.get(m.id); this.#calls.delete(m.id);
      if (m.error) call?.reject(error); else call?.resolve(m.value);
    });
    this.#worker.on('error', e => this.#fail(e));
    this.#worker.on('exit', () => this.#fail(new Error('database worker exited')));
    storeIngressCapabilities.set(this, Object.freeze({
      assertDurable: async () => {
        const text = await this.#call('assert-ingress-durability');
        if (text !== 'FSYNC_COMMITTED') throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
      },
      appendAuditEvent: (event: string, payload: Readonly<Record<string, unknown>>, stableEventId?: string) =>
        this.#appendAuditEvent(event, payload, stableEventId),
      getAuditEventByStableId: (stableEventId: string) => this.#getAuditEventByStableId(stableEventId),
      getPendingIngress: async (afterSequence: number, limit: number) => {
        const text = await this.#call('get-pending-ingress', JSON.stringify({ afterSequence, limit }));
        return Object.freeze(text ? JSON.parse(text) : []);
      },
      acknowledgeIngress: async (observationId: string, sequence: number, entryHash: string) => {
        await this.#call('acknowledge-ingress', JSON.stringify({ observationId, sequence, entryHash }));
      },
    }));
  }
  #fail(error: Error, knownFailure = false): void {
    this.#failure ??= error;
    for (const c of this.#calls.values()) c.reject(!knownFailure && c.op === 'register-initial-generation'
      ? new GenerationStorageError('STORAGE_OUTCOME_UNKNOWN') : this.#failure);
    this.#calls.clear();
  }
  #call(op: string, body?: string, event?: string, eventId?: string): Promise<string | null> {
    if (this.#closing && op !== 'close') return Promise.reject(new Error('Database is closing; request rejected'));
    if (this.#failure) return Promise.reject(this.#failure);
    // Bound queued snapshots when disk throughput falls behind producers.
    if (op !== 'close' && this.#calls.size >= 128) return Promise.reject(new Error('Database request queue full; retry after pending writes complete'));
    return new Promise((resolve, reject) => {
      const id = ++this.#seq; this.#calls.set(id, { op, resolve, reject });
      try { this.#worker.postMessage({ id, op, body, event, eventId }); }
      catch (e) { this.#calls.delete(id); reject(e); }
    });
  }
  get worker(): Worker { return this.#worker; }
  call(op: string, body?: string, event?: string, eventId?: string): Promise<string | null> {
    return this.#call(op, body, event, eventId);
  }
  async load(): Promise<State | null> { const text = await this.#call('load'); return text ? JSON.parse(text) : null; }
  async appendAuditEvent(
    event: string,
    payload: Readonly<Record<string, unknown>>,
    stableEventId?: string
  ): Promise<{ inserted: boolean; auditId?: number }> {
    return this.#appendAuditEvent(event, payload, stableEventId);
  }
  async #appendAuditEvent(
    event: string,
    payload: Readonly<Record<string, unknown>>,
    stableEventId?: string
  ): Promise<{ inserted: boolean; auditId?: number }> {
    if (typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event)) throw new Error('Invalid audit event name');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid audit event payload');
    if (stableEventId !== undefined && (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId))) {
      throw new Error('Invalid audit event id');
    }
    const body = JSON.stringify(payload, (_, value) => typeof value === 'bigint' ? value.toString() : value);
    if (typeof body !== 'string' || Buffer.byteLength(body) > 65_536) throw new Error('Audit event payload exceeds size limit');
    const result = await this.#call('append-audit-event', body, event, stableEventId);
    return result ? JSON.parse(result) : { inserted: true };
  }
  async getAuditEvents(event: string, limit = 1000): Promise<readonly { id: number; at: number; event: string; body: string }[]> {
    if (typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event)) throw new Error('Invalid audit event name');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Invalid audit event limit');
    const text = await this.#call('get-audit-events', JSON.stringify({ event, limit }));
    return Object.freeze(text ? JSON.parse(text) : []);
  }
  async getAuditEventByStableId(stableEventId: string): Promise<{ id: number; at: number; event: string | null; body: string | null; pruned?: boolean; eventHash?: string } | null> {
    return this.#getAuditEventByStableId(stableEventId);
  }
  async #getAuditEventByStableId(stableEventId: string): Promise<{ id: number; at: number; event: string | null; body: string | null; pruned?: boolean; eventHash?: string } | null> {
    if (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId)) throw new Error('Invalid audit event id');
    const text = await this.#call('get-audit-event-by-stable-id', stableEventId);
    return text ? JSON.parse(text) : null;
  }
  async registerInitialGeneration(input: InitialGenerationRegistration): Promise<RegistrationResult> {
    const request = snapshotRegistration(input);
    return JSON.parse((await this.#call('register-initial-generation', JSON.stringify(request)))!);
  }
  async readGenerationIdentity(intentId: string): Promise<GenerationIdentityRead> {
    validateGenerationId(intentId);
    return JSON.parse((await this.#call('read-generation-identity', intentId))!);
  }
  async save(state: State, event?: string) {
    if (event !== undefined && (typeof event !== 'string' || event.length < 1 || event.length > 256)) throw new Error('Invalid state audit event');
    await this.#call('save', JSON.stringify(state), event);
  }
  async prepareSigningIntent(intent: PreparedSigningIntent): Promise<void> {
    await this.#call('prepare-signing', JSON.stringify(intent));
  }
  async markSigningIntentSigned(economicIntentId: string, messageSha256: string, signatureBase64: string): Promise<void> {
    await this.#call('mark-signed', JSON.stringify({ economicIntentId, messageSha256, signatureBase64 }));
  }
  async getSigningIntent(economicIntentId: string): Promise<PersistedSigningIntent | null> {
    if (typeof economicIntentId !== 'string' || economicIntentId.length < 1 || economicIntentId.length > 256) {
      throw new Error('Invalid signing intent lookup');
    }
    const text = await this.#call('get-signing-intent', economicIntentId);
    if (!text) return null;
    let row: unknown;
    try { row = JSON.parse(text); } catch { throw new Error('SIGNING_INTENT_ROW_INCONSISTENT'); }
    if (row === null) return null;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('SIGNING_INTENT_ROW_INCONSISTENT');
    const value = row as Record<string, unknown>;
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
    }) as PersistedSigningIntent;
  }
  async saveCapitalCommit(commit: { intentId: string; reservationId: string; certificateId: string; capitalStateRoot: string; certificateHash: string }): Promise<void> {
    await this.#call('save-capital-commit', JSON.stringify(commit, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async appendCapitalEvent(event: Record<string, unknown>): Promise<void> {
    await this.#call('append-capital-event', JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async saveRecoveryCertificate(cert: Record<string, unknown>): Promise<void> {
    // Legacy signed-row format; new range-bound certificates use the v2 journal below.
    await this.#call('save-recovery-certificate', JSON.stringify(cert));
  }
  async saveVerifiedRecoveryCertificate(certificate: RecoveryCertificate): Promise<void> {
    const serialized = serializeRecoveryCertificate(certificate);
    if (!serialized) throw new Error('RECOVERY_CERTIFICATE_INVALID');
    await this.#call('save-verified-recovery-certificate', JSON.stringify({
      certificateJson: serialized.certificateJson,
      certificateSha256: serialized.certificateSha256,
    }));
  }
  async getVerifiedRecoveryCertificate(certificateIdOrGapId: string): Promise<RecoveryCertificate | null> {
    if (typeof certificateIdOrGapId !== 'string' || certificateIdOrGapId.length < 1 || certificateIdOrGapId.length > 256) {
      throw new Error('RECOVERY_CERTIFICATE_LOOKUP_INVALID');
    }
    const text = await this.#call('get-verified-recovery-certificate', certificateIdOrGapId);
    if (!text) return null;
    let certificate: unknown;
    try { certificate = JSON.parse(text); } catch { throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT'); }
    const serialized = serializeRecoveryCertificate(certificate);
    if (!serialized || serialized.certificateJson !== text) throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT');
    return serialized.certificate;
  }
  async getRecoveryCertificate(certificateIdOrGapId: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-recovery-certificate', certificateIdOrGapId);
    return text ? JSON.parse(text) : null;
  }
  async saveCoverageFrontier(frontier: { lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string }): Promise<void> {
    await this.#call('save-coverage-frontier', JSON.stringify(frontier));
  }
  async getCoverageFrontier(lane: string): Promise<{ lane: string; continuousSlot: number; sealedSlot: number; coverageRoot: string } | null> {
    const text = await this.#call('get-coverage-frontier', lane);
    return text ? JSON.parse(text) : null;
  }
  async saveContractCanary(health: Record<string, unknown>): Promise<void> {
    await this.#call('save-contract-canary', JSON.stringify(health));
  }
  async getContractCanary(providerId: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-contract-canary', providerId);
    return text ? JSON.parse(text) : null;
  }
  async getAllContractCanaries(): Promise<Record<string, unknown>[]> {
    const text = await this.#call('get-all-contract-canaries');
    return text ? JSON.parse(text) : [];
  }
  async saveProviderQuota(quota: Record<string, unknown>): Promise<void> {
    await this.#call('save-provider-quota', JSON.stringify(quota));
  }
  async getProviderQuota(providerId: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-provider-quota', providerId);
    return text ? JSON.parse(text) : null;
  }
  async getAllProviderQuotas(): Promise<Record<string, unknown>[]> {
    const text = await this.#call('get-all-provider-quotas');
    return text ? JSON.parse(text) : [];
  }
  async saveCounterfactualEvaluation(evaluation: Record<string, unknown>): Promise<void> {
    await this.#call('save-counterfactual-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getCounterfactualEvaluation(evaluationId: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-counterfactual-evaluation', evaluationId);
    return text ? JSON.parse(text) : null;
  }
  async getCounterfactualEvaluationsForToken(tokenId: string): Promise<Record<string, unknown>[]> {
    const text = await this.#call('get-counterfactual-evaluations-for-token', tokenId);
    return text ? JSON.parse(text) : [];
  }
  async saveFalsificationReport(report: Record<string, unknown>): Promise<void> {
    await this.#call('save-falsification-report', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getFalsificationReport(reportId: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-falsification-report', reportId);
    return text ? JSON.parse(text) : null;
  }
  async saveEntityControlEvaluation(evaluation: Record<string, unknown>): Promise<void> {
    await this.#call('save-entity-control-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  }
  async getEntityControlEvaluation(mint: string): Promise<Record<string, unknown> | null> {
    const text = await this.#call('get-entity-control-evaluation', mint);
    return text ? JSON.parse(text) : null;
  }
  async backup(destinationPath: string): Promise<void> { await this.#call('backup', destinationPath); }
  async pruneAudit(maxAgeMs?: number): Promise<{ prunedRowCount: number; idRanges: readonly (readonly [number, number])[]; limitReached: boolean }> {
    if (maxAgeMs !== undefined && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10 * 365 * 86_400_000)) {
      throw new Error('Invalid audit retention age');
    }
    const text = await this.#call('prune', maxAgeMs === undefined ? undefined : String(maxAgeMs));
    const result = JSON.parse(text ?? 'null');
    if (!result || !Number.isSafeInteger(result.prunedRowCount) || result.prunedRowCount < 0 || !Array.isArray(result.idRanges) || typeof result.limitReached !== 'boolean') {
      throw new Error('Invalid audit prune result');
    }
    return Object.freeze({ prunedRowCount: result.prunedRowCount, limitReached: result.limitReached, idRanges: Object.freeze(result.idRanges.map((range: unknown) => {
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0]) {
        throw new Error('Invalid audit prune ranges');
      }
      return Object.freeze([range[0], range[1]] as const);
    })) });
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    // Worker message ordering drains accepted writes before the close request.
    this.#closePromise = (async () => { try { await this.#call('close'); } finally { await this.#worker.terminate(); } })();
    return this.#closePromise;
  }
}

export interface DurableCapitalJournal {
  saveCapitalCommit(commit: { intentId: string; reservationId: string; certificateId: string; capitalStateRoot: string; certificateHash: string }): Promise<void>;
  appendCapitalEvent(event: Record<string, unknown>): Promise<void>;
}

export interface DurableRecoveryJournal {
  saveRecoveryCertificate(cert: Record<string, unknown>): Promise<void>;
  getRecoveryCertificate(certificateIdOrGapId: string): Promise<Record<string, unknown> | null>;
  saveVerifiedRecoveryCertificate(certificate: RecoveryCertificate): Promise<void>;
  getVerifiedRecoveryCertificate(certificateIdOrGapId: string): Promise<RecoveryCertificate | null>;
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

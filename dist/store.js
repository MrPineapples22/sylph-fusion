import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, statSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { serializeRecoveryCertificate } from './platform/ingestion/recovery-certificate.js';
import { GenerationStorageError, snapshotRegistration, validateGenerationId, storageErrorCodes } from './platform/storage/generation-identity.js';
const storeIngressCapabilities = new WeakMap();
const engineProjectionCapabilities = new WeakMap();
const reviewedEngineIngressStores = new WeakSet();
const storeTestHooks = new WeakMap();
const stagingBatchCapabilities = new WeakMap();
const stagingLockReleases = new WeakMap();
const stagingStoreToken = Symbol('STAGING_REPLAY_STORE');
const stagingBatchOperation = 'append-staging-ingress-batch';
/** The returned operation exists only for a worker opened by the staging factory. */
export function getStagingIngressBatchCapability(value) {
    if (!value || typeof value !== 'object')
        return null;
    return stagingBatchCapabilities.get(value) ?? null;
}
function readStagingSession(dbPath, sessionPath, productionConfig) {
    const canonicalDbPath = resolve(dbPath);
    const canonicalSessionPath = resolve(sessionPath);
    const stageDir = dirname(canonicalDbPath);
    if (basename(canonicalDbPath).toLowerCase() !== 'staging.sqlite' ||
        canonicalSessionPath !== join(stageDir, 'stage-session.json'))
        throw new Error('STAGING_INGRESS_PATH_INVALID');
    const canonicalStageDir = realpathSync(stageDir);
    if (!/^feed-replay-staging-[a-z0-9-]{1,96}$/i.test(basename(canonicalStageDir)))
        throw new Error('STAGING_INGRESS_PATH_INVALID');
    const workDir = realpathSync(dirname(canonicalStageDir));
    if (basename(workDir).toLowerCase() !== 'work')
        throw new Error('STAGING_INGRESS_PATH_INVALID');
    const root = dirname(workDir);
    let packageManifest;
    try {
        packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    }
    catch {
        throw new Error('STAGING_INGRESS_PROJECT_ROOT_INVALID');
    }
    if (packageManifest?.name !== 'sylph-fusion')
        throw new Error('STAGING_INGRESS_PROJECT_ROOT_INVALID');
    if (!productionConfig || typeof productionConfig.DB_PATH !== 'string' || !productionConfig.DB_PATH) {
        throw new Error('STAGING_CONFIGURED_DATABASE_PATH_REQUIRED');
    }
    const denyIdentity = readDatabaseDenyIdentity(root, productionConfig.DB_PATH);
    const canonicalStageDbPath = join(canonicalStageDir, 'staging.sqlite');
    if (databasePathsCollide(canonicalDbPath, denyIdentity) || databasePathsCollide(canonicalStageDbPath, denyIdentity)) {
        throw new Error('STAGING_DATABASE_MUST_DIFFER_FROM_CONFIGURED_DATABASE');
    }
    const sessionStat = lstatSync(canonicalSessionPath);
    if (!sessionStat.isFile() || sessionStat.nlink !== 1)
        throw new Error('STAGING_INGRESS_SESSION_FILE_INVALID');
    const session = JSON.parse(readFileSync(canonicalSessionPath, 'utf8'));
    if (!session || session.schemaVersion !== 1 || session.project !== 'sylph-fusion-finalized-replay' ||
        typeof session.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.sessionId) ||
        !session.pending || !Number.isSafeInteger(session.pending.fromSlot) || session.pending.fromSlot < 1 ||
        !Number.isSafeInteger(session.pending.toSlot) || session.pending.toSlot < session.pending.fromSlot ||
        typeof session.pending.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(session.pending.manifestSha256) ||
        typeof session.pending.evidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(session.pending.evidenceSha256)) {
        throw new Error('STAGING_INGRESS_SESSION_INVALID');
    }
    if (existsSync(canonicalDbPath)) {
        const realDb = realpathSync(canonicalDbPath);
        if (dirname(realDb) !== canonicalStageDir || basename(realDb).toLowerCase() !== 'staging.sqlite' || statSync(realDb).nlink !== 1) {
            throw new Error('STAGING_INGRESS_DATABASE_PATH_INVALID');
        }
    }
    return Object.freeze({ dbPath: canonicalStageDbPath, stageDir: canonicalStageDir,
        sessionPath: join(canonicalStageDir, 'stage-session.json'), denyIdentity,
        sessionId: session.sessionId, manifestSha256: session.pending.manifestSha256,
        evidenceSha256: session.pending.evidenceSha256 });
}
function normalizedDatabasePath(path) {
    const value = resolve(path);
    return process.platform === 'win32' ? value.toLowerCase() : value;
}
function canonicalProspectivePath(path, seen = new Set()) {
    const candidate = resolve(path);
    if (seen.has(candidate))
        throw new Error('STAGING_CONFIGURED_DATABASE_PATH_INVALID');
    seen.add(candidate);
    try {
        const entry = lstatSync(candidate);
        if (entry.isSymbolicLink())
            return canonicalProspectivePath(resolve(dirname(candidate), readlinkSync(candidate)), seen);
        return realpathSync(candidate);
    }
    catch (error) {
        if (error?.code !== 'ENOENT')
            throw error;
        const parent = dirname(candidate);
        if (parent === candidate)
            return candidate;
        return join(canonicalProspectivePath(parent, seen), basename(candidate));
    }
}
function readDatabaseDenyIdentity(projectRoot, configuredDbPath) {
    try {
        const configuredPath = resolve(projectRoot, configuredDbPath);
        const canonicalPath = canonicalProspectivePath(configuredPath);
        const realPath = existsSync(configuredPath) ? realpathSync(configuredPath) : null;
        const stats = realPath ? statSync(realPath) : null;
        return Object.freeze({ configuredPath: resolve(configuredPath), canonicalPath, realPath,
            dev: stats && Number(stats.dev) !== 0 ? String(stats.dev) : null,
            ino: stats && Number(stats.ino) !== 0 ? String(stats.ino) : null });
    }
    catch {
        throw new Error('STAGING_CONFIGURED_DATABASE_PATH_INVALID');
    }
}
function databasePathsCollide(stagingPath, deny) {
    const stagingResolved = normalizedDatabasePath(stagingPath);
    if (stagingResolved === normalizedDatabasePath(deny.configuredPath) ||
        stagingResolved === normalizedDatabasePath(deny.canonicalPath))
        return true;
    let stagingReal = null;
    let stagingStats = null;
    if (existsSync(stagingPath)) {
        stagingReal = realpathSync(stagingPath);
        stagingStats = statSync(stagingReal);
    }
    if (stagingReal && deny.realPath && normalizedDatabasePath(stagingReal) === normalizedDatabasePath(deny.realPath))
        return true;
    if (stagingReal && normalizedDatabasePath(stagingReal) === normalizedDatabasePath(deny.canonicalPath))
        return true;
    return Boolean(stagingStats && deny.dev && deny.ino && String(stagingStats.dev) === deny.dev && String(stagingStats.ino) === deny.ino);
}
/** Opens the tightly bounded replay-only worker role for a DB under this repo's work directory. */
export function openStagingReplayStore(dbPath, sessionPath, productionConfig) {
    const identity = readStagingSession(dbPath, sessionPath, productionConfig);
    const lockPath = join(identity.stageDir, 'stage-session.lock');
    const nonce = randomBytes(32).toString('hex');
    const lock = { schemaVersion: 1, project: 'sylph-fusion-finalized-replay', sessionId: identity.sessionId,
        pid: process.pid, nonce };
    for (;;) {
        try {
            const fd = openSync(lockPath, 'wx');
            try {
                writeFileSync(fd, JSON.stringify(lock));
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
            break;
        }
        catch (error) {
            if (error?.code !== 'EEXIST')
                throw error;
            let prior;
            try {
                const lockStat = lstatSync(lockPath);
                if (!lockStat.isFile() || lockStat.nlink !== 1)
                    throw new Error('STAGING_INGRESS_LOCK_INVALID');
                prior = JSON.parse(readFileSync(lockPath, 'utf8'));
            }
            catch {
                throw new Error('STAGING_INGRESS_LOCK_INVALID');
            }
            if (prior?.schemaVersion !== 1 || prior.project !== lock.project || prior.sessionId !== identity.sessionId ||
                !Number.isSafeInteger(prior.pid) || prior.pid < 1 || typeof prior.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(prior.nonce)) {
                throw new Error('STAGING_INGRESS_LOCK_INVALID');
            }
            let processAbsent = false;
            try {
                process.kill(prior.pid, 0);
            }
            catch (probe) {
                if (probe?.code === 'ESRCH')
                    processAbsent = true;
            }
            if (!processAbsent)
                throw new Error('STAGING_INGRESS_LOCK_HELD');
            // Portable Node core has no unlink-if-inode-still-matches primitive. Never
            // race a stale-owner unlink against a new owner; manual recovery is required.
            throw new Error('STAGING_INGRESS_LOCK_STALE_REQUIRES_MANUAL_RECOVERY');
        }
    }
    const releaseLock = () => {
        try {
            const current = JSON.parse(readFileSync(lockPath, 'utf8'));
            if (current?.sessionId === identity.sessionId && current?.pid === process.pid && current?.nonce === nonce)
                unlinkSync(lockPath);
        }
        catch { /* A missing or replaced lock is never removed by this owner. */ }
    };
    try {
        const store = new Store(identity.dbPath, stagingStoreToken, { ...identity, nonce: randomBytes(32).toString('hex'),
            lockNonce: nonce, lockPid: process.pid });
        stagingLockReleases.set(store, releaseLock);
        return store;
    }
    catch (error) {
        releaseLock();
        throw error;
    }
}
/** Test-only hook for simulating worker death without exposing its message port. */
export function terminateStoreWorkerForTest(value) {
    if (!value || typeof value !== 'object')
        throw new Error('STORE_TEST_HOOK_UNAVAILABLE');
    const hook = storeTestHooks.get(value);
    if (!hook)
        throw new Error('STORE_TEST_HOOK_UNAVAILABLE');
    return hook.terminateWorker();
}
export function getStoreIngressCapability(value) {
    if (!value || typeof value !== 'object')
        return null;
    return storeIngressCapabilities.get(value) ?? null;
}
// Used only by the restricted Engine projection module. The C1 auditor enforces
// that module boundary; JS cannot hide a same-process module export from code
// that deliberately imports internal source modules.
export function getInternalEngineProjectionCapability(value) {
    if (!value || typeof value !== 'object')
        return null;
    return engineProjectionCapabilities.get(value) ?? null;
}
export class Store {
    #worker;
    #seq = 0;
    #failure = null;
    #closing = false;
    #closePromise = null;
    #calls = new Map();
    constructor(path, role, stagingIdentity) {
        const stagingReplay = role === stagingStoreToken ? stagingIdentity : undefined;
        if ((role === stagingStoreToken) !== Boolean(stagingReplay) || (stagingReplay && stagingReplay.dbPath !== resolve(path))) {
            throw new Error('STAGING_INGRESS_ROLE_INVALID');
        }
        this.#worker = new Worker(new URL('./db-worker.js', import.meta.url), { workerData: {
                path, ...(stagingReplay ? { stagingReplay } : {}),
            } });
        storeTestHooks.set(this, { terminateWorker: async () => { await this.#worker.terminate(); } });
        this.#worker.on('message', m => {
            const error = storageErrorCodes.includes(m.code) ? new GenerationStorageError(m.code, Number.isSafeInteger(m.sqliteCode) && m.sqliteCode >= 0 && m.sqliteCode <= 0x7fffffff ? m.sqliteCode : undefined) : new Error(m.error);
            if (m.fatal) {
                this.#fail(error, true);
                return;
            }
            const call = this.#calls.get(m.id);
            this.#calls.delete(m.id);
            if (m.error)
                call?.reject(error);
            else
                call?.resolve(m.value);
        });
        this.#worker.on('error', e => this.#fail(e));
        this.#worker.on('exit', () => this.#fail(new Error('database worker exited')));
        storeIngressCapabilities.set(this, Object.freeze({
            getRuntimeStoreInstanceId: async () => {
                const id = await this.#call('runtime-store-instance-id');
                if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
                    throw new Error('RUNTIME_STORE_IDENTITY_INVALID');
                return id;
            },
            assertDurable: async () => {
                const text = await this.#call('assert-ingress-durability');
                if (text !== 'FSYNC_COMMITTED')
                    throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
            },
            appendAuditEvent: (event, payload, stableEventId) => this.#appendAuditEvent(event, payload, stableEventId),
            getAuditEventByStableId: (stableEventId) => this.#getAuditEventByStableId(stableEventId),
            getPendingIngress: async (afterSequence, limit) => {
                const text = await this.#call('get-pending-ingress', JSON.stringify({ afterSequence, limit }));
                return Object.freeze(text ? JSON.parse(text) : []);
            },
            inspectIngressStartupState: async () => {
                const text = await this.#call('inspect-ingress-startup-state');
                const value = text === null ? null : JSON.parse(text);
                if (!value || typeof value !== 'object' || typeof value.outboxAvailable !== 'boolean' ||
                    typeof value.hasLegacyUnknown !== 'boolean' ||
                    (value.oldestPendingSequence !== null && (!Number.isSafeInteger(value.oldestPendingSequence) || value.oldestPendingSequence < 1))) {
                    throw new Error('INGRESS_STARTUP_STATE_INVALID');
                }
                return value;
            },
            markReviewedEngineIngress: () => { reviewedEngineIngressStores.add(this); },
        }));
        engineProjectionCapabilities.set(this, Object.freeze({
            loadEngineProjection: async () => {
                const text = await this.#call('load-engine-projection');
                return text ? JSON.parse(text) : null;
            },
            commitEngineProjection: async (observationId, sequence, entryHash, projectionJson, stateJson) => {
                await this.#call('commit-engine-projection', JSON.stringify({ observationId, sequence, entryHash, projectionJson, stateJson }));
            },
        }));
        if (stagingReplay) {
            stagingBatchCapabilities.set(this, async (records) => {
                if (!Array.isArray(records) || records.length < 1 || records.length > 64)
                    throw new Error('STAGING_INGRESS_BATCH_LIMIT');
                let totalBytes = 0;
                for (const row of records) {
                    if (!row || !/^[a-f0-9]{64}$/.test(row.observationId) || row.eventId !== `ingress:${row.observationId}` ||
                        !/^[a-f0-9]{64}$/.test(row.eventHash) || typeof row.body !== 'string')
                        throw new Error('STAGING_INGRESS_BATCH_INPUT_INVALID');
                    totalBytes += Buffer.byteLength(row.body);
                }
                if (totalBytes > 2 * 1024 * 1024)
                    throw new Error('STAGING_INGRESS_BATCH_LIMIT');
                const text = await this.#call(stagingBatchOperation, JSON.stringify(records), undefined, undefined, stagingReplay.nonce);
                const result = text ? JSON.parse(text) : null;
                if (!Array.isArray(result) || result.length !== records.length || result.some((row, i) => row?.observationId !== records[i].observationId || !Number.isSafeInteger(row.auditId) || row.auditId < 1 ||
                    typeof row.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.eventHash) ||
                    typeof row.inserted !== 'boolean'))
                    throw new Error('STAGING_INGRESS_BATCH_RESULT_INVALID');
                return Object.freeze(result.map(row => Object.freeze(row)));
            });
        }
    }
    #fail(error, knownFailure = false) {
        this.#failure ??= error;
        for (const c of this.#calls.values())
            c.reject(!knownFailure && c.op === 'register-initial-generation'
                ? new GenerationStorageError('STORAGE_OUTCOME_UNKNOWN') : this.#failure);
        this.#calls.clear();
    }
    #call(op, body, event, eventId, capability) {
        if (this.#closing && op !== 'close')
            return Promise.reject(new Error('Database is closing; request rejected'));
        if (this.#failure)
            return Promise.reject(this.#failure);
        // Bound queued snapshots when disk throughput falls behind producers.
        if (op !== 'close' && this.#calls.size >= 128)
            return Promise.reject(new Error('Database request queue full; retry after pending writes complete'));
        return new Promise((resolve, reject) => {
            const id = ++this.#seq;
            this.#calls.set(id, { op, resolve, reject });
            try {
                this.#worker.postMessage({ id, op, body, event, eventId, capability });
            }
            catch (e) {
                this.#calls.delete(id);
                reject(e);
            }
        });
    }
    call(op, body, event, eventId) {
        if (op === stagingBatchOperation)
            return Promise.reject(new Error('STAGING_INGRESS_CAPABILITY_REQUIRED'));
        if (reviewedEngineIngressStores.has(this) && (op === 'acknowledge-ingress' || op === 'commit-engine-projection')) {
            return Promise.reject(new Error('ENGINE_PROJECTION_CAPABILITY_REQUIRED'));
        }
        return this.#call(op, body, event, eventId);
    }
    async load() { const text = await this.#call('load'); return text ? JSON.parse(text) : null; }
    async appendAuditEvent(event, payload, stableEventId) {
        return this.#appendAuditEvent(event, payload, stableEventId);
    }
    async #appendAuditEvent(event, payload, stableEventId) {
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
        const result = await this.#call('append-audit-event', body, event, stableEventId);
        return result ? JSON.parse(result) : { inserted: true };
    }
    async getAuditEvents(event, limit = 1000) {
        if (typeof event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(event))
            throw new Error('Invalid audit event name');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
            throw new Error('Invalid audit event limit');
        const text = await this.#call('get-audit-events', JSON.stringify({ event, limit }));
        return Object.freeze(text ? JSON.parse(text) : []);
    }
    async getAuditEventByStableId(stableEventId) {
        return this.#getAuditEventByStableId(stableEventId);
    }
    async #getAuditEventByStableId(stableEventId) {
        if (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId))
            throw new Error('Invalid audit event id');
        const text = await this.#call('get-audit-event-by-stable-id', stableEventId);
        return text ? JSON.parse(text) : null;
    }
    async registerInitialGeneration(input) {
        const request = snapshotRegistration(input);
        return JSON.parse((await this.#call('register-initial-generation', JSON.stringify(request))));
    }
    async readGenerationIdentity(intentId) {
        validateGenerationId(intentId);
        return JSON.parse((await this.#call('read-generation-identity', intentId)));
    }
    async save(state, event) {
        if (event !== undefined && (typeof event !== 'string' || event.length < 1 || event.length > 256))
            throw new Error('Invalid state audit event');
        await this.#call('save', JSON.stringify(state), event);
    }
    async prepareSigningIntent(intent) {
        await this.#call('prepare-signing', JSON.stringify(intent));
    }
    async markSigningIntentSigned(economicIntentId, messageSha256, signatureBase64) {
        await this.#call('mark-signed', JSON.stringify({ economicIntentId, messageSha256, signatureBase64 }));
    }
    async getSigningIntent(economicIntentId) {
        if (typeof economicIntentId !== 'string' || economicIntentId.length < 1 || economicIntentId.length > 256) {
            throw new Error('Invalid signing intent lookup');
        }
        const text = await this.#call('get-signing-intent', economicIntentId);
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
        await this.#call('save-capital-commit', JSON.stringify(commit, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async appendCapitalEvent(event) {
        await this.#call('append-capital-event', JSON.stringify(event, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async saveRecoveryCertificate(cert) {
        // Legacy signed-row format; new range-bound certificates use the v2 journal below.
        await this.#call('save-recovery-certificate', JSON.stringify(cert));
    }
    async saveVerifiedRecoveryCertificate(certificate) {
        const serialized = serializeRecoveryCertificate(certificate);
        if (!serialized)
            throw new Error('RECOVERY_CERTIFICATE_INVALID');
        await this.#call('save-verified-recovery-certificate', JSON.stringify({
            certificateJson: serialized.certificateJson,
            certificateSha256: serialized.certificateSha256,
        }));
    }
    async getVerifiedRecoveryCertificate(certificateIdOrGapId) {
        if (typeof certificateIdOrGapId !== 'string' || certificateIdOrGapId.length < 1 || certificateIdOrGapId.length > 256) {
            throw new Error('RECOVERY_CERTIFICATE_LOOKUP_INVALID');
        }
        const text = await this.#call('get-verified-recovery-certificate', certificateIdOrGapId);
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
        const text = await this.#call('get-recovery-certificate', certificateIdOrGapId);
        return text ? JSON.parse(text) : null;
    }
    async saveCoverageFrontier(frontier) {
        await this.#call('save-coverage-frontier', JSON.stringify(frontier));
    }
    async getCoverageFrontier(lane) {
        const text = await this.#call('get-coverage-frontier', lane);
        return text ? JSON.parse(text) : null;
    }
    async saveContractCanary(health) {
        await this.#call('save-contract-canary', JSON.stringify(health));
    }
    async getContractCanary(providerId) {
        const text = await this.#call('get-contract-canary', providerId);
        return text ? JSON.parse(text) : null;
    }
    async getAllContractCanaries() {
        const text = await this.#call('get-all-contract-canaries');
        return text ? JSON.parse(text) : [];
    }
    async saveProviderQuota(quota) {
        await this.#call('save-provider-quota', JSON.stringify(quota));
    }
    async getProviderQuota(providerId) {
        const text = await this.#call('get-provider-quota', providerId);
        return text ? JSON.parse(text) : null;
    }
    async getAllProviderQuotas() {
        const text = await this.#call('get-all-provider-quotas');
        return text ? JSON.parse(text) : [];
    }
    async saveCounterfactualEvaluation(evaluation) {
        await this.#call('save-counterfactual-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getCounterfactualEvaluation(evaluationId) {
        const text = await this.#call('get-counterfactual-evaluation', evaluationId);
        return text ? JSON.parse(text) : null;
    }
    async getCounterfactualEvaluationsForToken(tokenId) {
        const text = await this.#call('get-counterfactual-evaluations-for-token', tokenId);
        return text ? JSON.parse(text) : [];
    }
    async saveFalsificationReport(report) {
        await this.#call('save-falsification-report', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getFalsificationReport(reportId) {
        const text = await this.#call('get-falsification-report', reportId);
        return text ? JSON.parse(text) : null;
    }
    async saveEntityControlEvaluation(evaluation) {
        await this.#call('save-entity-control-evaluation', JSON.stringify(evaluation, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    }
    async getEntityControlEvaluation(mint) {
        const text = await this.#call('get-entity-control-evaluation', mint);
        return text ? JSON.parse(text) : null;
    }
    async backup(destinationPath) { await this.#call('backup', destinationPath); }
    async pruneAudit(maxAgeMs) {
        if (maxAgeMs !== undefined && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10 * 365 * 86_400_000)) {
            throw new Error('Invalid audit retention age');
        }
        const text = await this.#call('prune', maxAgeMs === undefined ? undefined : String(maxAgeMs));
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
        if (this.#closePromise)
            return this.#closePromise;
        this.#closing = true;
        // Worker message ordering drains accepted writes before the close request.
        this.#closePromise = (async () => {
            try {
                await this.#call('close');
            }
            finally {
                try {
                    await this.#worker.terminate();
                }
                finally {
                    stagingLockReleases.get(this)?.();
                    stagingLockReleases.delete(this);
                }
            }
        })();
        return this.#closePromise;
    }
}
//# sourceMappingURL=store.js.map
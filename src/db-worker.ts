import { parentPort, workerData } from 'node:worker_threads';
import { createHash, randomBytes } from 'node:crypto';
import { openGenerationDatabase, registerInitialGenerationSync, readGenerationIdentitySync, sqliteDiagnostic } from './platform/storage/generation-sqlite.js';
import { GenerationStorageError } from './platform/storage/generation-identity.js';
import { serializeRecoveryCertificate } from './platform/ingestion/recovery-certificate.js';

const verifiedRecoveryCertificateSchema = `CREATE TABLE IF NOT EXISTS verified_recovery_certificates_v2(
  certificate_id TEXT PRIMARY KEY CHECK(length(certificate_id) BETWEEN 1 AND 128),
  gap_id TEXT NOT NULL CHECK(length(gap_id) BETWEEN 1 AND 256),
  start_slot INTEGER NOT NULL CHECK(start_slot > 0),
  end_slot INTEGER NOT NULL CHECK(end_slot >= start_slot),
  provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 128),
  classification TEXT NOT NULL CHECK(classification IN ('SKIPPED_SLOT','DEAD_FORK','MISSING_OBSERVATION','PROVIDER_LOSS','UNAVAILABLE_HISTORY','PARTIAL_RECOVERY','PROVIDER_DISAGREEMENT','UNKNOWN')),
  lane TEXT NOT NULL CHECK(lane IN ('CHAIN_BLOCK','PUMP_TRANSACTION','ACCOUNT_WRITE','ENTRY','FORK_LINEAGE','BLOCK_FOOTER')),
  state_root TEXT NOT NULL CHECK(length(state_root)=64 AND state_root NOT GLOB '*[^a-f0-9]*'),
  coverage_root TEXT NOT NULL CHECK(length(coverage_root)=64 AND coverage_root NOT GLOB '*[^a-f0-9]*'),
  certified_at_ms INTEGER NOT NULL CHECK(certified_at_ms BETWEEN 0 AND 9007199254740991),
  certificate_sha256 TEXT NOT NULL CHECK(length(certificate_sha256)=64 AND certificate_sha256 NOT GLOB '*[^a-f0-9]*'),
  certificate_json TEXT NOT NULL CHECK(length(certificate_json)<=33554432)
) STRICT;`;
const verifiedRecoveryCertificateIndex = 'CREATE INDEX verified_recovery_certificates_gap_time_idx ON verified_recovery_certificates_v2(gap_id,certified_at_ms DESC,certificate_id ASC)';
const normalizedSql = (value: string) => value.replace(/CREATE TABLE IF NOT EXISTS /i, 'CREATE TABLE ').replace(/\s+/g, '').replace(/;$/, '').toLowerCase();
function ensureVerifiedRecoveryCertificateSchema(): void {
  const table: any = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='verified_recovery_certificates_v2'").get();
  if (!table) db.exec(verifiedRecoveryCertificateSchema);
  else if (normalizedSql(String(table.sql)) !== normalizedSql(verifiedRecoveryCertificateSchema)) throw new Error('RECOVERY_CERTIFICATE_SCHEMA_UNSUPPORTED');
  const index: any = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='verified_recovery_certificates_gap_time_idx'").get();
  if (!index) db.exec(verifiedRecoveryCertificateIndex);
  else if (normalizedSql(String(index.sql)) !== normalizedSql(verifiedRecoveryCertificateIndex)) throw new Error('RECOVERY_CERTIFICATE_INDEX_UNSUPPORTED');
}
const initialized = (() => {
  try { return openGenerationDatabase(workerData.path); }
  catch (error) {
    const failure = error instanceof GenerationStorageError ? error : new GenerationStorageError('STORAGE_FAILURE');
    parentPort!.postMessage({ fatal: true, error: failure.message, code: failure.code, sqliteCode: failure.sqliteCode });
    throw failure;
  }
})();
const { db, registrationCapable } = initialized;

const runtimeIdentitySchema = `CREATE TABLE runtime_store_identity_v1(
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  instance_id TEXT NOT NULL CHECK(length(instance_id)=32 AND instance_id NOT GLOB '*[^a-f0-9]*')
) STRICT;`;
function assertRuntimeDurability(): void {
  const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  if (!registrationCapable || typeof file !== 'string' || file.length === 0 ||
      db.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'wal' ||
      db.prepare('PRAGMA synchronous').get()!.synchronous !== 2) throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
}
function runtimeStoreInstanceId(): string {
  assertRuntimeDurability();
  db.exec('BEGIN IMMEDIATE');
  try {
    const table = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='runtime_store_identity_v1'").get();
    if (!table) {
      db.exec(runtimeIdentitySchema);
      db.prepare('INSERT INTO runtime_store_identity_v1 VALUES(1,?)').run(randomBytes(16).toString('hex'));
    } else if (normalizedSql(String(table.sql)) !== normalizedSql(runtimeIdentitySchema)) throw new Error('RUNTIME_STORE_IDENTITY_SCHEMA_INVALID');
    const rows = db.prepare('SELECT singleton,instance_id FROM runtime_store_identity_v1').all();
    if (rows.length !== 1 || rows[0].singleton !== 1 || typeof rows[0].instance_id !== 'string' ||
        !/^[a-f0-9]{32}$/.test(rows[0].instance_id)) throw new Error('RUNTIME_STORE_IDENTITY_INVALID');
    db.exec('COMMIT');
    return rows[0].instance_id;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function ensureIngressDeliverySchemaInternal(): void {
  const priorDeliverySchema = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_delivery_v1'").get();
  db.exec('CREATE TABLE IF NOT EXISTS audit_event_dedupe(event_id TEXT PRIMARY KEY, event_hash TEXT NOT NULL, audit_id INTEGER, created_at_ms INTEGER NOT NULL) STRICT;');
  db.exec(`CREATE TABLE IF NOT EXISTS canonical_ingress_delivery_v1(
    observation_id TEXT PRIMARY KEY CHECK(length(observation_id)=64 AND observation_id NOT GLOB '*[^a-f0-9]*'),
    audit_id INTEGER NOT NULL UNIQUE,
    entry_hash TEXT NOT NULL CHECK(length(entry_hash)=64 AND entry_hash NOT GLOB '*[^a-f0-9]*'),
    acknowledged_at_ms INTEGER CHECK(acknowledged_at_ms IS NULL OR acknowledged_at_ms BETWEEN 0 AND 9007199254740991),
    delivery_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(delivery_status IN ('PENDING','ACKNOWLEDGED','LEGACY_UNKNOWN'))
  ) STRICT;`);
  const deliveryColumns = db.prepare('PRAGMA table_info(canonical_ingress_delivery_v1)').all() as { name: string }[];
  if (!deliveryColumns.some(column => column.name === 'delivery_status')) {
    db.exec(`ALTER TABLE canonical_ingress_delivery_v1 ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'PENDING'
      CHECK(delivery_status IN ('PENDING','ACKNOWLEDGED','LEGACY_UNKNOWN'));
      UPDATE canonical_ingress_delivery_v1 SET delivery_status='ACKNOWLEDGED' WHERE acknowledged_at_ms IS NOT NULL;`);
  }
  // Before the outbox existed, the database cannot tell whether an old
  // in-memory subscriber completed. Replaying those rows as pending would
  // silently duplicate non-idempotent Engine projections. Quarantine that
  // uncertainty as LEGACY_UNKNOWN, and retain a durable audit marker so a
  // later explicit rebuild can account for it.
  if (priorDeliverySchema) return;
  const rows = db.prepare(`SELECT a.id,a.body,e.event_hash AS eventHash FROM audit a
    JOIN audit_event_dedupe e ON e.audit_id=a.id
    WHERE a.event='canonical_ingress_committed_v1' ORDER BY a.id`).all() as { id: number; body: string; eventHash: string }[];
  const migrate = () => {
    const migratedAt = Date.now();
    const insert = db.prepare(`INSERT INTO canonical_ingress_delivery_v1(observation_id,audit_id,entry_hash,acknowledged_at_ms,delivery_status)
      VALUES(?,?,?,NULL,'LEGACY_UNKNOWN') ON CONFLICT(observation_id) DO NOTHING`);
    const observationIds: string[] = [];
    for (const row of rows) {
      let payload: any;
      try { payload = JSON.parse(row.body); } catch { throw new Error('INGRESS_OUTBOX_ROW_INVALID'); }
      if (typeof payload?.observationId !== 'string' || !/^[a-f0-9]{64}$/.test(payload.observationId) ||
          typeof payload.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.entryHash) ||
          typeof row.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.eventHash)) {
        throw new Error('INGRESS_OUTBOX_ROW_INVALID');
      }
      insert.run(payload.observationId, row.id, row.eventHash);
      observationIds.push(payload.observationId);
    }
    if (observationIds.length > 0) {
      const markerEvent = 'canonical_ingress_legacy_delivery_migration_v1';
      const markerId = 'canonical-ingress-legacy-delivery-migration:v1';
      const marker = JSON.stringify({ schemaVersion: 1, policy: 'LEGACY_OUTCOME_UNKNOWN_DO_NOT_REPLAY',
        migratedAtMs: migratedAt, rowCount: observationIds.length,
        observationIdsSha256: createHash('sha256').update([...observationIds].sort().join('\n')).digest('hex') });
      const markerHash = createHash('sha256').update(`${markerEvent}:${marker}`).digest('hex');
      const previous = db.prepare('SELECT event_hash FROM audit_event_dedupe WHERE event_id=?').get(markerId) as { event_hash: string } | undefined;
      if (previous && previous.event_hash !== markerHash) throw new Error('INGRESS_LEGACY_MIGRATION_MARKER_CONFLICT');
      if (!previous) {
        const info = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(migratedAt, markerEvent, marker);
        db.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,?,?)')
          .run(markerId, markerHash, Number(info.lastInsertRowid), migratedAt);
      }
    }
  };
  migrate();
}

function ensureIngressDeliverySchema(): void {
  if (db.isTransaction) {
    ensureIngressDeliverySchemaInternal();
    return;
  }
  // Schema creation, legacy classification and its audit marker must commit
  // together; otherwise a crash after CREATE TABLE could make the next boot
  // mistake an incomplete migration for a completed one.
  db.exec('BEGIN IMMEDIATE');
  try { ensureIngressDeliverySchemaInternal(); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

parentPort!.on('message', (m: { id: number; op: string; body?: string; event?: string; eventId?: string }) => {
  try {
    if (m.op === 'runtime-store-instance-id') {
      parentPort!.postMessage({ id: m.id, value: runtimeStoreInstanceId() });
    } else if (m.op === 'assert-ingress-durability') {
      const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
      const journalMode = db.prepare('PRAGMA journal_mode').get()!.journal_mode;
      const synchronous = db.prepare('PRAGMA synchronous').get()!.synchronous;
      if (!registrationCapable || typeof file !== 'string' || file.length === 0 || journalMode !== 'wal' || synchronous !== 2) {
        throw new Error('INGRESS_DURABLE_JOURNAL_REQUIRED');
      }
      ensureIngressDeliverySchema();
      parentPort!.postMessage({ id: m.id, value: 'FSYNC_COMMITTED' });
    } else if (m.op === 'register-initial-generation') {
      const result = registerInitialGenerationSync(db, registrationCapable, m.body);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(result) });
    } else if (m.op === 'read-generation-identity') {
      const result = readGenerationIdentitySync(db, registrationCapable, m.body);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(result) });
    } else if (m.op === 'load') {
      const row = db.prepare('SELECT body FROM state WHERE id=1').get();
      parentPort!.postMessage({ id: m.id, value: row?.body ?? null });
    } else if (m.op === 'save') {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.body!);
        if (m.event !== undefined && (typeof m.event !== 'string' || m.event.length < 1 || m.event.length > 256)) throw new Error('invalid state audit event');
        if (m.event) db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body!);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'append-audit-event') {
      if (typeof m.event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(m.event) ||
          typeof m.body !== 'string' || Buffer.byteLength(m.body) > 65_536) throw new Error('invalid audit event');
      const payload = JSON.parse(m.body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid audit event payload');
      const stableEventId = m.eventId;
      if (stableEventId !== undefined) {
        if (typeof stableEventId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(stableEventId)) {
          throw new Error('invalid audit event id');
        }
        const eventHash = createHash('sha256').update(`${m.event}:${m.body}`).digest('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          if (m.event === 'runtime_telemetry_observed_v2') {
            assertRuntimeDurability();
            const identity = db.prepare('SELECT instance_id FROM runtime_store_identity_v1 WHERE singleton=1').get();
            if (!identity || identity.instance_id !== payload.storeInstanceId) throw new Error('RUNTIME_STORE_IDENTITY_MISMATCH');
          }
          db.exec('CREATE TABLE IF NOT EXISTS audit_event_dedupe(event_id TEXT PRIMARY KEY, event_hash TEXT NOT NULL, audit_id INTEGER, created_at_ms INTEGER NOT NULL) STRICT;');
          const existing = db.prepare('SELECT event_hash, audit_id FROM audit_event_dedupe WHERE event_id=?').get(stableEventId) as { event_hash: string; audit_id: number } | undefined;
          if (existing) {
            if (existing.event_hash !== eventHash) {
              throw new Error('DUPLICATE_EVENT_ID_CONTENT_CONFLICT');
            }
            if (m.event === 'canonical_ingress_committed_v1') {
              ensureIngressDeliverySchema();
              const record = db.prepare('SELECT audit_id,entry_hash FROM canonical_ingress_delivery_v1 WHERE observation_id=?').get(payload.observationId) as
                { audit_id: number; entry_hash: string } | undefined;
              if (!record || record.audit_id !== existing.audit_id || record.entry_hash !== eventHash) throw new Error('INGRESS_OUTBOX_ROW_CONFLICT');
            }
            db.exec('COMMIT');
            parentPort!.postMessage({ id: m.id, value: JSON.stringify({ inserted: false, auditId: existing.audit_id }) });
            return;
          }
          if (m.event === 'canonical_ingress_committed_v1') ensureIngressDeliverySchema();
          const info = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body);
          const auditId = Number(info.lastInsertRowid);
          db.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,?,?)').run(stableEventId, eventHash, auditId, Date.now());
          if (m.event === 'canonical_ingress_committed_v1') {
            if (typeof payload.observationId !== 'string' || !/^[a-f0-9]{64}$/.test(payload.observationId) ||
                typeof payload.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.entryHash)) throw new Error('invalid canonical ingress delivery identity');
            db.prepare(`INSERT INTO canonical_ingress_delivery_v1(observation_id,audit_id,entry_hash,acknowledged_at_ms,delivery_status)
              VALUES(?,?,?,NULL,'PENDING')`).run(payload.observationId, auditId, eventHash);
            const record = db.prepare('SELECT audit_id,entry_hash FROM canonical_ingress_delivery_v1 WHERE observation_id=?').get(payload.observationId) as
              { audit_id: number; entry_hash: string } | undefined;
            if (!record || record.audit_id !== auditId || record.entry_hash !== eventHash) throw new Error('INGRESS_OUTBOX_ROW_CONFLICT');
          }
          db.exec('COMMIT');
          parentPort!.postMessage({ id: m.id, value: JSON.stringify({ inserted: true, auditId }) });
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      } else {
        db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body);
        parentPort!.postMessage({ id: m.id, value: null });
      }
    } else if (m.op === 'get-audit-events') {
      const query = JSON.parse(m.body!);
      if (!query || typeof query.event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(query.event) ||
          !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 10_000) throw new Error('invalid audit query');
      const rows = db.prepare('SELECT id,at,event,body FROM audit WHERE event=? ORDER BY id ASC LIMIT ?').all(query.event, query.limit);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'get-audit-event-by-stable-id') {
      if (typeof m.body !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(m.body)) throw new Error('invalid audit event id');
      const dedupeTable = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='audit_event_dedupe'").get();
      const row = dedupeTable ? db.prepare(`SELECT COALESCE(a.id,d.audit_id) AS id,COALESCE(a.at,d.created_at_ms) AS at,
        a.event,a.body,d.event_hash AS eventHash,(a.id IS NULL) AS pruned FROM audit_event_dedupe d
        LEFT JOIN audit a ON a.id=d.audit_id WHERE d.event_id=?`).get(m.body) : undefined;
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'get-pending-ingress') {
      const query = JSON.parse(m.body!);
      if (!query || !Number.isSafeInteger(query.afterSequence) || query.afterSequence < 0 ||
          !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000) throw new Error('invalid ingress outbox query');
      ensureIngressDeliverySchema();
      const rows = db.prepare(`SELECT d.audit_id AS id,a.at,a.body,d.entry_hash AS eventHash
        FROM canonical_ingress_delivery_v1 d JOIN audit a ON a.id=d.audit_id
        WHERE d.delivery_status='PENDING' AND d.audit_id>? ORDER BY d.audit_id LIMIT ?`).all(query.afterSequence, query.limit);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'load-engine-projection') {
      const exists = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_engine_projection_v1'").get();
      const row = exists ? db.prepare(`SELECT sequence,observation_id AS observationId,entry_hash AS entryHash,
        projection_json AS projectionJson,state_json AS stateJson,projection_hash AS projectionHash,state_hash AS stateHash
        FROM canonical_ingress_engine_projection_v1 WHERE id=1`).get() as any : undefined;
      if (!row) parentPort!.postMessage({ id: m.id, value: null });
      else {
        if (!Number.isSafeInteger(row.sequence) || row.sequence < 1 || typeof row.observationId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(row.observationId) || typeof row.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.entryHash) ||
            typeof row.projectionJson !== 'string' || typeof row.stateJson !== 'string' ||
            createHash('sha256').update(row.projectionJson).digest('hex') !== row.projectionHash ||
            createHash('sha256').update(row.stateJson).digest('hex') !== row.stateHash) throw new Error('ENGINE_PROJECTION_CHECKPOINT_INVALID');
        parentPort!.postMessage({ id: m.id, value: JSON.stringify({ sequence: row.sequence, observationId: row.observationId,
          entryHash: row.entryHash, projectionJson: row.projectionJson, stateJson: row.stateJson }) });
      }
    } else if (m.op === 'commit-engine-projection') {
      const input = JSON.parse(m.body!);
      if (!input || typeof input.observationId !== 'string' || !/^[a-f0-9]{64}$/.test(input.observationId) ||
          !Number.isSafeInteger(input.sequence) || input.sequence < 1 || typeof input.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.entryHash) ||
          typeof input.projectionJson !== 'string' || Buffer.byteLength(input.projectionJson) > 32 * 1024 * 1024 ||
          typeof input.stateJson !== 'string' || Buffer.byteLength(input.stateJson) > 32 * 1024 * 1024) throw new Error('ENGINE_PROJECTION_INPUT_INVALID');
      let projection: any, state: any;
      try { projection = JSON.parse(input.projectionJson); state = JSON.parse(input.stateJson); }
      catch { throw new Error('ENGINE_PROJECTION_JSON_INVALID'); }
      if (!projection || projection.schemaVersion !== 1 || projection.sequence !== input.sequence ||
          projection.observationId !== input.observationId || projection.entryHash !== input.entryHash ||
          !state || typeof state !== 'object' || Array.isArray(state)) throw new Error('ENGINE_PROJECTION_IDENTITY_MISMATCH');
      ensureIngressDeliverySchema();
      db.exec(`CREATE TABLE IF NOT EXISTS canonical_ingress_engine_projection_v1(
        id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL CHECK(sequence>0),
        observation_id TEXT NOT NULL CHECK(length(observation_id)=64 AND observation_id NOT GLOB '*[^a-f0-9]*'),
        entry_hash TEXT NOT NULL CHECK(length(entry_hash)=64 AND entry_hash NOT GLOB '*[^a-f0-9]*'),
        projection_json TEXT NOT NULL,projection_hash TEXT NOT NULL CHECK(length(projection_hash)=64 AND projection_hash NOT GLOB '*[^a-f0-9]*'),
        state_json TEXT NOT NULL,state_hash TEXT NOT NULL CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^a-f0-9]*')
      ) STRICT;`);
      const projectionHash = createHash('sha256').update(input.projectionJson).digest('hex');
      const stateHash = createHash('sha256').update(input.stateJson).digest('hex');
      const ackEvent = 'canonical_ingress_delivery_ack_v1';
      const ackEventId = `ingress-delivery:${input.observationId}`;
      const ackPayload = JSON.stringify({ schemaVersion: 1, observationId: input.observationId, journalSeq: input.sequence, entryHash: input.entryHash });
      const ackHash = createHash('sha256').update(`${ackEvent}:${ackPayload}`).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const delivery = db.prepare(`SELECT audit_id,entry_hash,delivery_status FROM canonical_ingress_delivery_v1 WHERE observation_id=?`).get(input.observationId) as
          { audit_id: number; entry_hash: string; delivery_status: string } | undefined;
        if (!delivery || delivery.audit_id !== input.sequence || delivery.entry_hash !== input.entryHash) throw new Error('INGRESS_ACK_IDENTITY_MISMATCH');
        if (delivery.delivery_status !== 'PENDING') throw new Error(delivery.delivery_status === 'LEGACY_UNKNOWN' ? 'INGRESS_LEGACY_DELIVERY_REQUIRES_REBUILD' : 'INGRESS_PROJECTION_ALREADY_ACKNOWLEDGED');
        const existing = db.prepare('SELECT sequence,observation_id,entry_hash FROM canonical_ingress_engine_projection_v1 WHERE id=1').get() as
          { sequence: number; observation_id: string; entry_hash: string } | undefined;
        if (existing && existing.sequence >= input.sequence) throw new Error('ENGINE_PROJECTION_SEQUENCE_REGRESSION');
        db.prepare(`INSERT INTO canonical_ingress_engine_projection_v1(id,sequence,observation_id,entry_hash,projection_json,projection_hash,state_json,state_hash)
          VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,observation_id=excluded.observation_id,
          entry_hash=excluded.entry_hash,projection_json=excluded.projection_json,projection_hash=excluded.projection_hash,
          state_json=excluded.state_json,state_hash=excluded.state_hash`).run(input.sequence,input.observationId,input.entryHash,
            input.projectionJson,projectionHash,input.stateJson,stateHash);
        db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(input.stateJson);
        db.prepare(`UPDATE canonical_ingress_delivery_v1 SET acknowledged_at_ms=?,delivery_status='ACKNOWLEDGED'
          WHERE observation_id=? AND delivery_status='PENDING'`).run(Date.now(),input.observationId);
        const prior = db.prepare('SELECT event_hash FROM audit_event_dedupe WHERE event_id=?').get(ackEventId) as { event_hash: string } | undefined;
        if (prior && prior.event_hash !== ackHash) throw new Error('INGRESS_ACK_CONTENT_CONFLICT');
        if (!prior) {
          const info = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(),ackEvent,ackPayload);
          db.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,?,?)')
            .run(ackEventId,ackHash,Number(info.lastInsertRowid),Date.now());
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'acknowledge-ingress') {
      const ack = JSON.parse(m.body!);
      if (!ack || typeof ack.observationId !== 'string' || !/^[a-f0-9]{64}$/.test(ack.observationId) ||
          !Number.isSafeInteger(ack.sequence) || ack.sequence < 1 || typeof ack.entryHash !== 'string' || !/^[a-f0-9]{64}$/.test(ack.entryHash)) {
        throw new Error('invalid ingress acknowledgement');
      }
      ensureIngressDeliverySchema();
      const stableEventId = `ingress-delivery:${ack.observationId}`;
      const ackPayload = JSON.stringify({ schemaVersion: 1, observationId: ack.observationId, journalSeq: ack.sequence, entryHash: ack.entryHash });
      const ackEvent = 'canonical_ingress_delivery_ack_v1';
      const ackEventHash = createHash('sha256').update(`${ackEvent}:${ackPayload}`).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare(`SELECT audit_id,entry_hash,acknowledged_at_ms,delivery_status FROM canonical_ingress_delivery_v1 WHERE observation_id=?`).get(ack.observationId) as
          { audit_id: number; entry_hash: string; acknowledged_at_ms: number | null; delivery_status: string } | undefined;
        if (!row || row.audit_id !== ack.sequence || row.entry_hash !== ack.entryHash) throw new Error('INGRESS_ACK_IDENTITY_MISMATCH');
        if (row.delivery_status === 'LEGACY_UNKNOWN') throw new Error('INGRESS_LEGACY_DELIVERY_REQUIRES_REBUILD');
        if (row.delivery_status === 'PENDING') {
          db.prepare(`UPDATE canonical_ingress_delivery_v1 SET acknowledged_at_ms=?,delivery_status='ACKNOWLEDGED'
            WHERE observation_id=? AND delivery_status='PENDING'`).run(Date.now(), ack.observationId);
          db.exec('CREATE TABLE IF NOT EXISTS audit_event_dedupe(event_id TEXT PRIMARY KEY, event_hash TEXT NOT NULL, audit_id INTEGER, created_at_ms INTEGER NOT NULL) STRICT;');
          const prior = db.prepare('SELECT event_hash FROM audit_event_dedupe WHERE event_id=?').get(stableEventId) as { event_hash: string } | undefined;
          if (prior && prior.event_hash !== ackEventHash) throw new Error('INGRESS_ACK_CONTENT_CONFLICT');
          if (!prior) {
            const info = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), ackEvent, ackPayload);
            db.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,?,?)').run(stableEventId, ackEventHash, Number(info.lastInsertRowid), Date.now());
          }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'prepare-signing') {
      const intent = JSON.parse(m.body!);
      if (!intent.economicIntentId || !intent.grantId || !intent.wallet || !/^[a-f0-9]{64}$/.test(intent.messageSha256) ||
          !Number.isSafeInteger(intent.controlEpoch) || !Number.isSafeInteger(intent.preparedAtMs)) throw new Error('invalid signing intent');
      const revEpoch = Number.isSafeInteger(intent.revocationEpoch) ? intent.revocationEpoch : 0;
      db.prepare(`INSERT INTO signing_intents(economic_intent_id,grant_id,wallet,message_sha256,control_epoch,revocation_epoch,prepared_at,state)
        VALUES(?,?,?,?,?,?,?,'PREPARED')`).run(intent.economicIntentId, intent.grantId, intent.wallet,
          intent.messageSha256, intent.controlEpoch, revEpoch, intent.preparedAtMs);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'mark-signed') {
      const signed = JSON.parse(m.body!);
      if (!signed.economicIntentId || !/^[a-f0-9]{64}$/.test(signed.messageSha256) ||
          typeof signed.signatureBase64 !== 'string' || Buffer.from(signed.signatureBase64, 'base64').byteLength !== 64) {
        throw new Error('invalid signed intent');
      }
      const result = db.prepare(`UPDATE signing_intents SET state='SIGNED',signature_base64=?
        WHERE economic_intent_id=? AND message_sha256=? AND state='PREPARED'`).run(
          signed.signatureBase64, signed.economicIntentId, signed.messageSha256);
      if (result.changes !== 1) throw new Error('signing intent missing, altered, or already finalized');
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-signing-intent') {
      if (typeof m.body !== 'string' || m.body.length < 1 || m.body.length > 256) throw new Error('invalid signing intent lookup');
      const row = db.prepare(`SELECT economic_intent_id AS economicIntentId,wallet,message_sha256 AS messageSha256,
        state,signature_base64 AS signatureBase64 FROM signing_intents WHERE economic_intent_id=? AND record_kind='LEGACY_SIGNING'`).get(m.body);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(row ?? null) });
    } else if (m.op === 'save-capital-commit') {
      const commit = JSON.parse(m.body!);
      db.prepare(`INSERT INTO capital_commits(intent_id, reservation_id, certificate_id, capital_state_root, certificate_hash, committed_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET certificate_hash=excluded.certificate_hash`).run(
          commit.intentId, commit.reservationId, commit.certificateId, commit.capitalStateRoot, commit.certificateHash, Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'append-capital-event') {
      const ev = JSON.parse(m.body!);
      db.prepare(`INSERT INTO capital_events(sequence_number, event_type, timestamp_ms, slot, entity_id, delta_lamports, balance_after_lamports, previous_event_hash, event_hash, payload_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          ev.sequence_number, ev.event_type, ev.timestamp_ms, ev.slot, ev.entity_id,
          String(ev.delta_lamports), String(ev.balance_after_lamports), ev.previous_event_hash, ev.event_hash, JSON.stringify(ev.payload || {})
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'backup') {
      const dest = m.body;
      if (!dest) throw new Error('backup destination path required');
      const safeDest = dest.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${safeDest}';`);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'save-recovery-certificate') {
      const cert = JSON.parse(m.body!);
      if (!cert || typeof cert !== 'object' || Array.isArray(cert) ||
        'startSlot' in cert || 'perSlotStatus' in cert || typeof cert.certificateId !== 'string' || !cert.certificateId ||
        typeof cert.gapId !== 'string' || !cert.gapId || !Number.isSafeInteger(cert.fromSlot) || !Number.isSafeInteger(cert.toSlot) ||
        cert.fromSlot < 1 || cert.toSlot < cert.fromSlot || typeof cert.providerId !== 'string' || !cert.providerId ||
        typeof cert.signature !== 'string' || !cert.signature) throw new Error('RECOVERY_CERTIFICATE_USE_V2_JOURNAL');
      const certificateJson = JSON.stringify(cert);
      if (Buffer.byteLength(certificateJson, 'utf8') > 32 * 1024 * 1024) throw new Error('RECOVERY_CERTIFICATE_INVALID');
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing: any = db.prepare('SELECT certificate_json FROM recovery_certificates WHERE certificate_id=?').get(cert.certificateId);
        if (existing) {
          if (existing.certificate_json !== certificateJson) throw new Error('RECOVERY_CERTIFICATE_CONTENT_CONFLICT');
        } else {
          db.prepare(`INSERT INTO recovery_certificates(certificate_id, gap_id, from_slot, to_slot, provider_id, recovered_events_count, skipped_slots_json, dead_fork_slots_json, coverage_root, state_root, resolved_at_ms, signature, certificate_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
              cert.certificateId, cert.gapId, cert.fromSlot, cert.toSlot, cert.providerId,
              cert.recoveredEventIds?.length ?? 0, JSON.stringify(cert.skippedSlots ?? []), JSON.stringify(cert.deadForkSlots ?? []),
              cert.coverageRoot ?? null, cert.stateRoot ?? null, cert.resolvedAtMs ?? Date.now(), cert.signature, certificateJson
            );
        }
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-recovery-certificate') {
      const id = m.body!;
      const row: any = db.prepare('SELECT certificate_json FROM recovery_certificates WHERE certificate_id=? OR gap_id=?').get(id, id);
      parentPort!.postMessage({ id: m.id, value: row?.certificate_json ?? null });
    } else if (m.op === 'save-verified-recovery-certificate') {
      const request = JSON.parse(m.body!);
      if (!request || typeof request.certificateJson !== 'string' || typeof request.certificateSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.certificateSha256) || Buffer.byteLength(request.certificateJson, 'utf8') > 32 * 1024 * 1024) {
        throw new Error('RECOVERY_CERTIFICATE_INVALID');
      }
      let certificate: unknown;
      try { certificate = JSON.parse(request.certificateJson); } catch { throw new Error('RECOVERY_CERTIFICATE_INVALID'); }
      const serialized = serializeRecoveryCertificate(certificate);
      if (!serialized || serialized.certificateJson !== request.certificateJson || serialized.certificateSha256 !== request.certificateSha256) {
        throw new Error('RECOVERY_CERTIFICATE_INVALID');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        ensureVerifiedRecoveryCertificateSchema();
        const cert = serialized.certificate;
        const existing: any = db.prepare('SELECT certificate_sha256,certificate_json FROM verified_recovery_certificates_v2 WHERE certificate_id=?').get(cert.certificateId);
        if (existing) {
          if (existing.certificate_sha256 !== serialized.certificateSha256 || existing.certificate_json !== serialized.certificateJson) {
            throw new Error('RECOVERY_CERTIFICATE_CONTENT_CONFLICT');
          }
        } else {
          db.prepare(`INSERT INTO verified_recovery_certificates_v2(
            certificate_id,gap_id,start_slot,end_slot,provider_id,classification,lane,state_root,coverage_root,
            certified_at_ms,certificate_sha256,certificate_json
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            cert.certificateId, cert.gapId, cert.startSlot, cert.endSlot, cert.providerId, cert.classification,
            cert.lane, cert.stateRoot, cert.coverageRoot, cert.certifiedAtMs, serialized.certificateSha256, serialized.certificateJson,
          );
        }
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-verified-recovery-certificate') {
      const lookup = m.body!;
      if (typeof lookup !== 'string' || lookup.length < 1 || lookup.length > 256) throw new Error('RECOVERY_CERTIFICATE_LOOKUP_INVALID');
      ensureVerifiedRecoveryCertificateSchema();
      const row: any = db.prepare(`SELECT certificate_id,gap_id,start_slot,end_slot,provider_id,classification,lane,state_root,
        coverage_root,certified_at_ms,certificate_sha256,certificate_json FROM verified_recovery_certificates_v2
        WHERE certificate_id=? OR gap_id=? ORDER BY certified_at_ms DESC,certificate_id ASC LIMIT 1`).get(lookup, lookup);
      if (!row) parentPort!.postMessage({ id: m.id, value: null });
      else {
        let certificate: unknown;
        try { certificate = JSON.parse(row.certificate_json); } catch { throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT'); }
        const serialized = serializeRecoveryCertificate(certificate);
        const cert = serialized?.certificate;
        if (!serialized || !cert || serialized.certificateJson !== row.certificate_json ||
          serialized.certificateSha256 !== row.certificate_sha256 || cert.certificateId !== row.certificate_id ||
          cert.gapId !== row.gap_id || cert.startSlot !== row.start_slot || cert.endSlot !== row.end_slot ||
          cert.providerId !== row.provider_id || cert.classification !== row.classification || cert.lane !== row.lane ||
          cert.stateRoot !== row.state_root || cert.coverageRoot !== row.coverage_root || cert.certifiedAtMs !== row.certified_at_ms) {
          throw new Error('RECOVERY_CERTIFICATE_ROW_INCONSISTENT');
        }
        parentPort!.postMessage({ id: m.id, value: row.certificate_json });
      }
    } else if (m.op === 'save-coverage-frontier') {
      const frontier = JSON.parse(m.body!);
      db.prepare(`INSERT INTO coverage_frontiers(lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms)
        VALUES(?,?,?,?,?)
        ON CONFLICT(lane) DO UPDATE SET continuous_slot=excluded.continuous_slot, sealed_slot=excluded.sealed_slot, coverage_root=excluded.coverage_root, updated_at_ms=excluded.updated_at_ms`).run(
          frontier.lane,
          frontier.continuousSlot ?? frontier.continuous_slot,
          frontier.sealedSlot ?? frontier.sealed_slot ?? null,
          frontier.coverageRoot ?? frontier.coverage_root ?? null,
          Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-coverage-frontier') {
      const lane = m.body!;
      const row: any = db.prepare('SELECT lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms FROM coverage_frontiers WHERE lane=?').get(lane);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'save-contract-canary') {
      const canary = JSON.parse(m.body!);
      db.prepare(`INSERT INTO contract_canaries(
        provider_id, transport_health, schema_health, semantic_health, freshness_health, quota_health,
        is_quarantined, last_validated_slot, last_validated_at_ms, failure_reason, contract_epoch_id, contract_fingerprint, updated_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider_id) DO UPDATE SET
        transport_health=excluded.transport_health,
        schema_health=excluded.schema_health,
        semantic_health=excluded.semantic_health,
        freshness_health=excluded.freshness_health,
        quota_health=excluded.quota_health,
        is_quarantined=excluded.is_quarantined,
        last_validated_slot=excluded.last_validated_slot,
        last_validated_at_ms=excluded.last_validated_at_ms,
        failure_reason=excluded.failure_reason,
        contract_epoch_id=excluded.contract_epoch_id,
        contract_fingerprint=excluded.contract_fingerprint,
        updated_at_ms=excluded.updated_at_ms`).run(
          canary.providerId ?? canary.provider_id,
          canary.transportHealth ?? canary.transport_health ?? 'HEALTHY',
          canary.schemaHealth ?? canary.schema_health ?? 'HEALTHY',
          canary.semanticHealth ?? canary.semantic_health ?? 'HEALTHY',
          canary.freshnessHealth ?? canary.freshness_health ?? 'HEALTHY',
          canary.quotaHealth ?? canary.quota_health ?? 'HEALTHY',
          canary.isQuarantined || canary.is_quarantined ? 1 : 0,
          canary.lastValidatedSlot ?? canary.last_validated_slot ?? 0,
          canary.lastValidatedAtMs ?? canary.last_validated_at_ms ?? Date.now(),
          canary.failureReason ?? canary.failure_reason ?? null,
          canary.contractEpochId ?? canary.contract_epoch_id ?? null,
          canary.contractFingerprint ?? canary.contract_fingerprint ?? null,
          Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-contract-canary') {
      const providerId = m.body!;
      const row: any = db.prepare('SELECT * FROM contract_canaries WHERE provider_id=?').get(providerId);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'get-all-contract-canaries') {
      const rows: any[] = db.prepare('SELECT * FROM contract_canaries').all();
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'save-provider-quota') {
      const q = JSON.parse(m.body!);
      db.prepare(`INSERT INTO provider_quotas(provider_id, rate_limited_until_ms, circuit_state, circuit_tripped_at_ms, consecutive_recovery, last_failure_reason, updated_at_ms)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET
          rate_limited_until_ms=excluded.rate_limited_until_ms,
          circuit_state=excluded.circuit_state,
          circuit_tripped_at_ms=excluded.circuit_tripped_at_ms,
          consecutive_recovery=excluded.consecutive_recovery,
          last_failure_reason=excluded.last_failure_reason,
          updated_at_ms=excluded.updated_at_ms`).run(
        q.providerId ?? q.provider_id,
        q.rateLimitedUntilMs ?? q.rate_limited_until_ms ?? 0,
        q.circuitState ?? q.circuit_state ?? 'CLOSED',
        q.circuitTrippedAtMs ?? q.circuit_tripped_at_ms ?? 0,
        q.consecutiveRecovery ?? q.consecutive_recovery ?? 0,
        q.lastFailureReason ?? q.last_failure_reason ?? null,
        Date.now()
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-provider-quota') {
      const providerId = m.body!;
      const row: any = db.prepare('SELECT * FROM provider_quotas WHERE provider_id=?').get(providerId);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'get-all-provider-quotas') {
      const rows: any[] = db.prepare('SELECT * FROM provider_quotas').all();
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'save-counterfactual-evaluation') {
      const ev = JSON.parse(m.body!);
      db.exec('BEGIN IMMEDIATE');
      try {
        const old = db.prepare('SELECT decision_id, opportunity_id, token_id, strategy_version, slot, timestamp_ms, action_taken, realized_pnl_bps, best_counterfactual_scenario, max_counterfactual_pnl_bps, overall_regret_bps, discovery_regret_bps, pricing_regret_bps, execution_regret_bps, exit_regret_bps, primary_failure_subsystem, actionable_policy_tuning, evaluation_json FROM counterfactual_regrets WHERE evaluation_id=?')
          .get(ev.evaluationId) as Record<string, unknown> | undefined;
        if (old) {
          const actual = [old.decision_id, old.opportunity_id, old.token_id, old.strategy_version, old.slot, old.timestamp_ms,
            old.action_taken, old.realized_pnl_bps, old.best_counterfactual_scenario, old.max_counterfactual_pnl_bps,
            old.overall_regret_bps, old.discovery_regret_bps, old.pricing_regret_bps, old.execution_regret_bps, old.exit_regret_bps,
            old.primary_failure_subsystem, old.actionable_policy_tuning, old.evaluation_json];
          const expected = [ev.decisionId, ev.opportunityId, ev.tokenId, ev.strategyVersion, ev.slot, ev.timestamp,
            ev.actionTaken, ev.realizedPnlBps, ev.bestCounterfactualScenario, ev.maxCounterfactualPnlBps,
            ev.overallRegretBps, ev.alphaDecomposition?.discoveryRegretBps ?? 0, ev.alphaDecomposition?.pricingRegretBps ?? 0,
            ev.alphaDecomposition?.executionRegretBps ?? 0, ev.alphaDecomposition?.exitRegretBps ?? 0,
            ev.primaryFailureSubsystem, ev.actionablePolicyTuning, m.body];
          if (actual.some((value, index) => value !== expected[index])) {
            throw new Error(old.evaluation_json === m.body ? 'COUNTERFACTUAL_ROW_INCONSISTENT' : 'COUNTERFACTUAL_ID_CONTENT_CONFLICT');
          }
        } else {
          db.prepare(`INSERT INTO counterfactual_regrets(
            evaluation_id, decision_id, opportunity_id, token_id, strategy_version, slot, timestamp_ms,
            action_taken, realized_pnl_bps, best_counterfactual_scenario, max_counterfactual_pnl_bps,
            overall_regret_bps, discovery_regret_bps, pricing_regret_bps, execution_regret_bps, exit_regret_bps,
            primary_failure_subsystem, actionable_policy_tuning, evaluation_json
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            ev.evaluationId, ev.decisionId, ev.opportunityId, ev.tokenId, ev.strategyVersion, ev.slot, ev.timestamp,
            ev.actionTaken, ev.realizedPnlBps, ev.bestCounterfactualScenario, ev.maxCounterfactualPnlBps,
            ev.overallRegretBps, ev.alphaDecomposition?.discoveryRegretBps ?? 0, ev.alphaDecomposition?.pricingRegretBps ?? 0,
            ev.alphaDecomposition?.executionRegretBps ?? 0, ev.alphaDecomposition?.exitRegretBps ?? 0,
            ev.primaryFailureSubsystem, ev.actionablePolicyTuning, m.body!
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-counterfactual-evaluation') {
      const id = m.body!;
      const row: any = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE evaluation_id=?').get(id);
      parentPort!.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
    } else if (m.op === 'get-counterfactual-evaluations-for-token') {
      const tokenId = m.body!;
      const rows: any[] = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE token_id=? ORDER BY slot ASC').all(tokenId);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows.map(r => JSON.parse(r.evaluation_json))) });
    } else if (m.op === 'save-falsification-report') {
      const rep = JSON.parse(m.body!);
      db.exec('BEGIN IMMEDIATE');
      try {
        const old = db.prepare('SELECT mint, slot, is_thesis_falsified, falsification_confidence, survivability_index, minimum_plausible_break_capital_sol, lethal_attack_vector, is_veto_recommended, rationale, report_json FROM falsification_reports WHERE report_id=?')
          .get(rep.reportId) as Record<string, unknown> | undefined;
        if (old) {
          const actual = [old.mint, old.slot, old.is_thesis_falsified, old.falsification_confidence, old.survivability_index,
            old.minimum_plausible_break_capital_sol, old.lethal_attack_vector, old.is_veto_recommended, old.rationale, old.report_json];
          const expected = [rep.mint, rep.slot, rep.isThesisFalsified ? 1 : 0, rep.falsificationConfidence,
            rep.survivabilityIndex, rep.minimumPlausibleBreakCapitalSol, rep.lethalAttackVector,
            rep.isVetoRecommended ? 1 : 0, rep.rationale, m.body];
          if (actual.some((value, index) => value !== expected[index])) {
            throw new Error(old.report_json === m.body ? 'FALSIFICATION_ROW_INCONSISTENT' : 'FALSIFICATION_ID_CONTENT_CONFLICT');
          }
        } else {
          db.prepare(`INSERT INTO falsification_reports(
            report_id, mint, slot, is_thesis_falsified, falsification_confidence, survivability_index,
            minimum_plausible_break_capital_sol, lethal_attack_vector, is_veto_recommended, rationale, report_json, created_at_ms
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            rep.reportId, rep.mint, rep.slot, rep.isThesisFalsified ? 1 : 0, rep.falsificationConfidence,
            rep.survivabilityIndex, rep.minimumPlausibleBreakCapitalSol, rep.lethalAttackVector,
            rep.isVetoRecommended ? 1 : 0, rep.rationale, m.body!, Date.now()
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-falsification-report') {
      const id = m.body!;
      const row: any = db.prepare('SELECT report_json FROM falsification_reports WHERE report_id=?').get(id);
      parentPort!.postMessage({ id: m.id, value: row?.report_json ?? null });
    } else if (m.op === 'save-entity-control-evaluation') {
      const evalResult = JSON.parse(m.body!);
      db.prepare(`INSERT INTO entity_control_evaluations(
        mint, raw_wallet_count, resolved_entity_count, deception_gap, entity_entropy,
        normalized_entity_entropy, dominant_entity_supply_fraction, latent_inventory_fraction,
        supply_avalanche_risk, is_entropy_collapsed, evaluation_json, evaluated_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mint) DO UPDATE SET evaluation_json=excluded.evaluation_json, evaluated_at_ms=excluded.evaluated_at_ms`).run(
        evalResult.mint, evalResult.rawWalletCount, evalResult.resolvedEntityCount,
        evalResult.deceptionGap, evalResult.entityEntropy, evalResult.normalizedEntityEntropy,
        evalResult.dominantEntitySupplyFraction, evalResult.latentInventoryFraction,
        evalResult.supplyAvalancheRisk, evalResult.isEntropyCollapsed ? 1 : 0, JSON.stringify(evalResult), Date.now()
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-entity-control-evaluation') {
      const mint = m.body!;
      const row: any = db.prepare('SELECT evaluation_json FROM entity_control_evaluations WHERE mint=?').get(mint);
      parentPort!.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
    } else if (m.op === 'prune') {
      const maxAgeMs = m.body === undefined ? 7 * 86_400_000 : Number(m.body);
      if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10 * 365 * 86_400_000) throw new Error('invalid audit retention age');
      const cutoff = Date.now() - maxAgeMs;
      db.exec('BEGIN IMMEDIATE');
      try {
        ensureIngressDeliverySchema();
        const select = db.prepare(`SELECT a.id,a.at,substr(a.event,1,256) AS event FROM audit a
          WHERE a.at < ? AND NOT EXISTS (
            SELECT 1 FROM canonical_ingress_delivery_v1 d WHERE d.audit_id=a.id AND d.delivery_status='PENDING'
          ) ORDER BY a.id LIMIT 50000`);
        select.setReadBigInts(true);
        const rows = select.all(cutoff) as { id: bigint; at: bigint; event: string }[];
        if (!rows.length) {
          db.exec('COMMIT');
          parentPort!.postMessage({ id: m.id, value: JSON.stringify({ prunedRowCount: 0, idRanges: [], limitReached: false }) });
        } else {
          const idRanges: [number, number][] = [];
          let start = rows[0].id, end = rows[0].id;
          const eventCounts: Record<string, number> = Object.create(null);
          for (const row of rows) {
            if (row.id < 0n || row.id > BigInt(Number.MAX_SAFE_INTEGER) || row.at < 0n || row.at > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('audit retention integer out of range');
            if (row.id > end + 1n) { idRanges.push([Number(start), Number(end)]); start = row.id; }
            end = row.id;
            const eventClass = row.event.split(':', 1)[0].slice(0, 64);
            const category = /^[A-Za-z][A-Za-z0-9_.-]*$/.test(eventClass) ? eventClass : 'other';
            eventCounts[category] = (eventCounts[category] ?? 0) + 1;
            if (Object.keys(eventCounts).length > 1000) throw new Error('audit prune event category limit exceeded');
          }
          idRanges.push([Number(start), Number(end)]);
          const deletedAt = Date.now();
          db.prepare(`INSERT INTO audit_prune_ledger(pruned_at_ms,cutoff_at_ms,deleted_row_count,first_id,last_id,id_ranges_json,event_counts_json,first_audit_at_ms,last_audit_at_ms)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(deletedAt, cutoff, rows.length, Number(rows[0].id), Number(rows[rows.length - 1].id),
            JSON.stringify(idRanges), JSON.stringify(eventCounts), Number(rows.reduce((a, row) => a < row.at ? a : row.at, rows[0].at)),
            Number(rows.reduce((a, row) => a > row.at ? a : row.at, rows[0].at)));
          const remove = db.prepare('DELETE FROM audit WHERE id=?');
          for (const row of rows) remove.run(Number(row.id));
          db.exec('COMMIT');
          parentPort!.postMessage({ id: m.id, value: JSON.stringify({ prunedRowCount: rows.length, idRanges, limitReached: rows.length === 50_000 }) });
        }
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (m.op === 'close') { db.close(); parentPort!.postMessage({ id: m.id, value: null }); parentPort!.close(); }
    else throw new Error('unknown database operation');
  } catch (e) {
    const generationOp = m.op === 'register-initial-generation' || m.op === 'read-generation-identity';
    const failure = e instanceof GenerationStorageError ? e : generationOp ? new GenerationStorageError('STORAGE_FAILURE', sqliteDiagnostic(e)) : null;
    parentPort!.postMessage({ id: m.id, error: failure?.message ?? String(e), code: failure?.code, sqliteCode: failure?.sqliteCode });
    if ((e as { poisoned?: boolean })?.poisoned) {
      parentPort!.postMessage({ fatal: true, error: 'STORAGE_OUTCOME_UNKNOWN', code: 'STORAGE_OUTCOME_UNKNOWN' });
      parentPort!.close();
    }
  }
});

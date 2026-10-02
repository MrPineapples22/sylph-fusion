/** Internal synchronous worker implementation; never composed with signing or execution.
 * Injectable dependencies are for owned fixture fault tests, not Store options. */
import { DatabaseSync } from 'node:sqlite';
import { GenerationStorageError, snapshotRegistration, validateGenerationId,
  type GenerationIdentityRead, type RegisteredGenerationIdentity, type RegistrationResult } from './generation-identity.js';
import { legacySigningSchema, generationSigningSchema, generationTriggers, otherStoreSchema } from './generation-schema.js';

type Row = Record<string, any>;
type Hook = (point: string) => void;
const noop: Hook = () => {};
const legacyColumns = 'economic_intent_id,grant_id,wallet,message_sha256,control_epoch,revocation_epoch,prepared_at,state,signature_base64';
const triggerNames = ['initial_generation_no_update', 'initial_generation_no_delete', 'signing_intent_no_kind_change'];
// Ignore formatting outside SQL string literals only; whitespace inside a CHECK
// value is semantic and must not make a modified schema pass its fingerprint.
const normalize = (sql: string) => sql.split(/('(?:''|[^'])*')/g).map((part, i) => i % 2 ? part :
  part.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/"signing_intents"/g, 'signing_intents').replace(/\s+/g, '')).join('').replace(/;$/, '');
const schemaError = () => new GenerationStorageError('SCHEMA_UNSUPPORTED');
const quote = (identifier: string) => '"' + identifier.replace(/"/g, '""') + '"';

export function sqliteRuntimeEligible(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n)) || parts.join('.') !== value) return false;
  if (value === '3.44.6' || value === '3.50.7') return true;
  const floor = [3, 51, 3];
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}
export function sqliteDiagnostic(error: unknown): number | undefined {
  const n = (error as { errcode?: unknown } | null)?.errcode;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 0x7fffffff ? n : undefined;
}
function storageFailure(error: unknown, commitAttempted: boolean): GenerationStorageError {
  if (error instanceof GenerationStorageError) return error;
  const diagnostic = sqliteDiagnostic(error);
  const base = diagnostic === undefined ? undefined : diagnostic & 255;
  return new GenerationStorageError(commitAttempted ? 'STORAGE_OUTCOME_UNKNOWN' :
    base === 5 || base === 6 ? 'STORAGE_BUSY' : base === 19 ? 'STORAGE_INVARIANT_FAILURE' : 'STORAGE_FAILURE', diagnostic, { cause: error });
}
/** A rollback failure poisons the connection; keep original failure as cause.
 * Returning success is impossible until COMMIT has returned. */
export function immediateTransaction<T>(db: DatabaseSync, body: () => T, hook: Hook = noop): T {
  let commitAttempted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    const value = body();
    hook('before-commit');
    commitAttempted = true;
    db.exec('COMMIT');
    hook('after-commit');
    return value;
  } catch (original) {
    let poisoned = false;
    try { if (db.isTransaction) db.exec('ROLLBACK'); poisoned = db.isTransaction; }
    catch { poisoned = true; }
    if (poisoned) {
      try { db.close(); } catch { /* worker will fail closed */ }
      const failure = new GenerationStorageError('STORAGE_OUTCOME_UNKNOWN', sqliteDiagnostic(original), { cause: original });
      Object.defineProperty(failure, 'poisoned', { value: true });
      throw failure;
    }
    throw storageFailure(original, commitAttempted);
  }
}
function objects(db: DatabaseSync): Row[] {
  // Compare the literal reserved prefix; LIKE 'sqlite_%' also hides legal user
  // names such as sqliteXchild, bypassing checks before DROP TABLE can cascade.
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").all();
}
function checkDependencies(db: DatabaseSync, schema: Row[], version: number): void {
  for (const object of schema) {
    // Unrecognized views/triggers are conservatively refused: arbitrary SQL is
    // not reliably analyzed with substring matching or rewritten during migration.
    if (object.type === 'view' || (object.type === 'trigger' && !(version === 1 && triggerNames.includes(object.name)))) throw schemaError();
    if (object.type === 'index' && object.tbl_name === 'signing_intents') throw schemaError();
    if (object.type === 'table') {
      const fks = db.prepare(`PRAGMA foreign_key_list(${quote(object.name)})`).all();
      if (fks.some(fk => String(fk.table).toLowerCase() === 'signing_intents')) throw schemaError();
    }
  }
}
function checkIndexes(db: DatabaseSync, expected: string[]): void {
  const indexes = db.prepare('PRAGMA index_list(signing_intents)').all();
  const actual = indexes.map(index => {
    if (index.unique !== 1 || index.partial !== 0 || !['pk', 'u'].includes(String(index.origin))) throw schemaError();
    const cols = db.prepare(`PRAGMA index_xinfo(${quote(String(index.name))})`).all().filter(c => c.key === 1);
    if (cols.length !== 1 || cols[0].coll !== 'BINARY' || cols[0].desc !== 0) throw schemaError();
    return String(cols[0].name);
  });
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...expected].sort())) throw schemaError();
}
function verifyV1(db: DatabaseSync): void {
  const schema = objects(db);
  checkDependencies(db, schema, 1);
  const table = schema.find(o => o.name === 'signing_intents');
  if (!table || table.type !== 'table' || normalize(table.sql) !== normalize(generationSigningSchema.replace('signing_intents_v1', 'signing_intents'))) throw schemaError();
  if (schema.some(o => o.name === 'signing_intents_v1')) throw schemaError();
  checkIndexes(db, ['economic_intent_id', 'grant_id', 'registration_request_id']);
  const expected = generationTriggers.match(/CREATE TRIGGER[\s\S]*?END;/g)!;
  for (let i = 0; i < triggerNames.length; i++) {
    const found = schema.find(o => o.name === triggerNames[i]);
    if (!found || found.type !== 'trigger' || normalize(found.sql) !== normalize(expected[i])) throw schemaError();
  }
}
export function initializeGenerationSchema(db: DatabaseSync, hook: Hook = noop): void {
  immediateTransaction(db, () => {
    const version = db.prepare('PRAGMA user_version').get()!.user_version;
    if (version === 1) { verifyV1(db); return; }
    if (version !== 0) throw schemaError();
    const schema = objects(db);
    if (schema.some(o => ['signing_intents_v1', ...triggerNames].includes(o.name))) throw schemaError();
    checkDependencies(db, schema, 0);
    const old = schema.find(o => o.name === 'signing_intents');
    if (!old && schema.length !== 0) throw schemaError();
    if (old) {
      if (old.type !== 'table' || normalize(old.sql) !== normalize(legacySigningSchema)) throw schemaError();
      checkIndexes(db, ['economic_intent_id', 'grant_id']);
      db.exec(generationSigningSchema);
      db.exec(`INSERT INTO signing_intents_v1(${legacyColumns},record_kind,generation,registration_request_id,intent_sha256,registered_at)
        SELECT ${legacyColumns},'LEGACY_SIGNING',NULL,NULL,NULL,NULL FROM signing_intents`);
      hook('migration-copy');
      const before = db.prepare('SELECT count(*) AS n FROM signing_intents').get()!.n;
      const after = db.prepare('SELECT count(*) AS n FROM signing_intents_v1').get()!.n;
      const difference = db.prepare(`SELECT ${legacyColumns} FROM signing_intents EXCEPT SELECT ${legacyColumns} FROM signing_intents_v1`).all();
      const reverse = db.prepare(`SELECT ${legacyColumns} FROM signing_intents_v1 EXCEPT SELECT ${legacyColumns} FROM signing_intents`).all();
      if (before !== after || difference.length || reverse.length) throw schemaError();
      db.exec('DROP TABLE signing_intents'); hook('migration-drop');
      db.exec('ALTER TABLE signing_intents_v1 RENAME TO signing_intents'); hook('migration-rename');
    } else db.exec(generationSigningSchema.replace('signing_intents_v1', 'signing_intents'));
    db.exec(generationTriggers);
    db.exec(otherStoreSchema);
    verifyV1(db);
    if (db.prepare('PRAGMA foreign_key_check').all().length ||
        db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw schemaError();
    db.exec('PRAGMA user_version=1'); hook('migration-version');
  }, hook);
}
type OpenDependencies = {
  open?: (path: string, options?: { timeout: number }) => DatabaseSync;
  version?: (db: DatabaseSync) => unknown;
  hook?: Hook;
};
function enableWal(db: DatabaseSync): unknown {
  // journal_mode conversion can return BUSY immediately during two fresh opens,
  // even with a connection busy handler. Bound that particular setup retry by
  // one deadline; registrations themselves have no application retry loop.
  const deadline = performance.now() + 5000;
  for (;;) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    db.exec(`PRAGMA busy_timeout=${remaining}`);
    try {
      const mode = db.prepare('PRAGMA journal_mode=WAL').get()!.journal_mode;
      db.exec('PRAGMA busy_timeout=5000');
      return mode;
    } catch (error) {
      const diagnostic = sqliteDiagnostic(error);
      if (diagnostic === undefined || ![5, 6].includes(diagnostic & 255) || performance.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, Math.max(0, deadline - performance.now())));
    }
  }
}
export function openGenerationDatabase(path: string, dependencies: OpenDependencies = {}): { db: DatabaseSync; registrationCapable: boolean } {
  const open = dependencies.open ?? ((p, options) => new DatabaseSync(p, options ?? {}));
  const version = dependencies.version ?? (db => db.prepare('SELECT sqlite_version() AS version').get()!.version);
  const probe = open(':memory:');
  let accepted: unknown;
  try { accepted = version(probe); if (!sqliteRuntimeEligible(accepted)) throw new GenerationStorageError('SQLITE_RUNTIME_UNSUPPORTED'); }
  finally { probe.close(); }
  let db: DatabaseSync | undefined;
  try {
    db = open(path, { timeout: 5000 });
    if (version(db) !== accepted) throw new GenerationStorageError('SQLITE_RUNTIME_UNSUPPORTED');
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    const mode = enableWal(db);
    db.exec('PRAGMA synchronous=FULL');
    const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
    const registrationCapable = typeof file === 'string' && file.length > 0 && mode === 'wal';
    if ((file && mode !== 'wal') || db.prepare('PRAGMA synchronous').get()!.synchronous !== 2 ||
        db.prepare('PRAGMA foreign_keys').get()!.foreign_keys !== 1 ||
        db.prepare('PRAGMA busy_timeout').get()!.timeout !== 5000) throw new GenerationStorageError('REGISTRATION_STORAGE_UNSUPPORTED');
    initializeGenerationSchema(db, dependencies.hook);
    return { db, registrationCapable };
  } catch (error) {
    try { db?.close(); } catch { /* preserve the original failure */ }
    throw storageFailure(error, false);
  }
}
function identity(row: Row): RegisteredGenerationIdentity {
  const input = snapshotRegistration({ intentId: row.economic_intent_id, registrationRequestId: row.registration_request_id, intentSha256: row.intent_sha256 });
  if (row.record_kind !== 'INITIAL_GENERATION' || row.generation !== 1 || row.state !== 'REGISTERED' ||
      !Number.isSafeInteger(row.registered_at) || row.registered_at < 0) throw new GenerationStorageError('STORAGE_INVARIANT_FAILURE');
  return { ...input, generation: 1, state: 'REGISTERED', registeredAtMs: row.registered_at };
}
function requireCapability(db: DatabaseSync, capable: boolean): void {
  if (!capable || db.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'wal' ||
      db.prepare('PRAGMA synchronous').get()!.synchronous !== 2) throw new GenerationStorageError('REGISTRATION_STORAGE_UNSUPPORTED');
}
export function registerInitialGenerationSync(db: DatabaseSync, capable: boolean, body: unknown, hook: Hook = noop): RegistrationResult {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 4096) throw new GenerationStorageError('INVALID_REGISTRATION');
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new GenerationStorageError('INVALID_REGISTRATION'); }
  const input = snapshotRegistration(parsed);
  requireCapability(db, capable);
  return immediateTransaction(db, () => {
    const row = db.prepare('SELECT * FROM signing_intents WHERE economic_intent_id=?').get(input.intentId);
    if (row) {
      if (row.record_kind === 'LEGACY_SIGNING') throw new GenerationStorageError('LEGACY_INTENT_BLOCKED');
      const stored = identity(row);
      if (stored.registrationRequestId !== input.registrationRequestId || stored.intentSha256 !== input.intentSha256) throw new GenerationStorageError('IDENTITY_CONFLICT');
      return { disposition: 'ALREADY_REGISTERED', identity: stored };
    }
    if (db.prepare('SELECT economic_intent_id FROM signing_intents WHERE registration_request_id=?').get(input.registrationRequestId)) throw new GenerationStorageError('REQUEST_ID_CONFLICT');
    const at = Date.now();
    if (!Number.isSafeInteger(at) || at < 0) throw new GenerationStorageError('STORAGE_INVARIANT_FAILURE');
    const result = db.prepare(`INSERT INTO signing_intents(economic_intent_id,record_kind,state,generation,registration_request_id,intent_sha256,registered_at,revocation_epoch)
      VALUES(?,'INITIAL_GENERATION','REGISTERED',1,?,?,?,NULL)`).run(input.intentId, input.registrationRequestId, input.intentSha256, at);
    if (result.changes !== 1) throw new GenerationStorageError('STORAGE_INVARIANT_FAILURE');
    hook('registration-insert');
    return { disposition: 'CREATED', identity: { ...input, generation: 1, state: 'REGISTERED', registeredAtMs: at } };
  }, hook);
}
export function readGenerationIdentitySync(db: DatabaseSync, capable: boolean, intentId: unknown): GenerationIdentityRead {
  validateGenerationId(intentId); requireCapability(db, capable);
  const row = db.prepare('SELECT * FROM signing_intents WHERE economic_intent_id=?').get(intentId);
  if (!row) return { kind: 'MISSING' };
  if (row.record_kind === 'LEGACY_SIGNING' && ['PREPARED', 'SIGNED'].includes(String(row.state))) {
    return { kind: 'LEGACY_TOMBSTONE', intentId, legacyState: row.state as 'PREPARED' | 'SIGNED' };
  }
  return { kind: 'REGISTERED', identity: identity(row) };
}

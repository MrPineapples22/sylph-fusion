import { closeSync, existsSync, lstatSync, openSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { types as utilTypes } from 'node:util';

export type PaperAccountV3ScratchIdentityNamespace = 'owner' | 'lease' | 'lockNonce';
export interface PaperAccountV3ScratchIdentityIndexOptions { readonly maxBytes: number }

const DB_NAME = 'scratch.sqlite';
const PAGE_SIZE = 4096;
const MAX_BYTES = 64 * 1024 * 1024;
const MIN_BYTES = PAGE_SIZE * 2;
const MAX_IDENTITY_UTF8_BYTES = 36;
const IDENTITY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_VALUE_BYTES = 512;
const MAX_SQL_BYTES = 8192;
const CACHE_KIB = 1024;
const SCHEMA_SQL = `CREATE TABLE identities (
  namespace TEXT NOT NULL CHECK(namespace IN ('owner','lease','lockNonce')),
  identity TEXT NOT NULL,
  PRIMARY KEY(namespace, identity)
) WITHOUT ROWID`;
const CREATE_SQL = SCHEMA_SQL;
const HAS_SQL = 'SELECT 1 AS present FROM identities WHERE namespace=? AND identity=?';
const INSERT_SQL = 'INSERT OR IGNORE INTO identities(namespace, identity) VALUES (?, ?)';
const NAMESPACES = new Set<PaperAccountV3ScratchIdentityNamespace>(['owner', 'lease', 'lockNonce']);
const SIDECARS = ['scratch.sqlite-journal', 'scratch.sqlite-wal', 'scratch.sqlite-shm'];

type SQLiteLimits = Record<'length' | 'sqlLength' | 'attach', number> & Record<string, number>;
type BoundedDatabase = DatabaseSync & {
  readonly limits: SQLiteLimits;
  enableDefensive(active: boolean): void;
};

const fail = (code: string, cause?: unknown): never => { throw new Error(code, cause === undefined ? undefined : { cause }); };

function runtimeSupported(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 24 || (major === 24 && minor >= 15);
}

/** The required Node APIs (DatabaseSync limits + defensive mode) first exist together in Node 24.15. */
export function assertPaperAccountV3ScratchIdentityRuntime(version = process.versions.node): void {
  if (!runtimeSupported(version)) fail('PAPER_ACCOUNT_V3_SCRATCH_RUNTIME_UNSUPPORTED');
}

function assertNoUnpairedSurrogates(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID');
  }
}

function validateIdentity(namespace: unknown, identity: unknown): asserts namespace is PaperAccountV3ScratchIdentityNamespace {
  if (typeof namespace !== 'string' || !NAMESPACES.has(namespace as PaperAccountV3ScratchIdentityNamespace)) {
    fail('PAPER_ACCOUNT_V3_SCRATCH_NAMESPACE_INVALID');
  }
  if (typeof identity !== 'string') throw new Error('PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID');
  assertNoUnpairedSurrogates(identity);
  if (Buffer.byteLength(identity, 'utf8') > MAX_IDENTITY_UTF8_BYTES) fail('PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_TOO_LARGE');
  if (!IDENTITY_UUID.test(identity)) fail('PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID');
}

function validateMaxBytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < MIN_BYTES || Number(value) > MAX_BYTES || Number(value) % PAGE_SIZE !== 0) {
    fail('PAPER_ACCOUNT_V3_SCRATCH_MAX_BYTES_INVALID');
  }
  return Number(value);
}

function snapshotOptions(value: unknown): PaperAccountV3ScratchIdentityIndexOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('PAPER_ACCOUNT_V3_SCRATCH_OPTIONS_INVALID');
  }
  const keys = Reflect.ownKeys(value as object);
  if (keys.length !== 1 || keys[0] !== 'maxBytes') throw new Error('PAPER_ACCOUNT_V3_SCRATCH_OPTIONS_INVALID');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'maxBytes');
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('PAPER_ACCOUNT_V3_SCRATCH_OPTIONS_INVALID');
  return Object.freeze({ maxBytes: validateMaxBytes(descriptor.value) });
}

function attemptDatabasePath(attemptDirectory: unknown): { directory: string; databasePath: string } {
  if (typeof attemptDirectory !== 'string' || attemptDirectory.length === 0 || attemptDirectory.includes('\0')) {
    throw new Error('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID');
  }
  let absolute: string;
  let real: string;
  let stat;
  try {
    absolute = resolve(attemptDirectory);
    stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID');
    real = realpathSync(absolute);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PAPER_ACCOUNT_V3_')) throw error;
    return fail('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID', error);
  }
  if (resolve(real) !== absolute) fail('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID');
  let entries: string[];
  try { entries = readdirSync(absolute); } catch (error) { return fail('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID', error); }
  if (entries.length !== 0) fail('PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_NOT_EMPTY');
  const databasePath = join(absolute, DB_NAME);
  if (!databasePath.startsWith(`${absolute}${sep}`)) fail('PAPER_ACCOUNT_V3_SCRATCH_DATABASE_PATH_INVALID');
  for (const sidecar of SIDECARS) if (existsSync(join(absolute, sidecar))) fail('PAPER_ACCOUNT_V3_SCRATCH_SIDECAR_EXISTS');
  return { directory: absolute, databasePath };
}

function readNumber(db: DatabaseSync, sql: string, key: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('PAPER_ACCOUNT_V3_SCRATCH_SQLITE_CONFIGURATION_INVALID');
  return value;
}

function configure(db: BoundedDatabase, pageCap: number): void {
  if (typeof db.enableDefensive !== 'function' || !db.limits || typeof db.limits !== 'object') {
    fail('PAPER_ACCOUNT_V3_SCRATCH_SQLITE_FEATURES_UNSUPPORTED');
  }
  db.enableDefensive(true);
  db.exec(`PRAGMA page_size=${PAGE_SIZE}`);
  const journal = db.prepare('PRAGMA journal_mode=MEMORY').get() as Record<string, unknown> | undefined;
  if (journal?.journal_mode !== 'memory') fail('PAPER_ACCOUNT_V3_SCRATCH_JOURNAL_MODE_UNSUPPORTED');
  db.exec('PRAGMA temp_store=MEMORY');
  db.exec(`PRAGMA cache_size=-${CACHE_KIB}`);
  db.exec('PRAGMA mmap_size=0');
  const configuredPageCap = readNumber(db, `PRAGMA max_page_count=${pageCap}`, 'max_page_count');
  if (configuredPageCap !== pageCap || readNumber(db, 'PRAGMA page_size', 'page_size') !== PAGE_SIZE ||
      readNumber(db, 'PRAGMA temp_store', 'temp_store') !== 2 ||
      readNumber(db, 'PRAGMA cache_size', 'cache_size') !== -CACHE_KIB ||
      readNumber(db, 'PRAGMA mmap_size', 'mmap_size') !== 0) fail('PAPER_ACCOUNT_V3_SCRATCH_SQLITE_CONFIGURATION_INVALID');

  db.limits.length = MAX_VALUE_BYTES;
  db.limits.sqlLength = MAX_SQL_BYTES;
  db.limits.attach = 0;
  if (db.limits.length !== MAX_VALUE_BYTES || db.limits.sqlLength !== MAX_SQL_BYTES || db.limits.attach !== 0) {
    fail('PAPER_ACCOUNT_V3_SCRATCH_SQLITE_LIMITS_UNSUPPORTED');
  }
  // Defensive mode prevents writable_schema from being enabled. Read it back after the rejected attempt.
  db.exec('PRAGMA writable_schema=ON');
  if (readNumber(db, 'PRAGMA writable_schema', 'writable_schema') !== 0) fail('PAPER_ACCOUNT_V3_SCRATCH_DEFENSIVE_MODE_UNAVAILABLE');
}

function assertSidecarsAbsent(directory: string): void {
  for (const sidecar of SIDECARS) if (existsSync(join(directory, sidecar))) fail('PAPER_ACCOUNT_V3_SCRATCH_SIDECAR_PRESENT');
  const entries = readdirSync(directory);
  if (entries.length !== 1 || entries[0] !== DB_NAME) fail('PAPER_ACCOUNT_V3_SCRATCH_DIRECTORY_CONTENTS_INVALID');
}

/**
 * Per-attempt, bounded SQLite index for previously observed owner, lease, and lock-nonce IDs.
 * `attemptDirectory` must be a fresh, caller-provisioned private directory. This utility does not
 * provision ACLs, impose a filesystem quota, or recover/reuse an index after process failure.
 */
export class PaperAccountV3ScratchIdentityIndex {
  readonly #directory: string;
  readonly #databasePath: string;
  readonly #maxBytes: number;
  readonly #pageCap: number;
  readonly #db: BoundedDatabase;
  readonly #hasStatement: ReturnType<DatabaseSync['prepare']>;
  readonly #insertStatement: ReturnType<DatabaseSync['prepare']>;
  #poisoned = false;
  #closed = false;

  private constructor(directory: string, databasePath: string, maxBytes: number, db: BoundedDatabase) {
    this.#directory = directory;
    this.#databasePath = databasePath;
    this.#maxBytes = maxBytes;
    this.#pageCap = maxBytes / PAGE_SIZE;
    this.#db = db;
    this.#hasStatement = db.prepare(HAS_SQL);
    this.#insertStatement = db.prepare(INSERT_SQL);
  }

  static open(attemptDirectory: string, options: PaperAccountV3ScratchIdentityIndexOptions): PaperAccountV3ScratchIdentityIndex {
    assertPaperAccountV3ScratchIdentityRuntime();
    const { maxBytes } = snapshotOptions(options);
    const { directory, databasePath } = attemptDatabasePath(attemptDirectory);
    let descriptor: number | undefined;
    let db: BoundedDatabase | undefined;
    try {
      descriptor = openSync(databasePath, 'wx', 0o600);
      closeSync(descriptor);
      descriptor = undefined;
      db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, allowExtension: false }) as BoundedDatabase;
      configure(db, maxBytes / PAGE_SIZE);
      db.exec(CREATE_SQL);
      const pageCount = readNumber(db, 'PRAGMA page_count', 'page_count');
      if (pageCount < 1 || pageCount > maxBytes / PAGE_SIZE || statSync(databasePath).size > maxBytes) fail('PAPER_ACCOUNT_V3_SCRATCH_PAGE_CAP_EXCEEDED');
      assertSidecarsAbsent(directory);
      return new PaperAccountV3ScratchIdentityIndex(directory, databasePath, maxBytes, db);
    } catch (error) {
      try { db?.close(); } catch { /* discarded attempt directory is the caller's recovery boundary */ }
      if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* preserve initialization error */ }
      if (error instanceof Error && error.message.startsWith('PAPER_ACCOUNT_V3_')) throw error;
      return fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_OPEN_FAILED', error);
    }
  }

  has(namespace: PaperAccountV3ScratchIdentityNamespace, identity: string): boolean {
    validateIdentity(namespace, identity);
    this.#assertUsable();
    try {
      this.#assertStorageCap();
      const found = this.#hasStatement.get(namespace, identity) !== undefined;
      this.#assertStorageCap();
      return found;
    }
    catch (error) { return this.#poisonAndThrow(error); }
  }

  /** Returns true only when the identity was newly recorded; exact duplicates return false. */
  remember(namespace: PaperAccountV3ScratchIdentityNamespace, identity: string): boolean {
    validateIdentity(namespace, identity);
    this.#assertUsable();
    try {
      this.#assertStorageCap();
      const result = this.#insertStatement.run(namespace, identity);
      this.#assertStorageCap();
      return result.changes === 1 || result.changes === 1n;
    } catch (error) { return this.#poisonAndThrow(error); }
  }

  close(): void {
    if (this.#closed) {
      if (this.#poisoned) fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_POISONED');
      return;
    }
    this.#assertUsable();
    try {
      this.#verifyDatabase();
      this.#db.close();
      this.#closed = true;
      if (statSync(this.#databasePath).size > this.#maxBytes) fail('PAPER_ACCOUNT_V3_SCRATCH_PAGE_CAP_EXCEEDED');
      assertSidecarsAbsent(this.#directory);
    } catch (error) {
      this.#poisoned = true;
      try { if (this.#db.isOpen) this.#db.close(); } catch { /* caller must discard this attempt */ }
      this.#closed = true;
      if (error instanceof Error && error.message.startsWith('PAPER_ACCOUNT_V3_')) throw error;
      fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_CLOSE_FAILED', error);
    }
  }

  #assertUsable(): void {
    if (this.#poisoned) fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_POISONED');
    if (this.#closed || !this.#db.isOpen) fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_CLOSED');
    if (this.#db.isTransaction) this.#poisonAndThrow(new Error('Unexpected open SQLite transaction'));
  }

  #verifyDatabase(): void {
    if (this.#db.isTransaction) fail('PAPER_ACCOUNT_V3_SCRATCH_TRANSACTION_OPEN');
    if (readNumber(this.#db, 'PRAGMA page_size', 'page_size') !== PAGE_SIZE ||
        readNumber(this.#db, 'PRAGMA max_page_count', 'max_page_count') !== this.#pageCap ||
        readNumber(this.#db, 'PRAGMA page_count', 'page_count') > this.#pageCap ||
        statSync(this.#databasePath).size > this.#maxBytes ||
        readNumber(this.#db, 'PRAGMA temp_store', 'temp_store') !== 2 ||
        readNumber(this.#db, 'PRAGMA cache_size', 'cache_size') !== -CACHE_KIB ||
        readNumber(this.#db, 'PRAGMA mmap_size', 'mmap_size') !== 0 ||
        this.#db.limits.length !== MAX_VALUE_BYTES || this.#db.limits.sqlLength !== MAX_SQL_BYTES || this.#db.limits.attach !== 0) {
      fail('PAPER_ACCOUNT_V3_SCRATCH_SQLITE_CONFIGURATION_INVALID');
    }
    const journal = this.#db.prepare('PRAGMA journal_mode').get() as Record<string, unknown> | undefined;
    if (journal?.journal_mode !== 'memory') fail('PAPER_ACCOUNT_V3_SCRATCH_JOURNAL_MODE_UNSUPPORTED');
    const check = this.#db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    if (check?.integrity_check !== 'ok') fail('PAPER_ACCOUNT_V3_SCRATCH_INTEGRITY_FAILED');
  }

  #assertStorageCap(): void {
    if (readNumber(this.#db, 'PRAGMA page_count', 'page_count') > this.#pageCap || statSync(this.#databasePath).size > this.#maxBytes) {
      fail('PAPER_ACCOUNT_V3_SCRATCH_PAGE_CAP_EXCEEDED');
    }
  }

  #poisonAndThrow(error: unknown): never {
    this.#poisoned = true;
    try { if (this.#db.isOpen) this.#db.close(); } catch { /* attempt is unusable; caller discards its directory */ }
    this.#closed = true;
    return fail('PAPER_ACCOUNT_V3_SCRATCH_INDEX_SQLITE_FAILURE', error);
  }
}

export const paperAccountV3ScratchIdentityIndexLimits = Object.freeze({
  pageSize: PAGE_SIZE,
  maxBytesCeiling: MAX_BYTES,
  minBytes: MIN_BYTES,
  maxIdentityUtf8Bytes: MAX_IDENTITY_UTF8_BYTES,
  maxValueBytes: MAX_VALUE_BYTES,
  maxSqlBytes: MAX_SQL_BYTES,
  cacheKiB: CACHE_KIB,
  databaseFileName: DB_NAME,
});

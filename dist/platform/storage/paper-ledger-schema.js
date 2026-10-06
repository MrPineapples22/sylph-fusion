import { DatabaseSync } from 'node:sqlite';
const noop = () => { };
const schemaError = () => new Error('PAPER_LEDGER_SCHEMA_UNSUPPORTED');
export function isPaperLedgerSqliteVersionSupported(version) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isSafeInteger(part)))
        return false;
    const [major, minor, patch] = parts;
    return major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3))) ||
        (major === 3 && minor === 50 && patch === 7) || (major === 3 && minor === 44 && patch === 6);
}
const normalize = (sql) => sql === null ? null : sql
    .split(/('(?:''|[^'])*')/g).map((part, index) => index % 2 ? part :
    part.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, '')).join('').replace(/;$/, '');
export const paperLedgerSchema = `
CREATE TABLE paper_generations(
 account_id TEXT NOT NULL, generation_id TEXT NOT NULL, opening_cash_lamports TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL, PRIMARY KEY(account_id,generation_id)
) STRICT;
CREATE TABLE paper_commands(
 account_id TEXT NOT NULL, generation_id TEXT NOT NULL, command_id TEXT NOT NULL,
 request_fingerprint TEXT NOT NULL, request_json TEXT NOT NULL, accepted_at_ms INTEGER NOT NULL,
 PRIMARY KEY(account_id,generation_id,command_id),
 FOREIGN KEY(account_id,generation_id) REFERENCES paper_generations(account_id,generation_id)
) STRICT;
CREATE TABLE paper_command_events(
 event_id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, generation_id TEXT NOT NULL,
 command_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('ACCEPTED','SIMULATED','SETTLED','REJECTED','UNRESOLVED')),
 occurred_at_ms INTEGER NOT NULL, payload_json TEXT NOT NULL,
 UNIQUE(account_id,generation_id,command_id,event_type),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES paper_commands(account_id,generation_id,command_id)
) STRICT;
CREATE TABLE paper_simulation_reports(
 account_id TEXT NOT NULL, generation_id TEXT NOT NULL, command_id TEXT NOT NULL,
 report_fingerprint TEXT NOT NULL, report_json TEXT NOT NULL, recorded_at_ms INTEGER NOT NULL,
 PRIMARY KEY(account_id,generation_id,command_id),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES paper_commands(account_id,generation_id,command_id)
) STRICT;
CREATE TABLE paper_fills(
 account_id TEXT NOT NULL, generation_id TEXT NOT NULL, command_id TEXT NOT NULL, fill_id TEXT NOT NULL,
 filled_at_ms INTEGER NOT NULL, mint TEXT NOT NULL,
 cash_delta_lamports TEXT NOT NULL CHECK(cash_delta_lamports='0' OR (cash_delta_lamports NOT GLOB '*[^0-9-]*' AND (cash_delta_lamports GLOB '[1-9]*' OR cash_delta_lamports GLOB '-[1-9]*') AND (cash_delta_lamports NOT GLOB '*-*' OR (cash_delta_lamports GLOB '-*' AND substr(cash_delta_lamports,2) NOT GLOB '*-*')))),
 token_delta_raw TEXT NOT NULL CHECK(token_delta_raw='0' OR (token_delta_raw NOT GLOB '*[^0-9-]*' AND (token_delta_raw GLOB '[1-9]*' OR token_delta_raw GLOB '-[1-9]*') AND (token_delta_raw NOT GLOB '*-*' OR (token_delta_raw GLOB '-*' AND substr(token_delta_raw,2) NOT GLOB '*-*')))),
 report_fingerprint TEXT NOT NULL, report_json TEXT NOT NULL,
 PRIMARY KEY(account_id,generation_id,command_id), UNIQUE(account_id,generation_id,fill_id),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES paper_commands(account_id,generation_id,command_id)
) STRICT;
CREATE INDEX paper_events_scope_order ON paper_command_events(account_id,generation_id,event_id);
CREATE TRIGGER paper_generations_no_update BEFORE UPDATE ON paper_generations BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_generations_no_delete BEFORE DELETE ON paper_generations BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_commands_no_update BEFORE UPDATE ON paper_commands BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_commands_no_delete BEFORE DELETE ON paper_commands BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_events_no_update BEFORE UPDATE ON paper_command_events BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_events_no_delete BEFORE DELETE ON paper_command_events BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_reports_no_update BEFORE UPDATE ON paper_simulation_reports BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_reports_no_delete BEFORE DELETE ON paper_simulation_reports BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_fills_no_update BEFORE UPDATE ON paper_fills BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER paper_fills_no_delete BEFORE DELETE ON paper_fills BEGIN SELECT RAISE(ABORT,'PAPER_LEDGER_APPEND_ONLY'); END;
`;
/** Inert schema marker only. It has no account, command, event, ownership, or projection data. */
export const paperLedgerPrototypeSchema = `
CREATE TABLE paper_kernel_prototype_marker(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 marker_version INTEGER NOT NULL CHECK(marker_version=2),
 purpose TEXT NOT NULL CHECK(purpose='NONCANONICAL_OFFLINE_PROTOTYPE')
) STRICT;
INSERT INTO paper_kernel_prototype_marker VALUES(1,2,'NONCANONICAL_OFFLINE_PROTOTYPE');
`;
function userObjects(db) {
    // A literal prefix check matters: LIKE 'sqlite_%' treats '_' as a wildcard.
    return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").all();
}
function verifyCanonical(db) {
    const expectedDb = new DatabaseSync(':memory:');
    try {
        expectedDb.exec(paperLedgerSchema);
        const actual = userObjects(db).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: normalize(row.sql) })).sort((a, b) => a.name.localeCompare(b.name));
        const expected = userObjects(expectedDb).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: normalize(row.sql) })).sort((a, b) => a.name.localeCompare(b.name));
        if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw schemaError();
    }
    finally {
        expectedDb.close();
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
        db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok'))
        throw schemaError();
}
function verifyCanonicalV2(db) {
    const expectedDb = new DatabaseSync(':memory:');
    try {
        expectedDb.exec(paperLedgerSchema);
        expectedDb.exec(paperLedgerPrototypeSchema);
        const actual = userObjects(db).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: normalize(row.sql) })).sort((a, b) => a.name.localeCompare(b.name));
        const expected = userObjects(expectedDb).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: normalize(row.sql) })).sort((a, b) => a.name.localeCompare(b.name));
        if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw schemaError();
    }
    finally {
        expectedDb.close();
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
        db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok'))
        throw schemaError();
}
/** Read-only canonical validation helpers used before any journal-mode/schema mutation. */
export function verifyPaperLedgerV1(db) {
    if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 1)
        throw schemaError();
    verifyCanonical(db);
}
export function verifyPaperLedgerV2(db) {
    if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 2)
        throw schemaError();
    verifyCanonicalV2(db);
}
/** Additive v1->v2 prototype-marker migration only. Existing v1 facts are never rewritten or promoted; no v2 account data or public v2 event writer exists. */
export function migratePaperLedgerV1ToV2(db, hook = noop) {
    verifyPaperLedgerV1(db);
    let commitAttempted = false;
    try {
        db.exec('BEGIN IMMEDIATE');
        db.exec(paperLedgerPrototypeSchema);
        hook('after-v2-ddl-before-version');
        db.exec('PRAGMA user_version=2');
        hook('after-v2-version-before-commit');
        verifyCanonicalV2(db);
        hook('before-v2-commit');
        commitAttempted = true;
        db.exec('COMMIT');
        hook('after-v2-commit');
    }
    catch (error) {
        try {
            if (db.isTransaction)
                db.exec('ROLLBACK');
        }
        catch {
            try {
                db.close();
            }
            catch { }
        }
        if (commitAttempted)
            throw new Error('PAPER_LEDGER_V2_COMMIT_OUTCOME_UNKNOWN', { cause: error });
        throw error;
    }
}
/** Establishes a new dedicated schema atomically, or refuses any non-canonical existing schema. */
export function initializePaperLedgerSchema(db, hook = noop) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 1) {
        verifyCanonical(db);
        return;
    }
    if (version !== 0)
        throw schemaError();
    if (userObjects(db).length !== 0)
        throw new Error('PAPER_LEDGER_UNVERSIONED_DATABASE_NOT_EMPTY');
    let commitAttempted = false;
    try {
        db.exec('BEGIN IMMEDIATE');
        db.exec(paperLedgerSchema);
        hook('after-ddl-before-version');
        db.exec('PRAGMA user_version=1');
        verifyCanonical(db);
        hook('before-commit');
        commitAttempted = true;
        db.exec('COMMIT');
    }
    catch (error) {
        try {
            if (db.isTransaction)
                db.exec('ROLLBACK');
        }
        catch {
            try {
                db.close();
            }
            catch { }
        }
        if (commitAttempted)
            throw new Error('PAPER_LEDGER_SCHEMA_COMMIT_OUTCOME_UNKNOWN', { cause: error });
        throw error;
    }
}
//# sourceMappingURL=paper-ledger-schema.js.map
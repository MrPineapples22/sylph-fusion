import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isPaperLedgerSqliteVersionSupported, verifyPaperLedgerV1, verifyPaperLedgerV2, paperLedgerSchema, } from './paper-ledger-schema.js';
const noop = () => { };
const unsupported = () => new Error('PAPER_ACCOUNT_V3_SCHEMA_UNSUPPORTED');
const bytes = (value) => Buffer.from(value, 'utf8');
const unsignedText = (column) => `CHECK(${column}='0' OR (${column} NOT GLOB '*[^0-9]*' AND substr(${column},1,1) BETWEEN '1' AND '9'))`;
const signedText = (column) => `CHECK(${column}='0' OR (${column} NOT GLOB '*[^0-9]*' AND substr(${column},1,1) BETWEEN '1' AND '9') OR (substr(${column},1,1)='-' AND substr(${column},2) NOT GLOB '*[^0-9]*' AND substr(${column},2,1) BETWEEN '1' AND '9'))`;
const nullableUnsignedText = (column) => `CHECK(${column} IS NULL OR ${column}='0' OR (${column} NOT GLOB '*[^0-9]*' AND substr(${column},1,1) BETWEEN '1' AND '9'))`;
const sha256Text = (column) => `CHECK(length(${column})=64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
const nullableSha256Text = (column) => `CHECK(${column} IS NULL OR (length(${column})=64 AND ${column} NOT GLOB '*[^0-9a-f]*'))`;
/**
 * Canonical v3 physical schema. This module intentionally does not implement
 * event-byte encoding, account admission, activation, or an event writer.
 */
export const paperAccountV3Schema = `
CREATE TABLE pa2_schema_metadata(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 model_version TEXT NOT NULL CHECK(model_version='paper-account-v2'),
 schema_version INTEGER NOT NULL CHECK(schema_version=3),
 source_user_version INTEGER NOT NULL CHECK(source_user_version IN (0,1,2)),
 migration_id TEXT NOT NULL,
 schema_sha256 TEXT NOT NULL ${sha256Text('schema_sha256')},
 migrated_at_ms INTEGER NOT NULL CHECK(migrated_at_ms>=0)
) STRICT;
CREATE TABLE pa2_accounts(
 account_id TEXT PRIMARY KEY,
 active_generation_id TEXT,
 admission_state TEXT NOT NULL CHECK(admission_state IN ('BLOCKED','RECOVERY_HOLD','READY','STOPPED','SEALED')),
 owner_id TEXT,
 owner_epoch INTEGER NOT NULL CHECK(owner_epoch>=0),
 lease_id TEXT,
 lease_until_ms INTEGER,
 lease_renewed_at_ms INTEGER,
 state_version INTEGER NOT NULL CHECK(state_version>=0),
 stop_epoch INTEGER NOT NULL CHECK(stop_epoch>=0),
 emergency_stop_id TEXT,
 emergency_stop_sha256 TEXT ${nullableSha256Text('emergency_stop_sha256')},
 CHECK((owner_id IS NULL AND lease_id IS NULL AND lease_until_ms IS NULL AND lease_renewed_at_ms IS NULL) OR
       (owner_id IS NOT NULL AND lease_id IS NOT NULL AND lease_until_ms IS NOT NULL AND lease_renewed_at_ms IS NOT NULL)),
 CHECK((emergency_stop_id IS NULL AND emergency_stop_sha256 IS NULL) OR
       (emergency_stop_id IS NOT NULL AND emergency_stop_sha256 IS NOT NULL)),
 FOREIGN KEY(account_id,active_generation_id) REFERENCES pa2_generations(account_id,generation_id)
   DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE pa2_generations(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 genesis_json BLOB NOT NULL CHECK(typeof(genesis_json)='blob'),
 genesis_sha256 TEXT NOT NULL ${sha256Text('genesis_sha256')},
 schema_version INTEGER NOT NULL CHECK(schema_version=2),
 created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
 created_by TEXT NOT NULL,
 reason TEXT NOT NULL,
 prior_generation_id TEXT,
 origin TEXT NOT NULL CHECK(origin IN ('EXPLICIT_OPERATOR_GENESIS','ATTESTED_GENESIS')),
 initial_capital_usd_micro TEXT NOT NULL ${unsignedText('initial_capital_usd_micro')},
 opening_cash_usd_micro TEXT NOT NULL ${unsignedText('opening_cash_usd_micro')},
 initial_cash_available_usd_micro TEXT NOT NULL ${unsignedText('initial_cash_available_usd_micro')},
 accounting_policy_hash TEXT NOT NULL ${sha256Text('accounting_policy_hash')},
 risk_policy_hash TEXT NOT NULL ${sha256Text('risk_policy_hash')},
 config_hash TEXT NOT NULL ${sha256Text('config_hash')},
 conversion_policy_hash TEXT NOT NULL ${sha256Text('conversion_policy_hash')},
 simulator_build_hash TEXT NOT NULL ${sha256Text('simulator_build_hash')},
 simulator_report_schema TEXT NOT NULL,
 token_metadata_policy_hash TEXT NOT NULL ${sha256Text('token_metadata_policy_hash')},
 generation_state TEXT NOT NULL CHECK(generation_state IN ('PENDING','ACTIVE','SEALED')),
 PRIMARY KEY(account_id,generation_id),
 FOREIGN KEY(account_id) REFERENCES pa2_accounts(account_id),
 FOREIGN KEY(account_id,prior_generation_id) REFERENCES pa2_generations(account_id,generation_id)
) STRICT;
CREATE TABLE pa2_events(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 account_sequence INTEGER NOT NULL CHECK(account_sequence>0),
 generation_sequence INTEGER NOT NULL CHECK(generation_sequence>0),
 event_type TEXT NOT NULL,
 payload_version INTEGER NOT NULL CHECK(payload_version>0),
 command_id TEXT,
 owner_epoch INTEGER NOT NULL CHECK(owner_epoch>=0),
 occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0),
 recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>=0),
 payload_bytes BLOB NOT NULL CHECK(typeof(payload_bytes)='blob'),
 payload_sha256 TEXT NOT NULL ${sha256Text('payload_sha256')},
 previous_event_sha256 TEXT NOT NULL ${sha256Text('previous_event_sha256')},
 event_sha256 TEXT NOT NULL ${sha256Text('event_sha256')},
 PRIMARY KEY(account_id,event_id),
 UNIQUE(account_id,account_sequence),
 UNIQUE(account_id,generation_id,generation_sequence),
 UNIQUE(account_id,generation_id,event_id),
 FOREIGN KEY(account_id,generation_id) REFERENCES pa2_generations(account_id,generation_id)
) STRICT;
CREATE TABLE pa2_commands(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 command_id TEXT NOT NULL,
 economic_order_id TEXT NOT NULL,
 initiator TEXT NOT NULL,
 command_type TEXT NOT NULL,
 pool_id TEXT NOT NULL,
 mint TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
 token_decimals INTEGER NOT NULL CHECK(token_decimals BETWEEN 0 AND 18),
 request_bytes BLOB NOT NULL CHECK(typeof(request_bytes)='blob'),
 request_sha256 TEXT NOT NULL ${sha256Text('request_sha256')},
 config_sha256 TEXT NOT NULL ${sha256Text('config_sha256')},
 risk_policy_sha256 TEXT NOT NULL ${sha256Text('risk_policy_sha256')},
 accepted_evidence_bytes BLOB NOT NULL CHECK(typeof(accepted_evidence_bytes)='blob'),
 accepted_evidence_sha256 TEXT NOT NULL ${sha256Text('accepted_evidence_sha256')},
 frozen_quote_bytes BLOB NOT NULL CHECK(typeof(frozen_quote_bytes)='blob'),
 frozen_quote_sha256 TEXT NOT NULL ${sha256Text('frozen_quote_sha256')},
 amount_usd_micro TEXT NOT NULL ${unsignedText('amount_usd_micro')},
 amount_lamports TEXT NOT NULL ${unsignedText('amount_lamports')},
 amount_token_raw TEXT NOT NULL ${unsignedText('amount_token_raw')},
 accepted_account_sequence INTEGER NOT NULL CHECK(accepted_account_sequence>0),
 accepted_generation_sequence INTEGER NOT NULL CHECK(accepted_generation_sequence>0),
 command_state TEXT NOT NULL CHECK(command_state IN ('ACCEPTED','SIMULATED','SETTLED','REJECTED','UNRESOLVED','CANCELLED_BEFORE_SIMULATION','MANUALLY_RESOLVED')),
 terminal_result_bytes BLOB,
 terminal_result_sha256 TEXT ${nullableSha256Text('terminal_result_sha256')},
 PRIMARY KEY(account_id,generation_id,command_id),
 UNIQUE(account_id,generation_id,economic_order_id),
 FOREIGN KEY(account_id,generation_id) REFERENCES pa2_generations(account_id,generation_id),
 CHECK((terminal_result_bytes IS NULL AND terminal_result_sha256 IS NULL) OR
       (terminal_result_bytes IS NOT NULL AND typeof(terminal_result_bytes)='blob' AND terminal_result_sha256 IS NOT NULL AND length(terminal_result_sha256)=64))
) STRICT;
CREATE TABLE pa2_simulation_reports(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 command_id TEXT NOT NULL,
 simulator_request_bytes BLOB NOT NULL CHECK(typeof(simulator_request_bytes)='blob'),
 simulator_request_sha256 TEXT NOT NULL ${sha256Text('simulator_request_sha256')},
 report_bytes BLOB NOT NULL CHECK(typeof(report_bytes)='blob'),
 report_sha256 TEXT NOT NULL ${sha256Text('report_sha256')},
 telemetry_bytes BLOB NOT NULL CHECK(typeof(telemetry_bytes)='blob'),
 telemetry_sha256 TEXT NOT NULL ${sha256Text('telemetry_sha256')},
 report_schema TEXT NOT NULL,
 simulator_build_hash TEXT NOT NULL ${sha256Text('simulator_build_hash')},
 seed_identity TEXT NOT NULL,
 recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms>=0),
 PRIMARY KEY(account_id,generation_id,command_id),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES pa2_commands(account_id,generation_id,command_id)
) STRICT;
CREATE TABLE pa2_reservations(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 command_id TEXT NOT NULL,
 reservation_kind TEXT NOT NULL CHECK(reservation_kind IN ('BUY_CASH','SELL_POSITION','FEE_BUFFER')),
 cash_usd_micro TEXT NOT NULL ${unsignedText('cash_usd_micro')},
 position_lot_id TEXT,
 token_qty_raw TEXT NOT NULL ${unsignedText('token_qty_raw')},
 fee_buffer_lamports TEXT NOT NULL ${unsignedText('fee_buffer_lamports')},
 creating_generation_sequence INTEGER NOT NULL CHECK(creating_generation_sequence>0),
 reservation_state TEXT NOT NULL CHECK(reservation_state IN ('OPEN','RELEASED','CONSUMED','UNRESOLVED_HOLD')),
 PRIMARY KEY(account_id,generation_id,command_id),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES pa2_commands(account_id,generation_id,command_id)
) STRICT;
CREATE TABLE pa2_position_lots(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 position_lot_id TEXT NOT NULL,
 opened_fill_id TEXT NOT NULL,
 pool_id TEXT NOT NULL,
 mint TEXT NOT NULL,
 symbol TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side='LONG'),
 token_program TEXT,
 token_decimals INTEGER NOT NULL CHECK(token_decimals BETWEEN 0 AND 18),
 opening_command_id TEXT NOT NULL,
 opening_fill_ordinal INTEGER NOT NULL CHECK(opening_fill_ordinal>=0),
 opened_at_ms INTEGER NOT NULL CHECK(opened_at_ms>=0),
 opened_qty_raw TEXT NOT NULL ${unsignedText('opened_qty_raw')},
 remaining_qty_raw TEXT NOT NULL ${unsignedText('remaining_qty_raw')},
 closed_qty_raw TEXT NOT NULL ${unsignedText('closed_qty_raw')},
 opening_basis_usd_micro TEXT NOT NULL ${unsignedText('opening_basis_usd_micro')},
 remaining_basis_usd_micro TEXT NOT NULL ${unsignedText('remaining_basis_usd_micro')},
 closed_basis_usd_micro TEXT NOT NULL ${unsignedText('closed_basis_usd_micro')},
 entry_fee_usd_micro TEXT NOT NULL ${unsignedText('entry_fee_usd_micro')},
 entry_fee_evidence_bytes BLOB NOT NULL CHECK(typeof(entry_fee_evidence_bytes)='blob'),
 entry_micro_usd_per_token TEXT NOT NULL ${unsignedText('entry_micro_usd_per_token')},
 stage TEXT NOT NULL,
 entry_policy_sha256 TEXT NOT NULL ${sha256Text('entry_policy_sha256')},
 entry_reason TEXT NOT NULL,
 exit_policy_bytes BLOB NOT NULL CHECK(typeof(exit_policy_bytes)='blob'),
 reconciliation_state TEXT NOT NULL CHECK(reconciliation_state='SIMULATED'),
 PRIMARY KEY(account_id,generation_id,position_lot_id),
 UNIQUE(account_id,generation_id,opened_fill_id,opening_fill_ordinal),
 FOREIGN KEY(account_id,generation_id) REFERENCES pa2_generations(account_id,generation_id)
) STRICT;
CREATE TABLE pa2_risk_watermarks(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 position_lot_id TEXT NOT NULL,
 watermark_state TEXT NOT NULL CHECK(watermark_state IN ('KNOWN','STALE','UNKNOWN_UNRESOLVED','REPAIR_HOLD')),
 last_mark_micro_usd TEXT ${nullableUnsignedText('last_mark_micro_usd')},
 observed_at_ms INTEGER,
 recorded_at_ms INTEGER,
 source_id TEXT,
 evidence_sha256 TEXT ${nullableSha256Text('evidence_sha256')},
 source_sequence INTEGER,
 peak_micro_usd TEXT ${nullableUnsignedText('peak_micro_usd')},
 peak_at_ms INTEGER,
 trough_micro_usd TEXT ${nullableUnsignedText('trough_micro_usd')},
 trough_at_ms INTEGER,
 protective_stop_micro_usd TEXT ${nullableUnsignedText('protective_stop_micro_usd')},
 policy_sha256 TEXT NOT NULL ${sha256Text('policy_sha256')},
 last_event_account_sequence INTEGER NOT NULL CHECK(last_event_account_sequence>=0),
 PRIMARY KEY(account_id,generation_id,position_lot_id),
 FOREIGN KEY(account_id,generation_id,position_lot_id) REFERENCES pa2_position_lots(account_id,generation_id,position_lot_id),
 CHECK((watermark_state IN ('KNOWN','STALE') AND last_mark_micro_usd IS NOT NULL AND observed_at_ms IS NOT NULL AND source_id IS NOT NULL AND source_sequence IS NOT NULL) OR
       (watermark_state IN ('UNKNOWN_UNRESOLVED','REPAIR_HOLD')))
) STRICT;
CREATE TABLE pa2_fills(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 fill_id TEXT NOT NULL,
 command_id TEXT NOT NULL,
 fill_ordinal INTEGER NOT NULL CHECK(fill_ordinal>=0),
 report_sha256 TEXT NOT NULL ${sha256Text('report_sha256')},
 side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
 pool_id TEXT NOT NULL,
 mint TEXT NOT NULL,
 token_decimals INTEGER NOT NULL CHECK(token_decimals BETWEEN 0 AND 18),
 input_lamports TEXT NOT NULL ${unsignedText('input_lamports')},
 output_lamports TEXT NOT NULL ${unsignedText('output_lamports')},
 output_token_raw TEXT NOT NULL ${unsignedText('output_token_raw')},
 filled_at_ms INTEGER NOT NULL CHECK(filled_at_ms>=0),
 slot_latency INTEGER CHECK(slot_latency IS NULL OR slot_latency>=0),
 amm_fee_attribution_lamports TEXT NOT NULL ${unsignedText('amm_fee_attribution_lamports')},
 external_priority_fee_lamports TEXT NOT NULL ${unsignedText('external_priority_fee_lamports')},
 external_tip_lamports TEXT NOT NULL ${unsignedText('external_tip_lamports')},
 external_base_fee_lamports TEXT NOT NULL ${unsignedText('external_base_fee_lamports')},
 quote_sha256 TEXT NOT NULL ${sha256Text('quote_sha256')},
 evidence_sha256 TEXT NOT NULL ${sha256Text('evidence_sha256')},
 cash_delta_usd_micro TEXT NOT NULL ${signedText('cash_delta_usd_micro')},
 token_delta_raw TEXT NOT NULL ${signedText('token_delta_raw')},
 gross_proceeds_usd_micro TEXT NOT NULL ${unsignedText('gross_proceeds_usd_micro')},
 external_fees_usd_micro TEXT NOT NULL ${unsignedText('external_fees_usd_micro')},
 closed_basis_usd_micro TEXT NOT NULL ${unsignedText('closed_basis_usd_micro')},
 realized_pnl_usd_micro TEXT NOT NULL ${signedText('realized_pnl_usd_micro')},
 trigger TEXT NOT NULL,
 lot_id TEXT,
 basis_remainder TEXT NOT NULL ${unsignedText('basis_remainder')},
 PRIMARY KEY(account_id,generation_id,fill_id),
 UNIQUE(account_id,generation_id,command_id,fill_ordinal),
 FOREIGN KEY(account_id,generation_id,command_id) REFERENCES pa2_commands(account_id,generation_id,command_id),
 FOREIGN KEY(account_id,generation_id,lot_id) REFERENCES pa2_position_lots(account_id,generation_id,position_lot_id)
) STRICT;
CREATE TABLE pa2_projection_snapshots(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 projection_version INTEGER NOT NULL CHECK(projection_version>0),
 last_account_sequence INTEGER NOT NULL CHECK(last_account_sequence>=0),
 last_generation_sequence INTEGER NOT NULL CHECK(last_generation_sequence>=0),
 last_event_id TEXT,
 last_event_sha256 TEXT NOT NULL ${sha256Text('last_event_sha256')},
 schema_version INTEGER NOT NULL CHECK(schema_version=3),
 projection_bytes BLOB NOT NULL CHECK(typeof(projection_bytes)='blob'),
 projection_sha256 TEXT NOT NULL ${sha256Text('projection_sha256')},
 written_at_ms INTEGER NOT NULL CHECK(written_at_ms>=0),
 PRIMARY KEY(account_id,generation_id),
 FOREIGN KEY(account_id,generation_id) REFERENCES pa2_generations(account_id,generation_id)
) STRICT;
CREATE TABLE pa2_outbox(
 account_id TEXT NOT NULL,
 generation_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 consumer TEXT NOT NULL,
 payload_bytes BLOB NOT NULL CHECK(typeof(payload_bytes)='blob'),
 payload_sha256 TEXT NOT NULL ${sha256Text('payload_sha256')},
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 delivery_state TEXT NOT NULL CHECK(delivery_state IN ('PENDING','DELIVERED','FAILED')),
 next_attempt_at_ms INTEGER,
 PRIMARY KEY(account_id,generation_id,event_id,consumer),
 FOREIGN KEY(account_id,generation_id,event_id) REFERENCES pa2_events(account_id,generation_id,event_id)
) STRICT;
CREATE INDEX pa2_events_generation_order ON pa2_events(account_id,generation_id,generation_sequence);
CREATE INDEX pa2_events_command ON pa2_events(account_id,generation_id,command_id,account_sequence);
CREATE INDEX pa2_commands_status ON pa2_commands(account_id,generation_id,command_state);
CREATE INDEX pa2_reservations_open ON pa2_reservations(account_id,generation_id,reservation_state);
CREATE INDEX pa2_lots_mint_pool ON pa2_position_lots(account_id,generation_id,mint,pool_id);
CREATE TRIGGER pa2_events_no_update BEFORE UPDATE ON pa2_events BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_events_no_delete BEFORE DELETE ON pa2_events BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_generations_no_delete BEFORE DELETE ON pa2_generations BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_genesis_no_update BEFORE UPDATE OF genesis_json,genesis_sha256,schema_version,created_at_ms,created_by,reason,prior_generation_id,origin,initial_capital_usd_micro,opening_cash_usd_micro,initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,simulator_build_hash,simulator_report_schema,token_metadata_policy_hash ON pa2_generations BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_reports_no_update BEFORE UPDATE ON pa2_simulation_reports BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_reports_no_delete BEFORE DELETE ON pa2_simulation_reports BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_fills_no_update BEFORE UPDATE ON pa2_fills BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_fills_no_delete BEFORE DELETE ON pa2_fills BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;
CREATE TRIGGER pa2_outbox_identity_no_update BEFORE UPDATE OF account_id,generation_id,event_id,consumer,payload_bytes,payload_sha256 ON pa2_outbox BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_IMMUTABLE_OUTBOX_IDENTITY'); END;
CREATE VIEW pa2_control_events AS
 SELECT account_id,generation_id,event_id,account_sequence,generation_sequence,event_type,owner_epoch,occurred_at_ms,recorded_at_ms,payload_bytes,payload_sha256,event_sha256
 FROM pa2_events
 WHERE event_type IN ('ACCOUNT_BOOTSTRAPPED','GENERATION_CREATED','GENERATION_ACTIVATED','GENERATION_SEALED','OWNER_ACQUIRED','OWNER_RENEWED','OWNER_RELEASED','OWNER_FENCED','RECOVERY_HOLD','RECOVERY_RELEASED','RISK_REPAIR','EMERGENCY_STOP_LATCHED','EMERGENCY_STOP_CLEAR_INTENT','EMERGENCY_STOP_CLEARED');
`;
export const paperAccountV3SchemaSha256 = createHash('sha256').update(bytes(paperAccountV3Schema)).digest('hex');
function userObjects(db) {
    return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_' ORDER BY type,name").all();
}
function normalize(sql) {
    return sql === null ? null : sql.split(/('(?:''|[^'])*')/g).map((part, index) => index % 2
        ? part : part.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, '')).join('').replace(/;$/, '');
}
function expectedObjects() {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(paperLedgerSchema);
        db.exec(paperAccountV3Schema);
        return userObjects(db);
    }
    finally {
        db.close();
    }
}
function compareObjects(db) {
    const actual = userObjects(db).map(row => ({ ...row, sql: normalize(row.sql) }));
    const expected = expectedObjects().map(row => ({ ...row, sql: normalize(row.sql) }));
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw unsupported();
}
function verifyIntegrity(db) {
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
        db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok'))
        throw unsupported();
}
function verifyMetadata(db) {
    const rows = db.prepare('SELECT * FROM pa2_schema_metadata').all();
    if (rows.length !== 1 || rows[0].singleton !== 1 || rows[0].model_version !== 'paper-account-v2' ||
        rows[0].schema_version !== 3 || ![0, 1, 2].includes(Number(rows[0].source_user_version)) ||
        rows[0].migration_id !== 'paper-account-v2-sqlite-v3' || rows[0].schema_sha256 !== paperAccountV3SchemaSha256 ||
        !Number.isSafeInteger(rows[0].migrated_at_ms) || Number(rows[0].migrated_at_ms) < 0)
        throw unsupported();
}
/** Exact canonical v3 schema + SQLite integrity check. Does not claim a valid event fold. */
export function verifyPaperAccountV3Schema(db) {
    if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 3)
        throw unsupported();
    compareObjects(db);
    verifyMetadata(db);
    verifyIntegrity(db);
}
function checkRuntime(db) {
    const version = String(db.prepare('SELECT sqlite_version() AS version').get()?.version ?? '');
    if (!isPaperLedgerSqliteVersionSupported(version))
        throw new Error('PAPER_ACCOUNT_V3_SQLITE_WAL_RESET_FIX_REQUIRED');
}
function verifySource(db, version) {
    if (version === 0) {
        if (userObjects(db).length !== 0)
            throw new Error('PAPER_ACCOUNT_V3_UNVERSIONED_DATABASE_NOT_EMPTY');
        return;
    }
    if (version === 1) {
        verifyPaperLedgerV1(db);
        return;
    }
    if (version === 2) {
        verifyPaperLedgerV2(db);
        const marker = db.prepare('SELECT singleton,marker_version,purpose FROM paper_kernel_prototype_marker').all();
        if (marker.length !== 1 || marker[0].singleton !== 1 || marker[0].marker_version !== 2 ||
            marker[0].purpose !== 'NONCANONICAL_OFFLINE_PROTOTYPE')
            throw unsupported();
        return;
    }
    if (version === 3) {
        verifyPaperAccountV3Schema(db);
        return;
    }
    throw unsupported();
}
function inspectSourceSnapshot(db) {
    db.exec('BEGIN');
    try {
        const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
        // user_version and sqlite_schema must be read from one SQLite snapshot.
        // Otherwise a concurrent initializer can commit between these queries,
        // pairing the old version with the new schema and falsely rejecting v3.
        verifySource(db, version);
        db.exec('COMMIT');
        return version;
    }
    catch (error) {
        let rollbackFailed = false;
        try {
            if (db.isTransaction)
                db.exec('ROLLBACK');
            rollbackFailed = db.isTransaction;
        }
        catch {
            rollbackFailed = true;
        }
        if (rollbackFailed) {
            try {
                db.close();
            }
            catch { /* the handle is poisoned even if close also fails */ }
            throw new Error('PAPER_ACCOUNT_V3_SOURCE_INSPECTION_ROLLBACK_FAILED', { cause: error });
        }
        throw error;
    }
}
function configureDurability(db) {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const deadline = performance.now() + 5000;
    let mode;
    for (;;) {
        try {
            mode = db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode;
            break;
        }
        catch (error) {
            const code = error.errcode;
            if (typeof code !== 'number' || ![5, 6].includes(code & 255) || performance.now() >= deadline)
                throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, Math.max(0, deadline - performance.now())));
        }
    }
    db.exec('PRAGMA synchronous=FULL;');
    if (mode !== 'wal' || db.prepare('PRAGMA synchronous').get()?.synchronous !== 2 ||
        db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1 ||
        db.prepare('PRAGMA busy_timeout').get()?.timeout !== 5000)
        throw new Error('PAPER_ACCOUNT_V3_DURABILITY_UNAVAILABLE');
}
/**
 * Verify the exact source before WAL or schema mutation; then atomically install
 * v3 and reopen verification. This only installs schema, never account state.
 */
export function initializePaperAccountV3Schema(db, hook = noop) {
    checkRuntime(db);
    let sourceVersion = inspectSourceSnapshot(db);
    if (sourceVersion === 3) {
        configureDurability(db);
        verifyPaperAccountV3Schema(db);
        return { sourceUserVersion: 3, targetUserVersion: 3, schemaSha256: paperAccountV3SchemaSha256 };
    }
    configureDurability(db);
    let commitAttempted = false;
    try {
        hook('before-v3-transaction');
        db.exec('BEGIN IMMEDIATE');
        // Another initializer can finish between the read-only source check and
        // this write lock. Reclassify under the lock before applying any DDL.
        const lockedVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version);
        if (lockedVersion !== sourceVersion) {
            verifySource(db, lockedVersion);
            sourceVersion = lockedVersion;
        }
        if (sourceVersion === 3) {
            verifyPaperAccountV3Schema(db);
            commitAttempted = true;
            db.exec('COMMIT');
            return { sourceUserVersion: 3, targetUserVersion: 3, schemaSha256: paperAccountV3SchemaSha256 };
        }
        if (sourceVersion === 2) {
            db.exec("DROP TABLE paper_kernel_prototype_marker");
            hook('after-marker-drop');
        }
        if (sourceVersion === 0)
            db.exec(paperLedgerSchema);
        db.exec(paperAccountV3Schema);
        db.prepare(`INSERT INTO pa2_schema_metadata
      (singleton,model_version,schema_version,source_user_version,migration_id,schema_sha256,migrated_at_ms)
      VALUES(1,'paper-account-v2',3,?,'paper-account-v2-sqlite-v3',?,?)`)
            .run(sourceVersion, paperAccountV3SchemaSha256, Date.now());
        hook('after-v3-ddl-before-version');
        db.exec('PRAGMA user_version=3');
        hook('after-v3-version-before-commit');
        verifyPaperAccountV3Schema(db);
        if (db.prepare('SELECT count(*) AS count FROM pa2_accounts').get()?.count !== 0 ||
            db.prepare('SELECT count(*) AS count FROM pa2_generations').get()?.count !== 0)
            throw unsupported();
        hook('before-v3-commit');
        commitAttempted = true;
        db.exec('COMMIT');
        hook('after-v3-commit');
    }
    catch (error) {
        let poisoned = false;
        try {
            if (db.isTransaction)
                db.exec('ROLLBACK');
            poisoned = db.isTransaction;
        }
        catch {
            poisoned = true;
        }
        if (poisoned) {
            try {
                db.close();
            }
            catch { }
        }
        if (commitAttempted)
            throw new Error('PAPER_ACCOUNT_V3_COMMIT_OUTCOME_UNKNOWN', { cause: error });
        throw error;
    }
    verifyPaperAccountV3Schema(db);
    return { sourceUserVersion: sourceVersion, targetUserVersion: 3, schemaSha256: paperAccountV3SchemaSha256 };
}
/** Verify a canonical v0/v1/v2/v3 source without changing journal mode or schema. */
export function inspectPaperAccountV3Source(db) {
    checkRuntime(db);
    return inspectSourceSnapshot(db);
}
/** Read-only gates for isolated state-changing operations after schema provisioning. */
export function verifyPaperAccountV3WritePreconditions(db) {
    checkRuntime(db);
    verifyPaperAccountV3Schema(db);
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal' || db.prepare('PRAGMA synchronous').get()?.synchronous !== 2 ||
        db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1 || db.prepare('PRAGMA busy_timeout').get()?.timeout !== 5000)
        throw new Error('PAPER_ACCOUNT_V3_DURABILITY_UNAVAILABLE');
}
//# sourceMappingURL=paper-account-v3-schema.js.map
import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializePaperLedgerSchema, isPaperLedgerSqliteVersionSupported, migratePaperLedgerV1ToV2, verifyPaperLedgerV1, verifyPaperLedgerV2 } from './paper-ledger-schema.js';
if (!parentPort)
    throw new Error('PAPER_LEDGER_WORKER_PORT_MISSING');
mkdirSync(dirname(workerData.path), { recursive: true });
function openConnection() {
    const connection = new DatabaseSync(workerData.path, { timeout: 5000 });
    connection.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    return connection;
}
function checkSqliteRuntime(connection) {
    const version = String(connection.prepare('SELECT sqlite_version() AS version').get()?.version ?? '');
    if (!version)
        throw new Error('PAPER_LEDGER_SQLITE_VERSION_UNKNOWN');
    if (!isPaperLedgerSqliteVersionSupported(version))
        throw new Error('PAPER_LEDGER_SQLITE_WAL_RESET_FIX_REQUIRED');
}
function verifyDurability(connection) {
    const mode = connection.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode;
    connection.exec('PRAGMA synchronous=FULL;');
    if (mode !== 'wal' || connection.prepare('PRAGMA synchronous').get()?.synchronous !== 2 || connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1)
        throw new Error('PAPER_LEDGER_DURABILITY_UNAVAILABLE');
}
function openV2Database() {
    let connection = openConnection();
    try {
        checkSqliteRuntime(connection);
        let version = Number(connection.prepare('PRAGMA user_version').get()?.user_version);
        if (version === 0) {
            const existing = connection.prepare("SELECT 1 FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_' LIMIT 1").get();
            if (existing)
                throw new Error('PAPER_LEDGER_UNVERSIONED_DATABASE_NOT_EMPTY');
            initializePaperLedgerSchema(connection);
            version = 1;
        }
        if (version === 1)
            verifyPaperLedgerV1(connection);
        else if (version === 2)
            verifyPaperLedgerV2(connection);
        else
            throw new Error('PAPER_LEDGER_SCHEMA_UNSUPPORTED');
        // Canonical v1/v2 verification deliberately precedes persistent WAL setup.
        verifyDurability(connection);
        if (version === 1)
            migratePaperLedgerV1ToV2(connection);
        connection.close();
        connection = openConnection();
        checkSqliteRuntime(connection);
        verifyPaperLedgerV2(connection);
        verifyDurability(connection);
        return connection;
    }
    catch (error) {
        try {
            connection.close();
        }
        catch { }
        throw error;
    }
}
const db = openV2Database();
function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const value = fn();
        db.exec('COMMIT');
        return value;
    }
    catch (error) {
        try {
            if (db.isTransaction)
                db.exec('ROLLBACK');
        }
        catch {
            db.close();
        }
        throw error;
    }
}
function command(scope, commandId) {
    const row = db.prepare(`SELECT c.*, (SELECT event_type FROM paper_command_events e WHERE e.account_id=c.account_id AND e.generation_id=c.generation_id AND e.command_id=c.command_id ORDER BY event_id DESC LIMIT 1) AS state,
   (SELECT report_json FROM paper_simulation_reports r WHERE r.account_id=c.account_id AND r.generation_id=c.generation_id AND r.command_id=c.command_id) AS simulation_report_json,
   (SELECT fill_id FROM paper_fills f WHERE f.account_id=c.account_id AND f.generation_id=c.generation_id AND f.command_id=c.command_id) AS fill_id
   FROM paper_commands c WHERE c.account_id=? AND c.generation_id=? AND c.command_id=?`).get(scope.accountId, scope.generationId, commandId);
    return row ? { accountId: row.account_id, generationId: row.generation_id, commandId: row.command_id,
        requestFingerprint: row.request_fingerprint, requestJson: row.request_json, acceptedAtMs: row.accepted_at_ms,
        state: row.state, simulationReportJson: row.simulation_report_json ?? null, fillId: row.fill_id ?? null } : null;
}
function requireGeneration(scope) {
    if (!db.prepare('SELECT 1 FROM paper_generations WHERE account_id=? AND generation_id=?').get(scope.accountId, scope.generationId))
        throw new Error('PAPER_LEDGER_GENERATION_NOT_FOUND');
}
function requireCommand(scope, id) {
    const row = command(scope, id);
    if (!row)
        throw new Error('PAPER_LEDGER_COMMAND_NOT_FOUND');
    return row;
}
function appendEvent(scope, commandId, type, at, payload) {
    db.prepare('INSERT INTO paper_command_events(account_id,generation_id,command_id,event_type,occurred_at_ms,payload_json) VALUES(?,?,?,?,?,?)')
        .run(scope.accountId, scope.generationId, commandId, type, at, payload);
}
parentPort.on('message', (message) => {
    try {
        const input = message.body ? JSON.parse(message.body) : undefined;
        let value = null;
        switch (message.op) {
            case 'create-generation':
                value = tx(() => {
                    const existing = db.prepare('SELECT opening_cash_lamports,created_at_ms FROM paper_generations WHERE account_id=? AND generation_id=?').get(input.accountId, input.generationId);
                    if (existing) {
                        if (existing.opening_cash_lamports !== input.openingCashLamports || existing.created_at_ms !== input.createdAtMs)
                            throw new Error('PAPER_LEDGER_GENERATION_CONFLICT');
                        return 'EXISTING';
                    }
                    db.prepare('INSERT INTO paper_generations VALUES(?,?,?,?)').run(input.accountId, input.generationId, input.openingCashLamports, input.createdAtMs);
                    return 'CREATED';
                });
                break;
            case 'begin-command':
                value = tx(() => {
                    requireGeneration(input);
                    const prior = db.prepare('SELECT request_fingerprint FROM paper_commands WHERE account_id=? AND generation_id=? AND command_id=?').get(input.accountId, input.generationId, input.commandId);
                    if (prior) {
                        if (prior.request_fingerprint !== input.requestFingerprint)
                            throw new Error('PAPER_LEDGER_IDEMPOTENCY_CONFLICT');
                        return { disposition: 'EXISTING', command: command(input, input.commandId) };
                    }
                    db.prepare('INSERT INTO paper_commands VALUES(?,?,?,?,?,?)').run(input.accountId, input.generationId, input.commandId, input.requestFingerprint, input.requestJson, input.acceptedAtMs);
                    appendEvent(input, input.commandId, 'ACCEPTED', input.acceptedAtMs, '{}');
                    return { disposition: 'CREATED', command: command(input, input.commandId) };
                });
                break;
            case 'record-simulation':
                value = tx(() => {
                    const current = requireCommand(input, input.commandId);
                    const prior = db.prepare('SELECT report_fingerprint FROM paper_simulation_reports WHERE account_id=? AND generation_id=? AND command_id=?').get(input.accountId, input.generationId, input.commandId);
                    if (prior) {
                        if (prior.report_fingerprint !== input.reportFingerprint)
                            throw new Error('PAPER_LEDGER_SIMULATION_CONFLICT');
                        return null;
                    }
                    if (current.state !== 'ACCEPTED')
                        throw new Error('PAPER_LEDGER_INVALID_TRANSITION');
                    db.prepare('INSERT INTO paper_simulation_reports VALUES(?,?,?,?,?,?)').run(input.accountId, input.generationId, input.commandId, input.reportFingerprint, input.reportJson, input.recordedAtMs);
                    appendEvent(input, input.commandId, 'SIMULATED', input.recordedAtMs, JSON.stringify({ reportFingerprint: input.reportFingerprint }));
                    return null;
                });
                break;
            case 'append-fill':
                value = tx(() => {
                    const current = requireCommand(input, input.commandId);
                    const prior = db.prepare('SELECT * FROM paper_fills WHERE account_id=? AND generation_id=? AND command_id=?').get(input.accountId, input.generationId, input.commandId);
                    if (prior) {
                        if (prior.fill_id !== input.fillId || prior.filled_at_ms !== input.filledAtMs || prior.mint !== input.mint ||
                            prior.cash_delta_lamports !== input.cashDeltaLamports || prior.token_delta_raw !== input.tokenDeltaRaw || prior.report_fingerprint !== input.reportFingerprint)
                            throw new Error('PAPER_LEDGER_FILL_CONFLICT');
                        return 'EXISTING';
                    }
                    const report = db.prepare('SELECT report_fingerprint FROM paper_simulation_reports WHERE account_id=? AND generation_id=? AND command_id=?').get(input.accountId, input.generationId, input.commandId);
                    if (current.state !== 'SIMULATED' || !report || report.report_fingerprint !== input.reportFingerprint)
                        throw new Error('PAPER_LEDGER_SETTLEMENT_REQUIRES_MATCHED_SIMULATION');
                    db.prepare('INSERT INTO paper_fills VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.accountId, input.generationId, input.commandId, input.fillId, input.filledAtMs, input.mint, input.cashDeltaLamports, input.tokenDeltaRaw, input.reportFingerprint, input.reportJson);
                    appendEvent(input, input.commandId, 'SETTLED', input.filledAtMs, JSON.stringify({ fillId: input.fillId }));
                    return 'APPENDED';
                });
                break;
            case 'mark-unresolved':
                value = tx(() => {
                    const current = requireCommand(input, input.commandId);
                    if (current.state === 'UNRESOLVED') {
                        const original = db.prepare(`SELECT occurred_at_ms,payload_json FROM paper_command_events
            WHERE account_id=? AND generation_id=? AND command_id=? AND event_type='UNRESOLVED'`).get(input.accountId, input.generationId, input.commandId);
                        const exactPayload = JSON.stringify({ reasonCode: input.reasonCode });
                        if (original?.occurred_at_ms !== input.atMs || original?.payload_json !== exactPayload)
                            throw new Error('PAPER_LEDGER_UNRESOLVED_CONFLICT');
                        return null;
                    }
                    if (current.state !== 'ACCEPTED' && current.state !== 'SIMULATED')
                        throw new Error('PAPER_LEDGER_INVALID_TRANSITION');
                    appendEvent(input, input.commandId, 'UNRESOLVED', input.atMs, JSON.stringify({ reasonCode: input.reasonCode }));
                    return null;
                });
                break;
            case 'get-command':
                value = command(input, input.commandId);
                break;
            case 'list-commands':
                value = db.prepare(`SELECT command_id FROM paper_commands WHERE account_id=? AND generation_id=? ORDER BY accepted_at_ms,command_id`).all(input.accountId, input.generationId).map((row) => command(input, row.command_id));
                break;
            case 'list-fills':
                value = db.prepare('SELECT * FROM paper_fills WHERE account_id=? AND generation_id=? ORDER BY filled_at_ms,command_id').all(input.accountId, input.generationId).map((row) => ({ accountId: row.account_id, generationId: row.generation_id, commandId: row.command_id, fillId: row.fill_id, filledAtMs: row.filled_at_ms, cashDeltaLamports: row.cash_delta_lamports, tokenDeltaRaw: row.token_delta_raw, mint: row.mint, simulationReportJson: row.report_json }));
                break;
            case 'close':
                db.close();
                break;
            default: throw new Error('PAPER_LEDGER_OPERATION_UNKNOWN');
        }
        parentPort.postMessage({ id: message.id, value: value === null ? null : JSON.stringify(value) });
    }
    catch (error) {
        parentPort.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'PAPER_LEDGER_STORAGE_FAILURE' });
    }
});
//# sourceMappingURL=paper-ledger-worker.js.map
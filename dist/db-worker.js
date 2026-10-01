import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL);');
db.exec(`CREATE TABLE IF NOT EXISTS signing_intents(
  economic_intent_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  message_sha256 TEXT NOT NULL,
  control_epoch INTEGER NOT NULL,
  revocation_epoch INTEGER DEFAULT 0,
  prepared_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','SIGNED')),
  signature_base64 TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS capital_events(
  sequence_number INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  delta_lamports TEXT NOT NULL,
  balance_after_lamports TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS capital_commits(
  intent_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  certificate_id TEXT NOT NULL,
  capital_state_root TEXT NOT NULL,
  certificate_hash TEXT NOT NULL,
  committed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS recovery_certificates(
  certificate_id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL,
  from_slot INTEGER NOT NULL,
  to_slot INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  recovered_events_count INTEGER NOT NULL,
  skipped_slots_json TEXT NOT NULL,
  dead_fork_slots_json TEXT NOT NULL,
  coverage_root TEXT NOT NULL,
  state_root TEXT NOT NULL,
  resolved_at_ms INTEGER NOT NULL,
  signature TEXT NOT NULL,
  certificate_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS coverage_frontiers(
  lane TEXT PRIMARY KEY,
  continuous_slot INTEGER NOT NULL,
  sealed_slot INTEGER,
  coverage_root TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;`);
parentPort.on('message', (m) => {
    try {
        if (m.op === 'load') {
            const row = db.prepare('SELECT body FROM state WHERE id=1').get();
            parentPort.postMessage({ id: m.id, value: row?.body ?? null });
        }
        else if (m.op === 'save') {
            db.exec('BEGIN IMMEDIATE');
            try {
                db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.body);
                if (m.event)
                    db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body);
                db.exec('COMMIT');
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'prepare-signing') {
            const intent = JSON.parse(m.body);
            if (!intent.economicIntentId || !intent.grantId || !intent.wallet || !/^[a-f0-9]{64}$/.test(intent.messageSha256) ||
                !Number.isSafeInteger(intent.controlEpoch) || !Number.isSafeInteger(intent.preparedAtMs))
                throw new Error('invalid signing intent');
            const revEpoch = Number.isSafeInteger(intent.revocationEpoch) ? intent.revocationEpoch : 0;
            db.prepare(`INSERT INTO signing_intents(economic_intent_id,grant_id,wallet,message_sha256,control_epoch,revocation_epoch,prepared_at,state)
        VALUES(?,?,?,?,?,?,?,'PREPARED')`).run(intent.economicIntentId, intent.grantId, intent.wallet, intent.messageSha256, intent.controlEpoch, revEpoch, intent.preparedAtMs);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'mark-signed') {
            const signed = JSON.parse(m.body);
            if (!signed.economicIntentId || !/^[a-f0-9]{64}$/.test(signed.messageSha256) ||
                typeof signed.signatureBase64 !== 'string' || Buffer.from(signed.signatureBase64, 'base64').byteLength !== 64) {
                throw new Error('invalid signed intent');
            }
            const result = db.prepare(`UPDATE signing_intents SET state='SIGNED',signature_base64=?
        WHERE economic_intent_id=? AND message_sha256=? AND state='PREPARED'`).run(signed.signatureBase64, signed.economicIntentId, signed.messageSha256);
            if (result.changes !== 1)
                throw new Error('signing intent missing, altered, or already finalized');
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'save-capital-commit') {
            const commit = JSON.parse(m.body);
            db.prepare(`INSERT INTO capital_commits(intent_id, reservation_id, certificate_id, capital_state_root, certificate_hash, committed_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET certificate_hash=excluded.certificate_hash`).run(commit.intentId, commit.reservationId, commit.certificateId, commit.capitalStateRoot, commit.certificateHash, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'append-capital-event') {
            const ev = JSON.parse(m.body);
            db.prepare(`INSERT INTO capital_events(sequence_number, event_type, timestamp_ms, slot, entity_id, delta_lamports, balance_after_lamports, previous_event_hash, event_hash, payload_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(ev.sequence_number, ev.event_type, ev.timestamp_ms, ev.slot, ev.entity_id, String(ev.delta_lamports), String(ev.balance_after_lamports), ev.previous_event_hash, ev.event_hash, JSON.stringify(ev.payload || {}));
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'backup') {
            const dest = m.body;
            if (!dest)
                throw new Error('backup destination path required');
            const safeDest = dest.replace(/'/g, "''");
            db.exec(`VACUUM INTO '${safeDest}';`);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'save-recovery-certificate') {
            const cert = JSON.parse(m.body);
            db.prepare(`INSERT INTO recovery_certificates(certificate_id, gap_id, from_slot, to_slot, provider_id, recovered_events_count, skipped_slots_json, dead_fork_slots_json, coverage_root, state_root, resolved_at_ms, signature, certificate_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(certificate_id) DO UPDATE SET certificate_json=excluded.certificate_json, state_root=excluded.state_root`).run(cert.certificateId, cert.gapId, cert.fromSlot, cert.toSlot, cert.providerId, cert.recoveredEventIds?.length ?? 0, JSON.stringify(cert.skippedSlots ?? []), JSON.stringify(cert.deadForkSlots ?? []), cert.coverageRoot ?? null, cert.stateRoot ?? null, cert.resolvedAtMs ?? Date.now(), cert.signature ?? null, JSON.stringify(cert));
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-recovery-certificate') {
            const id = m.body;
            const row = db.prepare('SELECT certificate_json FROM recovery_certificates WHERE certificate_id=? OR gap_id=?').get(id, id);
            parentPort.postMessage({ id: m.id, value: row?.certificate_json ?? null });
        }
        else if (m.op === 'save-coverage-frontier') {
            const frontier = JSON.parse(m.body);
            db.prepare(`INSERT INTO coverage_frontiers(lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms)
        VALUES(?,?,?,?,?)
        ON CONFLICT(lane) DO UPDATE SET continuous_slot=excluded.continuous_slot, sealed_slot=excluded.sealed_slot, coverage_root=excluded.coverage_root, updated_at_ms=excluded.updated_at_ms`).run(frontier.lane, frontier.continuousSlot ?? frontier.continuous_slot, frontier.sealedSlot ?? frontier.sealed_slot ?? null, frontier.coverageRoot ?? frontier.coverage_root ?? null, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-coverage-frontier') {
            const lane = m.body;
            const row = db.prepare('SELECT lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms FROM coverage_frontiers WHERE lane=?').get(lane);
            parentPort.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
        }
        else if (m.op === 'prune') {
            const maxAgeMs = Number(m.body) || (7 * 86_400_000);
            const cutoff = Date.now() - maxAgeMs;
            db.prepare('DELETE FROM audit WHERE at < ?').run(cutoff);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'close') {
            db.close();
            parentPort.postMessage({ id: m.id, value: null });
            parentPort.close();
        }
        else
            throw new Error('unknown database operation');
    }
    catch (e) {
        parentPort.postMessage({ id: m.id, error: String(e) });
    }
});
//# sourceMappingURL=db-worker.js.map
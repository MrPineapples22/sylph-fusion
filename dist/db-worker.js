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
  prepared_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','SIGNED')),
  signature_base64 TEXT
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
            db.prepare(`INSERT INTO signing_intents(economic_intent_id,grant_id,wallet,message_sha256,control_epoch,prepared_at,state)
        VALUES(?,?,?,?,?,?,'PREPARED')`).run(intent.economicIntentId, intent.grantId, intent.wallet, intent.messageSha256, intent.controlEpoch, intent.preparedAtMs);
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
        else if (m.op === 'backup') {
            const dest = m.body;
            if (!dest)
                throw new Error('backup destination path required');
            const safeDest = dest.replace(/'/g, "''");
            db.exec(`VACUUM INTO '${safeDest}';`);
            parentPort.postMessage({ id: m.id, value: null });
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
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL);');
parentPort!.on('message', (m: { id: number; op: string; body?: string; event?: string }) => {
  try {
    if (m.op === 'load') {
      const row = db.prepare('SELECT body FROM state WHERE id=1').get();
      parentPort!.postMessage({ id: m.id, value: row?.body ?? null });
    } else if (m.op === 'save') {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.body!);
        if (m.event) db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body!);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'backup') {
      const dest = m.body;
      if (!dest) throw new Error('backup destination path required');
      const safeDest = dest.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${safeDest}';`);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'prune') {
      const maxAgeMs = Number(m.body) || (7 * 86_400_000);
      const cutoff = Date.now() - maxAgeMs;
      db.prepare('DELETE FROM audit WHERE at < ?').run(cutoff);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'close') { db.close(); parentPort!.postMessage({ id: m.id, value: null }); parentPort!.close(); }
    else throw new Error('unknown database operation');
  } catch (e) { parentPort!.postMessage({ id: m.id, error: String(e) }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../dist/store.js';
import { createResearchExportManifest, verifyResearchExportManifest } from '../../dist/platform/audit/research-export-manifest.js';

async function makeSnapshot(directory, lossMarker) {
  const path = join(directory, 'research.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL);');
  db.prepare('INSERT INTO state VALUES(1, ?)').run(JSON.stringify({ researchEvidenceLoss: lossMarker }));
  const insert = db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)');
  insert.run(100, 'candidate_discovered_v1', '{}');
  insert.run(200, 'candidate_snapshot_v1', '{}');
  db.close();
  return path;
}

test('research export manifest verifies retained coverage and reports completeness as unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-export-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = await makeSnapshot(directory, { failureCount: 3, firstFailureAtMs: 10, lastFailureAtMs: 20, recoveryRequired: true });
  const manifest = await createResearchExportManifest(snapshot);
  assert.equal(manifest.auditCoverage.retainedRowCount, 2);
  assert.deepEqual({ ...manifest.auditCoverage.countsByEvent }, { candidate_discovered_v1: 1, candidate_snapshot_v1: 1 });
  assert.equal(manifest.auditCoverage.completeness, 'UNKNOWN');
  assert.equal(manifest.knownCaptureLoss.status, 'RECORDED');
  assert.equal(manifest.knownCaptureLoss.failureCount, 3);
  assert.deepEqual(await verifyResearchExportManifest(snapshot), {
    valid: true, snapshotSha256: manifest.snapshotSha256, retainedAuditRows: 2,
  });
});

test('research export verification detects changed snapshots and edited manifests', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-export-tamper-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = await makeSnapshot(directory, undefined);
  const manifestPath = `${snapshot}.manifest.json`;
  const manifest = await createResearchExportManifest(snapshot);
  const edited = { ...manifest, auditCoverage: { ...manifest.auditCoverage, retainedRowCount: 99 } };
  await writeFile(manifestPath, JSON.stringify(edited));
  assert.deepEqual(await verifyResearchExportManifest(snapshot), { valid: false, reason: 'SNAPSHOT_INVENTORY_MISMATCH' });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const db = new DatabaseSync(snapshot);
  db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(300, 'candidate_snapshot_v1', '{}');
  db.close();
  assert.deepEqual(await verifyResearchExportManifest(snapshot), { valid: false, reason: 'SNAPSHOT_HASH_MISMATCH' });
  await writeFile(manifestPath, JSON.stringify({ ...manifest, snapshotSha256: '0'.repeat(64) }));
  assert.deepEqual(await verifyResearchExportManifest(snapshot), { valid: false, reason: 'SNAPSHOT_HASH_MISMATCH' });
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).schemaVersion, 'sylph-research-export-manifest/1');
});

test('signed manifests bind snapshot inventory and anchor claims to the HMAC', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-export-signed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = await makeSnapshot(directory, undefined);
  const manifestPath = `${snapshot}.manifest.json`;
  const key = 'test-only-signing-secret';
  const anchor = { witnessRootSha256: 'a'.repeat(64), anchorReference: 'witness://batch-42' };
  const manifest = await createResearchExportManifest(snapshot, manifestPath, {
    signingKey: key, signerId: 'research-test', externalAnchor: anchor,
  });
  assert.equal(manifest.trust.manifestAuthentication.mode, 'HMAC_SHA256');
  assert.deepEqual(await verifyResearchExportManifest(snapshot, manifestPath, { verificationKey: key }), {
    valid: true, snapshotSha256: manifest.snapshotSha256, retainedAuditRows: 2,
    authentication: { signerId: 'research-test', verified: true },
    externalAnchor: { witnessRootSha256: anchor.witnessRootSha256, anchorReference: anchor.anchorReference },
  });
  assert.deepEqual(await verifyResearchExportManifest(snapshot, manifestPath), {
    valid: false, reason: 'SIGNATURE_INVALID',
  });
  assert.deepEqual(await verifyResearchExportManifest(snapshot, manifestPath, { verificationKey: 'wrong-key' }), {
    valid: false, reason: 'SIGNATURE_INVALID',
  });

  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    trust: { ...manifest.trust, externalAnchor: { ...manifest.trust.externalAnchor, anchorReference: 'witness://edited' } },
  }));
  assert.deepEqual(await verifyResearchExportManifest(snapshot, manifestPath, { verificationKey: key }), {
    valid: false, reason: 'SIGNATURE_INVALID',
  });
});

test('manifest signing and external-anchor inputs cannot be silently downgraded', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-export-signing-input-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = await makeSnapshot(directory, undefined);
  await assert.rejects(createResearchExportManifest(snapshot, undefined, { signingKey: 'secret' }),
    /INVALID_MANIFEST_SIGNING_CONFIGURATION/);
  await assert.rejects(createResearchExportManifest(snapshot, undefined, { signerId: 'signer' }),
    /INVALID_MANIFEST_SIGNING_CONFIGURATION/);
  await assert.rejects(createResearchExportManifest(snapshot, undefined, {
    signingKey: 'secret', signerId: 'signer', externalAnchor: { witnessRootSha256: 'bad', anchorReference: 'ref' },
  }), /INVALID_EXTERNAL_ANCHOR/);
});

test('manifest describes and verifies the existing Store VACUUM INTO snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-store-export-'));
  const store = new Store(join(directory, 'source.sqlite'));
  t.after(async () => { await store.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  await store.save({ mode: 'paper', researchEvidenceLoss: { failureCount: 1, firstFailureAtMs: 10,
    lastFailureAtMs: 10, lastEvent: 'candidate_snapshot_v1', lastReason: 'test', recoveryRequired: true } });
  await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'candidate-one' });
  const snapshot = join(directory, 'snapshot.sqlite');
  await store.backup(snapshot);
  await store.close();
  const manifest = await createResearchExportManifest(snapshot);
  assert.equal(manifest.auditCoverage.retainedRowCount, 1);
  assert.equal(manifest.knownCaptureLoss.status, 'RECORDED');
  assert.deepEqual(await verifyResearchExportManifest(snapshot), {
    valid: true, snapshotSha256: manifest.snapshotSha256, retainedAuditRows: 1,
  });
});

test('audit pruning is bounded and records exact deleted id ranges transactionally', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-audit-prune-'));
  const store = new Store(join(directory, 'source.sqlite'));
  t.after(async () => { await store.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'a' });
  await store.appendAuditEvent('candidate_snapshot_v1', { candidateId: 'a' });
  await store.appendAuditEvent('candidate_snapshot_v1', { candidateId: 'a' });
  const sourceDb = new DatabaseSync(join(directory, 'source.sqlite'));
  sourceDb.prepare('UPDATE audit SET at=? WHERE id=2').run(Date.now() + 60_000);
  sourceDb.close();
  await delay(3);
  const result = await store.pruneAudit(0);
  assert.equal(result.prunedRowCount, 2);
  assert.equal(result.limitReached, false);
  assert.deepEqual(result.idRanges, [[1, 1], [3, 3]]);
  const sourceDb2 = new DatabaseSync(join(directory, 'source.sqlite'));
  sourceDb2.prepare('UPDATE audit SET at=? WHERE id=2').run(Date.now() - 10);
  sourceDb2.close();
  const secondBatch = await store.pruneAudit(0);
  assert.deepEqual(secondBatch.idRanges, [[2, 2]]);
  const snapshot = join(directory, 'snapshot.sqlite');
  await store.backup(snapshot);
  const manifest = await createResearchExportManifest(snapshot);
  assert.equal(manifest.auditCoverage.retainedRowCount, 0);
  assert.equal(manifest.auditCoverage.prunedRowCount, 3);
  assert.equal(manifest.auditCoverage.pruneBatchCount, 2);
  assert.deepEqual(manifest.auditCoverage.knownPrunedIdRanges, [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual({ ...manifest.auditCoverage.prunedCountsByEvent }, {
    candidate_discovered_v1: 1, candidate_snapshot_v1: 2,
  });
  assert.deepEqual(await verifyResearchExportManifest(snapshot), {
    valid: true, snapshotSha256: manifest.snapshotSha256, retainedAuditRows: 0,
  });
});

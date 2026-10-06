import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../dist/store.js';

test('Store.appendAuditEvent enforces idempotent deduplication and rejects conflicting payloads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-store-dedupe-'));
  const dbPath = join(dir, 'test.sqlite');
  const store = new Store(dbPath);
  t.after(async () => {
    await store.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  // 1. Initial insert with stable event ID
  const res1 = await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'cand-1', val: 100 }, 'event-stable-1');
  assert.equal(res1.inserted, true);
  assert.equal(typeof res1.auditId, 'number');

  // 2. Exact replay returns inserted: false and same auditId without creating duplicate row
  const res2 = await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'cand-1', val: 100 }, 'event-stable-1');
  assert.equal(res2.inserted, false);
  assert.equal(res2.auditId, res1.auditId);

  const events = await store.getAuditEvents('candidate_discovered_v1');
  assert.equal(events.length, 1);
  assert.equal(events[0].id, res1.auditId);

  // 3. Reusing the same stable event ID with different payload fails closed
  await assert.rejects(
    store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'tampered-candidate', val: 999 }, 'event-stable-1'),
    /DUPLICATE_EVENT_ID_CONTENT_CONFLICT/
  );

  // 4. Different stable ID succeeds
  const res3 = await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'cand-2', val: 200 }, 'event-stable-2');
  assert.equal(res3.inserted, true);

  const eventsAfter = await store.getAuditEvents('candidate_discovered_v1');
  assert.equal(eventsAfter.length, 2);
});

test('Deduplication identity survives audit retention pruning without resurrecting pruned rows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-store-prune-dedupe-'));
  const dbPath = join(dir, 'test.sqlite');
  const store = new Store(dbPath);
  t.after(async () => {
    await store.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  // Insert two events
  await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'c1' }, 'event-to-prune-1');
  await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'c2' }, 'event-to-prune-2');

  const beforePrune = await store.getAuditEvents('candidate_discovered_v1');
  assert.equal(beforePrune.length, 2);

  // Prune all events older than 0ms
  const pruneResult = await store.pruneAudit(0);
  assert.equal(pruneResult.prunedRowCount, 2);

  const afterPrune = await store.getAuditEvents('candidate_discovered_v1');
  assert.equal(afterPrune.length, 0);

  // Delayed spool replay of an already processed event must not resurrect a row in audit
  const replayed = await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'c1' }, 'event-to-prune-1');
  assert.equal(replayed.inserted, false);

  const finalCheck = await store.getAuditEvents('candidate_discovered_v1');
  assert.equal(finalCheck.length, 0, 'Pruned event must not be resurrected into audit table');
});

test('CLI research-export-manifest respects signing and verification environment variables', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-cli-manifest-'));
  const dbPath = join(dir, 'cli-test.sqlite');
  const manifestPath = join(dir, 'cli-test.sqlite.manifest.json');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const store = new Store(dbPath);
  await store.save({ mode: 'paper' });
  await store.appendAuditEvent('candidate_discovered_v1', { candidateId: 'cli-c1' }, 'cli-evt-1');
  await store.close();

  const scriptPath = fileURLToPath(new URL('../../scripts/research-export-manifest.mjs', import.meta.url));

  const signingKey = 'super-secret-key-42';
  const signerId = 'automated-audit-agent';

  // 1. Create with signing env vars
  const createProc = spawnSync(process.execPath, [scriptPath, 'create', dbPath, manifestPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SYLPH_RESEARCH_MANIFEST_SIGNING_KEY: signingKey,
      SYLPH_RESEARCH_MANIFEST_SIGNER_ID: signerId,
    },
  });
  assert.equal(createProc.status, 0, createProc.stderr);
  const created = JSON.parse(createProc.stdout);
  assert.equal(created.trust.manifestAuthentication.mode, 'HMAC_SHA256');
  assert.equal(created.trust.manifestAuthentication.signerId, signerId);

  // 2. Verify with matching verification key
  const verifyProc = spawnSync(process.execPath, [scriptPath, 'verify', dbPath, manifestPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SYLPH_RESEARCH_MANIFEST_VERIFICATION_KEY: signingKey,
    },
  });
  assert.equal(verifyProc.status, 0, verifyProc.stderr);
  const verified = JSON.parse(verifyProc.stdout);
  assert.equal(verified.valid, true);
  assert.equal(verified.authentication.signerId, signerId);
  assert.equal(verified.authentication.verified, true);

  // 3. Verify with wrong key exits 1
  const failProc = spawnSync(process.execPath, [scriptPath, 'verify', dbPath, manifestPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SYLPH_RESEARCH_MANIFEST_VERIFICATION_KEY: 'wrong-key',
    },
  });
  assert.equal(failProc.status, 1);
  const failVerified = JSON.parse(failProc.stdout);
  assert.equal(failVerified.valid, false);
  assert.equal(failVerified.reason, 'SIGNATURE_INVALID');
});

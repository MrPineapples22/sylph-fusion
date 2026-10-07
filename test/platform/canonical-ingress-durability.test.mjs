import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store, getStoreIngressCapability } from '../../dist/store.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import { CanonicalIngress, DefaultFusionEnvelopeCompiler, DefaultTruthValidator, StoreIngressJournal } from '../../dist/platform/ingress/canonical-ingress.js';

const observation = (receivedAtMs = Date.now()) => createUnvalidatedObservation({
  sourceId: 'test-source', providerId: 'test-provider', transport: 'mock', receivedAtMs,
  slot: 42, commitment: 'confirmed', signature: 'test-signature-1234567890',
  rawPayload: Buffer.from(JSON.stringify(['raw-evidence'])), schemaVersion: 'fixture/v1',
  processingIntent: 'DETERMINISTIC_REPLAY',
});

test('ingress durability capability rejects SQLite memory databases', async () => {
  const store = new Store(':memory:');
  try {
    store.assertIngressDurability = async () => {};
    await assert.rejects(new StoreIngressJournal(store).append({}), /INGRESS_DURABLE_JOURNAL_REQUIRED/);
  } finally { await store.close(); }
});

test('canonical ingress cannot issue a committed envelope from a caller supplied journal', async () => {
  let notifications = 0;
  const ingress = new CanonicalIngress({
    compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
    journal: { async append() { return { sequence: 1n, entryHash: 'a'.repeat(64) }; } },
    downstreamSubscriber() { notifications++; },
  });
  const receipt = await ingress.submit(observation());
  assert.equal(receipt.status, 'REJECTED');
  assert.match(receipt.reason, /DURABLE_STORE_INGRESS_JOURNAL_REQUIRED/);
  assert.equal(notifications, 0);
});

test('Store ingress commits before notifying and detects replay after a fresh instance', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canonical-ingress-wal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  await getStoreIngressCapability(store).assertDurable();
  const firstObservation = observation();
  let deliveries = 0;
  let initialJournalRecord;
  const makeIngress = onCommitted => new CanonicalIngress({
    compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
    journal: new StoreIngressJournal(store), durability: 'FSYNC_COMMITTED', downstreamSubscriber: onCommitted,
  });
  const ingress = makeIngress(async committed => {
    const rows = await store.getAuditEvents('canonical_ingress_committed_v1');
    assert.equal(rows.length, 1, 'downstream callback must run after the committed row is readable');
    assert.equal(committed.durability, 'FSYNC_COMMITTED');
    assert.equal(committed.validatedEnvelope.truthEvidence.signatureVerified, false, 'hash validation cannot claim transaction signature verification');
    assert.equal(committed.validatedEnvelope.truthEvidence.schemaCompliant, false, 'generic decoder cannot claim Solana schema validation');
    deliveries++;
  });
  try {
    assert.equal((await ingress.submit(firstObservation)).status, 'ACCEPTED');
    assert.equal(deliveries, 1);
    initialJournalRecord = await new StoreIngressJournal(store).findByObservationId(firstObservation.observationId);
    assert.ok(initialJournalRecord);
    const row = JSON.parse((await store.getAuditEvents('canonical_ingress_committed_v1'))[0].body);
    assert.equal(Buffer.from(row.rawPayloadBase64, 'base64').toString(), Buffer.from(firstObservation.rawPayload).toString());
    assert.match(row.entryHash, /^[a-f0-9]{64}$/);
  } finally { await store.close(); }

  store = new Store(path);
  try {
    await store.pruneAudit(0);
    const replay = makeIngress();
    const result = await replay.submit(observation(Date.now() + 1));
    assert.equal(result.status, 'DUPLICATE');
    assert.equal((await store.getAuditEvents('canonical_ingress_committed_v1')).length, 0);
    const recoveredJournalRecord = await new StoreIngressJournal(store).findByObservationId(firstObservation.observationId);
    assert.deepEqual(recoveredJournalRecord, initialJournalRecord, 'duplicate identity and journal hash stay stable after row pruning');
  } finally { await store.close(); }
});

test('outbox migration quarantines legacy delivery uncertainty without replaying historical events', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canonical-ingress-legacy-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  const observationId = 'a'.repeat(64);
  let store = new Store(path);
  try {
    await getStoreIngressCapability(store).appendAuditEvent('canonical_ingress_committed_v1', {
      schemaVersion: 1, observationId, entryHash: 'b'.repeat(64),
    }, `ingress:${observationId}`);
  } finally { await store.close(); }

  // Recreate the schema state produced by a pre-outbox release while keeping
  // its committed event and dedupe identity intact.
  const legacyDb = new DatabaseSync(path);
  try {
    legacyDb.exec(`DELETE FROM audit_event_dedupe WHERE event_id='canonical-ingress-legacy-delivery-migration:v1';
      DELETE FROM audit WHERE event='canonical_ingress_legacy_delivery_migration_v1';
      DROP TABLE canonical_ingress_delivery_v1;`);
  }
  finally { legacyDb.close(); }

  store = new Store(path);
  try {
    const journal = new StoreIngressJournal(store);
    await getStoreIngressCapability(store).assertDurable();
    assert.deepEqual(await journal.getPendingDeliveries(0, 10), [], 'legacy rows must not be implicitly replayed');
    const migration = await store.getAuditEvents('canonical_ingress_legacy_delivery_migration_v1');
    assert.equal(migration.length, 1);
    assert.equal(JSON.parse(migration[0].body).policy, 'LEGACY_OUTCOME_UNKNOWN_DO_NOT_REPLAY');
    assert.equal(JSON.parse(migration[0].body).rowCount, 1);
    const legacyIdentity = await getStoreIngressCapability(store).getAuditEventByStableId(`ingress:${observationId}`);
    assert.equal(legacyIdentity?.event, 'canonical_ingress_committed_v1', 'legacy dedupe evidence remains available');
  } finally { await store.close(); }
});

test('invalid legacy ingress rolls back outbox schema creation and migration atomically', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canonical-ingress-legacy-rollback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  const initial = new Store(path);
  await getStoreIngressCapability(initial).assertDurable();
  await initial.close();

  const legacyDb = new DatabaseSync(path);
  try {
    legacyDb.exec('DROP TABLE canonical_ingress_delivery_v1');
    const body = JSON.stringify({ malformed: true });
    const event = 'canonical_ingress_committed_v1';
    const eventId = `ingress:${'c'.repeat(64)}`;
    const eventHash = createHash('sha256').update(`${event}:${body}`).digest('hex');
    const info = legacyDb.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), event, body);
    legacyDb.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,?,?)')
      .run(eventId, eventHash, Number(info.lastInsertRowid), Date.now());
  } finally { legacyDb.close(); }

  const upgraded = new Store(path);
  try {
    await assert.rejects(getStoreIngressCapability(upgraded).assertDurable(), /INGRESS_OUTBOX_ROW_INVALID/);
  } finally { await upgraded.close(); }
  const verifyDb = new DatabaseSync(path);
  try {
    assert.equal(verifyDb.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_delivery_v1'").get(), undefined,
      'failed migration must roll back the new schema as well as migrated rows');
  } finally { verifyDb.close(); }
});

test('ingress refuses tampered raw payload before compiling or journaling', async () => {
  const input = observation();
  input.rawPayload[0] ^= 0xff;
  let compiles = 0;
  const ingress = new CanonicalIngress({
    compiler: { compile() { compiles++; throw new Error('must not compile'); } },
    validator: new DefaultTruthValidator(), journal: { async append() { throw new Error('must not append'); } },
  });
  const result = await ingress.submit(input);
  assert.equal(result.status, 'REJECTED');
  assert.match(result.reason, /RAW_PAYLOAD_HASH_MISMATCH/);
  assert.equal(compiles, 0);
});

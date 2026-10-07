import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../dist/store.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import { CanonicalIngress, DefaultFusionEnvelopeCompiler, DefaultTruthValidator, StoreIngressJournal } from '../../dist/platform/ingress/canonical-ingress.js';

const observation = (receivedAtMs = Date.now()) => createUnvalidatedObservation({
  sourceId: 'test-source', providerId: 'test-provider', transport: 'mock', receivedAtMs,
  slot: 42, commitment: 'confirmed', signature: 'test-signature-1234567890',
  rawPayload: Buffer.from(JSON.stringify(['raw-evidence'])), schemaVersion: 'fixture/v1',
  processingIntent: 'DETERMINISTIC_REPLAY',
});

test('Store ingress commits before notifying and detects replay after a fresh instance', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canonical-ingress-wal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  const firstObservation = observation();
  let deliveries = 0;
  const makeIngress = onCommitted => new CanonicalIngress({
    compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
    journal: new StoreIngressJournal(store), durability: 'FSYNC_COMMITTED', downstreamSubscriber: onCommitted,
  });
  const ingress = makeIngress(async committed => {
    const rows = await store.getAuditEvents('canonical_ingress_committed_v1');
    assert.equal(rows.length, 1, 'downstream callback must run after the committed row is readable');
    assert.equal(committed.durability, 'FSYNC_COMMITTED');
    deliveries++;
  });
  try {
    assert.equal((await ingress.submit(firstObservation)).status, 'ACCEPTED');
    assert.equal(deliveries, 1);
    const row = JSON.parse((await store.getAuditEvents('canonical_ingress_committed_v1'))[0].body);
    assert.equal(Buffer.from(row.rawPayloadBase64, 'base64').toString(), Buffer.from(firstObservation.rawPayload).toString());
    assert.match(row.entryHash, /^[a-f0-9]{64}$/);
  } finally { await store.close(); }

  store = new Store(path);
  try {
    const replay = makeIngress();
    const result = await replay.submit(observation(Date.now() + 1));
    assert.equal(result.status, 'DUPLICATE');
    assert.equal((await store.getAuditEvents('canonical_ingress_committed_v1')).length, 1);
  } finally { await store.close(); }
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

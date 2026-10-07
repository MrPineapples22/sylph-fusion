import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../dist/store.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import {
  CanonicalIngress,
  DefaultFusionEnvelopeCompiler,
  DefaultTruthValidator,
  StoreIngressJournal,
} from '../../dist/platform/ingress/canonical-ingress.js';

function createSampleObservation(receivedAtMs = Date.now()) {
  return createUnvalidatedObservation({
    sourceId: 'crash-recovery-source',
    providerId: 'quicknode-mainnet',
    transport: 'websocket.logsSubscribe',
    receivedAtMs,
    observedAtMs: receivedAtMs,
    slot: 101,
    commitment: 'confirmed',
    signature: '5wVv5Gj2E7W3m1Q8nF5x4T7k9m2p1v0crash-recovery-test',
    rawPayload: Buffer.from(JSON.stringify({ directive: 'crash_test', seq: 1 })),
    schemaVersion: 'solana-program-logs/v1',
    processingIntent: 'LIVE',
  });
}

test('Canonical ingress redispatches a durably committed delivery after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ingress-crash-recovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const observation = createSampleObservation();
  let store = new Store(dbPath);
  let firstAttempts = 0;
  try {
    const ingress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(),
      validator: new DefaultTruthValidator(),
      journal: new StoreIngressJournal(store),
      downstreamSubscriber: async () => {
        firstAttempts++;
        throw new Error('SIMULATED_PROCESS_CRASH_POST_COMMIT');
      },
    });
    const firstReceipt = await ingress.submit(observation);
    assert.equal(firstReceipt.status, 'REJECTED', 'failed delivery must not be reported as successful');
    assert.match(firstReceipt.reason, /COMMITTED_DELIVERY_PENDING_RETRY/);
  } finally { await store.close(); }

  store = new Store(dbPath);
  try {
    const journal = new StoreIngressJournal(store);
    const recoveredRecord = await journal.findByObservationId(observation.observationId);
    assert.ok(recoveredRecord, 'the committed journal record must survive restart');
    assert.match(recoveredRecord.entryHash, /^[a-f0-9]{64}$/);

    let recoveredAttempts = 0;
    const restartedIngress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(),
      validator: new DefaultTruthValidator(),
      journal,
      downstreamSubscriber: async committed => {
        recoveredAttempts++;
        assert.equal(committed.journalSeq, recoveredRecord.sequence);
        assert.equal(committed.envelopeHash, recoveredRecord.entryHash);
      },
    });
    const retryReceipt = await restartedIngress.submit(observation);
    assert.equal(retryReceipt.status, 'DUPLICATE');
    assert.equal(recoveredAttempts, 1, 'restart must redispatch the durable but unacknowledged envelope');
  } finally { await store.close(); }
  assert.equal(firstAttempts, 1);
});

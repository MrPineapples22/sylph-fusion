import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, getStoreIngressCapability } from '../../dist/store.js';
import { Engine } from '../../dist/fusion.js';
import { createHash } from 'node:crypto';
import { CanonicalReducer } from '../../dist/platform/reducer/index.js';
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
  let journal = new StoreIngressJournal(store);
  let firstAttempts = 0;
  try {
    const ingress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(),
      validator: new DefaultTruthValidator(),
      journal,
      downstreamSubscriber: async () => {
        firstAttempts++;
        throw new Error('SIMULATED_PROCESS_CRASH_POST_COMMIT');
      },
    });
    const firstReceipt = await ingress.submit(observation);
    assert.equal(firstReceipt.status, 'REJECTED', 'failed delivery must not be reported as successful');
    assert.match(firstReceipt.reason, /COMMITTED_DELIVERY_PENDING_RETRY/);
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 1, 'commit and pending outbox entry must exist together');
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.pruneAudit(0);
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 1, 'retention must preserve an unacknowledged recovery payload');
  } finally { await store.close(); }

  store = new Store(dbPath);
  try {
    journal = new StoreIngressJournal(store);
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
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 0, 'successful redispatch must durably acknowledge the outbox row');
    assert.equal((await store.getAuditEvents('canonical_ingress_delivery_ack_v1')).length, 1);
    await store.pruneAudit(0);
    assert.equal((await store.getAuditEvents('canonical_ingress_committed_v1')).length, 0, 'acknowledged ingress payload may follow normal audit retention');
    const stillDeduplicated = await journal.findByObservationId(observation.observationId);
    assert.ok(stillDeduplicated, 'pruning a delivered payload must preserve deduplication evidence');
  } finally { await store.close(); }
  assert.equal(firstAttempts, 1);
});

test('Engine projection checkpoint and ingress acknowledgement commit atomically', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ingress-projection-atomic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const observation = createSampleObservation();
  let store = new Store(dbPath);
  const capability = getStoreIngressCapability(store);
  assert.ok(capability);
  let effects = 0;
  try {
    const ingress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
      journal: new StoreIngressJournal(store),
      downstreamSubscriber: async committed => {
        effects++;
        const sequence = Number(committed.journalSeq);
        const observationId = committed.validatedEnvelope.compiledEnvelope.observation.observationId;
        const projection = { schemaVersion: 1, sequence, observationId, entryHash: committed.envelopeHash, effects };
        await capability.commitEngineProjection(observationId, sequence, committed.envelopeHash,
          JSON.stringify(projection), JSON.stringify({ version: 1, wallet: 'fixture', mode: 'paper' }));
        // Models a crash after the atomic commit but before callback completion.
        throw new Error('SIMULATED_CRASH_AFTER_PROJECTION_COMMIT');
      },
    });
    const receipt = await ingress.submit(observation);
    assert.equal(receipt.status, 'REJECTED');
    assert.equal((await new StoreIngressJournal(store).getPendingDeliveries(0, 10)).length, 0,
      'the projection transaction must acknowledge the event in the same commit');
    assert.equal((await store.getAuditEvents('canonical_ingress_delivery_ack_v1')).length, 1);
  } finally { await store.close(); }

  store = new Store(dbPath);
  try {
    const recovered = await getStoreIngressCapability(store).loadEngineProjection();
    assert.ok(recovered);
    const parsed = JSON.parse(recovered.projectionJson);
    assert.equal(parsed.sequence, recovered.sequence);
    assert.equal(parsed.observationId, observation.observationId);
    assert.equal(parsed.effects, 1, 'the committed projection is durable after reopen');
    assert.equal(JSON.parse(recovered.stateJson).wallet, 'fixture');
    const retryIngress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
      journal: new StoreIngressJournal(store), downstreamSubscriber: () => { effects++; },
    });
    assert.equal((await retryIngress.submit(observation)).status, 'DUPLICATE');
    assert.equal(effects, 1, 'an already checkpointed observation must not reapply its effect');
    assert.equal((await store.getAuditEvents('canonical_ingress_delivery_ack_v1')).length, 1);
  } finally { await store.close(); }
});

test('Engine restores canonical state and active candidate projection before ingress recovery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-projection-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const mint = 'EngineProjectionMint11111111111111111111111111111';
  const creator = 'EngineProjectionCreator111111111111111111111111';
  const receivedAtMs = Date.now();
  const observation = createUnvalidatedObservation({
    sourceId: 'projection-test', providerId: 'fixture-provider', transport: 'fixture', receivedAtMs,
    observedAtMs: receivedAtMs, slot: 301, commitment: 'confirmed', signature: 'projection-test-signature-301',
    rawPayload: Buffer.from('{}'), schemaVersion: 'fixture/v1', processingIntent: 'DETERMINISTIC_REPLAY',
  });
  const compiler = {
    compile(obs) {
      const decodedEvents = [{ name: 'CreateEvent', signature: obs.signature, slot: obs.slot, received: obs.receivedAtMs,
        observation: obs, data: { mint: { toBase58: () => mint }, creator: { toBase58: () => creator },
          user: { toBase58: () => 'EngineProjectionLaunchUser11111111111111111' },
          timestamp: { toString: () => String(Math.floor(receivedAtMs / 1000)) } } }];
      return { envelopeId: createHash('sha256').update(`fixture:${obs.observationId}`).digest('hex'),
        observation: obs, compiledAtMs: receivedAtMs, decodedEvents, compilerVersion: 'engine-projection-fixture/v1' };
    },
  };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const stateFor = () => ({ version: 1, wallet: 'projection-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false });
  const fakeFeed = (engine, ingress) => ({
    isIngressBound: port => port === ingress,
    gapReconciler: { setRecoveryCertificateJournal() {} },
    run: async () => { engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0
  });
  const makeIngress = store => new CanonicalIngress({ compiler, validator: new DefaultTruthValidator(), journal: new StoreIngressJournal(store) });
  const makeEngine = (store, state, ingress) => {
    let engine;
    engine = new Engine(cfg, { connection: {} }, {}, {}, store, state, undefined, undefined,
      'deterministic_only', undefined, undefined, undefined, ingress, fakeFeed({ stop: () => engine.stop() }, ingress));
    return engine;
  };

  let store = new Store(dbPath);
  try {
    await store.save(stateFor());
    const ingress = makeIngress(store);
    const subscribedEngine = makeEngine(store, stateFor(), ingress);
    const receipt = await ingress.submit(observation);
    assert.equal(receipt.status, 'ACCEPTED');
    assert.equal(subscribedEngine.getCanonicalState().revision, 1n);
    const checkpoint = await getStoreIngressCapability(store).loadEngineProjection();
    assert.ok(checkpoint);
    assert.equal(JSON.parse(checkpoint.projectionJson).candidates.length, 1);
    assert.equal((await new StoreIngressJournal(store).getPendingDeliveries(0, 10)).length, 0);
  } finally { await store.close(); }

  store = new Store(dbPath);
  try {
    const state = await store.load();
    const restarted = makeEngine(store, state, makeIngress(store));
    await restarted.run();
    assert.equal(restarted.getCanonicalState().revision, 1n, 'canonical root is restored rather than reset to genesis');
    assert.equal(CanonicalReducer.isStateRootV2(restarted.getCanonicalState()), true);
    assert.equal(CanonicalReducer.isStateTransitionProof(restarted.getLastTransitionProof()), true);
    assert.equal(JSON.parse((await getStoreIngressCapability(store).loadEngineProjection()).projectionJson).candidates[0].mint, mint,
      'the active candidate projection survives process restart');
  } finally { await store.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, getStoreIngressCapability } from '../../dist/store.js';
import { Engine } from '../../dist/fusion.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { CanonicalReducer } from '../../dist/platform/reducer/index.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import {
  CanonicalIngress,
  DefaultFusionEnvelopeCompiler,
  DefaultTruthValidator,
  StoreIngressJournal,
  createCanonicalSolanaIngress,
} from '../../dist/platform/ingress/canonical-ingress.js';

function encodeCreateEventLogs({ mint, creator, user, timestamp }) {
  const u32 = value => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
  const string = value => { const bytes = Buffer.from(value); return Buffer.concat([u32(bytes.length), bytes]); };
  const pubkey = value => new PublicKey(value).toBuffer();
  const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
  const i64 = value => { const out = Buffer.alloc(8); out.writeBigInt64LE(BigInt(value)); return out; };
  const bool = value => Buffer.from([value ? 1 : 0]);
  const event = Buffer.concat([
    Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]),
    string('Fixture token'), string('FIX'), string('https://example.invalid/metadata'),
    pubkey(mint), pubkey(Keypair.generate().publicKey), pubkey(user), pubkey(creator),
    i64(timestamp), u64(1_000_000), u64(2_000_000), u64(3_000_000), u64(4_000_000),
    pubkey(PublicKey.default), bool(false), bool(false), pubkey(PublicKey.default),
    u64(2_000_000), u64(100), bool(false),
  ]);
  const programId = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  return [
    `Program ${programId} invoke [1]`,
    `Program data: ${event.toString('base64')}`,
    `Program ${programId} success`,
  ];
}

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

test('general ingress adapters cannot bind Engine or commit projection acknowledgements', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ingress-projection-atomic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const capability = getStoreIngressCapability(store);
  assert.ok(capability);
  try {
    assert.equal(typeof capability.bindEngineProjectionOwner, 'undefined');
    assert.equal(typeof capability.commitEngineProjection, 'undefined');
    assert.equal(typeof capability.acknowledgeIngress, 'undefined');
    const reviewedJournal = new StoreIngressJournal(store);
    createCanonicalSolanaIngress({ journal: reviewedJournal });
    await assert.rejects(store.call('commit-engine-projection', '{}'), /ENGINE_PROJECTION_CAPABILITY_REQUIRED/);
    await assert.rejects(store.call('acknowledge-ingress', '{}'), /ENGINE_PROJECTION_CAPABILITY_REQUIRED/);
    const journal = reviewedJournal;
    await assert.rejects(journal.acknowledgeDelivery('a'.repeat(64), 1, 'b'.repeat(64)), /INGRESS_ENGINE_ATOMIC_ACK_REQUIRED/);
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 0);
  } finally { await store.close(); }
});

test('Engine restores canonical state and active candidate projection before ingress recovery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-projection-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const mint = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const user = Keypair.generate().publicKey.toBase58();
  const receivedAtMs = Date.now();
  const observation = createUnvalidatedObservation({
    sourceId: 'projection-test', providerId: 'fixture-provider', transport: 'fixture', receivedAtMs,
    observedAtMs: receivedAtMs, slot: 301, commitment: 'confirmed', signature: 'projection-test-signature-301',
    rawPayload: Buffer.from(JSON.stringify(encodeCreateEventLogs({ mint, creator, user, timestamp: Math.floor(receivedAtMs / 1000) }))),
    schemaVersion: 'solana-program-logs/v1', processingIntent: 'DETERMINISTIC_REPLAY',
  });
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const stateFor = () => ({ version: 1, wallet: 'projection-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false });
  const fakeFeed = (engine, ingress) => ({
    isIngressBound: port => port === ingress,
    gapReconciler: { setRecoveryCertificateJournal() {} },
    run: async () => { engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0
  });
  const makeIngress = store => createCanonicalSolanaIngress({ journal: new StoreIngressJournal(store) });
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
    const rawCheckpoint = await store.call('load-engine-projection');
    const checkpoint = rawCheckpoint ? JSON.parse(rawCheckpoint) : null;
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
    assert.equal(JSON.parse(JSON.parse(await store.call('load-engine-projection')).projectionJson).candidates[0].mint, mint,
      'the active candidate projection survives process restart');
  } finally { await store.close(); }
});

test('unreviewed adapter crash after in-memory effect retains legacy replay semantics', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ingress-crash-before-commit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const observation = createSampleObservation();
  let store = new Store(dbPath);
  const capability = getStoreIngressCapability(store);
  assert.ok(capability);
  let memoryEffects = 0;
  try {
    const ingress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
      journal: new StoreIngressJournal(store),
      downstreamSubscriber: async () => {
        memoryEffects++;
        // Crash before calling commitEngineProjection!
        throw new Error('SIMULATED_PROCESS_CRASH_BEFORE_PROJECTION_COMMIT');
      },
    });
    const receipt = await ingress.submit(observation);
    assert.equal(receipt.status, 'REJECTED');
    assert.match(receipt.reason, /COMMITTED_DELIVERY_PENDING_RETRY/);
    assert.equal(memoryEffects, 1);
    assert.equal((await new StoreIngressJournal(store).getPendingDeliveries(0, 10)).length, 1,
      'pending outbox entry must remain unacknowledged when commit did not occur');
    assert.equal(await store.call('load-engine-projection'), null,
      'no projection checkpoint must exist when commit was never executed');
  } finally { await store.close(); }

  // Reopen after simulated crash
  store = new Store(dbPath);
  try {
    let durableEffects = 0;
    const restartedJournal = new StoreIngressJournal(store);
    assert.equal((await restartedJournal.getPendingDeliveries(0, 10)).length, 1,
      'pending delivery survives crash');
    const restartedIngress = new CanonicalIngress({
      compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(),
      journal: restartedJournal,
      downstreamSubscriber: async () => { durableEffects++; },
    });
    const recoveredCount = await restartedIngress.recoverPendingDeliveries();
    assert.equal(recoveredCount, 1, 'unreviewed test adapter can use the legacy journal acknowledgement route');
    assert.equal(durableEffects, 1, 'effect is now applied and committed exactly once');
    assert.equal((await restartedJournal.getPendingDeliveries(0, 10)).length, 0,
      'unreviewed adapter acknowledgement clears its delivery');
    assert.equal(await store.call('load-engine-projection'), null);

    // Duplicate submit check
    const dupReceipt = await restartedIngress.submit(observation);
    assert.equal(dupReceipt.status, 'DUPLICATE');
    assert.equal(durableEffects, 1, 'duplicate submit must not reapply effect');
  } finally { await store.close(); }
});


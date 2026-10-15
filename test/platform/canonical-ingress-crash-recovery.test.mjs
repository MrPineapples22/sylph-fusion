import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, getInternalEngineProjectionCapability, getStoreIngressCapability } from '../../dist/store.js';
import { Engine } from '../../dist/fusion.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
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
  const program = getPumpProgram({}), zero = new BN(0);
  const data = { name: 'Fixture token', symbol: 'FIX', uri: 'https://example.invalid/metadata',
    mint: new PublicKey(mint), bondingCurve: Keypair.generate().publicKey, user: new PublicKey(user),
    creator: new PublicKey(creator), timestamp: new BN(timestamp), virtualTokenReserves: zero,
    virtualSolReserves: zero, realTokenReserves: zero, tokenTotalSupply: zero, tokenProgram: TOKEN_PROGRAM_ID,
    isMayhemMode: false, isCashbackEnabled: false, quoteMint: PublicKey.default,
    virtualQuoteReserves: zero, creatorFeeBps: zero, isHolderReward: false };
  const definition = program.idl.events.find(event => event.name === 'createEvent');
  if (!definition) throw new Error('CRASH_RECOVERY_CREATE_EVENT_IDL_MISSING');
  const event = Buffer.concat([Buffer.from(definition.discriminator), program.coder.types.encode('createEvent', data)]);
  return [
    `Program ${PUMP_PROGRAM_ID} invoke [1]`,
    `Program data: ${event.toString('base64')}`,
    `Program ${PUMP_PROGRAM_ID} success`,
  ];
}

function createSampleObservation(receivedAtMs = Date.now(), sourceId = 'crash-recovery-source') {
  return createUnvalidatedObservation({
    sourceId,
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

function createValidProjectionObservation(sourceId, signature) {
  const receivedAtMs = Date.now();
  const mint = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const user = Keypair.generate().publicKey.toBase58();
  return createUnvalidatedObservation({sourceId, providerId:'fixture-provider', transport:'fixture', receivedAtMs, observedAtMs:receivedAtMs,
    slot:301, commitment:'confirmed', signature,
    rawPayload:Buffer.from(JSON.stringify(encodeCreateEventLogs({mint,creator,user,timestamp:Math.floor(receivedAtMs/1000)}))),
    schemaVersion:'solana-program-logs/v1', processingIntent:'DETERMINISTIC_REPLAY'});
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

test('Engine projection cannot pass an earlier unresolved ingress delivery', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ingress-projection-order-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const journal = new StoreIngressJournal(store);
  const firstObservation = createSampleObservation(Date.now(), 'earlier-pending-delivery');
  const laterObservation = createSampleObservation(Date.now(), 'later-pending-delivery');
  const firstIngress = new CanonicalIngress({
    compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal,
    downstreamSubscriber: async () => { throw new Error('SIMULATED_EARLIER_PROJECTION_FAILURE'); },
  });
  const laterIngress = new CanonicalIngress({
    compiler: new DefaultFusionEnvelopeCompiler(), validator: new DefaultTruthValidator(), journal,
    downstreamSubscriber: async () => { throw new Error('SIMULATED_LATER_PROJECTION_FAILURE'); },
  });
  try {
    assert.equal((await firstIngress.submit(firstObservation)).status, 'REJECTED');
    assert.equal((await laterIngress.submit(laterObservation)).status, 'REJECTED');
    const pending = await journal.getPendingDeliveries(0, 10);
    assert.equal(pending.length, 2);
    assert.ok(pending[0].sequence < pending[1].sequence);
    const projectionCapability = getInternalEngineProjectionCapability(store);
    assert.ok(projectionCapability);
    const stateJson = JSON.stringify({version: 1, wallet: 'projection-order-fixture', mode: 'paper_standard'});
    const projectionJson = (row, observationId, revision) => JSON.stringify({
      schemaVersion: 1,
      sequence: row.sequence,
      observationId,
      entryHash: row.entryHash,
      canonicalState: {revision: String(revision)},
    });

    await assert.rejects(projectionCapability.commitEngineProjection(
      laterObservation.observationId, pending[1].sequence, pending[1].entryHash,
      projectionJson(pending[1], laterObservation.observationId, 2), stateJson,
    ), /ENGINE_PROJECTION_BLOCKED_BY_EARLIER_DELIVERY/);
    assert.equal(await projectionCapability.loadEngineProjection(), null,
      'rejecting the later projection must leave the checkpoint unchanged');
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 2,
      'neither pending outbox row may be acknowledged by a rejected checkpoint');

    const statusDb = new DatabaseSync(dbPath);
    try {
      statusDb.prepare(`UPDATE canonical_ingress_delivery_v1 SET delivery_status='LEGACY_UNKNOWN' WHERE audit_id=?`)
        .run(pending[0].sequence);
    } finally { statusDb.close(); }
    await assert.rejects(projectionCapability.commitEngineProjection(
      laterObservation.observationId, pending[1].sequence, pending[1].entryHash,
      projectionJson(pending[1], laterObservation.observationId, 2), stateJson,
    ), /ENGINE_PROJECTION_BLOCKED_BY_EARLIER_DELIVERY/);
    assert.equal(await projectionCapability.loadEngineProjection(), null,
      'an earlier legacy-unknown row must also leave the checkpoint unchanged');
    const restoreStatusDb = new DatabaseSync(dbPath);
    try {
      restoreStatusDb.prepare(`UPDATE canonical_ingress_delivery_v1 SET delivery_status='PENDING' WHERE audit_id=?`)
        .run(pending[0].sequence);
    } finally { restoreStatusDb.close(); }

    await projectionCapability.commitEngineProjection(
      firstObservation.observationId, pending[0].sequence, pending[0].entryHash,
      projectionJson(pending[0], firstObservation.observationId, 1), stateJson,
    );
    const afterFirst = await journal.getPendingDeliveries(0, 10);
    assert.equal(afterFirst.length, 1);
    assert.equal(afterFirst[0].sequence, pending[1].sequence);
    await projectionCapability.commitEngineProjection(
      laterObservation.observationId, pending[1].sequence, pending[1].entryHash,
      projectionJson(pending[1], laterObservation.observationId, 2), stateJson,
    );
    assert.equal((await journal.getPendingDeliveries(0, 10)).length, 0,
      'once the earlier delivery is committed, the later projection can advance');
  } finally { await store.close(); }
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

test('Engine refuses a pending delivery at or below restored projection without dispatch or acknowledgment', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-pending-before-projection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const stateFor = () => ({ version: 1, wallet: 'projection-order-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false });
  const makeEngine = (store, state, ingress, feedCounters) => {
    let engine;
    const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
      run: async () => { feedCounters.started++; engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0};
    engine = new Engine(cfg, { connection: {} }, {}, {}, store, state, undefined, undefined,
      'deterministic_only', undefined, undefined, undefined, ingress, feed);
    return engine;
  };
  let store = new Store(dbPath);
  try {
    await store.save(stateFor());
    const initialIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
    makeEngine(store, stateFor(), initialIngress, {started: 0});
    const observation = createValidProjectionObservation('checkpointed-delivery','projection-stale-pending-1');
    const firstReceipt = await initialIngress.submit(observation);
    assert.equal(firstReceipt.status, 'ACCEPTED', firstReceipt.reason);
    const committed = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    assert.ok(committed.sequence > 0);
    assert.equal((await new StoreIngressJournal(store).getPendingDeliveries(0, 10)).length, 0);
    // Corruption fixture: simulate a stale PENDING status after a successful projection+ACK commit.
    const db = new DatabaseSync(dbPath);
    try { db.prepare("UPDATE canonical_ingress_delivery_v1 SET delivery_status='PENDING',acknowledged_at_ms=NULL WHERE audit_id=?").run(committed.sequence); }
    finally { db.close(); }
  } finally { await store.close(); }

  store = new Store(dbPath);
  const feedCounters = {started: 0};
  let subscriberEffects = 0;
  const pendingIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  pendingIngress.subscribe(() => { subscriberEffects++; });
  const restarted = makeEngine(store, await store.load(), pendingIngress, feedCounters);
  try {
    const beforeProjection = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    const beforePending = await new StoreIngressJournal(store).getPendingDeliveries(0, 1);
    assert.equal(beforePending.length, 1);
    assert.equal(beforePending[0].sequence, beforeProjection.sequence);
    await assert.rejects(restarted.run(), /ENGINE_PENDING_INGRESS_NOT_AFTER_PROJECTION/);
    assert.equal(subscriberEffects, 0, 'pending delivery must not reach ordinary or terminal subscribers');
    assert.equal(feedCounters.started, 0, 'feed production must not start after the startup guard fails');
    assert.deepEqual(await getInternalEngineProjectionCapability(store).loadEngineProjection(), beforeProjection,
      'projection checkpoint must remain unchanged');
    const afterPending = await new StoreIngressJournal(store).getPendingDeliveries(0, 1);
    assert.equal(afterPending.length, 1);
    assert.equal(afterPending[0].sequence, beforePending[0].sequence);
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try {
      const status = db.prepare('SELECT delivery_status,acknowledged_at_ms FROM canonical_ingress_delivery_v1 WHERE audit_id=?').get(beforePending[0].sequence);
      assert.equal(status.delivery_status, 'PENDING');
      assert.equal(status.acknowledged_at_ms, null);
    } finally { db.close(); }
  } finally { await store.close(); }
});

test('Engine normally replays a pending delivery strictly after the restored projection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-pending-after-projection-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const stateFor = () => ({ version: 1, wallet: 'projection-order-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false });
  const makeEngine = (store, state, ingress, feedCounters) => {
    let engine;
    const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
      run: async () => { feedCounters.started++; engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0};
    engine = new Engine(cfg, { connection: {} }, {}, {}, store, state, undefined, undefined,
      'deterministic_only', undefined, undefined, undefined, ingress, feed);
    return engine;
  };
  let store = new Store(dbPath);
  let pendingSequence;
  try {
    await store.save(stateFor());
    const firstIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
    makeEngine(store, stateFor(), firstIngress, {started: 0});
    const firstReceipt = await firstIngress.submit(createValidProjectionObservation('checkpoint-before-pending','projection-later-pending-1'));
    assert.equal(firstReceipt.status, 'ACCEPTED', firstReceipt.reason);
    const firstProjection = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    assert.ok(firstProjection.sequence > 0);

    const pendingIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
    pendingIngress.subscribe(() => { throw new Error('LEAVE_SECOND_DELIVERY_PENDING'); });
    assert.equal((await pendingIngress.submit(createValidProjectionObservation('strictly-later-pending','projection-later-pending-2'))).status, 'REJECTED');
    const pending = await new StoreIngressJournal(store).getPendingDeliveries(0, 10);
    assert.equal(pending.length, 1);
    assert.ok(pending[0].sequence > firstProjection.sequence);
    pendingSequence = pending[0].sequence;
  } finally { await store.close(); }

  store = new Store(dbPath);
  const feedCounters = {started: 0};
  let subscriberEffects = 0;
  const recoveredIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  recoveredIngress.subscribe(() => { subscriberEffects++; });
  const restarted = makeEngine(store, await store.load(), recoveredIngress, feedCounters);
  try {
    await restarted.run();
    assert.equal(subscriberEffects, 1);
    assert.equal(feedCounters.started, 1);
    const projection = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    assert.equal(projection.sequence, pendingSequence);
    assert.equal((await new StoreIngressJournal(store).getPendingDeliveries(0, 10)).length, 0);
  } finally { await store.close(); }
});

test('fresh database with no ingress history passes preflight and starts the feed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-fresh-ingress-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const state = { version: 1, wallet: 'fresh-ingress-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const ingress = createCanonicalSolanaIngress({ journal: new StoreIngressJournal(store) });
  let engine;
  let feedStarts = 0;
  const feed = { isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
    run: async () => { feedStarts++; engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0 };
  engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  try {
    await store.save(state);
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try {
      assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_delivery_v1'").get(), undefined);
      assert.equal(db.prepare("SELECT 1 FROM audit WHERE event='canonical_ingress_committed_v1' LIMIT 1").get(), undefined);
    } finally { db.close(); }
    await engine.run();
    assert.equal(feedStarts, 1, 'fresh no-ingress database must reach feed startup');
  } finally { await store.close(); }
});

test('missing outbox with historical committed ingress fails closed without creating the outbox', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-missing-ingress-outbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const state = { version: 1, wallet: 'missing-outbox-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const ingress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  let feedStarts = 0;
  const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
    run: async () => { feedStarts++; }, stop() {}, healthy: () => false, last: 0, slot: 0};
  const engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  try {
    await store.save(state);
    const db = new DatabaseSync(dbPath);
    try { db.prepare("INSERT INTO audit(at,event,body) VALUES(?,?,?)").run(Date.now(), 'canonical_ingress_committed_v1', '{}'); }
    finally { db.close(); }
    await assert.rejects(engine.run(), /INGRESS_OUTBOX_REBUILD_REQUIRED/);
    assert.equal(feedStarts, 0);
    const verify = new DatabaseSync(dbPath, {readOnly: true});
    try {
      assert.equal(verify.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_delivery_v1'").get(), undefined,
        'read-only preflight must not create or migrate the outbox');
      assert.ok(verify.prepare("SELECT 1 FROM audit WHERE event='canonical_ingress_committed_v1' LIMIT 1").get());
    } finally { verify.close(); }
  } finally { await store.close(); }
});

test('missing outbox fails closed when the prune ledger records removed committed ingress', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-pruned-ingress-outbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const state = { version: 1, wallet: 'pruned-ingress-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const ingress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  let feedStarts = 0;
  const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
    run: async () => { feedStarts++; }, stop() {}, healthy: () => false, last: 0, slot: 0};
  const engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  try {
    await store.save(state);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(`INSERT INTO audit_prune_ledger(pruned_at_ms,cutoff_at_ms,deleted_row_count,first_id,last_id,id_ranges_json,
        event_counts_json,first_audit_at_ms,last_audit_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        Date.now(), Date.now(), 1, 1, 1, '[[1,1]]', JSON.stringify({canonical_ingress_committed_v1: 1}), Date.now(), Date.now());
    } finally { db.close(); }
    const before = new DatabaseSync(dbPath, {readOnly: true});
    try { assert.equal(before.prepare("SELECT 1 FROM audit WHERE event='canonical_ingress_committed_v1' LIMIT 1").get(), undefined); }
    finally { before.close(); }
    await assert.rejects(engine.run(), /INGRESS_OUTBOX_REBUILD_REQUIRED/);
    assert.equal(feedStarts, 0);
    const verify = new DatabaseSync(dbPath, {readOnly: true});
    try {
      assert.equal(verify.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='canonical_ingress_delivery_v1'").get(), undefined,
        'read-only preflight must not create or migrate the outbox');
    } finally { verify.close(); }
  } finally { await store.close(); }
});

test('missing outbox and unavailable prune summary schema fail closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-unavailable-prune-ledger-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const state = { version: 1, wallet: 'unavailable-ledger-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const ingress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  let feedStarts = 0;
  const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
    run: async () => { feedStarts++; }, stop() {}, healthy: () => false, last: 0, slot: 0};
  const engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  try {
    await store.save(state);
    const db = new DatabaseSync(dbPath);
    try { db.exec('DROP TABLE audit_prune_ledger'); }
    finally { db.close(); }
    await assert.rejects(engine.run(), /INGRESS_AUDIT_PRUNE_LEDGER_UNAVAILABLE/);
    assert.equal(feedStarts, 0);
  } finally { await store.close(); }
});

test('missing outbox rejects a noninteger committed-ingress prune count', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-malformed-ingress-prune-count-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const store = new Store(dbPath);
  const state = { version: 1, wallet: 'malformed-prune-count-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const ingress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  let feedStarts = 0;
  const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
    run: async () => { feedStarts++; }, stop() {}, healthy: () => false, last: 0, slot: 0};
  const engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  try {
    await store.save(state);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(`INSERT INTO audit_prune_ledger(pruned_at_ms,cutoff_at_ms,deleted_row_count,first_id,last_id,id_ranges_json,
        event_counts_json,first_audit_at_ms,last_audit_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        Date.now(), Date.now(), 1, 1, 1, '[[1,1]]', JSON.stringify({canonical_ingress_committed_v1: 'bogus'}), Date.now(), Date.now());
    } finally { db.close(); }
    await assert.rejects(engine.run(), /INGRESS_AUDIT_PRUNE_LEDGER_INVALID/);
    assert.equal(feedStarts, 0);
  } finally { await store.close(); }
});

test('LEGACY_UNKNOWN delivery blocks startup even when its sequence follows the restored projection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-legacy-unknown-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const state = { version: 1, wallet: 'legacy-ingress-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const makeEngine = (store, ingress, counters) => {
    let engine;
    const feed = {isIngressBound: port => port === ingress, gapReconciler: {setRecoveryCertificateJournal() {}},
      run: async () => { counters.feedStarts++; engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0};
    engine = new Engine(cfg, {connection: {}}, {}, {}, store, state, undefined, undefined,
      'deterministic_only', undefined, undefined, undefined, ingress, feed);
    return engine;
  };
  let store = new Store(dbPath);
  try {
    await store.save(state);
    const firstIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
    makeEngine(store, firstIngress, {feedStarts: 0});
    assert.equal((await firstIngress.submit(createValidProjectionObservation('committed-before-legacy', 'legacy-before-checkpoint'))).status, 'ACCEPTED');
    const checkpoint = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    const laterIngress = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
    laterIngress.subscribe(() => { throw new Error('LEAVE_LATER_DELIVERY_PENDING'); });
    assert.equal((await laterIngress.submit(createValidProjectionObservation('later-legacy', 'legacy-after-checkpoint'))).status, 'REJECTED');
    const pending = await new StoreIngressJournal(store).getPendingDeliveries(checkpoint.sequence, 1);
    assert.equal(pending.length, 1);
    assert.ok(pending[0].sequence > checkpoint.sequence);
    const db = new DatabaseSync(dbPath);
    try { db.prepare("UPDATE canonical_ingress_delivery_v1 SET delivery_status='LEGACY_UNKNOWN',acknowledged_at_ms=NULL WHERE audit_id=?").run(pending[0].sequence); }
    finally { db.close(); }
  } finally { await store.close(); }

  store = new Store(dbPath);
  const counters = {feedStarts: 0};
  let subscriberEffects = 0;
  const recovered = createCanonicalSolanaIngress({journal: new StoreIngressJournal(store)});
  recovered.subscribe(() => { subscriberEffects++; });
  const engine = makeEngine(store, recovered, counters);
  try {
    const checkpoint = await getInternalEngineProjectionCapability(store).loadEngineProjection();
    const startupState = await getStoreIngressCapability(store).inspectIngressStartupState();
    assert.equal(startupState.hasLegacyUnknown, true);
    assert.ok(startupState.oldestPendingSequence === null || startupState.oldestPendingSequence > checkpoint.sequence);
    await assert.rejects(engine.run(), /ENGINE_INGRESS_LEGACY_UNKNOWN_REQUIRES_REBUILD/);
    assert.equal(subscriberEffects, 0);
    assert.equal(counters.feedStarts, 0, 'legacy-unknown must block before feed startup');
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try {
      const row = db.prepare("SELECT delivery_status,acknowledged_at_ms FROM canonical_ingress_delivery_v1 WHERE delivery_status='LEGACY_UNKNOWN' LIMIT 1").get();
      assert.equal(row.delivery_status, 'LEGACY_UNKNOWN');
      assert.equal(row.acknowledged_at_ms, null);
    } finally { db.close(); }
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

  const receiptDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const receipt = receiptDb.prepare(`SELECT sequence,observation_id AS observationId,entry_hash AS entryHash,
      previous_sequence AS previousSequence,previous_projection_hash AS previousProjectionHash,
      canonical_revision AS canonicalRevision,projection_hash AS projectionHash,state_hash AS stateHash
      FROM canonical_ingress_projection_history_v1`).get();
    assert.equal(receipt.sequence, 1);
    assert.equal(receipt.observationId.length, 64);
    assert.equal(receipt.entryHash.length, 64);
    assert.equal(receipt.previousSequence, null);
    assert.equal(receipt.previousProjectionHash, null);
    assert.equal(receipt.canonicalRevision, '1');
    assert.match(receipt.projectionHash, /^[a-f0-9]{64}$/);
    assert.match(receipt.stateHash, /^[a-f0-9]{64}$/);
  } finally { receiptDb.close(); }

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

test('Engine projection skips unchanged state payload writes but persists state changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-projection-state-write-elision-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.sqlite');
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const state = { version: 1, wallet: 'projection-write-elision-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false };
  const store = new Store(dbPath);
  const ingress = createCanonicalSolanaIngress({ journal: new StoreIngressJournal(store) });
  let engine;
  const fakeFeed = {
    isIngressBound: port => port === ingress,
    gapReconciler: { setRecoveryCertificateJournal() {} },
    run: async () => {}, stop() {}, healthy: () => false, last: 0, slot: 0,
  };
  try {
    await store.save(state);
    engine = new Engine(cfg, { connection: {} }, {}, {}, store, state, undefined, undefined,
      'deterministic_only', undefined, undefined, undefined, ingress, fakeFeed);
    assert.equal((await ingress.submit(createValidProjectionObservation('projection-state-write-1', 'projection-state-write-1'))).status, 'ACCEPTED');

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`CREATE TABLE projection_write_counts(name TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER count_state_body_update AFTER UPDATE OF body ON state BEGIN
          INSERT INTO projection_write_counts(name,count) VALUES('state',1)
          ON CONFLICT(name) DO UPDATE SET count=count+1;
        END;
        CREATE TRIGGER count_projection_state_update AFTER UPDATE OF state_json,state_hash ON canonical_ingress_engine_projection_v1 BEGIN
          INSERT INTO projection_write_counts(name,count) VALUES('projection_state',1)
          ON CONFLICT(name) DO UPDATE SET count=count+1;
        END;
        CREATE TRIGGER count_projection_row_update AFTER UPDATE ON canonical_ingress_engine_projection_v1 BEGIN
          INSERT INTO projection_write_counts(name,count) VALUES('projection_row',1)
          ON CONFLICT(name) DO UPDATE SET count=count+1;
        END;`);
    } finally { db.close(); }

    assert.equal((await ingress.submit(createValidProjectionObservation('projection-state-write-2', 'projection-state-write-2'))).status, 'ACCEPTED');
    const unchangedDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const counts = Object.fromEntries(unchangedDb.prepare('SELECT name,count FROM projection_write_counts').all().map(row => [row.name, row.count]));
      assert.equal(counts.state ?? 0, 0, 'identical serialized state must not rewrite the state row');
      assert.equal(counts.projection_state ?? 0, 0, 'identical serialized state must not rewrite the projection state payload');
      assert.equal(counts.projection_row, 1, 'the new projection identity and sequence must still be committed');
    } finally { unchangedDb.close(); }

    state.operatorPaused = true;
    assert.equal((await ingress.submit(createValidProjectionObservation('projection-state-write-3', 'projection-state-write-3'))).status, 'ACCEPTED');
    const changedDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const counts = Object.fromEntries(changedDb.prepare('SELECT name,count FROM projection_write_counts').all().map(row => [row.name, row.count]));
      assert.equal(counts.state, 1, 'a changed state value must update the state row');
      assert.equal(counts.projection_state, 1, 'a changed state value must update the projection state payload and hash');
      const row = changedDb.prepare('SELECT state_json,state_hash FROM canonical_ingress_engine_projection_v1 WHERE id=1').get();
      assert.equal(JSON.parse(row.state_json).operatorPaused, true);
      assert.match(row.state_hash, /^[a-f0-9]{64}$/);
    } finally { changedDb.close(); }
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


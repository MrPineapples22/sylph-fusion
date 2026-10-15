import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import BN from 'bn.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { Engine } from '../../dist/fusion.js';
import { config } from '../../dist/config.js';
import { Store, getStagingIngressBatchCapability, openStagingReplayStore } from '../../dist/store.js';
import { createUnvalidatedObservation } from '../../dist/platform/ingress/observation-factory.js';
import { CanonicalIngress, createCanonicalSolanaIngress, DefaultTruthValidator, SolanaLogFusionEnvelopeCompiler, StoreIngressJournal } from '../../dist/platform/ingress/canonical-ingress.js';
import { getEngineProjectionCapability } from '../../dist/platform/ingress/engine-projection-capability.js';
const testProductionConfig = dbPath => config({ MODE: 'paper', DB_PATH: dbPath ?? 'fusion.sqlite',
  RPC_URLS: 'https://127.0.0.1:1', WS_URLS: '' });
const openStageStore = stage => {
  const store = openStagingReplayStore(stage.dbPath, stage.sessionPath, testProductionConfig());
  stage.handles.push(() => store.close().catch(() => {}));
  return store;
};

function createLogs({ mint, creator, user, timestamp }) {
  const program = getPumpProgram({}), zero = new BN(0);
  const data = { name: 'Fixture token', symbol: 'FIX', uri: 'https://example.invalid/metadata',
    mint: new PublicKey(mint), bondingCurve: Keypair.generate().publicKey, user: new PublicKey(user),
    creator: new PublicKey(creator), timestamp: new BN(timestamp), virtualTokenReserves: zero,
    virtualSolReserves: zero, realTokenReserves: zero, tokenTotalSupply: zero, tokenProgram: TOKEN_PROGRAM_ID,
    isMayhemMode: false, isCashbackEnabled: false, quoteMint: PublicKey.default,
    virtualQuoteReserves: zero, creatorFeeBps: zero, isHolderReward: false };
  const definition = program.idl.events.find(event => event.name === 'createEvent');
  if (!definition) throw new Error('STAGING_CREATE_EVENT_IDL_MISSING');
  const event = Buffer.concat([Buffer.from(definition.discriminator), program.coder.types.encode('createEvent', data)]);
  return [`Program ${PUMP_PROGRAM_ID} invoke [1]`,
    `Program data: ${event.toString('base64')}`, `Program ${PUMP_PROGRAM_ID} success`];
}

async function createStage(t) {
  const work = resolve('work');
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(join(work, 'feed-replay-staging-test-'));
  const sessionPath = join(dir, 'stage-session.json');
  const stage = { dir, sessionPath, dbPath: join(dir, 'staging.sqlite'), handles: [] };
  t.after(async () => {
    for (const close of [...stage.handles].reverse()) await close();
    let lastError;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { await rm(stage.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }); return; }
      catch (error) {
        lastError = error;
        if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    throw lastError;
  });
  const sessionId = randomUUID();
  await writeFile(sessionPath, JSON.stringify({ schemaVersion: 1, project: 'sylph-fusion-finalized-replay',
    sessionId, firstSlot: 1, lastCompletedToSlot: null, pending: { fromSlot: 1, toSlot: 10,
      manifestSha256: 'a'.repeat(64), evidenceSha256: 'b'.repeat(64) } }));
  return stage;
}

function createValidatedBatch(count) {
  const compiler = new SolanaLogFusionEnvelopeCompiler();
  const validator = new DefaultTruthValidator();
  return Array.from({ length: count }, (_, i) => {
    const now = Date.now();
    const mint = Keypair.generate().publicKey.toBase58();
    const creator = Keypair.generate().publicKey.toBase58();
    const user = Keypair.generate().publicKey.toBase58();
    const observation = createUnvalidatedObservation({ sourceId: 'staging-batch-test', providerId: 'fixture-provider',
      transport: 'rpc.getBlock', receivedAtMs: now, observedAtMs: now, slot: 100 + i,
      commitment: 'finalized', signature: `staging-fixture-${i}-${randomUUID()}`, transactionVersion: 'unknown',
      rawPayload: Buffer.from(JSON.stringify(createLogs({ mint, creator, user, timestamp: Math.floor(now / 1000) }))),
      schemaVersion: 'solana-program-logs/v1', processingIntent: 'DETERMINISTIC_REPLAY' });
    const compiled = compiler.compile(observation);
    const result = validator.validate(compiled);
    assert.equal(result.valid, true);
    return result.validatedEnvelope;
  });
}

function revalidateAfterRestart(validatedRows) {
  const compiler = new SolanaLogFusionEnvelopeCompiler();
  const validator = new DefaultTruthValidator();
  return validatedRows.map(validated => {
    const prior = validated.compiledEnvelope.observation;
    const observation = createUnvalidatedObservation({ sourceId: prior.sourceId, providerId: prior.providerId,
      transport: prior.transport, receivedAtMs: prior.receivedAtMs, observedAtMs: prior.observedAtMs, slot: prior.slot,
      commitment: prior.commitment, signature: prior.signature, transactionVersion: prior.transactionVersion,
      rawPayload: Buffer.from(prior.rawPayload), rawPayloadEncoding: prior.rawPayloadEncoding,
      schemaVersion: prior.schemaVersion, processingIntent: prior.processingIntent });
    assert.equal(observation.observationId, prior.observationId);
    const result = validator.validate(compiler.compile(observation));
    assert.equal(result.valid, true);
    return result.validatedEnvelope;
  });
}

test('staging batch is atomic, ordered, idempotent, and recovers through scalar delivery after restart', async t => {
  const stage = await createStage(t);
  const validated = createValidatedBatch(3);
  let store = openStageStore(stage);
  let journal = new StoreIngressJournal(store);
  const first = await journal.appendStagingBatch(validated);
  const firstSequences = first.map(row => Number(row.sequence));
  assert.deepEqual(firstSequences, [...firstSequences].sort((a, b) => a - b));
  for (let i = 0; i < validated.length; i++) {
    const observationId = validated[i].compiledEnvelope.observation.observationId;
    const journalRow = await journal.findByObservationId(observationId);
    assert.equal(journalRow.sequence, first[i].sequence);
    assert.equal(journalRow.entryHash, first[i].entryHash);
    assert.match(first[i].entryHash, /^[a-f0-9]{64}$/);
  }
  assert.equal((await journal.getPendingDeliveries(0, 10)).length, 3);
  await store.close(); // process boundary after durable batch commit, before any projection/ACK

  await new Promise(resolve => setTimeout(resolve, 5));
  const revalidated = revalidateAfterRestart(validated);
  assert.notEqual(revalidated[0].validatedAtMs, validated[0].validatedAtMs);
  assert.notEqual(revalidated[0].truthEvidence.validatedAtMs, validated[0].truthEvidence.validatedAtMs);
  store = openStageStore(stage);
  t.after(() => store.close().catch(() => {}));
  journal = new StoreIngressJournal(store);
  const replay = await journal.appendStagingBatch(revalidated);
  assert.deepEqual(replay.map(row => row.sequence), first.map(row => row.sequence));
  for (let i = 0; i < replay.length; i++) {
    const persisted = await journal.findByObservationId(revalidated[i].compiledEnvelope.observation.observationId);
    assert.equal(replay[i].entryHash, persisted.entryHash);
    assert.equal(replay[i].entryHash, first[i].entryHash);
  }
  const delivered = [];
  const ingress = new CanonicalIngress({ compiler: new SolanaLogFusionEnvelopeCompiler(),
    validator: new DefaultTruthValidator(), journal, downstreamSubscriber: envelope => {
      delivered.push(Number(envelope.journalSeq));
    } });
  assert.equal(await ingress.recoverPendingDeliveries(), 3);
  assert.deepEqual(delivered, first.map(row => Number(row.sequence)));
  assert.equal((await journal.getPendingDeliveries(0, 10)).length, 0);
  assert.equal(replay.every(row => row.inserted === false), true);
  const priorObservation = revalidated[0].compiledEnvelope.observation;
  const changedBytes = Buffer.concat([Buffer.from(priorObservation.rawPayload), Buffer.from(' ')]);
  const changedHash = createHash('sha256').update(changedBytes).digest('hex');
  const changedValidated = Object.freeze({ ...revalidated[0], compiledEnvelope: Object.freeze({
    ...revalidated[0].compiledEnvelope, observation: Object.freeze({ ...priorObservation, rawPayload: changedBytes,
      rawPayloadHash: changedHash }) }), truthEvidence: Object.freeze({ ...revalidated[0].truthEvidence,
      rawPayloadHash: changedHash }) });
  await assert.rejects(journal.appendStagingBatch([changedValidated]), /STAGING_INGRESS_BATCH_CONTENT_CONFLICT/);
});

test('batch conflict and mixed existing IDs fail closed without appending a new prefix', async t => {
  const stage = await createStage(t);
  const validated = createValidatedBatch(2);
  const store = openStageStore(stage);
  t.after(() => store.close().catch(() => {}));
  const journal = new StoreIngressJournal(store);
  await assert.rejects(journal.appendStagingBatch(Array(65).fill(validated[0])), /STAGING_INGRESS_BATCH_LIMIT/);
  await journal.appendStagingBatch([validated[0]]);
  await assert.rejects(journal.appendStagingBatch(validated), /STAGING_INGRESS_BATCH_PARTIAL_EXISTENCE/);
  assert.equal((await journal.getPendingDeliveries(0, 10)).length, 1);
  const priorObservation = validated[0].compiledEnvelope.observation;
  const changedBytes = Buffer.concat([Buffer.from(priorObservation.rawPayload), Buffer.from(' ')]);
  const changedHash = createHash('sha256').update(changedBytes).digest('hex');
  const conflicting = Object.freeze({ ...validated[0], compiledEnvelope: Object.freeze({
    ...validated[0].compiledEnvelope, observation: Object.freeze({ ...priorObservation, rawPayload: changedBytes,
      rawPayloadHash: changedHash }) }), truthEvidence: Object.freeze({ ...validated[0].truthEvidence,
      rawPayloadHash: changedHash }) });
  await assert.rejects(journal.appendStagingBatch([conflicting]), /STAGING_INGRESS_BATCH_CONTENT_CONFLICT/);
  assert.equal((await journal.getPendingDeliveries(0, 10)).length, 1);
});

test('batch operation is unavailable to ordinary Store.call and non-staging Stores', async t => {
  const stage = await createStage(t);
  const staging = openStageStore(stage);
  t.after(() => staging.close().catch(() => {}));
  assert.equal(typeof getStagingIngressBatchCapability(staging), 'function');
  await assert.rejects(staging.call('append-staging-ingress-batch', '[]'), /STAGING_INGRESS_CAPABILITY_REQUIRED/);
  const ordinaryDir = await mkdtemp(join(tmpdir(), 'ordinary-ingress-store-'));
  t.after(() => rm(ordinaryDir, { recursive: true, force: true }));
  const ordinaryDb = join(ordinaryDir, 'ordinary.sqlite');
  const ordinary = new Store(ordinaryDb);
  stage.handles.push(() => ordinary.close().catch(() => {}));
  t.after(() => ordinary.close().catch(() => {}));
  assert.throws(() => openStagingReplayStore(ordinaryDb, stage.sessionPath, testProductionConfig()), /STAGING_INGRESS_PATH_INVALID/);
  assert.equal(getStagingIngressBatchCapability(ordinary), null);
  await assert.rejects(ordinary.call('append-staging-ingress-batch', '[]'), /STAGING_INGRESS_CAPABILITY_REQUIRED/);

  const worker = new Worker(new URL('../../dist/db-worker.js', import.meta.url), { workerData: { path: ordinaryDb } });
  stage.handles.push(() => worker.terminate().catch(() => {}));
  t.after(() => worker.terminate().catch(() => {}));
  const rejected = new Promise((resolveMessage, reject) => {
    worker.once('error', reject);
    worker.on('message', message => { if (message.id === 41) resolveMessage(message); });
  });
  worker.postMessage({ id: 41, op: 'append-staging-ingress-batch', body: '[]', capability: 'f'.repeat(64) });
  const response = await rejected;
  assert.match(response.error, /STAGING_INGRESS_CAPABILITY_REQUIRED/);
});

test('staging store holds an exclusive session lock until clean close', async t => {
  const stage = await createStage(t);
  const first = openStageStore(stage);
  await assert.rejects(async () => openStageStore(stage), /STAGING_INGRESS_LOCK_HELD/);
  await first.close();
  const second = openStageStore(stage);
  t.after(() => second.close().catch(() => {}));
  });

test('stale session lock is fail-closed and requires explicit manual recovery', async t => {
  const stage = await createStage(t);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await once(child, 'exit');
  const pid = child.pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try { process.kill(pid, 0); t.skip('the exited PID was immediately reused'); return; }
  catch (error) { if (error?.code !== 'ESRCH') throw error; }
  const lockPath = join(stage.dir, 'stage-session.lock');
  const session = JSON.parse(await readFile(stage.sessionPath, 'utf8'));
  await writeFile(lockPath, JSON.stringify({ schemaVersion: 1, project: 'sylph-fusion-finalized-replay',
    sessionId: session.sessionId, pid, nonce: 'c'.repeat(64) }));
  assert.throws(() => openStageStore(stage), /STAGING_INGRESS_LOCK_STALE_REQUIRES_MANUAL_RECOVERY/);
  });

test('Engine restores and acknowledges a staged pending batch through scalar projection after reopen', async t => {
  const stage = await createStage(t);
  let store = openStageStore(stage);
  const stateFor = () => ({ version: 1, wallet: 'staging-projection-wallet', mode: 'paper_standard', positions: {}, closed: {},
    pending: null, cash: '1000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', halted: false });
  const cfg = { MODE: 'paper_standard', MAX_TRACKED: 20, MAX_AGE_MS: 300_000, MIN_AGE_MS: 1_000,
    MIN_BUYERS: 2, MIN_BUY_SELL_RATIO_BPS: 1_000, POLL_MS: 10, CHECKPOINT_INTERVAL_MS: 60_000 };
  const validated = createValidatedBatch(1);
  const journal = new StoreIngressJournal(store);
  await store.save(stateFor());
  const receipt = await journal.appendStagingBatch(validated);
  assert.equal((await journal.getPendingDeliveries(0, 10)).length, 1);
  await store.close();

  store = openStageStore(stage);
  t.after(() => store.close().catch(() => {}));
  const restartedJournal = new StoreIngressJournal(store);
  const ingress = createCanonicalSolanaIngress({ journal: restartedJournal });
  let engine;
  let feedStarts = 0;
  const feed = { isIngressBound: port => port === ingress, gapReconciler: { setRecoveryCertificateJournal() {} },
    run: async () => { feedStarts++; engine.stop(); }, stop() {}, healthy: () => false, last: 0, slot: 0 };
  engine = new Engine(cfg, { connection: {} }, {}, {}, store, await store.load(), undefined, undefined,
    'deterministic_only', undefined, undefined, undefined, ingress, feed);
  await engine.run();
  const projection = await getEngineProjectionCapability(store).loadEngineProjection();
  assert.equal(projection.sequence, Number(receipt[0].sequence));
  assert.equal(projection.entryHash, receipt[0].entryHash);
  assert.equal(feedStarts, 1);
  assert.equal((await restartedJournal.getPendingDeliveries(0, 10)).length, 0);
});

test('staging session marker must be a single-link regular file', async t => {
  const stage = await createStage(t);
  const alias = join(stage.dir, 'session-marker-alias.json');
  await link(stage.sessionPath, alias);
  assert.throws(() => openStageStore(stage), /STAGING_INGRESS_SESSION_FILE_INVALID/);
  });

test('staging factory rejects the configured database path without revealing it', async t => {
  const stage = await createStage(t);
  assert.throws(() => openStagingReplayStore(stage.dbPath, stage.sessionPath), /STAGING_CONFIGURED_DATABASE_PATH_REQUIRED/);
  assert.throws(() => openStagingReplayStore(stage.dbPath, stage.sessionPath, testProductionConfig(stage.dbPath)),
    /STAGING_DATABASE_MUST_DIFFER_FROM_CONFIGURED_DATABASE/);
  });

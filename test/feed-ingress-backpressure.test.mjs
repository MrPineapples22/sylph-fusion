import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import BN from 'bn.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { config } from '../dist/config.js';
import { Feed } from '../dist/feed.js';
import { ProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';
import { beginFeedSession, closeFeedSession, feedSessionLatchLocation, persistFeedReplayCheckpoint, persistFeedSessionIncident } from '../dist/platform/ingestion/feed-session-latch.js';
import { Engine } from '../dist/fusion.js';

const cfg = () => config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' });
const mint = Keypair.fromSeed(Buffer.alloc(32, 41)).publicKey;
const user = Keypair.fromSeed(Buffer.alloc(32, 42)).publicKey;
function createLogs() {
  const program = getPumpProgram({}), zero = new BN(0);
  const data = { name: 'fixture', symbol: 'TEST', uri: '', mint, bondingCurve: user, user, creator: user,
    timestamp: zero, virtualTokenReserves: zero, virtualSolReserves: zero, realTokenReserves: zero,
    tokenTotalSupply: zero, tokenProgram: TOKEN_PROGRAM_ID, isMayhemMode: false, isCashbackEnabled: false,
    quoteMint: PublicKey.default, virtualQuoteReserves: zero, creatorFeeBps: zero, isHolderReward: false };
  const definition = program.idl.events.find(e => e.name === 'createEvent');
  const bytes = Buffer.concat([Buffer.from(definition.discriminator), program.coder.types.encode('createEvent', data)]);
  return [`Program ${PUMP_PROGRAM_ID} invoke [1]`, `Program data: ${bytes.toString('base64')}`, `Program ${PUMP_PROGRAM_ID} success`];
}
const source = (index, transport = 'websocket.logsSubscribe') => ({
  sourceId: `provider-${index}`, providerId: 'https://provider.invalid', transport, commitment: 'confirmed',
});
const accepted = observation => ({ status: 'ACCEPTED', observationId: observation.observationId, journalSeq: 1n, envelopeHash: '0'.repeat(64) });
const waitFor = async condition => {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

class FakeWebSocket extends EventEmitter {
  readyState = 0;
  paused = false;
  pauseCount = 0;
  resumeCount = 0;
  onResume = () => {};
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send() {}
  ping() {}
  pause() { this.paused = true; this.pauseCount++; }
  resume() { this.paused = false; this.resumeCount++; this.onResume(); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  notification(index, logs = createLogs()) {
    const message = { method: 'logsNotification', params: { result: { context: { slot: 100 + index }, value: {
      err: null, signature: `signature-${index}`, logs,
    } } } };
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

test('websocket mentions without a Pump invocation do not consume canonical queue capacity', async () => {
  const submitted = [];
  let socket;
  const feed = new Feed(cfg(), {}, {submit: async observation => {
    submitted.push(observation.signature);
    return accepted(observation);
  }}, undefined, undefined, new ProviderHealthTracker(), () => (socket = new FakeWebSocket()));
  const loop = feed.websocket('wss://provider.invalid', 0);
  try {
    await waitFor(() => socket?.readyState === 1);
    socket.notification(0, ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success']);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(submitted, []);
    assert.equal(feed.slot, 0);
    socket.notification(1, createLogs());
    await waitFor(() => submitted.length === 1);
    assert.deepEqual(submitted, ['signature-1']);
    assert.equal(feed.slot, 101);
    const cpiLogs = ['Program 11111111111111111111111111111111 invoke [1]',
      ...createLogs().map(line => line.replace(`Program ${PUMP_PROGRAM_ID} invoke [1]`, `Program ${PUMP_PROGRAM_ID} invoke [2]`)),
      'Program 11111111111111111111111111111111 success'];
    socket.notification(2, cpiLogs);
    await waitFor(() => submitted.length === 2);
    assert.deepEqual(submitted, ['signature-1', 'signature-2'], 'Pump CPI invocation must pass the conservative filter');
    assert.equal(feed.slot, 102);
  } finally {
    await feed.stop();
    await loop;
  }
});

test('websocket ingress pauses and resumes around a serial, ordered canonical queue', async () => {
  let releaseFirst;
  const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
  const submitted = [];
  const ingress = { submit: async observation => {
    submitted.push(observation.signature);
    if (submitted.length === 1) await firstBlocked;
    return accepted(observation);
  } };
  let socket;
  let next = 0;
  const pump = () => {
    while (socket && !socket.paused && socket.readyState === 1 && next < 80) socket.notification(next++);
  };
  const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker(), () => (socket = new FakeWebSocket()));
  const loop = feed.websocket('wss://provider.invalid', 0);
  socket.onResume = pump;
  try {
    await waitFor(() => socket?.readyState === 1);
    pump();
    assert.ok(socket.pauseCount >= 1, `high-water pressure must pause the provider socket (count=${socket.pauseCount}, submitted=${submitted.length}, emitted=${next})`);
    assert.ok(next < 80, 'the producer must stop reading while the consumer is blocked');
    releaseFirst();
    await waitFor(() => submitted.length === 80);
    assert.ok(socket.resumeCount >= 1, 'the provider socket must resume after the queue drains');
    assert.deepEqual(submitted, Array.from({ length: 80 }, (_, i) => `signature-${i}`));
    assert.equal(feed.last > 0, true);
    assert.equal(feed.slot, 179);
    assert.equal(feed.ingressFault, null);
  } finally {
    releaseFirst();
    await feed.stop();
    await loop;
  }
});

test('hard queue overflow latches an explicit slot incident and stays unhealthy after admitted work drains', async () => {
  let releaseFirst;
  const blocked = new Promise(resolve => { releaseFirst = resolve; });
  const submitted = [];
  const faults = [];
  const persistedState = { halted: false };
  const ingress = { submit: async observation => {
    submitted.push(observation.signature);
    if (submitted.length === 1) await blocked;
    return accepted(observation);
  } };
  const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker());
  feed.setFatalIngressFaultHandler(fault => {
    faults.push(fault);
    persistedState.halted = true;
    persistedState.feedIngressFault = { ...fault };
  });
  const logs = createLogs();
  const enqueued = Array.from({ length: 256 }, (_, i) => feed.accept(`sig-${i}`, i + 100, logs, source(i)));
  await assert.rejects(feed.accept('overflow-signature', 999, logs, source(999)), /FEED_INGRESS_QUEUE_OVERFLOW/);
  await assert.rejects(feed.accept('after-fault', 1000, logs, source(1000)), /FEED_INGRESS_QUEUE_OVERFLOW/);
  assert.equal(feed.healthy(), false);
  assert.equal(faults.length, 1);
  assert.deepEqual(faults[0], {
    reason: 'FEED_INGRESS_QUEUE_OVERFLOW', detail: undefined, slot: 999, signature: 'overflow-signature',
    transport: 'websocket.logsSubscribe', observedAtMs: faults[0].observedAtMs,
  });
  releaseFirst();
  await Promise.all(enqueued);
  assert.deepEqual(submitted, Array.from({ length: 256 }, (_, i) => `sig-${i}`));
  assert.equal(feed.healthy(), false, 'draining admitted work must not clear the unreconciled overflow hold');
  await feed.stop();
  await assert.rejects(feed.accept('after-fault-and-stop', 1001, logs, source(1001)), /FEED_INGRESS_QUEUE_OVERFLOW/,
    'an ingress fault must remain rejecting after shutdown');
  assert.equal(persistedState.halted, true);
  assert.equal(persistedState.feedIngressFault.slot, 999);
  assert.equal(persistedState.feedIngressFault.signature, 'overflow-signature');
});

test('a persisted ingress incident still blocks PAPER_MAX_RISK entries after a fresh Feed is healthy', () => {
  const engine = Object.create(Engine.prototype);
  engine.stopped = false;
  engine.feed = { healthy: () => true };
  engine.state = { mode: 'paper_max_risk', pending: null, positions: {}, closed: {}, halted: false, feedIngressFault: {
    reason: 'FEED_INGRESS_QUEUE_OVERFLOW', slot: 900, signature: 'missed-signature',
    transport: 'websocket.logsSubscribe', observedAtMs: Date.now(),
  } };
  engine.entryBuildInFlight = false;
  engine.runtimeUnit = { paperPolicy: { isMaxRisk: () => true } };
  const candidate = { mint: 'mint', devSold: false, next: 0 };
  assert.equal(engine.canSubmitEntry(candidate, { curve: { complete: false } }, 1n), false);
});

test('ordinary validation rejection does not latch the canonical ingress incident hold', async () => {
  const ingress = { submit: async observation => ({ status: 'REJECTED', observationId: observation.observationId, reason: 'TOKEN_EVENT_NOT_RELEVANT' }) };
  const faults = [];
  const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker());
  feed.setFatalIngressFaultHandler(fault => faults.push(fault));
  await feed.accept('normal-rejection', 100, createLogs(), source(1));
  assert.deepEqual(faults, []);
  assert.equal(feed.ingressFault, null);
  await feed.stop();
});

test('canonical journal lookup failure latches a durable slot incident and unhealthy feed', async () => {
  const ingress = { submit: async observation => ({ status: 'REJECTED', observationId: observation.observationId,
    reason: 'JOURNAL_LOOKUP_FAILED: Database request queue full; retry after pending writes complete' }) };
  const faults = [];
  const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker());
  feed.setFatalIngressFaultHandler(fault => faults.push(fault));
  await feed.accept('journal-failure', 321, createLogs(), source(1));
  assert.equal(feed.healthy(), false);
  assert.equal(faults.length, 1);
  assert.equal(faults[0].reason, 'FEED_CANONICAL_INGRESS_FAILURE');
  assert.match(faults[0].detail, /^JOURNAL_LOOKUP_FAILED:/);
  assert.equal(faults[0].slot, 321);
  await feed.stop();
});

test('shutdown rejects new messages and waits for every already admitted ingress attempt', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const submitted = [];
  const ingress = { submit: async observation => { submitted.push(observation.signature); await blocked; return accepted(observation); } };
  const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker());
  const admitted = feed.accept('before-stop', 100, createLogs(), source(1));
  await waitFor(() => submitted.length === 1);
  let stopped = false;
  const stopping = feed.stop().then(() => { stopped = true; });
  assert.equal(await feed.accept('after-stop', 101, createLogs(), source(2)), undefined,
    'messages arriving after shutdown begins must resolve quietly without admission');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(stopped, false, 'stop must wait for admitted work instead of abandoning it');
  release();
  assert.equal((await admitted).status, 'ACCEPTED');
  await stopping;
  assert.equal(stopped, true);
  assert.deepEqual(submitted, ['before-stop']);
});

test('durable incident survives exhausted Store retries and blocks a restarted healthy feed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-session-latch-'));
  const latchPath = join(directory, 'paper.sqlite.feed-session-latch.json');
  const dbIdentity = join(directory, 'paper.sqlite');
  let releaseFirst;
  const blocked = new Promise(resolve => { releaseFirst = resolve; });
  const ingress = { submit: async observation => {
    if (observation.signature === 'sig-0') await blocked;
    return accepted(observation);
  } };
  try {
    const session = await beginFeedSession(latchPath, dbIdentity, dbIdentity, 1000);
    assert.ok(session.sessionId);
    const feed = new Feed(cfg(), {}, ingress, undefined, undefined, new ProviderHealthTracker());
    feed.setFatalIngressFaultHandler(fault => persistFeedSessionIncident(latchPath, session.sessionId, fault));
    let storeSaveAttempts = 0;
    feed.setFatalIngressFaultHandler(async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        storeSaveAttempts++;
        try { throw new Error('simulated Store.save failure'); }
        catch (error) {
          if (attempt === 5) throw error;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
    });
    const queued = Array.from({ length: 256 }, (_, i) => feed.accept(`sig-${i}`, 100 + i, createLogs(), source(i)));
    await assert.rejects(feed.accept('overflow-signature', 999, createLogs(), source(999)), /FEED_INGRESS_QUEUE_OVERFLOW/);
    await assert.rejects(feed.ingressFaultPersistence, /simulated Store.save failure/);
    assert.equal(storeSaveAttempts, 6);
    releaseFirst();
    await Promise.all(queued);
    await feed.stop();

    const restarted = await beginFeedSession(latchPath, dbIdentity, dbIdentity, 2000);
    assert.equal(restarted.sessionId, null);
    assert.equal(restarted.incident.reason, 'FEED_INGRESS_QUEUE_OVERFLOW');
    assert.equal(restarted.incident.slot, 999);
    assert.equal(restarted.incident.signature, 'overflow-signature');
    const recoveredFeed = new Feed(cfg(), {}, { submit: async observation => accepted(observation) }, undefined, undefined, new ProviderHealthTracker());
    recoveredFeed.restoreIngressFault(restarted.incident);
    assert.equal(recoveredFeed.healthy(), false);
    const engine = Object.create(Engine.prototype);
    engine.stopped = false;
    engine.feed = { healthy: () => recoveredFeed.healthy() };
    engine.state = { mode: 'paper_max_risk', pending: null, positions: {}, closed: {}, halted: true,
      feedIngressFault: { ...restarted.incident } };
    engine.entryBuildInFlight = false;
    engine.runtimeUnit = { paperPolicy: { isMaxRisk: () => true } };
    assert.equal(engine.canSubmitEntry({ mint: 'mint', devSold: false, next: 0 }, { curve: { complete: false } }, 1n), false);
    await recoveredFeed.stop();
  } finally {
    releaseFirst?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('unclean ACTIVE marker becomes a durable startup hold until explicitly resolved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-session-clean-'));
  const latchPath = join(directory, 'paper.sqlite.feed-session-latch.json');
  const dbIdentity = join(directory, 'paper.sqlite');
  try {
    await beginFeedSession(latchPath, dbIdentity, dbIdentity, 1000);
    const uncleanRestart = await beginFeedSession(latchPath, dbIdentity, dbIdentity, 2000);
    assert.equal(uncleanRestart.sessionId, null);
    assert.equal(uncleanRestart.incident.reason, 'FEED_SESSION_UNCLEAN_SHUTDOWN');
    assert.equal((await beginFeedSession(latchPath, dbIdentity, dbIdentity, 3000)).sessionId, null, 'unresolved incident must remain blocking');
    await assert.rejects(beginFeedSession(latchPath, join(directory, 'other.sqlite'), join(directory, 'other.sqlite'), 4000), /FEED_SESSION_DATABASE_IDENTITY_MISMATCH/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a cleanly drained session removes only its ACTIVE marker and retains the durable Yellowstone replay cursor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-session-close-'));
  const latchPath = join(directory, 'paper.sqlite.feed-session-latch.json');
  const dbIdentity = join(directory, 'paper.sqlite');
  try {
    const session = await beginFeedSession(latchPath, dbIdentity, dbIdentity, 1000);
    await persistFeedReplayCheckpoint(latchPath, session.sessionId, 456, 1500);
    await closeFeedSession(latchPath, session.sessionId, 512, 2000);
    const next = await beginFeedSession(latchPath, dbIdentity, dbIdentity, 2000);
    assert.ok(next.sessionId);
    assert.equal(next.incident, null);
    assert.equal(next.lastAcceptedYellowstoneSlot, 512, 'clean restart resumes inclusively from the last durable accepted slot');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent Feed.stop calls share one shutdown and close the latch once', async () => {
  const feed = new Feed(cfg(), {}, { submit: async observation => accepted(observation) }, undefined, undefined, new ProviderHealthTracker());
  let closes = 0;
  feed.setCleanSessionCloseHandler(async () => {
    closes++;
    await new Promise(resolve => setTimeout(resolve, 25));
  });
  const first = feed.stop();
  const second = feed.stop();
  assert.strictEqual(first, second, 'concurrent callers must await the exact same shutdown operation');
  await Promise.all([first, second]);
  await feed.stop();
  assert.equal(closes, 1);
});

test('database aliases resolve to the same durable latch identity and location', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-session-alias-'));
  const root = join(directory, 'appdata');
  const database = join(directory, 'paper.sqlite');
  const hardlinkAlias = join(directory, 'alias.sqlite');
  try {
    await writeFile(database, 'disposable-db-fixture');
    try { await link(database, hardlinkAlias); }
    catch (error) { t.skip(`hard links unavailable on this filesystem: ${error.code ?? error}`); return; }
    const original = await feedSessionLatchLocation(database, root);
    const alias = await feedSessionLatchLocation(hardlinkAlias, root);
    assert.equal(alias.databaseIdentity, original.databaseIdentity);
    assert.equal(alias.path, original.path);
    const session = await beginFeedSession(original.path, original.databaseIdentity, original.canonicalDatabasePath, 1000);
    assert.ok(session.sessionId);
    const aliasRestart = await beginFeedSession(alias.path, alias.databaseIdentity, alias.canonicalDatabasePath, 2000);
    assert.equal(aliasRestart.sessionId, null);
    assert.equal(aliasRestart.incident.reason, 'FEED_SESSION_UNCLEAN_SHUTDOWN');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('empty app-data root falls back absolutely across working directories and relative roots fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feed-session-cwd-'));
  const otherCwd = join(directory, 'other-cwd');
  const database = join(directory, 'paper.sqlite');
  const originalCwd = process.cwd();
  const originalLocalAppData = process.env.LOCALAPPDATA;
  try {
    await mkdir(otherCwd);
    await writeFile(database, 'disposable-db-fixture');
    delete process.env.LOCALAPPDATA;
    const fromOriginalCwd = await feedSessionLatchLocation(database);
    process.env.LOCALAPPDATA = '';
    process.chdir(otherCwd);
    const fromOtherCwd = await feedSessionLatchLocation(database);
    assert.ok(isAbsolute(fromOtherCwd.path));
    assert.equal(fromOtherCwd.path, fromOriginalCwd.path);
    process.env.LOCALAPPDATA = 'relative-appdata';
    await assert.rejects(feedSessionLatchLocation(database), /FEED_SESSION_APPDATA_ROOT_MUST_BE_ABSOLUTE/);
  } finally {
    process.chdir(originalCwd);
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    await rm(directory, { recursive: true, force: true });
  }
});

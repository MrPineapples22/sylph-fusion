import test from 'node:test';
import assert from 'node:assert/strict';
import { Feed } from '../dist/feed.js';
import { ProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';
import { CensusRJournalAuthority } from '../dist/platform/ingestion/census-r.js';
import { config } from '../dist/config.js';
import { createTestIngress } from './support/ingress-fixtures.mjs';

const logs = ['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'];
const historical = { sourceId: 'repair', providerId: 'https://repair.invalid', transport: 'websocket.logsSubscribe', processingIntent: 'HISTORICAL_REPAIR' };

function healthEvidence(tracker) {
  const report = tracker.getReport();
  return Object.fromEntries(['SOLANA_WSS', 'YELLOWSTONE_GRPC'].map(id => {
    const provider = report.providers[id];
    return [id, provider && {
      lastValidatedObservation: provider.lastValidatedObservation,
      lastSuccess: provider.lastSuccess,
      totalRequestsCount: provider.totalRequestsCount,
      totalErrorsCount: provider.totalErrorsCount,
      failureReason: provider.failureReason,
      circuitState: provider.circuitState,
    }];
  }));
}

test('newer-slot HISTORICAL_REPAIR is canonically processed without changing live feed or provider health', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  const ingress = createTestIngress({ parser: { *parseLogs() { yield { name: 'TradeEvent', data: { mint: 'historical-mint' } }; } } });
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' }), {}, ingress, undefined, undefined, tracker);
  feed.last = now - 10;
  feed.readySince = now - 10_000;
  feed.slot = 500;
  const before = { last: feed.last, readySince: feed.readySince, slot: feed.slot, health: healthEvidence(tracker) };

  const receipt = await feed.accept('historical-newer-slot', 900, logs, historical);

  assert.equal(receipt.status, 'ACCEPTED', 'historical evidence must still pass through canonical ingress');
  assert.equal(feed.last, before.last);
  assert.equal(feed.readySince, before.readySince);
  assert.equal(feed.slot, before.slot, 'historical slot must not become the live ordering watermark');
  assert.deepEqual(healthEvidence(tracker), before.health);
  assert.equal(feed.healthy(), true);
});

test('rejected non-LIVE historical evidence cannot reset a healthy live feed or trip provider health', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  const ingress = { submit: async () => ({ status: 'REJECTED', reason: 'JOURNAL_APPEND_FAILED' }) };
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' }), {}, ingress, undefined, undefined, tracker);
  feed.last = now - 10;
  feed.readySince = now - 10_000;
  feed.slot = 500;
  const before = { last: feed.last, readySince: feed.readySince, slot: feed.slot, health: healthEvidence(tracker) };

  await feed.accept('historical-rejected', 900, logs, historical);

  assert.equal(feed.last, before.last);
  assert.equal(feed.readySince, before.readySince);
  assert.equal(feed.slot, before.slot);
  assert.deepEqual(healthEvidence(tracker), before.health);
  assert.equal(feed.healthy(), true);
});

test('historical Census-R failure is visible and the committed observation can retry idempotently', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  const ingress = createTestIngress({ parser: { *parseLogs() { yield { name: 'TradeEvent', data: { mint: 'historical-retry-mint' } }; } } });
  const census = new CensusRJournalAuthority();
  const writeLate = census.ingestLateEvent.bind(census);
  let attempts = 0;
  t.mock.method(census, 'ingestLateEvent', params => {
    attempts++;
    if (attempts === 1) throw new Error('injected historical journal outage');
    return writeLate(params);
  });
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' }), {}, ingress, undefined, census, tracker);
  feed.last = now - 10;
  feed.readySince = now - 10_000;
  feed.slot = 500;

  const failedProjection = await feed.accept('historical-census-retry', 900, logs, historical);
  assert.equal(failedProjection.status, 'ACCEPTED');
  assert.equal(failedProjection.postCommitWarning, 'CENSUS_JOURNAL_WRITE_FAILED');
  assert.equal(census.getJournalLength(), 0);
  assert.equal(feed.last, now - 10);
  assert.equal(feed.slot, 500);

  now += 1;
  const retried = await feed.accept('historical-census-retry', 900, logs, historical);
  assert.equal(retried.status, 'DUPLICATE', 'canonical ingress remains idempotent while the secondary historical projection retries');
  assert.equal(retried.postCommitWarning, undefined);
  assert.equal(attempts, 2);
  assert.equal(census.getJournalLength(), 1);
  assert.equal(feed.last, 1_800_000_000_000 - 10, 'historical retry must not make the live feed fresh');
  assert.equal(feed.slot, 500);
  assert.equal(feed.healthy(), true);
});

test('live provider health is not refreshed until the Census-R projection commits', async t => {
  const now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  const ingress = createTestIngress({ parser: { *parseLogs() { yield { name: 'TradeEvent', data: { mint: 'live-journal-failure' } }; } } });
  const census = new CensusRJournalAuthority();
  t.mock.method(census, 'commitTransactionBatch', () => { throw new Error('injected live journal outage'); });
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: ['wss://one.invalid'] }), {}, ingress, undefined, census, tracker);

  const receipt = await feed.accept('live-journal-failure', 901, logs, {
    sourceId: 'live-wss', providerId: 'https://one.invalid', transport: 'websocket.logsSubscribe', processingIntent: 'LIVE',
  });
  const provider = tracker.getReport(now).providers.SOLANA_WSS;
  assert.equal(receipt.postCommitWarning, 'CENSUS_JOURNAL_WRITE_FAILED');
  assert.equal(provider.lastValidatedObservation, 0, 'failed secondary journaling must not mint a fresh provider-observation timestamp');
  assert.equal(provider.observationValidated, false);
  assert.equal(provider.failureReason, 'FEED_CENSUS_JOURNAL_FAILURE');
  assert.equal(feed.last, 0, 'live feed remains halted after the required journal projection fails');
});

test('legacy isRepair cannot override an explicit LIVE intent', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  const ingress = createTestIngress({ parser: { *parseLogs() { yield { name: 'TradeEvent', data: { mint: 'live-mint' } }; } } });
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' }), {}, ingress, undefined, undefined, tracker);

  await feed.accept('explicit-live', 700, logs, { ...historical, isRepair: true, processingIntent: 'LIVE' });

  assert.equal(feed.slot, 700);
  assert.equal(feed.last, now);
  assert.equal(tracker.getReport(now).providers.SOLANA_WSS.lastValidatedObservation, now);
});

test('non-LIVE ingress queue overflow rejects without tripping live feed or provider health', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  let resolveSubmit;
  const pendingSubmit = new Promise(resolve => { resolveSubmit = resolve; });
  const ingress = { submit: () => pendingSubmit };
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' }), {}, ingress, undefined, undefined, tracker);
  feed.last = now - 10;
  feed.readySince = now - 10_000;
  feed.slot = 500;
  const before = { last: feed.last, readySince: feed.readySince, slot: feed.slot, health: healthEvidence(tracker) };
  const admissions = Array.from({ length: 256 }, (_, index) => feed.accept(`historical-queued-${index}`, 900 + index, logs, historical));

  await assert.rejects(feed.accept('historical-overflow', 1200, logs, historical), /FEED_INGRESS_QUEUE_OVERFLOW/);
  assert.equal(feed.last, before.last);
  assert.equal(feed.readySince, before.readySince);
  assert.equal(feed.slot, before.slot);
  assert.deepEqual(healthEvidence(tracker), before.health);
  assert.equal(feed.healthy(), true);

  resolveSubmit({ status: 'REJECTED', reason: 'NO_MATCHING_PROGRAM_EVENTS' });
  await Promise.all(admissions);
});

test('queued feed admission snapshots caller-owned logs and raw frame bytes before backpressure', async t => {
  const tracker = new ProviderHealthTracker();
  const parsed = [];
  const canonical = createTestIngress({ parser: { *parseLogs(input) {
    parsed.push([...input]);
    yield { name: 'TradeEvent', data: { mint: `mint-${parsed.length}` } };
  } } });
  let firstSubmitStarted;
  const firstStarted = new Promise(resolve => { firstSubmitStarted = resolve; });
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let submitCount = 0;
  const ingress = { submit: async observation => {
    submitCount++;
    if (submitCount === 1) {
      firstSubmitStarted();
      await firstGate;
    }
    return canonical.submit(observation);
  } };
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: ['wss://one.invalid'] }), {}, ingress, undefined, undefined, tracker);

  const first = feed.accept('queued-first', 700, logs, { sourceId: 'test-first', providerId: 'https://one.invalid', transport: 'test.live' });
  await firstStarted;

  const intendedLogs = ['Program log: intended snapshot'];
  const intendedFrame = Buffer.from(JSON.stringify({ params: { result: { value: { logs: intendedLogs } } } }));
  const suppliedSource = {
    sourceId: 'test-second', providerId: 'https://two.invalid', transport: 'websocket.logsSubscribe',
    rawPayload: intendedFrame, rawPayloadEncoding: 'JSON_FRAME_BYTES',
  };
  const second = feed.accept('queued-second', 701, intendedLogs, suppliedSource);
  intendedLogs[0] = 'Program log: mutated after admission';
  intendedFrame.fill(0);

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(parsed[1], ['Program log: intended snapshot'],
    'the queued parser must consume the bytes and log snapshot captured at accept() time');
  assert.equal(feed.censusJournal.getJournalLength(), 2);
  t.after(() => feed.stop());
});

test('stop drains already-accepted ingress through Census-R before completing', async t => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  let resolveSubmit;
  const pendingSubmit = new Promise(resolve => { resolveSubmit = resolve; });
  const ingress = { submit: () => pendingSubmit };
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: [] }), {}, ingress);
  const journalLengthBefore = feed.censusJournal.getJournalLength();

  const accepted = feed.accept('accepted-before-stop', 600, logs, {
    sourceId: 'test-live', providerId: 'https://provider.invalid', transport: 'test.live', processingIntent: 'LIVE',
  });
  const stopped = feed.stop();
  resolveSubmit({ status: 'ACCEPTED' });
  await stopped;
  const receipt = await accepted;

  assert.equal(receipt.status, 'ACCEPTED');
  assert.equal(feed.censusJournal.getJournalLength(), journalLengthBefore + 1,
    'stop must wait for admitted accepted work to reach the canonical Census-R journal');
});

test('a websocket ingress incident is attributed to websocket health without poisoning Yellowstone health', () => {
  const tracker = new ProviderHealthTracker();
  const feed = new Feed(config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: ['wss://one.invalid'], YELLOWSTONE_URL: 'https://geyser.invalid' }), {}, { submit: async () => ({ status: 'ACCEPTED' }) }, undefined, undefined, tracker);
  const before = healthEvidence(tracker);

  feed.restoreIngressFault({ reason: 'FEED_INGRESS_QUEUE_OVERFLOW', slot: 900, signature: 'lost-signature',
    transport: 'websocket.logsSubscribe', observedAtMs: Date.now() });

  const after = healthEvidence(tracker);
  assert.equal(after.SOLANA_WSS.totalErrorsCount, before.SOLANA_WSS.totalErrorsCount + 1);
  assert.equal(after.SOLANA_WSS.failureReason, 'FEED_INGRESS_QUEUE_OVERFLOW');
  assert.deepEqual(after.YELLOWSTONE_GRPC, before.YELLOWSTONE_GRPC,
    'a websocket-only queue fault must not count as a Yellowstone transport failure');
});

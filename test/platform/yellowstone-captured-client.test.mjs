import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { Feed } from '../../dist/feed.js';
import { config } from '../../dist/config.js';
import { ProviderHealthTracker } from '../../dist/platform/ingestion/provider-health.js';
import { CensusRJournalAuthority } from '../../dist/platform/ingestion/census-r.js';
import {
  capturedPayloadBytes,
  capturedTransactionObservation,
  buildYellowstoneSubscriptionRequest,
  createCapturedResponseDeserializer,
  yellowstoneBackoffAfterSession,
  YellowstoneReplayCursor,
} from '../../dist/platform/ingestion/yellowstone-captured-client.js';

function encodedUpdate({ slot = '123', signature = Buffer.alloc(64, 7), logs = ['Program log: observed'] } = {}) {
  const update = SubscribeUpdate.fromPartial({
    transaction: { slot, transaction: { signature, meta: { logMessages: logs } } },
  });
  return Buffer.from(SubscribeUpdate.encode(update).finish());
}

test('response deserializer decodes the private copy and preserves the exact message payload', () => {
  const original = encodedUpdate();
  const expected = Buffer.from(original);
  let decoderInput;
  const deserialize = createCapturedResponseDeserializer({
    decode(bytes) { decoderInput = Buffer.from(bytes); return SubscribeUpdate.decode(bytes); },
    encode: SubscribeUpdate.encode,
  });
  const captured = deserialize(original);
  original.fill(0);
  assert.deepEqual(decoderInput, expected, 'the decoder received the same bytes retained by the capture');
  assert.deepEqual(capturedPayloadBytes(captured), expected);
  assert.equal(captured.update.transaction.slot, '123');
  const detached = capturedPayloadBytes(captured);
  detached.fill(0);
  assert.deepEqual(capturedPayloadBytes(captured), expected, 'payload access returns a detached copy');
  captured.update.transaction.transaction.signature.fill(0);
  captured.update.transaction.transaction.meta.logMessages[0] = 'mutated decoded object';
  assert.deepEqual(capturedPayloadBytes(captured), expected, 'decoder-owned Buffer views cannot mutate evidence bytes');
  assert.equal(capturedTransactionObservation(captured).signature, bs58.encode(Buffer.alloc(64, 7)),
    'the Feed-field snapshot remains bound to the object as decoded at capture time');
  assert.deepEqual(capturedTransactionObservation(captured).logs, ['Program log: observed']);
});

test('only decoder-produced capture binds the derived transaction fields to those bytes and Feed ingress', async () => {
  const bytes = encodedUpdate({ slot: '456', signature: Buffer.alloc(64, 9), logs: ['Program log: from wire'] });
  const captured = createCapturedResponseDeserializer(SubscribeUpdate)(bytes);
  const projection = capturedTransactionObservation(captured);
  assert.equal(projection.signature, bs58.encode(Buffer.alloc(64, 9)));
  assert.equal(projection.slot, 456);
  assert.deepEqual(projection.logs, ['Program log: from wire']);
  assert.deepEqual(projection.rawPayload, bytes);
  assert.equal(capturedTransactionObservation({ ...captured, update: SubscribeUpdate.fromPartial({}) }), undefined,
    'a spread object cannot attach capture bytes to an independently substituted update');
  assert.equal(capturedTransactionObservation({ update: captured.update }), undefined,
    'caller-provided decoded values carry no transport capture');

  let observed;
  const f = new Feed(config({ RPC_URLS: 'https://rpc.invalid', WS_URLS: 'wss://rpc.invalid' }), {}, {
    submit: async observation => { observed = observation; return { status: 'ACCEPTED' }; },
  });
  await f.acceptYellowstoneCapture(captured);
  assert.equal(observed.signature, projection.signature);
  assert.equal(observed.slot, 456);
  assert.deepEqual(Buffer.from(observed.rawPayload), bytes);
  assert.equal(observed.rawPayloadEncoding, 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES');
  assert.equal(observed.schemaVersion, 'yellowstone-grpc-protobuf-message/v1');

  const rejected = new Feed(config({ RPC_URLS: 'https://rpc.invalid', WS_URLS: 'wss://rpc.invalid' }), {}, {
    submit: async observation => { observed = observation; return { status: 'ACCEPTED' }; },
  });
  observed = undefined;
  await rejected.accept('caller-forged-signature', 999, ['caller forged log'], {
    sourceId: 'yellowstone-grpc', providerId: 'https://grpc.invalid', transport: 'yellowstone.transaction.logs',
    commitment: 'confirmed', rawPayload: Buffer.from('caller bytes'), rawPayloadEncoding: 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES',
  });
  assert.equal(observed, undefined, 'Feed.accept cannot promote arbitrary caller bytes to captured-message evidence');
  await rejected.accept(projection.signature, projection.slot, projection.logs, {
    sourceId: 'yellowstone-grpc', providerId: 'https://grpc.invalid', transport: 'yellowstone.transaction.logs',
    commitment: 'confirmed', rawPayload: Buffer.from('mismatching bytes'), rawPayloadEncoding: 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES',
    capturedYellowstoneUpdate: captured,
  });
  assert.equal(observed, undefined, 'capture bytes must match the independently supplied payload exactly');
});

test('malformed protobuf and structurally incomplete transactions fail closed', () => {
  const deserialize = createCapturedResponseDeserializer(SubscribeUpdate);
  assert.throws(() => deserialize(Buffer.from([0x22, 0x80])), /index|range|invalid|length/i);
  assert.throws(() => deserialize(Buffer.alloc(0)), /YELLOWSTONE_EMPTY_PROTOBUF_MESSAGE/);
  const noSignature = SubscribeUpdate.fromPartial({ transaction: { slot: '9', transaction: { meta: { logMessages: ['Program log: x'] } } } });
  const captured = deserialize(Buffer.from(SubscribeUpdate.encode(noSignature).finish()));
  assert.equal(capturedTransactionObservation(captured), undefined);
  assert.equal(capturedPayloadBytes({ update: noSignature }), undefined);
});

test('Yellowstone reconnect backoff resets only after a stable 30-second session', () => {
  assert.equal(yellowstoneBackoffAfterSession(8000, 29_999, true), 8000);
  assert.equal(yellowstoneBackoffAfterSession(8000, 30_000, true), 500);
  assert.equal(yellowstoneBackoffAfterSession(8000, 60_000, false), 8000, 'an idle stream closed by the watchdog does not reset');
  assert.equal(yellowstoneBackoffAfterSession(8000, Number.NaN, true), 8000);
});

test('Yellowstone reconnect replays from the last accepted slot and keeps replay historical through the confirmed boundary', () => {
  const cursor = new YellowstoneReplayCursor();
  assert.equal(cursor.prepareReconnect(105), undefined, 'a new stream has no local replay checkpoint');
  cursor.recordAccepted(100);
  const replay = cursor.prepareReconnect(105);
  assert.deepEqual(replay, { fromSlot: '100', historicalThroughSlot: 105 });
  const request = buildYellowstoneSubscriptionRequest({
    accounts: {}, slots: {}, transactions: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {},
    accountsDataSlice: [], commitment: 1,
  }, replay);
  const requestBytes = SubscribeRequest.encode(SubscribeRequest.fromPartial(request)).finish();
  assert.equal(SubscribeRequest.decode(requestBytes).fromSlot, '100', 'the pinned protobuf carries the replay cursor on wire');
  assert.equal(buildYellowstoneSubscriptionRequest({ accounts: {}, slots: {}, transactions: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: 1 }, undefined).fromSlot, undefined,
    'first connection stays a live subscription without a recovery cursor');
  assert.equal(cursor.intentFor(100), 'HISTORICAL_REPAIR');
  assert.equal(cursor.intentFor(105), 'HISTORICAL_REPAIR');
  assert.equal(cursor.intentFor(106), 'LIVE', 'live-health handoff begins only after the sampled confirmed boundary');
  cursor.recordAccepted(106);
  assert.deepEqual(cursor.prepareReconnect(110), { fromSlot: '106', historicalThroughSlot: 110 });
  assert.throws(() => cursor.prepareReconnect(105), /BEHIND_CURSOR/);
});

test('replayed Yellowstone captures enter canonical ingress as historical and cannot refresh live freshness', async () => {
  let observed;
  const feed = new Feed(config({ RPC_URLS: 'https://rpc.invalid', WS_URLS: [] }), {}, {
    submit: async value => { observed = value; return { status: 'ACCEPTED', observationId: value.observationId }; },
  });
  const captured = createCapturedResponseDeserializer(SubscribeUpdate)(encodedUpdate({ slot: '789' }));
  const receipt = await feed.acceptYellowstoneCapture(captured, 'HISTORICAL_REPAIR');
  assert.equal(receipt.status, 'ACCEPTED');
  assert.equal(observed.processingIntent, 'HISTORICAL_REPAIR');
  assert.equal(feed.last, 0);
  assert.equal(feed.slot, 0);
});

test('accepted Yellowstone observations update provider health without exposing endpoint credentials', async () => {
  const tracker = new ProviderHealthTracker();
  const endpoint = 'https://geyser.example.invalid:443/stream?api-key=private-value';
  const f = new Feed(config({
    RPC_URLS: 'https://rpc.invalid',
    WS_URLS: 'wss://rpc.invalid',
    YELLOWSTONE_URL: endpoint,
    YELLOWSTONE_TOKEN: 'private-token',
  }), {}, { submit: async () => ({ status: 'ACCEPTED' }) }, undefined, undefined, tracker);

  const captured = createCapturedResponseDeserializer(SubscribeUpdate)(encodedUpdate({ slot: '789' }));
  await f.acceptYellowstoneCapture(captured);
  const provider = tracker.getReport().providers.YELLOWSTONE_GRPC;
  assert.equal(provider.configured, true);
  assert.equal(provider.authenticationRequirement, 'REQUIRED');
  assert.equal(provider.authenticated, true, 'an accepted update verifies the configured credential');
  assert.equal(provider.transportReachable, true);
  assert.equal(provider.observationValidated, true);
  assert.equal(provider.totalRequestsCount, 1);
  assert.equal(provider.endpointUrlSanitized, 'https://geyser.example.invalid/stream');
  assert.ok(!JSON.stringify(tracker.getReport()).includes('private-value'));
  assert.ok(!JSON.stringify(tracker.getReport()).includes('private-token'));
});

test('failed Census-R commit cannot refresh Yellowstone validated-observation health', async t => {
  const tracker = new ProviderHealthTracker();
  const census = new CensusRJournalAuthority();
  t.mock.method(census, 'commitTransactionBatch', () => { throw new Error('injected Yellowstone journal outage'); });
  const f = new Feed(config({
    RPC_URLS: 'https://rpc.invalid',
    WS_URLS: 'wss://rpc.invalid',
    YELLOWSTONE_URL: 'https://geyser.example.invalid/stream',
    YELLOWSTONE_TOKEN: 'private-token',
  }), {}, { submit: async () => ({ status: 'ACCEPTED' }) }, undefined, census, tracker);
  const captured = createCapturedResponseDeserializer(SubscribeUpdate)(encodedUpdate({ slot: '790' }));

  await f.acceptYellowstoneCapture(captured);
  const provider = tracker.getReport().providers.YELLOWSTONE_GRPC;
  assert.equal(provider.lastValidatedObservation, 0,
    'the Geyser observation is not fully accepted until the required journal projection commits');
  assert.equal(provider.observationValidated, false);
  assert.equal(provider.failureReason, 'FEED_CENSUS_JOURNAL_FAILURE');
  assert.equal(f.last, 0);
});

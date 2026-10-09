import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { SubscribeUpdate } from '@triton-one/yellowstone-grpc';
import { Feed } from '../../dist/feed.js';
import { config } from '../../dist/config.js';
import {
  capturedPayloadBytes,
  capturedTransactionObservation,
  createCapturedResponseDeserializer,
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
  assert.equal(observed.schemaVersion, 'provider-payload/v1');

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

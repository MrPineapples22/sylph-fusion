import assert from 'node:assert/strict';
import test from 'node:test';
import { ContractCanaryAuthority, createWireWitness } from '../../dist/platform/ingestion/contract-canary.js';

test('CONTRACTCANARY: payload container and transport do not imply an encoding', () => {
  const canary = new ContractCanaryAuthority();
  for (const transport of ['HTTP_REST', 'WSS', 'GRPC']) {
    for (const payload of ['{"slot":1}', Buffer.from('{"slot":1}'), new Uint8Array([8, 1])]) {
      assert.equal(createWireWitness('provider', 'capability', transport, payload).wireEncoding, 'UNSPECIFIED');
      assert.equal(canary.createWireWitness('provider', 'capability', transport, payload).wireEncoding, 'UNSPECIFIED');
    }
    assert.equal(canary.createWireWitness('provider', 'capability', transport, { slot: 1 }).wireEncoding, 'UNSPECIFIED');
  }
});

test('CONTRACTCANARY: explicit representations stay distinct and hashes do not authenticate them', () => {
  const payload = '{"slot":1}';
  const witnesses = [
    ['HTTP_REST', payload, 'JSON_FRAME_BYTES'],
    ['WSS', Buffer.from(payload), 'JSON_FRAME_BYTES'],
    ['HTTP_REST', payload, 'JSON_CANONICAL'],
    ['GRPC', payload, 'DECODED_PROTOBUF_JSON_CANONICAL'],
    ['GRPC', Buffer.from(payload), 'PROTOBUF_WIRE_BYTES'],
  ].map(([transport, bytes, encoding]) => {
    const witness = createWireWitness('provider', 'capability', transport, bytes, 200, 'UNKNOWN', encoding);
    assert.equal(witness.wireEncoding, encoding);
    assert.equal(witness.contractStatus, 'UNKNOWN');
    return witness;
  });
  // Equal byte digests cannot establish whether any caller's encoding claim is true.
  assert.equal(new Set(witnesses.map((witness) => witness.payloadHash)).size, 1);
});

test('CONTRACTCANARY: validates RugCheck API schema and rejects malformed responses', () => {
  const canary = new ContractCanaryAuthority();

  // 1. Valid RugCheck report
  const validReport = {
    score: 150,
    rugged: false,
    risks: [
      { name: 'LowLiquidity', level: 'warn', score: 50 },
    ],
    token: {
      mintAuthority: null,
      freezeAuthority: null,
    },
  };
  const val1 = canary.validateRugCheckResponse(validReport);
  assert.equal(val1.isValid, true);
  assert.equal(val1.report?.score, 150);
  assert.equal(val1.report?.risks.length, 1);

  // 2. Malformed report (missing score or non-finite score)
  const malformedReport = {
    rugged: false,
    score: 'not-a-number',
  };
  const val2 = canary.validateRugCheckResponse(malformedReport);
  assert.equal(val2.isValid, false);
  assert.match(val2.error ?? '', /missing finite non-negative score/);
});

test('CONTRACTCANARY: validates DexScreener pairs and extracts valid numeric metrics', () => {
  const canary = new ContractCanaryAuthority();

  const validPairs = {
    pairs: [
      {
        pairAddress: 'PairAddress11111111111111111111111111111111',
        priceUsd: '0.0025',
        liquidity: { usd: 45000 },
        baseToken: { address: 'BaseToken11111111111111111111111111111111' },
        quoteToken: { address: 'So11111111111111111111111111111111111111112' },
      },
    ],
  };

  const val = canary.validateDexScreenerPairs(validPairs);
  assert.equal(val.isValid, true);
  assert.equal(val.pairs?.length, 1);
  assert.equal(val.pairs?.[0].priceUsd, 0.0025);
  assert.equal(val.pairs?.[0].liquidityUsd, 45000);
});

test('CONTRACTCANARY: tracks 5 health dimensions and quarantines drifting providers', () => {
  const canary = new ContractCanaryAuthority();

  // Provider healthy
  const h1 = canary.recordValidationResult({
    providerId: 'rugcheck-main',
    isTransportOk: true,
    isSchemaOk: true,
    isSemanticOk: true,
    isFresh: true,
    quotaAvailable: true,
    slot: 310000000,
  });
  assert.equal(h1.isQuarantined, false);
  assert.equal(canary.isProviderHealthy('rugcheck-main'), true);

  // Schema drift detected -> automatically quarantined
  const h2 = canary.recordValidationResult({
    providerId: 'rugcheck-main',
    isTransportOk: true,
    isSchemaOk: false, // Drift!
    isSemanticOk: true,
    isFresh: true,
    quotaAvailable: true,
    slot: 310000010,
    errorReason: 'Unexpected schema modification in RugCheck API v2',
  });
  assert.equal(h2.isQuarantined, true);
  assert.equal(canary.isProviderHealthy('rugcheck-main'), false);
});

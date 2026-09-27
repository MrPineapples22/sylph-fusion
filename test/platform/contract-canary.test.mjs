import assert from 'node:assert/strict';
import test from 'node:test';
import { ContractCanaryAuthority } from '../../dist/platform/ingestion/contract-canary.js';

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

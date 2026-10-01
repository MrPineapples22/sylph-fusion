import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ContractCanaryAuthority,
  validateRugCheckResponse,
  validateDexScreenerPairs,
  createWireWitness,
} from '../../dist/platform/ingestion/contract-canary.js';
import {
  MultiSourceCrossValidator,
  PROVIDER_INDEPENDENCE_REGISTRY,
} from '../../dist/platform/ingestion/cross-validator.js';
import { Store } from '../../dist/store.js';
import { scanToken } from '../../dist/risk.js';

test('PASS-27 REQ-1: validateRugCheckResponse enforces epistemic states and rejects boolean coercion of null/missing', () => {
  // Case A: Missing or null rugged field
  const payloadMissing = {
    mint: 'TestMint1111111111111111111111111111111111',
    score: 150,
    risks: [],
    mintAuthority: null,
    freezeAuthority: null,
  };
  const resultMissing = validateRugCheckResponse(payloadMissing);
  assert.equal(resultMissing.isValid, true);
  assert.ok(resultMissing.report);
  assert.equal(resultMissing.report.epistemicRugged.state, 'ABSENT');
  assert.equal(resultMissing.report.epistemicRugged.value, undefined);
  assert.equal(resultMissing.report.rugged, false, 'Boolean projection defaults to false but epistemic state retains ABSENT');
  assert.equal(resultMissing.report.epistemicMintAuthority.state, 'NULL');
  assert.equal(resultMissing.report.epistemicFreezeAuthority.state, 'NULL');

  // Case B: Explicitly safe RugCheck report
  const payloadExplicitSafe = {
    mint: 'SafeMint1111111111111111111111111111111111',
    score: 50,
    risks: [],
    rugged: false,
    mintAuthority: null,
    freezeAuthority: null,
  };
  const resultSafe = validateRugCheckResponse(payloadExplicitSafe);
  assert.equal(resultSafe.isValid, true);
  assert.ok(resultSafe.report);
  assert.equal(resultSafe.report.epistemicRugged.state, 'PRESENT');
  assert.equal(resultSafe.report.epistemicRugged.value, false);
  assert.equal(resultSafe.report.rugged, false);

  // Case C: Explicitly rugged
  const payloadRugged = {
    mint: 'BadMint11111111111111111111111111111111111',
    score: 5000,
    risks: [{ name: 'Rugged', level: 'danger', score: 5000 }],
    rugged: true,
  };
  const resultRugged = validateRugCheckResponse(payloadRugged);
  assert.ok(resultRugged.report);
  assert.equal(resultRugged.report.epistemicRugged.state, 'PRESENT');
  assert.equal(resultRugged.report.epistemicRugged.value, true);
  assert.equal(resultRugged.report.rugged, true);
});

test('PASS-27 REQ-2: validateDexScreenerPairs treats empty pairs array as ABSENT evidence, not zero/valid quote', () => {
  // Empty pairs array from DexScreener (token not yet indexed or zero pairs found)
  const emptyPayload = { schemaVersion: '1.0.0', pairs: [] };
  const emptyResult = validateDexScreenerPairs(emptyPayload);

  assert.equal(emptyResult.isValid, true, 'Wire format is syntactically valid');
  assert.equal(emptyResult.hasPairs, false, 'hasPairs must be false');
  assert.equal(emptyResult.epistemicState, 'ABSENT', 'Epistemic state must be ABSENT');
  assert.equal(emptyResult.pairs?.length, 0);

  // Populated pairs
  const populatedPayload = {
    schemaVersion: '1.0.0',
    pairs: [
      {
        pairAddress: 'PairAddress11111111111111111111111111111111',
        chainId: 'solana',
        priceUsd: '0.045',
        liquidity: { usd: 150000 },
        baseToken: { address: 'BaseToken11111111111111111111111111111111' },
        quoteToken: { address: 'So11111111111111111111111111111111111111112' },
      },
    ],
  };
  const populatedResult = validateDexScreenerPairs(populatedPayload);
  assert.equal(populatedResult.hasPairs, true);
  assert.equal(populatedResult.epistemicState, 'PRESENT');
  assert.equal(populatedResult.pairs?.[0].priceUsd, 0.045);
  assert.equal(populatedResult.pairs?.[0].liquidityUsd, 150000);
  assert.equal(populatedResult.pairs?.[0].epistemicPrice.state, 'PRESENT');
});

test('PASS-27 REQ-3: createWireWitness computes deterministic SHA-256 payload digest and captures byte length', () => {
  const payload = JSON.stringify({ event: 'price_update', slot: 310555000, mint: 'TestMint', price: 1.25 });
  const witness = createWireWitness(
    'PUMPPORTAL_WS',
    'PRICE_FEED',
    'WEBSOCKET',
    payload,
    101
  );

  assert.ok(witness.witnessId.startsWith('wit_PUMPPORTAL_WS_'));
  assert.equal(witness.providerId, 'PUMPPORTAL_WS');
  assert.equal(witness.capabilityId, 'PRICE_FEED');
  assert.equal(witness.transport, 'WEBSOCKET');
  assert.equal(witness.byteLength, Buffer.byteLength(payload, 'utf8'));
  assert.equal(witness.payloadHash.length, 64, 'SHA-256 must be 64 hex characters');
  assert.equal(witness.contractStatus, 'VALID');
});

test('PASS-27 REQ-4: Store SQLite WAL contract_canaries persistence and cold-boot rehydration preserves quarantine', async () => {
  const dbPath = resolve(process.cwd(), `test-contract-canary-${Date.now()}.db`);
  const store = new Store(dbPath);

  try {
    // 1. Initial empty canaries
    const initialRows = await store.getAllContractCanaries();
    assert.equal(initialRows.length, 0);

    // 2. Persist healthy provider and quarantined provider
    await store.saveContractCanary({
      providerId: 'SOLANA_RPC',
      transportHealth: 'HEALTHY',
      schemaHealth: 'HEALTHY',
      semanticHealth: 'HEALTHY',
      freshnessHealth: 'HEALTHY',
      quotaHealth: 'HEALTHY',
      isQuarantined: false,
      lastValidatedSlot: 310550100,
      lastValidatedAtMs: 1774000000000,
      contractEpochId: 'epoch-solana-rpc-1',
      contractFingerprint: 'fp-solana-rpc-abc',
    });

    await store.saveContractCanary({
      providerId: 'RUGCHECK_API',
      transportHealth: 'DEGRADED',
      schemaHealth: 'QUARANTINED',
      semanticHealth: 'QUARANTINED',
      freshnessHealth: 'HEALTHY',
      quotaHealth: 'HEALTHY',
      isQuarantined: true,
      lastValidatedSlot: 310550050,
      lastValidatedAtMs: 1774000000000,
      failureReason: 'SEMANTIC_DRIFT_MISSING_RUGGED_FIELD',
      contractEpochId: 'epoch-rugcheck-2',
      contractFingerprint: 'fp-rugcheck-xyz',
    });

    // 3. Query single canary
    const fetchedRugcheck = await store.getContractCanary('RUGCHECK_API');
    assert.ok(fetchedRugcheck);
    assert.equal(fetchedRugcheck.provider_id, 'RUGCHECK_API');
    assert.equal(fetchedRugcheck.is_quarantined, 1);
    assert.equal(fetchedRugcheck.failure_reason, 'SEMANTIC_DRIFT_MISSING_RUGGED_FIELD');

    // 4. Simulate process restart: instantiate new ContractCanaryAuthority and hydrate from store
    const restartedAuthority = new ContractCanaryAuthority();
    assert.equal(restartedAuthority.isProviderEligible('RUGCHECK_API'), true, 'Before hydration, default map is empty');

    const rehydratedCount = await restartedAuthority.loadPersistedCanaries(store);
    assert.equal(rehydratedCount, 2);

    // 5. Invariant: Quarantine MUST survive restart!
    assert.equal(restartedAuthority.isProviderEligible('RUGCHECK_API'), false, 'Quarantine must be enforced post-hydration');
    assert.equal(restartedAuthority.isProviderEligible('SOLANA_RPC'), true, 'Healthy provider remains eligible');

    const loadedRugcheck = restartedAuthority.getHealth('RUGCHECK_API');
    assert.equal(loadedRugcheck?.isQuarantined, true);
    assert.equal(loadedRugcheck?.failureReason, 'SEMANTIC_DRIFT_MISSING_RUGGED_FIELD');
    assert.equal(loadedRugcheck?.contractEpochId, 'epoch-rugcheck-2');
  } finally {
    await store.close();
    try { rmSync(dbPath, { force: true }); } catch {}
    try { rmSync(`${dbPath}-wal`, { force: true }); } catch {}
    try { rmSync(`${dbPath}-shm`, { force: true }); } catch {}
  }
});

test('PASS-27 REQ-5: MultiSourceCrossValidator enforces distinct independence groups for VERIFIED status', () => {
  const validator = new MultiSourceCrossValidator();
  const now = Date.now();

  // Test Case A: Correlated sources sharing the same upstream independence group
  // DEXSCREENER_API and PUMPPORTAL_WS are both in AMM_BONDING_INDEXER group!
  assert.equal(
    PROVIDER_INDEPENDENCE_REGISTRY.DEXSCREENER_API.independenceGroup,
    PROVIDER_INDEPENDENCE_REGISTRY.PUMPPORTAL_WS.independenceGroup
  );

  const correlatedSnapshot = validator.evaluateToken({
    mint: 'Correlated1111111111111111111111111111111111',
    symbol: 'CORR',
    priceObservations: [
      { provider: 'DEXSCREENER_API', value: 1.00, timestampMs: now - 500, latencyMs: 20, confidence: 0.90 },
      { provider: 'PUMPPORTAL_WS', value: 1.01, timestampMs: now - 400, latencyMs: 15, confidence: 0.90 },
    ],
    now,
  });

  // Must NOT be VERIFIED! Must be demoted to PARTIALLY_VERIFIED due to shared independence group
  assert.equal(correlatedSnapshot.status, 'PARTIALLY_VERIFIED');
  assert.ok(
    correlatedSnapshot.disagreementFlags.some(f => f.includes('CORRELATED_SOURCES_SHARED_GROUP_AMM_BONDING_INDEXER')),
    'Must record CORRELATED_SOURCES_SHARED_GROUP disagreement flag'
  );

  // Test Case B: Truly independent sources (SOLANA_RPC vs DEXSCREENER_API)
  assert.notEqual(
    PROVIDER_INDEPENDENCE_REGISTRY.SOLANA_RPC.independenceGroup,
    PROVIDER_INDEPENDENCE_REGISTRY.DEXSCREENER_API.independenceGroup
  );

  const independentSnapshot = validator.evaluateToken({
    mint: 'Independent11111111111111111111111111111111',
    symbol: 'INDEP',
    priceObservations: [
      { provider: 'SOLANA_RPC', value: 1.00, timestampMs: now - 500, latencyMs: 30, confidence: 0.95 },
      { provider: 'DEXSCREENER_API', value: 1.01, timestampMs: now - 400, latencyMs: 20, confidence: 0.90 },
    ],
    now,
  });

  assert.equal(independentSnapshot.status, 'VERIFIED', 'Independent sources must achieve VERIFIED consensus');
  assert.equal(
    independentSnapshot.disagreementFlags.filter(f => f.includes('CORRELATED_SOURCES')).length,
    0
  );
});

test('PASS-27 REQ-6: risk.ts rejects unobserved/missing rugged field from achieving safe=true', async () => {
  // Mock tracker
  const tracker = {
    recordSuccess: () => {},
    recordFailure: () => {},
    getProviderStatus: () => 'HEALTHY',
    canMakeRequest: () => true,
    recordLatency: () => {},
    updateQuotas: () => {},
  };

  // When RugCheck returns missing rugged property (out.rugged === null), safe must NOT be true
  // We mock a fetch response where rugged is undefined
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('rugcheck')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            mint: 'TestMint1111111111111111111111111111111111',
            score: 0,
            // rugged is intentionally omitted!
            risks: [],
            mintAuthority: null,
            freezeAuthority: null,
            topHolders: [],
          }),
        };
      }
      if (urlStr.includes('rpc') || urlStr.includes('solana')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            result: {
              value: {
                data: {
                  parsed: {
                    info: {
                      mintAuthority: null,
                      freezeAuthority: null,
                      decimals: 9,
                      supply: '1000000000',
                    },
                  },
                },
              },
            },
          }),
        };
      }
      return { ok: false, status: 500 };
    };

    const res = await scanToken(
      'TestMint1111111111111111111111111111111111',
      'https://mock-rpc.solana.com',
      'https://api.rugcheck.xyz/v1/tokens',
      tracker
    );

    // With our fix, out.rugged === null, so out.safe MUST be null (never true)!
    assert.equal(res.rugged, null, 'Unreported rugged must remain null');
    assert.notEqual(res.safe, true, 'safe must NEVER be true when rugged is unobserved / null');
    assert.equal(res.safe, null, 'safe must be null (epistemically unverified)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

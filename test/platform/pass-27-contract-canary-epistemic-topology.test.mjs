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
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

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

test('risk scanner only accepts mint authority bytes from the two canonical Solana token programs', async () => {
  const originalFetch = globalThis.fetch;
  const mint = 'So11111111111111111111111111111111111111112';
  const initializedMint = Buffer.alloc(82);
  initializedMint[45] = 1;
  const baseMintBytes = initializedMint.toString('base64');
  let rugcheckReport = { mint, rugged: false, risks: [], mintAuthority: null, freezeAuthority: null };
  let rpcData = [baseMintBytes, 'base64'];
  try {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('rugcheck')) {
        return { ok: true, status: 200, json: async () => rugcheckReport };
      }
      if (urlStr.includes('rpc')) {
        const owner = new URL(urlStr).searchParams.get('owner') ?? PublicKey.default.toBase58();
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', result: { value: { data: rpcData, owner } } }) };
      }
      return { ok: false, status: 500 };
    };

    for (const owner of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const result = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${owner.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
      assert.equal(result.providers.rpc, 'live');
      assert.equal(result.authorities.status, 'revoked');
      assert.notEqual(result.safe, true);
    }

    const unsupported = await scanToken(mint, 'https://mock-rpc.solana.com/', 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(unsupported.providers.rpc, 'unavailable');
    assert.equal(unsupported.authorities.status, 'unknown');
    assert.equal(unsupported.authorities.mint, null);
    assert.equal(unsupported.authorities.freeze, null);
    assert.equal(unsupported.safe, null);
    assert.ok(unsupported.risks.some(risk => risk.name === 'Unsupported mint program owner'));

    rugcheckReport = { ...rugcheckReport, freezeAuthority: TOKEN_PROGRAM_ID.toBase58() };
    const adverse = await scanToken(mint, 'https://mock-rpc.solana.com/', 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(adverse.authorities.status, 'unknown');
    assert.equal(adverse.authorities.freeze, TOKEN_PROGRAM_ID.toBase58());
    assert.equal(adverse.safe, false);

    const mintWithTlv = (tlv) => {
      const accountData = Buffer.alloc(166 + tlv.length);
      initializedMint.copy(accountData);
      accountData[165] = 1; // Token-2022 AccountType::Mint
      tlv.copy(accountData, 166);
      rpcData = [accountData.toString('base64'), 'base64'];
    };
    const tlvEntry = (type, value) => Buffer.concat([Buffer.from([type & 0xff, type >> 8, value.length & 0xff, value.length >> 8]), value]);
    const metadataPointer = tlvEntry(18, Buffer.alloc(64));
    for (const padding of [Buffer.alloc(1), Buffer.alloc(2), Buffer.from([0, 0, 0, 0])]) {
      mintWithTlv(Buffer.concat([metadataPointer, padding]));
      const validExtended = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
      assert.equal(validExtended.providers.rpc, 'live');
      assert.deepEqual(validExtended.token2022.extensions, ['18']);
    }

    const feeConfig = ({ authority = false, olderBps = 0, newerBps = 0, newerEpoch = 0n } = {}) => {
      const value = Buffer.alloc(108);
      if (authority) TOKEN_PROGRAM_ID.toBuffer().copy(value, 0);
      value.writeBigUInt64LE(newerEpoch, 90);
      value.writeUInt16LE(olderBps, 88);
      value.writeUInt16LE(newerBps, 106);
      return value;
    };
    const optimisticFeeReport = { mint, rugged: false, risks: [], mintAuthority: null, freezeAuthority: null, topHolders: [{ pct: 1 }], markets: [{ protocol: 'pump' }] };
    rugcheckReport = optimisticFeeReport;
    mintWithTlv(tlvEntry(1, feeConfig({ authority: true })));
    const mutableFee = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(mutableFee.token2022.transferFeeBps, 0);
    assert.equal(mutableFee.token2022.feeAuthority, TOKEN_PROGRAM_ID.toBase58());
    assert.equal(mutableFee.safe, false);
    assert.ok(mutableFee.risks.some(risk => risk.name === 'Token-2022 transfer fee authority active'));

    for (const config of [feeConfig({ olderBps: 1000, newerBps: 0, newerEpoch: 5n }), feeConfig({ olderBps: 0, newerBps: 1000 })]) {
      mintWithTlv(tlvEntry(1, config));
      const scheduledFee = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
      assert.equal(scheduledFee.token2022.transferFeeBps, 1000);
      assert.equal(scheduledFee.token2022.feeAuthority, null);
      assert.ok(scheduledFee.risks.some(risk => risk.name === 'Token-2022 transfer fee enabled'));
    }
    mintWithTlv(tlvEntry(1, feeConfig()));
    const immutableZeroFee = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(immutableZeroFee.token2022.feeAuthority, null);
    assert.equal(immutableZeroFee.token2022.transferFeeBps, 0);
    assert.equal(immutableZeroFee.safe, true);

    const withdrawalOnly = feeConfig();
    TOKEN_PROGRAM_ID.toBuffer().copy(withdrawalOnly, 32);
    mintWithTlv(tlvEntry(1, withdrawalOnly));
    const withdrawalAuthority = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(withdrawalAuthority.token2022.feeAuthority, null);
    assert.equal(withdrawalAuthority.safe, true);

    rugcheckReport = { ...optimisticFeeReport, transferFee: { pct: 0, authority: TOKEN_PROGRAM_ID.toBase58() } };
    mintWithTlv(Buffer.alloc(0));
    const feeReportConflict = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
    assert.equal(feeReportConflict.token2022.transferFeeBps, null);
    assert.equal(feeReportConflict.token2022.feeAuthority, null);
    assert.equal(feeReportConflict.safe, null);
    assert.ok(feeReportConflict.risks.some(risk => risk.name === 'Transfer fee report conflicts with mint data'));
    rugcheckReport = optimisticFeeReport;

    for (const bps of [10000, 10001]) {
      mintWithTlv(tlvEntry(1, feeConfig({ olderBps: bps })));
      const boundedFee = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
      if (bps === 10000) {
        assert.equal(boundedFee.token2022.transferFeeBps, 10000);
        assert.equal(boundedFee.safe, false);
      } else {
        assert.equal(boundedFee.providers.rpc, 'unavailable');
        assert.equal(boundedFee.safe, null);
      }
    }

    rugcheckReport = { mint, rugged: false, risks: [], mintAuthority: null, freezeAuthority: null };
    for (const malformedTlv of [
      Buffer.from([1, 0]), // incomplete TLV header
      Buffer.from([1, 0, 108, 0]), // TransferFeeConfig declares 108 bytes but contains none
      Buffer.concat([Buffer.from([1, 0, 107, 0]), Buffer.alloc(107)]), // known fixed extension has wrong width
      Buffer.concat([metadataPointer, metadataPointer]), // duplicate extension
      tlvEntry(2, Buffer.alloc(8)), // account-only TransferFeeAmount in a mint
      tlvEntry(65535, Buffer.alloc(0)), // unknown extension type
    ]) {
      mintWithTlv(malformedTlv);
      const rejected = await scanToken(mint, `https://mock-rpc.solana.com/?owner=${TOKEN_2022_PROGRAM_ID.toBase58()}`, 'https://api.rugcheck.xyz/v1/tokens');
      assert.equal(rejected.providers.rpc, 'unavailable');
      assert.equal(rejected.authorities.status, 'unknown');
      assert.equal(rejected.safe, null);
      assert.ok(rejected.risks.some(risk => risk.name === 'Invalid mint account data'));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

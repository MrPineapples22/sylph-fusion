import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RuntimeDivergenceAuditor,
} from '../../dist/platform/pipeline/index.js';
import {
  createEvidenceLease,
  isLeaseValid,
  getLeaseValueOrUnknown,
  HotPathCapsuleRegistry,
} from '../../dist/platform/assurance/index.js';
import {
  compileTradeAccounting,
  decomposeComprehensiveProfitAttribution,
} from '../../dist/intelligence/economics/profit-compiler/index.js';
import {
  EconomicAuthorityStore,
} from '../../dist/intelligence/capital/economic-authority-store.js';

test('RUNTIME CONVERGENCE: RuntimeDivergenceAuditor catches disagreements and issues canonical certificates', () => {
  const auditor = new RuntimeDivergenceAuditor();

  // Test 1: Identical decisions produce no divergence
  const identical = auditor.evaluateDivergence({
    mint: 'MintTokenAgree123',
    candidateGenerationId: 'gen_001',
    oldDecision: { pass: true, edgeBps: 400, safetyPassed: true },
    newDecision: { pass: true, edgeBps: 402, safetyPassed: true },
  });
  assert.equal(identical.hasDivergence, false);
  assert.equal(identical.divergenceReasons.length, 0);
  assert.equal(auditor.getDivergenceCount(), 0);

  // Test 2: Decision disagreement emits certificate
  const decisionDivergence = auditor.evaluateDivergence({
    mint: 'MintTokenDiverge456',
    candidateGenerationId: 'gen_002',
    oldDecision: { pass: true, edgeBps: 450, safetyPassed: true },
    newDecision: { pass: false, edgeBps: 120, safetyPassed: false },
  });
  assert.equal(decisionDivergence.hasDivergence, true);
  assert.ok(decisionDivergence.divergenceReasons.length >= 2);
  assert.equal(typeof decisionDivergence.certificateHash, 'string');
  assert.equal(decisionDivergence.certificateHash.length, 64);
  assert.equal(auditor.getDivergenceCount(), 1);
});

test('HOT-PATH PROOF CAPSULE: Feature-specific evidence leases expire individually to UNKNOWN', () => {
  const now = 1_000_000;

  // Short quote lease (500ms)
  const quoteLease = createEvidenceLease({
    value: { realQuoteReserves: 30_000_000_000n, virtualTokenReserves: 1_000_000_000_000n },
    source: 'WEBSOCKET_FEED',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 500,
    stateRoot: 'ROOT_QUOTE_001',
    featureClass: 'QUICK_QUOTE',
  });

  // Long mint authority lease (1 hour = 3,600,000ms)
  const mintAuthLease = createEvidenceLease({
    value: { mintAuthority: null, freezeAuthority: null, isToken2022: false },
    source: 'RPC_INSPECTOR',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 3_600_000,
    stateRoot: 'ROOT_AUTH_001',
    featureClass: 'MINT_AUTHORITY',
  });

  // At now + 300ms, both are valid
  assert.equal(isLeaseValid(quoteLease, now + 300), true);
  assert.equal(isLeaseValid(mintAuthLease, now + 300), true);

  // At now + 600ms, quote is expired, but mint authority remains valid
  assert.equal(isLeaseValid(quoteLease, now + 600), false);
  assert.equal(getLeaseValueOrUnknown(quoteLease, now + 600), 'UNKNOWN');
  assert.equal(isLeaseValid(mintAuthLease, now + 600), true);
  assert.notEqual(getLeaseValueOrUnknown(mintAuthLease, now + 600), 'UNKNOWN');
});

test('HOT-PATH REGISTRY: fails closed with STALE_LEASES when any critical lease is expired', () => {
  const registry = new HotPathCapsuleRegistry();
  const now = 2_000_000;

  const validQuote = createEvidenceLease({
    value: { realQuoteReserves: 30n, virtualTokenReserves: 1000n },
    source: 'FEED',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 500,
    stateRoot: 'R1',
    featureClass: 'QUICK_QUOTE',
  });

  const validBlockhash = createEvidenceLease({
    value: { blockhash: 'bh123', lastValidBlockHeight: 1000n },
    source: 'RPC',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 60_000,
    stateRoot: 'R2',
    featureClass: 'BLOCKHASH',
  });

  const validFee = createEvidenceLease({
    value: { priorityFeeLamports: 10000n, jitoTipLamports: 20000n },
    source: 'FEE_ESTIMATOR',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 2_000,
    stateRoot: 'R3',
    featureClass: 'PRIORITY_FEE',
  });

  const validSemantics = createEvidenceLease({
    value: { mintAuthority: null, freezeAuthority: null, isToken2022: false },
    source: 'INSPECTOR',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 3_600_000,
    stateRoot: 'R4',
    featureClass: 'MINT_AUTHORITY',
  });

  const validHolders = createEvidenceLease({
    value: { top10ConcentrationBps: 2000, holderCount: 150 },
    source: 'HOLDER_SCAN',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 300_000,
    stateRoot: 'R5',
    featureClass: 'HOLDER_CONCENTRATION',
  });

  const validRisk = createEvidenceLease({
    value: 'CERT_RISK_001',
    source: 'SAFETY_KERNEL',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 10_000,
    stateRoot: 'R6',
    featureClass: 'RISK_CERTIFICATE',
  });

  const validExit = createEvidenceLease({
    value: 'CERT_EXIT_001',
    source: 'ESCAPEROOT',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 10_000,
    stateRoot: 'R7',
    featureClass: 'EXITABILITY',
  });

  const validHealth = createEvidenceLease({
    value: 'CERT_HEALTH_001',
    source: 'PROVIDER_MONITOR',
    observedAtMs: now,
    knownAtMs: now,
    ttlMs: 10_000,
    stateRoot: 'R8',
    featureClass: 'PROVIDER_HEALTH',
  });

  registry.storeCapsule({
    capsuleId: 'cap_001',
    mint: 'MintTokenFresh',
    bankFingerprint: createEvidenceLease({ value: 'bank1', source: 'S', observedAtMs: now, knownAtMs: now, ttlMs: 10000, stateRoot: 'R', featureClass: 'PROGRAM_HASH' }),
    blockhashState: validBlockhash,
    tokenSemantics: validSemantics,
    creatorState: createEvidenceLease({ value: { creatorWallet: 'cw', solBalanceLamports: 1000n }, source: 'S', observedAtMs: now, knownAtMs: now, ttlMs: 10000, stateRoot: 'R', featureClass: 'HOLDER_CONCENTRATION' }),
    holderState: validHolders,
    walletGraph: createEvidenceLease({ value: { clusterId: 'c1', sybilSuspicionBps: 0 }, source: 'S', observedAtMs: now, knownAtMs: now, ttlMs: 10000, stateRoot: 'R', featureClass: 'HOLDER_CONCENTRATION' }),
    poolReserves: validQuote,
    feeEstimates: validFee,
    riskCertificate: validRisk,
    exitabilityCertificate: validExit,
    providerHealthCertificate: validHealth,
    capsuleHash: 'hash_cap_001',
    assembledAtMs: now,
  });

  // Fresh state evaluation: READY
  const freshReadiness = registry.evaluateHotPathReadiness('MintTokenFresh', now + 100);
  assert.equal(freshReadiness.isReady, true);
  assert.equal(freshReadiness.expiredLeases.length, 0);

  // Stale state evaluation (+1,000ms: quote is expired, requiring background refresh)
  const staleReadiness = registry.evaluateHotPathReadiness('MintTokenFresh', now + 1000);
  assert.equal(staleReadiness.isReady, false);
  assert.ok(staleReadiness.expiredLeases.includes('POOL_RESERVES_EXPIRED'));
});

test('PROFIT COMPILER: Comprehensive attribution reconciles exactly with UNEXPLAINED remainder', () => {
  const statement = compileTradeAccounting({
    actualEntryCostLamports: 1_000_000_000n, // 1.0 SOL
    actualExitProceedsLamports: 1_200_000_000n, // 1.2 SOL (+0.2 SOL gross)
    networkFeesLamports: 5_000n,
    priorityFeesLamports: 50_000n,
    jitoTipsLamports: 100_000n,
    routeFeesLamports: 0n,
    category: 'PAPER_PNL',
  });

  assert.equal(statement.realizedNetPnLLamports, 199_845_000n); // 200M - 155k fees
  assert.equal(statement.category, 'PAPER_PNL');

  // Multi-factor attribution
  const attribution = decomposeComprehensiveProfitAttribution({
    accounting: statement,
    marketBetaLamports: 20_000_000n,
    marketWideCohortReturnLamports: 30_000_000n,
    tokenSpecificReturnLamports: 100_000_000n,
    timingAlphaLamports: 15_000_000n,
    strategySignalAlphaLamports: 25_000_000n,
    executionEfficiencyLamports: -155_000n,
  });

  assert.equal(attribution.isReconciled, true);
  assert.equal(attribution.totalAttributedLamports, statement.realizedNetPnLLamports);
  // Remainder is in unexplainedResidualLamports, NOT defaulted to alpha!
  assert.equal(attribution.unexplainedResidualLamports, 10_000_000n);

  // REALIZED_FINAL_PNL without finalized settlement is rejected
  assert.throws(() => {
    compileTradeAccounting({
      actualEntryCostLamports: 100n,
      actualExitProceedsLamports: 200n,
      networkFeesLamports: 5n,
      priorityFeesLamports: 0n,
      jitoTipsLamports: 0n,
      routeFeesLamports: 0n,
      category: 'REALIZED_FINAL_PNL',
      isFinalizedSettlement: false, // Must throw!
    });
  }, /PNL_AUTHORITY_VIOLATION/);
});

test('ECONOMIC AUTHORITY STORE: Dynamic hybrid emergency reserve scales for small $250 account', () => {
  // 1. Small account ($250 ≈ 1.5 SOL = 1_500_000_000n)
  const smallStore = new EconomicAuthorityStore(1_500_000_000n);
  // Old hardcoded 5 SOL reserve would leave availableCash = 0n.
  // With Section 27 hybrid reserve, emergency reserve is 150_000_000n (10% of 1.5 SOL)
  assert.ok(smallStore.getAvailableCash() > 0n);
  assert.equal(smallStore.getEmergencyReserve(), 150_000_000n);
  assert.equal(smallStore.getAvailableCash(), 1_350_000_000n);

  // 2. Large bankroll (10 SOL = 10_000_000_000n) retains standard 5 SOL reserve
  const largeStore = new EconomicAuthorityStore(10_000_000_000n);
  assert.equal(largeStore.getEmergencyReserve(), 5_000_000_000n);
  assert.equal(largeStore.getAvailableCash(), 5_000_000_000n);

  // 3. Custom EmergencyReservePolicy: max(2*exitCost, floor, X% equity)
  const customStore = new EconomicAuthorityStore(2_000_000_000n, {
    stressedFullExitCostLamports: 20_000_000n, // 2x = 40M
    fixedOperationalFloorLamports: 50_000_000n, // floor = 50M
    equityReservePctBps: 500, // 5% of 2B = 100M
  });
  // max(40M, 50M, 100M) = 100M
  assert.equal(customStore.getEmergencyReserve(), 100_000_000n);
  assert.equal(customStore.getAvailableCash(), 1_900_000_000n);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_PROVIDER_REGISTRY,
  globalExternalProviderRegistry,
} from '../../dist/platform/security/external-registry.js';

import {
  MarketEvidenceProvenanceEngine,
} from '../../dist/intelligence/evidence/market-provenance.js';

import {
  CapitalYieldRegimeEngine,
} from '../../dist/intelligence/research/capital-regime.js';

test('External Provider Registry: all 14 providers are properly registered with security boundaries', () => {
  const expectedProviderIds = [
    'morpho_vaults',
    'exponent',
    'dooar',
    'moonpay_commerce',
    'seven_k',
    'wealthville',
    'aftermath_finance',
    'binoxswap',
    'ride_markets',
    'aave',
    'odin_fun',
    'lulo',
    'streamflow',
    'scallop',
  ];

  for (const id of expectedProviderIds) {
    const record = EXTERNAL_PROVIDER_REGISTRY[id];
    assert.ok(record, `Missing registry record for provider: ${id}`);
    assert.equal(record.providerId, id);
    assert.ok(record.url.startsWith('https://'), `Provider ${id} must have a valid https URL`);
    assert.ok(record.purpose.length > 10, `Provider ${id} must have an informative purpose`);
    assert.ok(record.capabilityProvided.length > 5, `Provider ${id} must detail capabilities provided`);
    assert.ok(record.consumingSubsystem.length > 0, `Provider ${id} must specify consuming subsystem`);

    // Non-negotiable signing boundary: external providers can NEVER sign!
    assert.equal(record.canSign, false, `Security invariant violated: ${id} cannot sign transactions`);
    assert.equal(record.canHoldCapital, false, `Security invariant violated: ${id} cannot hold capital`);
    assert.equal(record.canSubmitTransactions, false, `Provider ${id} is not an execution submitter`);
    assert.equal(record.canConstructTransactions, false, `Provider ${id} is not an external transaction builder`);
  }

  // Registry signing boundary verification must pass
  assert.equal(globalExternalProviderRegistry.verifySigningBoundary(), true);
});

test('BinoxSwap: Strict Quarantine & Containment Isolation', () => {
  const binox = EXTERNAL_PROVIDER_REGISTRY.binoxswap;
  assert.ok(binox);

  // Classification & status verification
  assert.equal(binox.classification, 'QUARANTINED');
  assert.equal(binox.verificationStatus, 'REQUIRES_VERIFICATION');
  assert.equal(binox.trustLevel, 'ZERO');
  assert.equal(binox.authorityClass, 'UNTRUSTED_EXTERNAL');

  // Strict isolation checks
  assert.equal(binox.canSign, false);
  assert.equal(binox.canHoldCapital, false);
  assert.equal(binox.canConstructTransactions, false);
  assert.equal(binox.canSubmitTransactions, false);
  assert.equal(binox.receivesWalletInfo, false);
  assert.equal(binox.receivesTokenInfo, false);
  assert.ok(binox.auditWarning?.includes('QUARANTINED_UNVERIFIED'));

  // Policy containment verification: MUST be rejected
  const containment = globalExternalProviderRegistry.verifyPolicyContainment('binoxswap');
  assert.equal(containment.permitted, false);
  assert.match(containment.reason ?? '', /QUARANTINED|REQUIRES_VERIFICATION|ZERO/);

  // Registry quarantined providers helper
  const quarantined = globalExternalProviderRegistry.getQuarantinedProviders();
  assert.ok(quarantined.some(p => p.providerId === 'binoxswap'));
});

test('WealthVille: High benchmark role with explicit unaudited-program gate', () => {
  const wv = EXTERNAL_PROVIDER_REGISTRY.wealthville;
  assert.ok(wv);

  assert.equal(wv.chainScope, 'SOLANA');
  assert.equal(wv.priorityAddition, true);
  assert.equal(wv.canHoldCapital, false);
  assert.ok(wv.auditWarning?.includes('UNAUDITED_PROGRAM_WARNING'));
  assert.equal(wv.verificationStatus, 'PARTIALLY_VERIFIED');
});

test('Priority Solana Additions: correctly isolates the 6 core SOL/SYLPH additions', () => {
  const priority = globalExternalProviderRegistry.getSolanaPriorityAdditions();
  const priorityIds = new Set(priority.map(p => p.providerId));

  const expectedSolanaPriority = [
    'exponent',
    'lulo',
    'ride_markets',
    'streamflow',
    'wealthville',
    'moonpay_commerce',
  ];

  for (const id of expectedSolanaPriority) {
    assert.ok(priorityIds.has(id), `Missing priority Solana addition: ${id}`);
    const record = EXTERNAL_PROVIDER_REGISTRY[id];
    assert.equal(record.chainScope, 'SOLANA');
    assert.equal(record.priorityAddition, true);
  }
});

test('Yield Regime Providers Group: aggregates the 6 yield intelligence benchmarks', () => {
  const yieldProviders = globalExternalProviderRegistry.getYieldRegimeProviders();
  const yieldIds = new Set(yieldProviders.map(p => p.providerId));

  const expectedYieldProtocols = [
    'exponent',
    'lulo',
    'morpho_vaults',
    'aave',
    'wealthville',
    'scallop',
  ];

  assert.equal(yieldProviders.length, 6);
  for (const id of expectedYieldProtocols) {
    assert.ok(yieldIds.has(id), `Missing yield provider: ${id}`);
  }
});

test('MarketEvidenceProvenanceEngine: Streamflow & distribution provenance correctly informs BuyerQuality', () => {
  const engine = new MarketEvidenceProvenanceEngine();
  const mint = 'TestMemeMint1111111111111111111111111111111111';

  // Scenario 1: Open-market DEX buyer
  engine.recordTransfer({
    mint,
    fromAddress: 'RaydiumPoolAddress111111111111111111111111111',
    toAddress: 'OrganicBuyer111111111111111111111111111111111',
    amount: 10_000_000_000n,
    isDexSwap: true,
  });

  // Scenario 2: Streamflow vesting contract recipient
  engine.recordTransfer({
    mint,
    fromAddress: 'StreamflowVestingContract1111111111111111111',
    toAddress: 'VestedTeamMember1111111111111111111111111111',
    amount: 50_000_000_000n,
    isStreamflowContract: true,
  });

  // Scenario 3: Batch distribution / airdrop
  engine.recordTransfer({
    mint,
    fromAddress: 'CreatorDeployerWallet11111111111111111111111',
    toAddress: 'AirdropReceiver11111111111111111111111111111',
    amount: 5_000_000_000n,
    isAirdrop: true,
  });

  // Scenario 4: Additional bulk distributed wallets
  for (let i = 0; i < 5; i++) {
    engine.recordTransfer({
      mint,
      fromAddress: 'CreatorDeployerWallet11111111111111111111111',
      toAddress: `BatchWallet${i}111111111111111111111111111111111`,
      amount: 1_000_000_000n,
      isBatchDistribution: true,
    });
  }

  // Evaluate BuyerQuality
  const buyerQuality = engine.evaluateBuyerQuality(mint);
  assert.equal(buyerQuality.totalObservedWallets, 8);
  assert.equal(buyerQuality.verifiedOrganicBuyerCount, 1);
  assert.equal(buyerQuality.discountedDistributedWalletCount, 7);

  // Invariant: Wallets receiving tokens through vesting/batch distributions are NOT counted as independent organic buyers!
  assert.ok(buyerQuality.organicBuyerRatio < 0.2);
  assert.equal(buyerQuality.buyerQualityTier, 'DISPERSION_SPOOFED');
  assert.equal(buyerQuality.verdict, 'REJECT_AS_SYBIL_INFLATION');

  // Filter organic buyers helper
  const candidateWallets = [
    'OrganicBuyer111111111111111111111111111111111',
    'VestedTeamMember1111111111111111111111111111',
    'AirdropReceiver11111111111111111111111111111',
    'NonExistentWallet1111111111111111111111111111',
  ];

  const filteredBuyers = engine.filterOrganicBuyers(mint, candidateWallets);
  assert.equal(filteredBuyers.length, 1);
  assert.equal(filteredBuyers[0], 'OrganicBuyer111111111111111111111111111111111');

  // Evaluate HolderQuality
  const holderQuality = engine.evaluateHolderQuality(mint);
  assert.equal(holderQuality.totalHoldersCount, 8);
  assert.equal(holderQuality.streamflowVestingCount, 1);
  assert.equal(holderQuality.airdropRecipientCount, 1);
  assert.equal(holderQuality.batchDistributionCount, 5);
  assert.equal(holderQuality.isSybilRiskElevated, true);
});

test('CapitalYieldRegimeEngine: Multi-protocol yield intelligence & opportunity cost evaluation', () => {
  const engine = new CapitalYieldRegimeEngine();

  // Register yield marks across the 6 benchmarks
  engine.registerYieldQuote({
    providerId: 'exponent',
    providerName: 'Exponent Protocol',
    chainScope: 'SOLANA',
    assetSymbol: 'SOL-PT',
    apyPct: 9.5,
    isProtected: false,
    isUnaudited: false,
    timestampMs: Date.now(),
  });

  engine.registerYieldQuote({
    providerId: 'lulo',
    providerName: 'Lulo Protocol',
    chainScope: 'SOLANA',
    assetSymbol: 'USDC-Protected',
    apyPct: 8.2,
    isProtected: true,
    isUnaudited: false,
    timestampMs: Date.now(),
  });

  engine.registerYieldQuote({
    providerId: 'wealthville',
    providerName: 'WealthVille',
    chainScope: 'SOLANA',
    assetSymbol: 'WV-Pool',
    apyPct: 15.0,
    isProtected: false,
    isUnaudited: true, // Should be isolated from conservative benchmark
    timestampMs: Date.now(),
  });

  engine.registerYieldQuote({
    providerId: 'morpho_vaults',
    providerName: 'Morpho Vaults',
    chainScope: 'EVM',
    assetSymbol: 'USDC-Morpho',
    apyPct: 7.8,
    isProtected: true,
    isUnaudited: false,
    timestampMs: Date.now(),
  });

  engine.registerYieldQuote({
    providerId: 'aave',
    providerName: 'Aave Protocol',
    chainScope: 'EVM',
    assetSymbol: 'USDC-Aave',
    apyPct: 6.4,
    isProtected: false,
    isUnaudited: false,
    timestampMs: Date.now(),
  });

  engine.registerYieldQuote({
    providerId: 'scallop',
    providerName: 'Scallop Protocol',
    chainScope: 'SUI',
    assetSymbol: 'USDC-Scallop',
    apyPct: 7.0,
    isProtected: false,
    isUnaudited: false,
    timestampMs: Date.now(),
  });

  // Create CapitalRegimeSnapshot
  const snapshot = engine.createRegimeSnapshot();
  assert.equal(snapshot.activeYieldBenchmarksCount, 6);
  assert.equal(snapshot.isRestrictedToResearchAndAllocation, true);
  assert.ok(snapshot.solanaRiskFreeRateAprPct > 0);
  assert.ok(snapshot.crossChainReferenceAprPct > 0);
  assert.ok(snapshot.lowerRiskOpportunityCostAprPct > 0);
  assert.ok(snapshot.requiredMemeRiskPremiumAprPct > snapshot.lowerRiskOpportunityCostAprPct);

  // Opportunity cost comparison: Low expected return vs hurdle
  const lowAlphaEval = engine.evaluateOpportunityCost({
    mint: 'LowConvictionMemeMint11111111111111111111111',
    expectedAnnualizedReturnPct: 15.0, // Fails to beat ~35%+ hurdle
  });
  assert.equal(lowAlphaEval.isMemeRiskWorthwhile, false);
  assert.equal(lowAlphaEval.recommendation, 'ALLOCATION_UNFAVORABLE');
  assert.ok(lowAlphaEval.explanation.includes('Capital is better allocated to safe yield protocols'));

  // Opportunity cost comparison: High asymmetric expected return vs hurdle
  const highAlphaEval = engine.evaluateOpportunityCost({
    mint: 'HighConvictionMemeMint2222222222222222222222',
    expectedAnnualizedReturnPct: 120.0, // Easily beats hurdle
  });
  assert.equal(highAlphaEval.isMemeRiskWorthwhile, true);
  assert.equal(highAlphaEval.recommendation, 'RESEARCH_EXPANSION_PERMITTED');
});

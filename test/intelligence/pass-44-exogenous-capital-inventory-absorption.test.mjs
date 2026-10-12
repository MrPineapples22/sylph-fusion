import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 44: Exogenous Capital Flow Decomposition Engine (Section XIII & Study 24)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Authentic, highly diversified external capital inflow
  const authenticFlow = engine.classifyExogenousCapital({
    totalInflowUsd: 10_000,
    fundingDiversityScore: 0.95,
    sameFunderClustersCount: 0,
    deployerRelatedFlowUsd: 0,
    circularTradeVolumeUsd: 0,
  });

  assert.equal(authenticFlow.dominantOrigin, 'NEW_CAPITAL');
  assert.equal(authenticFlow.isAuthenticInflow, true);
  assert.equal(authenticFlow.selfFundedRatio, 0.0);
  assert.ok(authenticFlow.newCapitalRatio > 0.85);
  assert.ok(authenticFlow.netExogenousInflowUsd > 8_000);

  // Case 2: Wash trading / deployer self-funded recirculation
  const washFlow = engine.classifyExogenousCapital({
    totalInflowUsd: 10_000,
    fundingDiversityScore: 0.20,
    sameFunderClustersCount: 1,
    deployerRelatedFlowUsd: 3_500,
    circularTradeVolumeUsd: 2_500,
  });

  assert.equal(washFlow.dominantOrigin, 'SELF_FUNDED_VOLUME');
  assert.equal(washFlow.isAuthenticInflow, false);
  assert.equal(washFlow.selfFundedRatio, 0.60); // (3500 + 2500) / 10000 = 60%
  assert.ok(washFlow.newCapitalRatio < 0.40);

  // Case 3: Coordinated sybil cluster funding
  const sybilFlow = engine.classifyExogenousCapital({
    totalInflowUsd: 10_000,
    fundingDiversityScore: 0.30,
    sameFunderClustersCount: 5, // 5 * 0.12 = 0.60 coordinated
    deployerRelatedFlowUsd: 0,
    circularTradeVolumeUsd: 0,
  });

  assert.equal(sybilFlow.dominantOrigin, 'COORDINATED_CAPITAL');
  assert.equal(sybilFlow.isAuthenticInflow, false);
  assert.equal(sybilFlow.coordinatedCapitalRatio, 0.60);
});

test('Pass 44: Floating Inventory Overhang Absorption Engine (Section XIII & Study 27)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Safe inventory overhang within pool absorption capacity
  const safeAbsorption = engine.evaluateInventoryAbsorption({
    insiderHoldingTokens: 10_000_000,
    tokenPriceUsd: 0.0001, // Overhang = $1,000
    poolDepthUsd: 15_000,  // Overhang/Pool = 6.67%
    organicBuyRateUsdPerMin: 150, // 1000 / 150 = 6.67 min
  });

  assert.equal(safeAbsorption.isOverhangDangerous, false);
  assert.equal(safeAbsorption.totalOverhangUsd, 1000);
  assert.ok(safeAbsorption.overhangToPoolRatio < 0.10);
  assert.ok(safeAbsorption.absorptionTimeMinutes < 10.0);
  assert.ok(safeAbsorption.maxSafePositionSizeUsd > 0);

  // Case 2: Dangerous overhang exceeding 50% of pool reserves
  const heavyOverhang = engine.evaluateInventoryAbsorption({
    insiderHoldingTokens: 100_000_000,
    tokenPriceUsd: 0.0001, // Overhang = $10,000
    poolDepthUsd: 15_000,  // Overhang/Pool = 66.7% > 50%
    organicBuyRateUsdPerMin: 500, // Absorption time = 20m < 45m, but overhang ratio is dangerous
  });

  assert.equal(heavyOverhang.isOverhangDangerous, true);
  assert.ok(heavyOverhang.overhangToPoolRatio > 0.50);

  // Case 3: Dangerous absorption time exceeding 45 minutes
  const slowAbsorption = engine.evaluateInventoryAbsorption({
    insiderHoldingTokens: 30_000_000,
    tokenPriceUsd: 0.0001, // Overhang = $3,000
    poolDepthUsd: 15_000,  // Overhang/Pool = 20% (< 50%)
    organicBuyRateUsdPerMin: 30, // 3000 / 30 = 100 min > 45 min
  });

  assert.equal(slowAbsorption.isOverhangDangerous, true);
  assert.equal(slowAbsorption.absorptionTimeMinutes, 100.0);
});

test('Pass 44: Decision Kernel Gating Fail-Closed Under Inauthentic Capital & Dangerous Inventory Overhang', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_950_000;
  const canonicalEvent = {
    eventId: 'evt_pass44_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenExoGate1111111111111111111111111111111',
    signature: '5exo_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 39510,
    slot: 530_000,
    parentSlot: 529_999,
    blockhash: 'BhashPass44Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'EXO',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  // Case 1: Authentic inflow and safe overhang -> gates clear
  const safeResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceExogenousCapitalGating: true,
    enforceInventoryAbsorptionGating: true,
  });

  assert.ok(safeResult.exogenousCapital);
  assert.ok(safeResult.inventoryAbsorption);
  assert.equal(safeResult.viewModel.isAuthenticInflow, true);
  assert.equal(safeResult.viewModel.isOverhangDangerous, false);

  // Case 2: Inauthentic capital flow (wash cycle) -> fail-closed CHALLENGED_ABSTAIN
  const inauthenticResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass44_inauth_002', signature: 'sig_inauth_002' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      exogenousCapital: {
        dominantOrigin: 'SELF_FUNDED_VOLUME',
        newCapitalRatio: 0.15,
        recycledCapitalRatio: 0.20,
        coordinatedCapitalRatio: 0.15,
        selfFundedRatio: 0.50, // > 0.40
        unknownRatio: 0,
        isAuthenticInflow: false,
        netExogenousInflowUsd: 1500,
      },
      enforceExogenousCapitalGating: true,
    }
  );

  assert.equal(inauthenticResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(inauthenticResult.whyExecutionBlocked?.includes('BLOCKED — INAUTHENTIC CAPITAL FLOW'));
  assert.equal(inauthenticResult.viewModel.isAuthenticInflow, false);

  // Case 3: Dangerous inventory overhang (> 50% pool) -> fail-closed CHALLENGED_ABSTAIN
  const dangerousOverhangResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass44_overhang_003', signature: 'sig_overhang_003' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      inventoryAbsorption: {
        totalOverhangTokens: 800_000_000,
        totalOverhangUsd: 8_000,
        poolDepthUsd: 10_000,
        overhangToPoolRatio: 0.80,
        absorptionTimeMinutes: 55.0,
        isOverhangDangerous: true,
        maxSafePositionSizeUsd: 200,
      },
      enforceInventoryAbsorptionGating: true,
    }
  );

  assert.equal(dangerousOverhangResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(dangerousOverhangResult.whyExecutionBlocked?.includes('BLOCKED — DANGEROUS INVENTORY OVERHANG'));
  assert.equal(dangerousOverhangResult.viewModel.isOverhangDangerous, true);
});

test('Pass 44: ViewModel Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_950_000;
  const canonicalEvent = {
    eventId: 'evt_pass44_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenExoTelem111111111111111111111111111111',
    signature: '5exo_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 39510,
    slot: 530_000,
    parentSlot: 529_999,
    blockhash: 'BhashPass44Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'ETLM',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
  ];

  const result = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  });

  const vm = result.viewModel;
  assert.ok(vm.exogenousCapital, 'exogenousCapital must be projected into ViewModel');
  assert.ok(vm.inventoryAbsorption, 'inventoryAbsorption must be projected into ViewModel');
  assert.equal(typeof vm.isAuthenticInflow, 'boolean');
  assert.equal(typeof vm.isOverhangDangerous, 'boolean');
  assert.equal(typeof vm.netExogenousInflowUsd, 'number');
  assert.equal(typeof vm.overhangToPoolRatio, 'number');
  assert.ok(result.exogenousCapital, 'exogenousCapital must be returned in MasterPipelineResult');
  assert.ok(result.inventoryAbsorption, 'inventoryAbsorption must be returned in MasterPipelineResult');
});

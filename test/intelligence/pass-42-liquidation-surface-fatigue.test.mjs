import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 42: Executable Liquidation Surface Engine & Laddered Scenarios (Section XV & Priority P0)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const surface = engine.computeLiquidationSurface({
    totalTokens: 10_000_000,
    currentMarkPriceUsd: 0.00010,
    poolSolReservesUsd: 15_000,
    poolTokenReserves: 800_000_000,
    estimatedBaseFeeUsd: 0.005,
    estimatedTipUsd: 0.015,
    slot: 510000n,
    nowMs: 3_800_000,
  });

  assert.equal(surface.currentMarkUsd, 1000);
  assert.equal(surface.base.points.length, 5, 'Must contain 5 laddered exit points (10, 25, 50, 75, 100)');
  assert.equal(surface.base.points[0].percentage, 10);
  assert.equal(surface.base.points[4].percentage, 100);

  // Stressed capacity and haircut verification
  assert.ok(surface.stressedExitCapacityUsd > 0);
  assert.ok(surface.stressedExitCapacityUsd < surface.currentMarkUsd);
  assert.ok(surface.liquidityHaircutUsd > 0, 'Haircut between BASE and STRESSED_50 must be positive');
  assert.ok(surface.surfaceDigest.length === 64, 'Digest must be 64-char SHA-256');

  // Multi-tier stress curves presence
  assert.equal(surface.base.scenarioName, 'BASE');
  assert.equal(surface.stressed25.scenarioName, 'STRESSED_25');
  assert.equal(surface.stressed50.scenarioName, 'STRESSED_50');
  assert.ok(surface.stressed50.maxCapacityUsd <= surface.base.maxCapacityUsd);
});

test('Pass 42: Liquidity Fatigue Staged Exit Engine & Fragility Accumulation (Section XIV & Study 31)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const fatigue = engine.simulateLiquidityFatigue({
    initialTokenPriceUsd: 0.00010,
    initialPoolSolReservesUsd: 15_000,
    initialTokenReserves: 800_000_000,
    totalPositionTokens: 10_000_000,
    fractions: [0.25, 0.25, 0.25, 0.25],
  });

  assert.equal(fatigue.sequentialSteps.length, 4, 'Must simulate all 4 staged sale tranches');
  assert.ok(fatigue.totalProceedsUsd > 0);
  assert.ok(fatigue.averageRealizedPriceUsd > 0);
  assert.ok(fatigue.terminalReserveFractionRemaining > 0 && fatigue.terminalReserveFractionRemaining < 1.0);

  // Sequential depletion invariant: step N+1 starts at step N end SOL reserves
  for (let i = 1; i < fatigue.sequentialSteps.length; i++) {
    const prevStep = fatigue.sequentialSteps[i - 1];
    const currStep = fatigue.sequentialSteps[i];
    assert.equal(currStep.startSolReservesUsd, prevStep.endSolReservesUsd, 'Step N+1 must begin with depleted reserves from step N');
    assert.ok(currStep.cumulativeImpactBps >= prevStep.cumulativeImpactBps, 'Cumulative price impact must increase sequentially');
  }
});

test('Pass 42: Decision Kernel Gating & Fail-Closed Protection Under Liquidation Stress', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass42_liq_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenLiqGate11111111111111111111111111111',
    signature: '5liq_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass42Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'SURF',
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

  // Case 1: Adequate liquidation surface capacity -> normal execution
  const adequateResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceLiquidationSurfaceGating: true,
  });

  assert.ok(adequateResult.liquidationSurface);
  assert.equal(adequateResult.viewModel.isLiquidationCapacityAdequate, true);

  // Case 2: Insufficient stressed exit capacity ($100 < $250 requirement) -> fail-closed CHALLENGED_ABSTAIN
  const shallowPoolResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass42_shallow_002', signature: 'sig_shallow_002' },
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
      requiredStakeUsd: 500.0,
      liquidationSurface: {
        currentMarkUsd: 200,
        base: { scenarioName: 'BASE', points: [{ percentage: 100, tokensSold: 1000, netProceedsUsd: 180, effectivePriceUsd: 0.18, impactBps: 1000, feeUsd: 1 }], maxCapacityUsd: 180 },
        stressed25: { scenarioName: 'STRESSED_25', points: [], maxCapacityUsd: 120 },
        stressed50: { scenarioName: 'STRESSED_50', points: [], maxCapacityUsd: 80 },
        stressedExitCapacityUsd: 80.0, // Well below $500 requirement
        liquidityHaircutUsd: 100.0,
        ownImpactUsd: 20.0,
        projectedFeesUsd: 2.0,
        computedAtMs: eventTime,
        slot: 510000n,
        surfaceDigest: '0'.repeat(64),
      },
      enforceLiquidationSurfaceGating: true,
    }
  );

  assert.equal(shallowPoolResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(shallowPoolResult.whyExecutionBlocked?.includes('BLOCKED — INSUFFICIENT STRESSED LIQUIDATION CAPACITY'));
  assert.equal(shallowPoolResult.viewModel.isLiquidationCapacityAdequate, false);

  // Case 3: Excessive liquidity fatigue (> 40% discount) -> fail-closed CHALLENGED_ABSTAIN
  const fatiguedResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass42_fatigue_003', signature: 'sig_fatigue_003' },
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
      liquidityFatigue: {
        sequentialSteps: [],
        totalProceedsUsd: 120.0,
        averageRealizedPriceUsd: 0.00001,
        terminalReserveFractionRemaining: 0.15, // < 0.20 threshold
        fatigueDiscountVsSingleSale: 0.45,     // > 0.40 threshold
      },
      enforceLiquidityFatigueGating: true,
    }
  );

  assert.equal(fatiguedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(fatiguedResult.whyExecutionBlocked?.includes('BLOCKED — EXCESSIVE LIQUIDITY FATIGUE'));
});

test('Pass 42: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass42_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenSurfTelem1111111111111111111111111111',
    signature: '5surf_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass42Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'SURF',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
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
    poolOpsPerSec: 15,
  });

  const vm = result.viewModel;
  assert.ok(vm.liquidationSurface, 'liquidationSurface must be present on viewModel');
  assert.ok(vm.liquidityFatigue, 'liquidityFatigue must be present on viewModel');
  assert.ok(Number.isFinite(vm.stressedExitCapacityUsd));
  assert.ok(Number.isFinite(vm.liquidityHaircutUsd));
  assert.ok(Number.isFinite(vm.liquidityFatigueDiscount));
  assert.equal(typeof vm.isLiquidationCapacityAdequate, 'boolean');

  assert.ok(result.liquidationSurface);
  assert.ok(result.liquidityFatigue);
});

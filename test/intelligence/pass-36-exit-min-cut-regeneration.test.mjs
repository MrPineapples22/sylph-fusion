import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 36: Exit Min-Cut Liquidity Engine & Network Bottlenecks (Section XIV & Study 29)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Deep reserves pool: safe exit capacity exceeds $250 research stake
  const deepPoolReport = engine.computeExitMinCut({
    poolSolReservesUsd: 12_000.0, // ~$12k pool
    creatorInventoryUsd: 600.0,
    topWhaleInventoryUsd: 500.0,
    maxAllowedImpactBps: 1200, // 12% max impact
  });

  assert.equal(deepPoolReport.scenarios.length, 6, 'Must evaluate 6 stress scenarios');
  assert.ok(deepPoolReport.baseExitCapacityUsd > 1400.0, 'Base exit capacity must reflect constant-product formula');
  assert.ok(deepPoolReport.qSafeExitUsd > 700.0, 'Stressed min-cut capacity must be healthy in deep pool');
  assert.equal(deepPoolReport.isCapacitySufficientForStake(250.0), true, 'Must comfortably support $250 stake');
  assert.ok(typeof deepPoolReport.minCutBottleneckEdge === 'string');

  // 2. Shallow reserves pool with creator dump liability: min-cut capacity chokes below $250
  const shallowPoolReport = engine.computeExitMinCut({
    poolSolReservesUsd: 1_200.0,
    creatorInventoryUsd: 800.0, // Dominant creator inventory
    topWhaleInventoryUsd: 300.0,
    maxAllowedImpactBps: 1200,
  });

  assert.ok(shallowPoolReport.qSafeExitUsd < 100.0, 'Severe stress scenario must restrict safe exit capacity');
  assert.equal(shallowPoolReport.isCapacitySufficientForStake(250.0), false, 'Must fail $250 stake capacity check');
  assert.equal(shallowPoolReport.minCutBottleneckEdge, 'CREATOR_DUMP', 'Creator dump must be identified as min-cut bottleneck');
});

test('Pass 36: Liquidity Regeneration Engine & Hysteresis Deficit (Section XIV & Study 30)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Robust regeneration: rapid replenishment by secondary liquidity post-shock
  const robustReport = engine.measureLiquidityRegeneration({
    shockSizeUsd: 2_000.0,
    depthImmediatelyAfterUsd: 3_000.0,
    depthAt30sUsd: 4_200.0,
    depthAt60sUsd: 4_800.0, // Recovered $1,800 of $2,000 shock (90% recovery)
  });

  assert.ok(robustReport.regenerationRateUsdPerSec > 25.0, 'Regeneration rate must be > $25/s');
  assert.ok(robustReport.recoveryHalfLifeSeconds < 45.0, 'Recovery half life must be under 45 seconds');
  assert.ok(robustReport.fullRecoveryProbability > 0.70, 'Recovery probability must be high');
  assert.equal(robustReport.isRegenerationRobust, true, 'Regeneration must be certified robust');
  assert.ok(robustReport.hysteresisDeficitUsd <= 200.0, 'Permanent hysteresis deficit must be small');

  // 2. Fragile regeneration: permanent liquidity evaporation post-shock
  const fragileReport = engine.measureLiquidityRegeneration({
    shockSizeUsd: 2_000.0,
    depthImmediatelyAfterUsd: 3_000.0,
    depthAt30sUsd: 3_050.0,
    depthAt60sUsd: 3_100.0, // Only recovered $100 of $2,000 shock (5% recovery)
  });

  assert.ok(robustReport.regenerationRateUsdPerSec > fragileReport.regenerationRateUsdPerSec);
  assert.equal(fragileReport.isRegenerationRobust, false, 'Stagnant pool must fail regeneration robustness');
  assert.ok(fragileReport.recoveryHalfLifeSeconds > 100.0, 'Half life must be prolonged');
  assert.ok(fragileReport.hysteresisDeficitUsd > 1800.0, 'Hysteresis deficit must be severe');
});

test('Pass 36: End-to-End Decision Kernel Min-Cut & Regeneration Gating in processEvent', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_600_000;
  const canonicalEvent = {
    eventId: 'evt_pass36_mincut_001',
    eventType: 'TOKEN_CREATE',
    mint: 'MinCutToken1111111111111111111111111111111',
    signature: '5mincut_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 36010,
    slot: 480_000,
    parentSlot: 479_999,
    blockhash: 'BhashMinCut001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'MINCUT',
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

  // Case 1: Insufficient Min-Cut exit capacity triggers CHALLENGED_ABSTAIN
  const minCutDeficitContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    enforceMinCutCapacity: true,
    minCutPoolReservesUsd: 1_200.0, // Choked pool
    minCutCreatorInventoryUsd: 900.0,
    minCutWhaleInventoryUsd: 300.0,
    requiredStakeUsd: 250.0,
  };

  const minCutResult = await engine.processEvent(canonicalEvent, minCutDeficitContext);
  assert.equal(minCutResult.decision, 'CHALLENGED_ABSTAIN', 'Min-cut bottleneck must trigger CHALLENGED_ABSTAIN');
  assert.ok(minCutResult.whyExecutionBlocked?.includes('INSUFFICIENT MIN-CUT EXIT CAPACITY'));
  assert.ok(minCutResult.exitMinCut, 'exitMinCut attached to result');
  assert.equal(minCutResult.viewModel.exitMinCut?.minCutBottleneckEdge, 'CREATOR_DUMP');

  // Case 2: Fragile liquidity regeneration triggers CHALLENGED_ABSTAIN
  const fragileRegenContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    liquidityShockData: {
      shockSizeUsd: 3_000.0,
      depthImmediatelyAfterUsd: 2_000.0,
      depthAt30sUsd: 2_050.0,
      depthAt60sUsd: 2_100.0, // Failure to replenish
    },
  };

  const fragileResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass36_fragile_002', signature: 'sig_fragile_002' }, fragileRegenContext);
  assert.equal(fragileResult.decision, 'CHALLENGED_ABSTAIN', 'Fragile liquidity regeneration must trigger CHALLENGED_ABSTAIN');
  assert.ok(fragileResult.whyExecutionBlocked?.includes('FRAGILE LIQUIDITY REGENERATION'));
  assert.ok(fragileResult.liquidityRegeneration, 'liquidityRegeneration attached to result');
  assert.equal(fragileResult.viewModel.isRegenerationRobust, false);

  // Case 3: Robust pool with healthy min-cut & robust regeneration projects all telemetry
  const healthyContext = {
    tokenAgeSec: 25.0,
    txCount: 45,
    liquiditySol: 75.0, // $11,250 reserves
    marketCapSol: 150.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    liquidityShockData: {
      shockSizeUsd: 2_000.0,
      depthImmediatelyAfterUsd: 8_000.0,
      depthAt30sUsd: 9_200.0,
      depthAt60sUsd: 9_800.0,
    },
  };

  const healthyResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass36_healthy_003', signature: 'sig_healthy_003' }, healthyContext);
  assert.ok(healthyResult.exitMinCut, 'exitMinCut attached');
  assert.ok(healthyResult.liquidityRegeneration, 'liquidityRegeneration attached');
  assert.ok(healthyResult.exitMinCut.qSafeExitUsd > 300.0, 'Safe exit capacity healthy');
  assert.equal(healthyResult.liquidityRegeneration.isRegenerationRobust, true);
  assert.equal(healthyResult.viewModel.isRegenerationRobust, true);
  assert.ok(healthyResult.viewModel.qSafeExitUsd > 300.0);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 39: Account Contention Heatmap Generation & Sealevel Conflict Dynamics (Section XVIII & Study 40)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const writableAccounts = [
    'PoolStateAccount111111111111111111111111111',
    'BaseVaultAccount111111111111111111111111111',
    'ProgramStateAccount111111111111111111111111',
    'FeePayerAccount1111111111111111111111111111',
  ];

  // 1. Moderate activity (cold/warm tiers)
  const heatmapModerate = engine.generateAccountContentionHeatmap({
    writableAccountPubkeys: writableAccounts,
    basePoolOpsPerSec: 25,
    globalCongestionLevel: 0.2,
  });

  assert.equal(heatmapModerate.accounts.length, 4);
  assert.equal(heatmapModerate.accounts[0].role, 'POOL_STATE');
  assert.equal(heatmapModerate.accounts[1].role, 'BASE_VAULT');
  assert.equal(heatmapModerate.accounts[3].role, 'FEE_PAYER');

  assert.ok(heatmapModerate.accounts[0].opsPerSec > heatmapModerate.accounts[3].opsPerSec, 'Pool state ops must exceed fee payer');
  assert.equal(heatmapModerate.isSchedulerSaturated, false, 'Moderate traffic must not saturate scheduler');
  assert.ok(heatmapModerate.parallelSchedulerConflictProb < 0.60);

  // 2. High saturation (critical saturated tier >= 150 ops/sec)
  const heatmapSaturated = engine.generateAccountContentionHeatmap({
    writableAccountPubkeys: writableAccounts,
    basePoolOpsPerSec: 180,
    globalCongestionLevel: 0.8,
  });

  assert.equal(heatmapSaturated.hottestAccount.contentionTier, 'CRITICAL_SATURATED');
  assert.equal(heatmapSaturated.highestContentionTier, 'CRITICAL_SATURATED');
  assert.ok(heatmapSaturated.parallelSchedulerConflictProb > 0.80, 'Critical saturation must produce >80% scheduler conflict prob');
  assert.equal(heatmapSaturated.isSchedulerSaturated, true);
  assert.ok(heatmapSaturated.recommendedPreemptionFeeMicroLamports >= 2_000_000, 'Preemption fee must escalate under saturation');
});

test('Pass 39: Dynamic Priority Fee Adaptation & Safety Budget Cap (Section XVIII & Study 39)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Low Urgency + Cold Contention -> p25 percentile
  const bidLow = engine.computeAdaptivePriorityFeeBid({
    contentionTier: 'COLD',
    urgency: 'LOW',
    positionValueUsd: 250.0,
    maxPolicyCapUsd: 5.0,
    solPriceUsd: 150.0,
  });

  assert.equal(bidLow.targetPercentile, 'p25');
  assert.ok(bidLow.recommendedPriorityMicroLamports <= 100_000);
  assert.equal(bidLow.isCappedBySafetyPolicy, false);

  // 2. Normal Urgency + Hot Contention -> p75 percentile
  const bidNormalHot = engine.computeAdaptivePriorityFeeBid({
    contentionTier: 'HOT',
    urgency: 'NORMAL',
    positionValueUsd: 250.0,
    maxPolicyCapUsd: 5.0,
    solPriceUsd: 150.0,
  });

  assert.equal(bidNormalHot.targetPercentile, 'p75');
  assert.ok(bidNormalHot.recommendedPriorityMicroLamports > bidLow.recommendedPriorityMicroLamports);

  // 3. Emergency Urgency -> p99 percentile with hard safety fee budget cap
  const bidEmergency = engine.computeAdaptivePriorityFeeBid({
    contentionTier: 'CRITICAL_SATURATED',
    urgency: 'EMERGENCY',
    positionValueUsd: 4.0, // Small $4 position: 10% max fee = $0.40
    maxPolicyCapUsd: 5.0,
    solPriceUsd: 150.0,
  });

  assert.equal(bidEmergency.targetPercentile, 'p99');
  assert.equal(bidEmergency.maxAllowedFeeCapUsd, 0.40, 'Max fee cap must be min(10% * $4, $5) = $0.40');
  assert.ok(bidEmergency.isCappedBySafetyPolicy, 'Aggressive bid on small position must trigger safety cap');
  assert.ok(bidEmergency.estimatedFeeUsd <= 0.40 + 1e-4, 'Estimated fee must strictly respect safety hard cap');
  assert.ok(bidEmergency.marginalLandingGainPerDollar < 0.50, 'Diminishing marginal returns in emergency high fee regime');
});

test('Pass 39: Decision Kernel Gating & Fail-Closed Protection Under Critical Contention', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass39_gating_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenContentionGate11111111111111111111111',
    signature: '5contention_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass39Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'HEAT',
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

  // Case 1: Normal contention conditions -> pipeline evaluates normally
  const normalResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceContentionGating: true,
  });

  assert.ok(normalResult.contentionHeatmap);
  assert.ok(normalResult.adaptiveFeeBid);
  assert.notEqual(normalResult.viewModel.hottestContentionTier, 'CRITICAL_SATURATED');

  // Case 2: Saturated contention with conflict > 80% and enforcement enabled -> fail-closed CHALLENGED_ABSTAIN
  const saturatedResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass39_saturated_002', signature: 'sig_saturated_002' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 250, // Massive contention: >150 ops/sec -> CRITICAL_SATURATED
      enforceContentionGating: true,
    }
  );

  assert.equal(saturatedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(saturatedResult.whyExecutionBlocked?.includes('BLOCKED — SEVERE ACCOUNT CONTENTION'));
  assert.ok(saturatedResult.contentionHeatmap.recommendedPreemptionFeeMicroLamports >= 2_000_000);
  assert.ok(saturatedResult.viewModel.preemptionFeeMicroLamports > 300_000);
});

test('Pass 39: ViewModel and Telemetry Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass39_telemetry_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenContentionTelem1111111111111111111111',
    signature: '5telem_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass39Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TELEM',
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
    poolOpsPerSec: 35, // Warm tier
  });

  const vm = result.viewModel;
  assert.ok(vm.contentionHeatmap, 'contentionHeatmap must be projected onto viewModel');
  assert.ok(vm.adaptiveFeeBid, 'adaptiveFeeBid must be projected onto viewModel');
  assert.ok(vm.hottestContentionTier, 'hottestContentionTier must be projected');
  assert.ok(Number.isFinite(vm.preemptionFeeMicroLamports), 'preemptionFeeMicroLamports must be numeric');
  assert.equal(vm.hottestContentionTier, vm.contentionHeatmap.hottestAccount.contentionTier);
  assert.equal(vm.preemptionFeeMicroLamports, vm.adaptiveFeeBid.recommendedPriorityMicroLamports);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 46: Transition Path Theory (TPT) Engine (Section XII & Study 17)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Super-critical direct ballistic forward flux
  const ballistic = engine.analyzeTransitionPath({
    qUp: 0.85,
    qFail: 0.10,
    effectiveDrift: 0.20,
    diffusionVariance: 0.05,
    distanceToTargetMultiple: 5.0,
  });

  assert.equal(ballistic.stateA, 'CROSSING_2X');
  assert.equal(ballistic.stateB, 'RUNNER_10X');
  assert.ok(ballistic.reactiveTrajectoryProbability > 0.70);
  assert.ok(ballistic.pathViabilityRatio > 0.60);
  assert.ok(ballistic.dominantPathDescription.includes('SUPER_CRITICAL_DIRECT_BALLISTIC'));
  assert.ok(ballistic.meanFirstPassageTimeSeconds > 0);

  // Case 2: Sub-critical diffusive trajectory with severe failure sink
  const subcritical = engine.analyzeTransitionPath({
    qUp: 0.20,
    qFail: 0.70,
    effectiveDrift: 0.02,
    diffusionVariance: 0.25,
    distanceToTargetMultiple: 5.0,
  });

  assert.ok(ballistic.pathViabilityRatio > subcritical.pathViabilityRatio);
  assert.ok(subcritical.pathViabilityRatio < 0.25);
  assert.ok(subcritical.dominantPathDescription.includes('DIFFUSIVE_SUB_CRITICAL'));
});

test('Pass 46: Metastability & Onsager-Machlup Action Residual (Section XII & Studies 20/21)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Persistent runner accumulation state (low escape hazard, high plausibility)
  const persistent = engine.evaluateMetastability({
    plateauDurationSeconds: 20,
    volatilityStdDev: 0.10,
    volumeDecayRatePerMin: 0.02,
    observedDrift: 0.14,
    modelDrift: 0.12,
    diffusionVariance: 0.08,
  });

  assert.equal(persistent.isMetastableTrap, false);
  assert.ok(persistent.escapeRatePerSec < 0.05);
  assert.ok(persistent.pathPlausibilityScore > 0.50);
  assert.ok(persistent.quasiStationaryLifetimeSeconds > 20.0);

  // Case 2: Metastable trap with rapid volume decay and imminent collapse escape
  const trap = engine.evaluateMetastability({
    plateauDurationSeconds: 150,
    volatilityStdDev: 0.35,
    volumeDecayRatePerMin: 0.25, // > 0.15 threshold
    observedDrift: 0.01,
    modelDrift: 0.25,
    diffusionVariance: 0.04,
  });

  assert.equal(trap.isMetastableTrap, true);
  assert.ok(trap.onsagerMachlupActionResidual > 0.5);
});

test('Pass 46: Kinetic Pathway Bottleneck & Activation Barriers (Section XII & Study 19)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Unobstructed pathway with high transmission coefficient
  const clearPath = engine.analyzePathwayBottlenecks({
    dtfScore: 0.15,
    creatorRemainingPct: 0.01,
    topHoldersConcentrationPct: 0.15,
    bondingCurveProgressPct: 60,
    poolLiquidityUsd: 25_000,
  });

  assert.equal(clearPath.isPathwayChoked, false);
  assert.equal(clearPath.recommendedAction, 'PROCEED');
  assert.ok(clearPath.transmissionCoefficient > 0.15);
  assert.ok(clearPath.activationBarrierEnergy < 4.0);

  // Case 2: Choked pathway with creator overhang and severe activation barrier
  const chokedPath = engine.analyzePathwayBottlenecks({
    dtfScore: 0.70,
    creatorRemainingPct: 0.25, // > 0.05 -> CREATOR_EXIT_OVERHANG
    topHoldersConcentrationPct: 0.60,
    bondingCurveProgressPct: 50,
    poolLiquidityUsd: 3_000,
  });

  assert.equal(chokedPath.isPathwayChoked, true);
  assert.equal(chokedPath.recommendedAction, 'HALT_BEFORE_BARRIER');
  assert.equal(chokedPath.bottleneckSurfaceLocation, 'CREATOR_EXIT_OVERHANG');
  assert.ok(chokedPath.activationBarrierEnergy > 4.5);
});

test('Pass 46: Decision Kernel Gating Fail-Closed Under Metastable Trap, Choked Bottleneck & Sub-Critical TPT', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_050_000;
  const canonicalEvent = {
    eventId: 'evt_pass46_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenTPTGate1111111111111111111111111111111',
    signature: '5tpt_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 40510,
    slot: 550_000,
    parentSlot: 549_999,
    blockhash: 'BhashPass46Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TPT',
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

  // Case 1: Healthy TPT flux and clear pathway -> gates clear
  const healthyResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 35.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceMetastabilityGating: true,
    enforcePathwayBottleneckGating: true,
    enforceTransitionPathGating: true,
  });

  assert.ok(healthyResult.transitionPath);
  assert.ok(healthyResult.metastability);
  assert.ok(healthyResult.pathwayBottleneck);
  assert.equal(healthyResult.viewModel.isMetastableTrap, false);
  assert.equal(healthyResult.viewModel.isPathwayChoked, false);

  // Case 2: Metastable trap detected -> fail-closed CHALLENGED_ABSTAIN
  const trapResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass46_trap_002', signature: 'sig_trap_002' },
    {
      tokenAgeSec: 35.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      metastability: {
        isMetastableTrap: true,
        escapeRatePerSec: 0.12,
        quasiStationaryLifetimeSeconds: 8.3,
        onsagerMachlupActionResidual: 2.5,
        pathPlausibilityScore: 0.08,
      },
      enforceMetastabilityGating: true,
    }
  );

  assert.equal(trapResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(trapResult.whyExecutionBlocked?.includes('BLOCKED — METASTABLE TRAP DETECTED'));
  assert.equal(trapResult.viewModel.isMetastableTrap, true);

  // Case 3: Choked pathway -> fail-closed CHALLENGED_ABSTAIN
  const chokedResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass46_choked_003', signature: 'sig_choked_003' },
    {
      tokenAgeSec: 35.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      pathwayBottleneck: {
        activationBarrierEnergy: 6.2,
        bottleneckSurfaceLocation: 'PRE_MIGRATION_FREEZE_BARRIER',
        transmissionCoefficient: 0.04,
        isPathwayChoked: true,
        recommendedAction: 'HALT_BEFORE_BARRIER',
      },
      enforcePathwayBottleneckGating: true,
    }
  );

  assert.equal(chokedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(chokedResult.whyExecutionBlocked?.includes('BLOCKED — PATHWAY CHOKED'));
  assert.equal(chokedResult.viewModel.isPathwayChoked, true);

  // Case 4: Sub-critical transition path viability (< 25%) -> fail-closed CHALLENGED_ABSTAIN
  const subcriticalResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass46_subcrit_004', signature: 'sig_subcrit_004' },
    {
      tokenAgeSec: 35.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      transitionPath: {
        stateA: 'CROSSING_2X',
        stateB: 'RUNNER_10X',
        meanFirstPassageTimeSeconds: 50.0,
        reactiveTrajectoryProbability: 0.10,
        dominantPathDescription: 'DIFFUSIVE_SUB_CRITICAL',
        pathViabilityRatio: 0.12, // < 0.25
      },
      enforceTransitionPathGating: true,
    }
  );

  assert.equal(subcriticalResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(subcriticalResult.whyExecutionBlocked?.includes('BLOCKED — SUB-CRITICAL TRANSITION PATH'));
});

test('Pass 46: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_050_000;
  const canonicalEvent = {
    eventId: 'evt_pass46_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenTPTTelem111111111111111111111111111111',
    signature: '5tpt_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 40510,
    slot: 550_000,
    parentSlot: 549_999,
    blockhash: 'BhashPass46Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TTLM',
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

  const result = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 35.0,
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
  assert.ok(vm.transitionPath, 'transitionPath must be projected into ViewModel');
  assert.ok(vm.metastability, 'metastability must be projected into ViewModel');
  assert.ok(vm.pathwayBottleneck, 'pathwayBottleneck must be projected into ViewModel');
  assert.equal(typeof vm.isMetastableTrap, 'boolean');
  assert.equal(typeof vm.isPathwayChoked, 'boolean');
  assert.equal(typeof vm.transitionViabilityRatio, 'number');
  assert.equal(typeof vm.bottleneckLocation, 'string');
  assert.ok(result.transitionPath, 'transitionPath must be returned in MasterPipelineResult');
  assert.ok(result.metastability, 'metastability must be returned in MasterPipelineResult');
  assert.ok(result.pathwayBottleneck, 'pathwayBottleneck must be returned in MasterPipelineResult');
});

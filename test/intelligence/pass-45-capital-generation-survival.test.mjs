import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 45: Capital Generation Depth Engine & Branching Dynamics (Section XIII & Study 25)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Deep organic multi-generational propagation (Gen 3 reached, organic ratio > 25%)
  const deepPropagation = engine.evaluateCapitalGenerationDepth({
    gen0CapitalUsd: 2000,
    gen1CapitalUsd: 2500,
    gen2CapitalUsd: 3500,
    gen3PlusCapitalUsd: 2000,
  });

  assert.equal(deepPropagation.maximumGenerationReached, 3);
  assert.equal(deepPropagation.depthSufficientForRunner, true);
  assert.equal(deepPropagation.organicGenerationalRatio, 0.55); // (3500 + 2000) / 10000 = 55%
  assert.ok(deepPropagation.generationalDecayFactor > 1.0);

  // Case 2: Shallow bot/sniper front-run concentration (Gen 1 only, 0% organic)
  const shallowBots = engine.evaluateCapitalGenerationDepth({
    gen0CapitalUsd: 6000,
    gen1CapitalUsd: 4000,
    gen2CapitalUsd: 0,
    gen3PlusCapitalUsd: 0,
  });

  assert.equal(shallowBots.maximumGenerationReached, 1);
  assert.equal(shallowBots.depthSufficientForRunner, false);
  assert.equal(shallowBots.organicGenerationalRatio, 0.0);
  assert.equal(shallowBots.generationalDecayFactor, 0.0);
});

test('Pass 45: Capital Survival & Extraction Siphon Engine (Section XIII & Study 26)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Healthy capital retention and sustainable half-life
  const healthySurvival = engine.measureCapitalSurvival({
    cumulativeInflowsUsd: 10_000,
    cumulativeOutflowsUsd: 1_500,
    poolAgeSeconds: 120,
    inflowObservationWindowSeconds: 60,
  });

  assert.equal(healthySurvival.isExtractionSiphon, false);
  assert.equal(healthySurvival.capitalRetentionRatio60s, 0.85); // 85% retained
  assert.equal(healthySurvival.extractionVelocityUsdPerSec, 12.5); // 1500 / 120
  assert.ok(healthySurvival.capitalHalfLifeSeconds > 100);

  // Case 2: Predatory extraction siphon (90% capital extracted, fast extraction)
  const predatorySiphon = engine.measureCapitalSurvival({
    cumulativeInflowsUsd: 10_000,
    cumulativeOutflowsUsd: 9_000,
    poolAgeSeconds: 60,
    inflowObservationWindowSeconds: 60,
  });

  assert.equal(predatorySiphon.isExtractionSiphon, true);
  assert.equal(predatorySiphon.capitalRetentionRatio60s, 0.10); // 10% retained < 20%
  assert.equal(predatorySiphon.extractionVelocityUsdPerSec, 150.0);
  assert.ok(predatorySiphon.capitalHalfLifeSeconds < 25.0);
});

test('Pass 45: Decision Kernel Gating Fail-Closed Under Shallow Depth & Extraction Siphon', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_000_000;
  const canonicalEvent = {
    eventId: 'evt_pass45_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenGenGate1111111111111111111111111111111',
    signature: '5gen_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 40010,
    slot: 540_000,
    parentSlot: 539_999,
    blockhash: 'BhashPass45Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'GEN',
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

  // Case 1: Healthy depth and non-siphon pool -> gates clear
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
    enforceCapitalGenerationGating: true,
    enforceCapitalSurvivalGating: true,
  });

  assert.ok(healthyResult.capitalGeneration);
  assert.ok(healthyResult.capitalSurvival);
  assert.equal(healthyResult.viewModel.isDepthSufficient, true);
  assert.equal(healthyResult.viewModel.isExtractionSiphon, false);

  // Case 2: Shallow generational depth past 30s -> fail-closed CHALLENGED_ABSTAIN
  const shallowDepthResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass45_shallow_002', signature: 'sig_shallow_002' },
    {
      tokenAgeSec: 35.0, // > 30s
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      capitalGeneration: {
        maximumGenerationReached: 1,
        generationMassDistribution: { 0: 0.7, 1: 0.3, 2: 0, 3: 0 },
        organicGenerationalRatio: 0.0,
        depthSufficientForRunner: false,
        generationalDecayFactor: 0.0,
      },
      enforceCapitalGenerationGating: true,
    }
  );

  assert.equal(shallowDepthResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(shallowDepthResult.whyExecutionBlocked?.includes('BLOCKED — SHALLOW GENERATIONAL DEPTH'));
  assert.equal(shallowDepthResult.viewModel.isDepthSufficient, false);

  // Case 3: Predatory extraction siphon -> fail-closed CHALLENGED_ABSTAIN
  const siphonResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass45_siphon_003', signature: 'sig_siphon_003' },
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
      capitalSurvival: {
        medianRetentionDurationSeconds: 8.0,
        capitalRetentionRatio60s: 0.12, // < 20%
        extractionVelocityUsdPerSec: 250.0,
        isExtractionSiphon: true,
        capitalHalfLifeSeconds: 8.0,
      },
      enforceCapitalSurvivalGating: true,
    }
  );

  assert.equal(siphonResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(siphonResult.whyExecutionBlocked?.includes('BLOCKED — EXTRACTION SIPHON'));
  assert.equal(siphonResult.viewModel.isExtractionSiphon, true);
});

test('Pass 45: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_000_000;
  const canonicalEvent = {
    eventId: 'evt_pass45_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenGenTelem111111111111111111111111111111',
    signature: '5gen_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 40010,
    slot: 540_000,
    parentSlot: 539_999,
    blockhash: 'BhashPass45Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'GTLM',
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
  assert.ok(vm.capitalGeneration, 'capitalGeneration must be projected into ViewModel');
  assert.ok(vm.capitalSurvival, 'capitalSurvival must be projected into ViewModel');
  assert.equal(typeof vm.isDepthSufficient, 'boolean');
  assert.equal(typeof vm.isExtractionSiphon, 'boolean');
  assert.equal(typeof vm.capitalRetentionRatio, 'number');
  assert.equal(typeof vm.maximumGenerationReached, 'number');
  assert.ok(result.capitalGeneration, 'capitalGeneration must be returned in MasterPipelineResult');
  assert.ok(result.capitalSurvival, 'capitalSurvival must be returned in MasterPipelineResult');
});

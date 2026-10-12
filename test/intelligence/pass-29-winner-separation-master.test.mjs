import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 29: Master Intelligence Orchestrator Winner Separation & Decision Slack Integration', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 2_300_000;
  const canonicalEvent = {
    eventId: 'evt_pass29_winner_001',
    eventType: 'TOKEN_CREATE',
    mint: 'WinnerToken11111111111111111111111111111111',
    signature: '5winner_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 15,
    monotonicTimestamp: 23015,
    slot: 350_000,
    parentSlot: 349_999,
    blockhash: 'BhashWinner001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 18.0,
      priceSol: 0.00004,
      symbol: 'WINNER',
    },
    sourceConfidence: 0.99,
    freshnessMs: 15,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 25, // Well within edgeDecayMs (60s)
    rawWallets: [
      { address: 'w1', solFundedAmount: 4.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 3.0 },
      { address: 'w2', solFundedAmount: 3.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 2.5 },
      { address: 'w3', solFundedAmount: 5.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 4.0 },
      { address: 'w4', solFundedAmount: 2.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 1.5 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 180,
    liquiditySol: 70,
    txCount: 55,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Verify Winner Separation Analysis is performed and present in MasterPipelineResult
  assert.ok(result.separationAnalysis, 'separationAnalysis must be populated in MasterPipelineResult');
  assert.equal(result.separationAnalysis.winnerMint, canonicalEvent.mint);
  assert.ok(Number.isFinite(result.separationAnalysis.edgeGoneMs), 'edgeGoneMs must be finite');
  assert.equal(result.separationAnalysis.edgeGoneMs, 60_000, 'Pre-migration edge horizon must be 60,000ms');
  assert.ok(Number.isFinite(result.separationAnalysis.crowdingHorizonMs), 'crowdingHorizonMs must be finite');
  assert.ok(Number.isFinite(result.separationAnalysis.decisionSlackMs), 'decisionSlackMs must be finite');
  assert.ok(result.separationAnalysis.decisionSlackMs > 0, 'Decision slack must be positive for early organic launch');
  assert.ok(result.separationAnalysis.timeSlices.length >= 3, 'Evaluated observation slices must be present');

  // 2. Verify Executable ATH Profile is computed and disentangles displayed ATH
  assert.ok(result.executableAthProfile, 'executableAthProfile must be populated in MasterPipelineResult');
  assert.equal(result.executableAthProfile.mint, canonicalEvent.mint);
  assert.ok(result.executableAthProfile.displayedAthMultiple >= 1.0, 'displayedAthMultiple must be >= 1.0');
  assert.ok(result.executableAthProfile.eathBySize instanceof Map, 'eathBySize must be a Map');

  // 3. Verify ViewModel surfaces Winner Separation & Decision Slack metrics
  const vm = result.viewModel;
  assert.ok(vm.separationAnalysis, 'separationAnalysis must be exposed in ViewModel');
  assert.ok(vm.executableAthProfile, 'executableAthProfile must be exposed in ViewModel');
  assert.equal(vm.decisionSlackMs, result.separationAnalysis.decisionSlackMs);
  assert.equal(vm.crowdingHorizonMs, result.separationAnalysis.crowdingHorizonMs);
  assert.ok(Number.isFinite(vm.executableAthMultiple), 'executableAthMultiple must be exposed in ViewModel');

  // 4. Verify decision is AUTHORIZED_BUY within valid decision slack window
  assert.equal(result.decision, 'AUTHORIZED_BUY');
  assert.ok(result.allocatedSol > 0, 'Capital must be allocated');
});

test('Pass 29: Master Intelligence Orchestrator fails closed when Crowding Horizon expires', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 2_400_000;
  const canonicalEvent = {
    eventId: 'evt_pass29_crowded_002',
    eventType: 'TOKEN_CREATE',
    mint: 'CrowdedToken1111111111111111111111111111111',
    signature: '5crowded_sig_002',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 15,
    monotonicTimestamp: 24015,
    slot: 360_000,
    parentSlot: 359_999,
    blockhash: 'BhashCrowded002',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.00003,
      symbol: 'CROWD',
    },
    sourceConfidence: 0.99,
    freshnessMs: 15,
    provenance: ['PUMP_PORTAL_WS'],
  };

  // Set tokenAgeSec = 85s (> 60s edge horizon; MEV front-runners have crowded the pool)
  const context = {
    tokenAgeSec: 85,
    rawWallets: [
      { address: 'w1', solFundedAmount: 3.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 2.0 },
      { address: 'w2', solFundedAmount: 2.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.8 },
      { address: 'w3', solFundedAmount: 4.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.2 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 150,
    liquiditySol: 65,
    txCount: 70,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // Candidate must fail closed because crowding horizon has expired and attainable edge is zero
  assert.equal(result.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(
    result.viewModel.capitalAuthority?.whyExecutionBlocked?.includes('CROWDING HORIZON') ||
    result.viewModel.status === 'ABSTAIN',
    'Candidate must be blocked with crowding horizon explanation'
  );
  assert.equal(result.allocatedSol, 0.0);
});

test('Pass 29: Master Intelligence Orchestrator fails closed when Decision Slack <= 0', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Force SpieEngine to return negative or zero net EV, resulting in 0 decision slack
  const origEvaluate = engine.spie.evaluate.bind(engine.spie);
  engine.spie.evaluate = (candidate) => {
    const base = origEvaluate(candidate);
    return {
      ...base,
      pTarget: 0.08, // Very low probability, will not achieve separation
      netExpectedEvBps: -250, // Negative EV
    };
  };

  const eventTime = 2_500_000;
  const canonicalEvent = {
    eventId: 'evt_pass29_noslack_003',
    eventType: 'TOKEN_CREATE',
    mint: 'NoSlackToken1111111111111111111111111111111',
    signature: '5noslack_sig_003',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 15,
    monotonicTimestamp: 25015,
    slot: 370_000,
    parentSlot: 369_999,
    blockhash: 'BhashNoSlack003',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 3,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 10.0,
      priceSol: 0.00002,
      symbol: 'NOSLACK',
    },
    sourceConfidence: 0.99,
    freshnessMs: 15,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 20,
    rawWallets: [
      { address: 'w1', solFundedAmount: 4.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 3.0 },
      { address: 'w2', solFundedAmount: 3.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 2.5 },
      { address: 'w3', solFundedAmount: 5.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 4.0 },
      { address: 'w4', solFundedAmount: 2.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 1.5 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 150,
    liquiditySol: 60,
    txCount: 45,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // Candidate must fail closed
  assert.equal(result.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(result.separationAnalysis.decisionSlackMs <= 0, 'Decision slack must be <= 0');
  assert.equal(result.allocatedSol, 0.0);
});

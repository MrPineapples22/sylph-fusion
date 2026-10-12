import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 31: Master Intelligence Orchestrator Transition-Path Physics & Flow Reproduction Integration', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_100_000;
  const canonicalEvent = {
    eventId: 'evt_pass31_committor_001',
    eventType: 'TOKEN_CREATE',
    mint: 'FlowWinnerToken1111111111111111111111111111',
    signature: '5flow_winner_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 31010,
    slot: 400_000,
    parentSlot: 399_999,
    blockhash: 'BhashFlowWinner001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 25.0,
      priceSol: 0.00005,
      symbol: 'SUPERFLOW',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 20, // Early organic curve
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 200,
    liquiditySol: 80,
    txCount: 65,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Verify Transition-Path Committors in MasterPipelineResult
  assert.ok(result.runnerCommittor, 'runnerCommittor must be populated in MasterPipelineResult');
  assert.ok(result.runnerCommittor.qUp > 0.001, 'Forward committor qUp must be positive');
  assert.ok(Number.isFinite(result.runnerCommittor.liftOverBaseRate), 'liftOverBaseRate must be finite');
  assert.ok(result.runnerCommittor.reactionCoordinate >= 0 && result.runnerCommittor.reactionCoordinate <= 1, 'reactionCoordinate must be bounded [0, 1]');

  assert.ok(result.failureCommittor, 'failureCommittor must be populated in MasterPipelineResult');
  assert.ok(result.failureCommittor.qFail >= 0.05 && result.failureCommittor.qFail <= 1.0, 'Backward failure committor qFail must be bounded');
  assert.equal(result.failureCommittor.failureImminent, false, 'Failure must not be imminent on healthy curve');

  // 2. Verify Flow Reproduction (R_buy, R_sell) in MasterPipelineResult
  assert.ok(result.flowReproduction, 'flowReproduction must be populated in MasterPipelineResult');
  assert.ok(result.flowReproduction.rBuy > 0, 'rBuy must be positive');
  assert.ok(result.flowReproduction.rSell > 0, 'rSell must be positive');
  assert.ok(result.flowReproduction.isSuperCriticalBuy, 'rBuy must be supercritical (>1.0) on healthy curve');
  assert.equal(result.flowReproduction.isFlowHealthy, true, 'isFlowHealthy must be true when rBuy > 1.0 and rSell < 1.0');

  // 3. Verify Reactive Flux J_{AB} in MasterPipelineResult
  assert.ok(result.reactiveFlux, 'reactiveFlux must be populated in MasterPipelineResult');
  assert.ok(Number.isFinite(result.reactiveFlux.netFluxRatePerSec), 'netFluxRatePerSec must be finite');
  assert.equal(result.reactiveFlux.isNetForwardPositive, true, 'Forward reactive flux must be positive');

  // 4. Verify ViewModel surfaces Transition-Path Physics & Super-Critical Flow telemetry
  const vm = result.viewModel;
  assert.ok(vm.runnerCommittor, 'runnerCommittor must be exposed in ViewModel');
  assert.ok(vm.failureCommittor, 'failureCommittor must be exposed in ViewModel');
  assert.ok(vm.flowReproduction, 'flowReproduction must be exposed in ViewModel');
  assert.ok(vm.reactiveFlux, 'reactiveFlux must be exposed in ViewModel');
  assert.equal(vm.qUp, result.runnerCommittor.qUp);
  assert.equal(vm.qFail, result.failureCommittor.qFail);
  assert.equal(vm.rBuy, result.flowReproduction.rBuy);
  assert.equal(vm.rSell, result.flowReproduction.rSell);
  assert.equal(vm.isSuperCriticalFlow, result.flowReproduction.isFlowHealthy);

  // 5. Verify Decision is AUTHORIZED_BUY
  assert.equal(result.decision, 'AUTHORIZED_BUY');
  assert.ok(result.allocatedSol > 0, 'Capital must be allocated to super-critical runner');
});

test('Pass 31: Master Intelligence Orchestrator fails closed when Failure Committor is critical (qFail >= 0.65)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_200_000;
  const canonicalEvent = {
    eventId: 'evt_pass31_failing_002',
    eventType: 'TOKEN_CREATE',
    mint: 'FailingToken11111111111111111111111111111111',
    signature: '5failing_sig_002',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 32010,
    slot: 410_000,
    parentSlot: 409_999,
    blockhash: 'BhashFailing002',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 10.0,
      priceSol: 0.00003,
      symbol: 'DOOM',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  // High creator inventory + sybil cluster triggering failure committor
  const context = {
    tokenAgeSec: 45,
    rawWallets: [
      { address: 'sybil1', solFundedAmount: 1.0, parentFundingAddress: 'shared_funder_1', buyVolumeSol: 1.0 },
      { address: 'sybil2', solFundedAmount: 1.0, parentFundingAddress: 'shared_funder_1', buyVolumeSol: 1.0 },
      { address: 'sybil3', solFundedAmount: 1.0, parentFundingAddress: 'shared_funder_1', buyVolumeSol: 1.0 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 50,
    liquiditySol: 15,
    txCount: 8,
    creatorRemainingSol: 12.0, // Creator holds 80% of pool liquidity!
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // Must fail closed with zero capital allocated
  assert.equal(result.allocatedSol, 0.0, 'Zero capital allocated to failing trajectory');
  assert.ok(['CHALLENGED_ABSTAIN', 'RISK_REJECTED', 'SAFETY_LOCKED'].includes(result.decision), 'Must reject, lock, or abstain from doomed token');
  assert.ok(result.failureCommittor.qFail >= 0.50, 'Failure committor must be elevated');
});

test('Pass 31: Master Intelligence Orchestrator blocks with CHALLENGED_ABSTAIN when failure committor trips without safety locks', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_300_000;
  const canonicalEvent = {
    eventId: 'evt_pass31_creator_drain_003',
    eventType: 'TOKEN_CREATE',
    mint: 'CreatorOverhangToken11111111111111111111111',
    signature: '5creator_overhang_sig_003',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 33010,
    slot: 420_000,
    parentSlot: 419_999,
    blockhash: 'BhashCreatorOverhang003',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 3,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 25.0,
      priceSol: 0.00005,
      symbol: 'OVERHANG',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  // Clean wallets (no sybils, passes safety & risk), but creator dump and high sell pressure
  const context = {
    tokenAgeSec: 25,
    rawWallets: [
      { address: 'clean1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot_1', buyVolumeSol: 4.0 },
      { address: 'clean2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot_2', buyVolumeSol: 5.0 },
      { address: 'clean3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot_3', buyVolumeSol: 3.5 },
      { address: 'clean4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot_4', buyVolumeSol: 6.0 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 200,
    liquiditySol: 80,
    txCount: 65,
    creatorRemainingSol: 76.0, // 95% creator inventory ratio
    dtfScore: 0.75, // Elevated dump-to-freefall score
    sellPressureRatio: 0.80, // Heavy sell volume
  };

  const result = await engine.processEvent(canonicalEvent, context);

  assert.equal(result.allocatedSol, 0.0, 'Zero capital allocated to creator overhang token');
  assert.equal(result.decision, 'CHALLENGED_ABSTAIN', 'Must block with CHALLENGED_ABSTAIN on high failure committor');
  assert.ok(result.failureCommittor.qFail >= 0.65, `qFail must be >= 0.65 (actual: ${result.failureCommittor.qFail})`);
  assert.ok(result.whyExecutionBlocked.includes('HIGH FAILURE COMMITTOR'), 'Block reason must specify high failure committor');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 38: Execution Lane Scorecard Engine & Track Record Invariants (Section XIX)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Unobserved lane defaults to zero assumed superiority and ineligible for optimization
  const emptyCard = engine.getLaneScorecard('Jito-Bundle');
  assert.equal(emptyCard.resolvedAttempts, 0);
  assert.equal(emptyCard.eligibleForOptimization, false, 'Zero attempts must not be eligible for optimization');
  assert.equal(emptyCard.failureRate, 1.0);

  // 2. Record 29 attempts (below minimum 30 threshold)
  for (let i = 0; i < 29; i++) {
    engine.recordLaneAttempt({
      laneId: 'Jito-Bundle',
      landed: true,
      sameSlot: true,
      nextSlot: false,
      latencyMs: 380,
      feeUsd: 0.05,
      tipUsd: 0.08,
      implementationShortfallUsd: 0.20,
    });
  }

  const card29 = engine.getLaneScorecard('Jito-Bundle');
  assert.equal(card29.resolvedAttempts, 29);
  assert.equal(card29.eligibleForOptimization, false, '29 attempts (<30) must remain ineligible for optimization');

  // 3. Record 30th attempt: crosses minimum evidence threshold -> eligibleForOptimization becomes true
  const card30 = engine.recordLaneAttempt({
    laneId: 'Jito-Bundle',
    landed: true,
    sameSlot: true,
    nextSlot: false,
    latencyMs: 390,
    feeUsd: 0.05,
    tipUsd: 0.08,
    implementationShortfallUsd: 0.20,
  });

  assert.equal(card30.resolvedAttempts, 30);
  assert.equal(card30.eligibleForOptimization, true, '30 resolved attempts with 100% landing rate must be eligible');
  assert.ok(card30.landingRate >= 0.99);
  assert.ok(card30.p50LandingMs <= 400);
  assert.equal(card30.failureRate, 0.0);
});

test('Pass 38: Lane-Conditional Landing Physics Model & Account Contention (Section XVIII & Study 37/40)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Jito bundle when leader IS Jito-enabled vs NOT Jito-enabled
  const jitoLeaderEnabled = engine.estimateLandingProbability({
    laneId: 'Jito-Bundle',
    priorityFeeMicroLamports: 100_000,
    tipLamports: 1_000_000n, // 0.001 SOL
    writableAccountCount: 3,
    isLeaderJitoEnabled: true,
    networkCongestionTps: 2000,
    tradeType: 'ENTRY_BUY',
  });

  const jitoLeaderDisabled = engine.estimateLandingProbability({
    laneId: 'Jito-Bundle',
    priorityFeeMicroLamports: 100_000,
    tipLamports: 1_000_000n,
    writableAccountCount: 3,
    isLeaderJitoEnabled: false,
    networkCongestionTps: 2000,
    tradeType: 'ENTRY_BUY',
  });

  assert.ok(jitoLeaderEnabled.landingProbability >= 0.85, 'Leader Jito enabled must have high landing probability');
  assert.ok(jitoLeaderDisabled.landingProbability <= 0.55, 'Leader Jito disabled bundle must experience severe drop');
  assert.ok(jitoLeaderEnabled.sameSlotProbability > jitoLeaderDisabled.sameSlotProbability);

  // 2. Account write-lock contention analysis
  const lowContention = engine.analyzeAccountContention({
    writableAccountPubkeys: ['mint_1', 'pool_1'],
    poolOpsPerSec: 5,
    globalCongestionLevel: 0.1,
  });

  const highContention = engine.analyzeAccountContention({
    writableAccountPubkeys: ['mint_1', 'pool_1', 'vault_1', 'authority_1', 'fee_vault_1', 'lock_1'],
    poolOpsPerSec: 120, // 120 concurrent txs targeting pool
    globalCongestionLevel: 0.8,
  });

  assert.equal(lowContention.requiresContentionMitigation, false);
  assert.ok(highContention.lockCollisionProbability > 0.60, 'Heavy account contention must detect high lock collision');
  assert.equal(highContention.requiresContentionMitigation, true);
  assert.ok(highContention.estimatedWaitSlots >= 1);
});

test('Pass 38: Multi-Lane Adaptive Submission Router & Net Utility Arbitration (Section XIX & Study 38)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Jito-enabled slot -> Jito-Bundle should win on net utility
  const decisionJito = engine.routeSubmissionLane({
    mint: 'TokenJitoWin111111111111111111111111111111111',
    tradeType: 'ENTRY_BUY',
    isLeaderJitoEnabled: true,
    networkCongestionTps: 1800,
    writableAccountPubkeys: ['mint_1', 'pool_1', 'fee_payer'],
    poolOpsPerSec: 10,
    urgency: 'NORMAL',
    expectedGrossEdgeUsd: 15.0,
    solPriceUsd: 150.0,
  });

  assert.equal(decisionJito.selectedLane, 'Jito-Bundle', 'Jito-Bundle must be primary when leader is Jito-enabled');
  assert.ok(decisionJito.landingProbability >= 0.80);
  assert.ok(decisionJito.optimalTipLamports > 0n);
  assert.equal(decisionJito.isExecutionSafe, true);

  // Case 2: Leader NOT Jito-enabled -> router must adaptively switch to Direct-TPU or NextBlock
  const decisionNonJito = engine.routeSubmissionLane({
    mint: 'TokenNonJito1111111111111111111111111111111111',
    tradeType: 'ENTRY_BUY',
    isLeaderJitoEnabled: false,
    networkCongestionTps: 1800,
    writableAccountPubkeys: ['mint_1', 'pool_1', 'fee_payer'],
    poolOpsPerSec: 10,
    urgency: 'NORMAL',
    expectedGrossEdgeUsd: 15.0,
    solPriceUsd: 150.0,
  });

  assert.notEqual(decisionNonJito.selectedLane, 'Jito-Bundle', 'Must not select Jito-Bundle when leader does not run Jito');
  assert.ok(decisionNonJito.selectedLane === 'Direct-TPU' || decisionNonJito.selectedLane === 'NextBlock-Relay');
  assert.equal(decisionNonJito.isExecutionSafe, true);
});

test('Pass 38: End-to-End Decision Kernel Gating in processEvent for Submission Lanes', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass38_lane_001',
    eventType: 'TOKEN_CREATE',
    mint: 'LaneToken1111111111111111111111111111111111',
    signature: '5lane_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashLane001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'LANE',
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

  // Case 1: Extreme account lock contention (> 0.85 collision prob) triggers CHALLENGED_ABSTAIN
  const heavyContentionContext = {
    tokenAgeSec: 25.0,
    txCount: 40,
    liquiditySol: 65.0,
    marketCapSol: 130.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    writableAccountPubkeys: [
      'acc1', 'acc2', 'acc3', 'acc4', 'acc5', 'acc6', 'acc7', 'acc8', 'acc9', 'acc10'
    ],
    poolOpsPerSec: 250, // Massive pool storm
    networkCongestionTps: 3800,
  };

  const contentionResult = await engine.processEvent(canonicalEvent, heavyContentionContext);
  assert.equal(contentionResult.decision, 'CHALLENGED_ABSTAIN', 'Critical account contention must trigger CHALLENGED_ABSTAIN');
  assert.ok(contentionResult.whyExecutionBlocked?.includes('CRITICAL_ACCOUNT_CONTENTION'));
  assert.ok(contentionResult.accountContention, 'accountContention attached');
  assert.ok(contentionResult.accountContention.lockCollisionProbability > 0.85);

  // Case 2: Healthy, optimal multi-lane submission projects full telemetry
  const healthyContext = {
    tokenAgeSec: 25.0,
    txCount: 40,
    liquiditySol: 70.0,
    marketCapSol: 140.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    isLeaderJitoEnabled: true,
    networkCongestionTps: 1800,
    poolOpsPerSec: 10,
  };

  const healthyResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass38_healthy_002', signature: 'sig_healthy_002' },
    healthyContext
  );

  assert.ok(healthyResult.submissionRouting, 'submissionRouting attached');
  assert.ok(healthyResult.laneScorecard, 'laneScorecard attached');
  assert.ok(healthyResult.accountContention, 'accountContention attached');
  assert.ok(healthyResult.feeOptimization, 'feeOptimization attached');
  assert.ok(healthyResult.viewModel.selectedSubmissionLane, 'selectedSubmissionLane on viewModel');
  assert.ok(healthyResult.viewModel.laneLandingProbability > 0.60);
  assert.ok(healthyResult.viewModel.accountCollisionProbability < 0.40);
});

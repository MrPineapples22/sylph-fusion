import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { TradeLearningService } from '../../dist/intelligence/attribution/trade-learning-service.js';
import { AutonomousResearchLab } from '../../dist/intelligence/research/autonomous-lab.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 27: Master Intelligence Orchestrator SPIE factor evaluation and Net EV computation', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 2_000_000;
  const canonicalEvent = {
    eventId: 'evt_spie_launch_001',
    eventType: 'TOKEN_CREATE',
    mint: 'So11111111111111111111111111111111111111112',
    signature: '5spie_sig_123',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 15,
    monotonicTimestamp: 20015,
    slot: 300_000,
    parentSlot: 299_999,
    blockhash: 'BhashSpie123',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.00003,
      symbol: 'SPIE',
    },
    sourceConfidence: 0.99,
    freshnessMs: 15,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 35,
    rawWallets: [
      { address: 'w1', solFundedAmount: 3.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 2.0 },
      { address: 'w2', solFundedAmount: 2.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.8 },
      { address: 'w3', solFundedAmount: 4.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.2 },
      { address: 'w4', solFundedAmount: 1.5, parentFundingAddress: 'okx_hot', buyVolumeSol: 1.1 },
      { address: 'w5', solFundedAmount: 6.0, parentFundingAddress: 'bybit_hot', buyVolumeSol: 4.5 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 150,
    liquiditySol: 75,
    txCount: 60,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Verify SPIE Evaluation was performed
  assert.ok(result.spieEvaluation, 'SPIE evaluation must be returned in MasterPipelineResult');
  assert.equal(result.spieEvaluation.mint, canonicalEvent.mint);
  assert.ok(result.spieEvaluation.pTarget > 0.5, `pTarget (${result.spieEvaluation.pTarget}) should be > 0.5 for high quality launch`);
  assert.ok(result.spieEvaluation.grossAlphaBps > 0, 'Gross alpha BPS must be positive');
  assert.ok(result.spieEvaluation.executionFrictionBps > 0, 'Execution friction BPS must be positive');
  assert.ok(result.spieEvaluation.frictionToGrossRatio <= 0.45, 'Friction-to-gross ratio must be <= 45%');
  assert.ok(result.spieEvaluation.netExpectedEvBps > 0, 'Net EV BPS must be positive');
  assert.ok(result.spieEvaluation.opportunityScore >= 70, 'Opportunity score must be >= 70 for strong launch');
  assert.ok(
    result.spieEvaluation.opportunityStage === 'READY' || result.spieEvaluation.opportunityStage === 'HIGH_CONFIDENCE',
    `Opportunity stage should be READY or HIGH_CONFIDENCE, got ${result.spieEvaluation.opportunityStage}`
  );

  // 2. Verify SPIE Evaluation in ViewModel
  assert.ok(result.viewModel.spieEvaluation, 'spieEvaluation must be exposed in ViewModel');
  assert.equal(result.viewModel.spieEvaluation.opportunityScore, result.spieEvaluation.opportunityScore);
});

test('Pass 27: Master Intelligence Orchestrator Convex Multi-Target Kelly Sizing toward +10,000% PnL', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 2_100_000;
  const canonicalEvent = {
    eventId: 'evt_kelly_launch_002',
    eventType: 'TOKEN_CREATE',
    mint: 'KellyToken111111111111111111111111111111111',
    signature: '5kelly_sig_456',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 20,
    monotonicTimestamp: 21020,
    slot: 310_000,
    parentSlot: 309_999,
    blockhash: 'BhashKelly456',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 20.0,
      priceSol: 0.00005,
      symbol: 'KELLY',
    },
    sourceConfidence: 0.99,
    freshnessMs: 20,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 40,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 3.5 },
      { address: 'w2', solFundedAmount: 4.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 2.8 },
      { address: 'w3', solFundedAmount: 3.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 2.1 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 200,
    liquiditySol: 80,
    txCount: 50,
  };

  const result = await engine.processEvent(canonicalEvent, context);

  // 1. Verify Convex Kelly is computed
  assert.ok(result.convexKelly, 'convexKelly result must be populated in MasterPipelineResult');
  assert.ok(result.convexKelly.recommendedAllocationSol > 0, 'Kelly recommended size must be > 0');
  assert.ok(result.convexKelly.unconstrainedKellyFraction > 0, 'Kelly fraction must be > 0');
  assert.ok(result.convexKelly.halfKellyFraction > 0, 'Half-Kelly fraction must be > 0');
  assert.ok(result.convexKelly.liquidityCapSol > 0, 'Liquidity cap must be > 0');

  // Liquidity capacity constraint: max 5% of 80 SOL = 4.0 SOL
  assert.equal(result.convexKelly.liquidityCapSol, 4.0);

  // 2. Verify allocatedSol matches growth-optimal sizing
  assert.equal(result.decision, 'AUTHORIZED_BUY');
  assert.ok(result.allocatedSol > 0, 'Allocated SOL must be positive');
  assert.ok(result.allocatedSol <= 2.0, 'Allocated SOL must respect mandate limit');

  // 3. Verify ViewModel contains convexKelly
  assert.ok(result.viewModel.convexKelly, 'convexKelly must be exposed in ViewModel');
  assert.equal(result.viewModel.convexKelly.recommendedAllocationSol, result.convexKelly.recommendedAllocationSol);
});

test('Pass 27: Master Intelligence Orchestrator fails closed on excessive execution friction (>45%)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Force SpieEngine to return high friction exceeding gross alpha
  const origEvaluate = engine.spie.evaluate.bind(engine.spie);
  engine.spie.evaluate = (candidate) => {
    const base = origEvaluate(candidate);
    return {
      ...base,
      opportunityStage: 'DEVELOPING',
      actionRecommendation: 'ABSTAIN',
      frictionToGrossRatio: 0.58, // 58% > 45% ceiling
      abstainReason: 'EXCESSIVE_FRICTION: Execution cost (480 BPS) exceeds 45% of gross alpha (ratio: 58.0%)',
    };
  };

  const eventTime = 2_200_000;
  const result = await engine.processEvent(
    {
      eventId: 'evt_friction_003',
      eventType: 'TOKEN_CREATE',
      mint: 'FrictionToken11111111111111111111111111111',
      signature: '5friction_sig',
      instructionIndex: 0,
      source: 'PUMP_PORTAL',
      sourceTimestampMs: eventTime,
      receivedTimestampMs: eventTime + 20,
      monotonicTimestamp: 22020,
      slot: 320_000,
      parentSlot: 319_999,
      blockhash: 'BhashFriction',
      commitment: 'confirmed',
      transactionVersion: 'legacy',
      sequenceId: 3,
      chainState: 'CONFIRMED',
      payload: { amountSol: 10.0, priceSol: 0.00002 },
      sourceConfidence: 0.99,
      freshnessMs: 20,
      provenance: ['PUMP_PORTAL_WS'],
    },
    {
      tokenAgeSec: 30,
      rawWallets: [
        { address: 'w1', solFundedAmount: 3.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 2.0 },
        { address: 'w2', solFundedAmount: 2.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.8 },
        { address: 'w3', solFundedAmount: 4.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.2 },
        { address: 'w4', solFundedAmount: 1.5, parentFundingAddress: 'okx_hot', buyVolumeSol: 1.1 },
        { address: 'w5', solFundedAmount: 6.0, parentFundingAddress: 'bybit_hot', buyVolumeSol: 4.5 },
      ],
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      marketCapSol: 150,
      liquiditySol: 65,
      txCount: 50,
    }
  );

  // Must cleanly abstain due to SPIE excessive friction
  assert.equal(result.decision, 'CHALLENGED_ABSTAIN');
  assert.equal(result.allocatedSol, 0);
  assert.ok(result.viewModel.capitalAuthority?.whyExecutionBlocked?.includes('EXCESSIVE_FRICTION'));
});

test('Pass 27: MasterIntelligenceEngine.evaluateDynamicExit enforces Breakeven Protection and Multi-Stage Moonshot Ratchets up to 100x (+10,000% PnL)', () => {
  const engine = new MasterIntelligenceEngine();

  // Test 1: Breakeven Protection Guard (peak +15%, current pulls back to +0.5%)
  const breakevenEval = engine.evaluateDynamicExit({
    mint: 'TokenBE111111111111111111111111111111111111',
    entryPriceUsd: 1.0,
    highestPriceUsd: 1.15, // +15% peak
    currentPriceUsd: 1.006, // pulled back to +0.6%
    holdingTimeSeconds: 120,
  });

  assert.equal(breakevenEval.godTier.action, 'BREAKEVEN_PROTECT');
  assert.ok(breakevenEval.godTier.reason.includes('BREAKEVEN_PROTECT'));
  assert.equal(breakevenEval.godTier.protectiveStopUsd, 1.005);
  assert.equal(breakevenEval.godTier.fractionPct, 1.0);

  // Test 2: 10x Moonshot (+1,000% PnL) ratchets to 7.5x trailing floor
  const tenXEval = engine.evaluateDynamicExit({
    mint: 'Token10x11111111111111111111111111111111111',
    entryPriceUsd: 1.0,
    highestPriceUsd: 12.0, // 12x peak
    currentPriceUsd: 10.0, // current 10x
    holdingTimeSeconds: 600,
  });

  assert.equal(tenXEval.godTier.action, 'HOLD');
  assert.ok(Math.abs(tenXEval.godTier.protectiveStopUsd - 8.4) < 1e-4); // max(7.50 floor, 12.0 * 0.70 = 8.40)
  assert.ok(tenXEval.godTier.protectiveStopUsd >= 7.5);

  // Test 3: 20x Moonshot (+2,000% PnL) ratchets to 15.0x trailing floor
  const twentyXEval = engine.evaluateDynamicExit({
    mint: 'Token20x1111111111111111111111111111111111',
    entryPriceUsd: 1.0,
    highestPriceUsd: 22.0, // 22x peak
    currentPriceUsd: 18.0, // current 18x
    holdingTimeSeconds: 1200,
  });

  assert.equal(twentyXEval.godTier.action, 'HOLD');
  assert.ok(Math.abs(twentyXEval.godTier.protectiveStopUsd - 15.4) < 1e-4); // max(15.0 floor, 22.0 * 0.70 = 15.4)
  assert.ok(twentyXEval.godTier.protectiveStopUsd >= 15.0);

  // Test 4: 100x Moonshot (+10,000% PnL) ratchets to 70.0x trailing floor
  const hundredXEval = engine.evaluateDynamicExit({
    mint: 'Token100x111111111111111111111111111111111',
    entryPriceUsd: 1.0,
    highestPriceUsd: 105.0, // 105x peak (+10,400% PnL)
    currentPriceUsd: 95.0,  // current 95x
    holdingTimeSeconds: 3600,
  });

  assert.equal(hundredXEval.godTier.action, 'HOLD');
  assert.ok(Math.abs(hundredXEval.godTier.protectiveStopUsd - 73.5) < 1e-4); // max(70.0 floor, 105.0 * 0.70 = 73.5)
  assert.ok(hundredXEval.godTier.protectiveStopUsd >= 70.0);

  // Test 5: 100x Moonshot breach triggers EXIT_100_PROFIT protecting +6,900% gain
  const hundredXBreach = engine.evaluateDynamicExit({
    mint: 'Token100xBreach111111111111111111111111111',
    entryPriceUsd: 1.0,
    highestPriceUsd: 105.0, // 105x peak
    currentPriceUsd: 68.0,  // pulled back below 73.5 stop
    holdingTimeSeconds: 3700,
  });

  assert.equal(hundredXBreach.godTier.action, 'EXIT_100_PROFIT');
  assert.ok(hundredXBreach.godTier.reason.includes('DYNAMIC_STAGED_TRAIL'));
  assert.equal(hundredXBreach.godTier.fractionPct, 1.0);
});

test('Pass 27: TradeLearningService outcome listeners and AutonomousResearchLab positive attribution', () => {
  const service = TradeLearningService.getInstance();
  const lab = new AutonomousResearchLab();

  let listenerFired = false;
  let receivedAutopsy = null;

  const unsubscribe = service.addOutcomeListener((autopsy) => {
    listenerFired = true;
    receivedAutopsy = autopsy;
  });

  // Record a closed trade
  const tradeReport = {
    tokenMint: 'LearnToken11111111111111111111111111111111',
    symbol: 'LRN',
    entryPriceUsd: 1.0,
    exitPriceUsd: 3.5, // 3.5x win (+250%)
    costBasisUsd: 100.0,
    proceedsUsd: 350.0,
    realizedPnlUsd: 250.0,
    realizedPnlPct: 250.0,
    holdDurationMs: 45000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
    processEvidenceRef: 'evidence:paper_entry_LearnToken11111111111111111111111111111111_trd_001',
  };

  const autopsy = service.recordClosedTrade(tradeReport);

  assert.ok(listenerFired, 'Outcome listener must fire on recorded closed trade');
  assert.equal(receivedAutopsy?.tokenMint, tradeReport.tokenMint);
  assert.equal(receivedAutopsy?.realizedPnlPct, 250.0);

  // Ingest feedback into AutonomousResearchLab
  const labFeedback = lab.ingestTradeAutopsyFeedback({
    targetFeatureFamily: 'MOMENTUM_EXPANSION',
    realizedMultiple: 3.5,
    wasProfitable: true,
    sampleCount: 16,
  });

  assert.ok(labFeedback.calibratedSharpeEstimate > 0, 'Calibrated Sharpe estimate must be positive');
  assert.equal(labFeedback.trialsRecorded, 16);

  unsubscribe();
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 37: Alpha Half-Life Engine & Economic Event Horizon (Section XV & Layer I/II/III)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Routine bonding curve early: moderate competition
  const earlyEstimate = engine.estimateAlphaHalfLife({
    stage: 'BONDING_CURVE_EARLY',
    initialEdgeBps: 500,
    hurdleBps: 100,
    competitorDensity: 0.30,
    opportunityJerk: 0.10,
    frictionBps: 50,
  });

  assert.ok(earlyEstimate.halfLifeMs >= 200, 'Half life must be >= 200ms');
  assert.equal(earlyEstimate.curvature, 'EXPONENTIAL');
  assert.ok(earlyEstimate.burnRateBpsPerMs > 0, 'Burn rate must be positive');
  assert.ok(earlyEstimate.economicEventHorizonMs >= earlyEstimate.halfLifeMs, 'EEH must be >= half life');

  // 2. Heavy competitor saturation & negative jerk -> CATASTROPHIC curvature & compressed half-life
  const crowdedEstimate = engine.estimateAlphaHalfLife({
    stage: 'BONDING_CURVE_EARLY',
    initialEdgeBps: 500,
    hurdleBps: 100,
    competitorDensity: 0.90, // Heavy bot competition
    opportunityJerk: -0.60, // Negative jerk
    frictionBps: 60,
  });

  assert.ok(crowdedEstimate.halfLifeMs < earlyEstimate.halfLifeMs, 'Crowded half life must be shorter');
  assert.equal(crowdedEstimate.curvature, 'CATASTROPHIC', 'Heavy bot density must trigger CATASTROPHIC curvature');
});

test('Pass 37: Latency Alpha Burn Ledger & Subsystem Attribution (Section XV & Section 32)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const estimate = engine.estimateAlphaHalfLife({
    stage: 'BONDING_CURVE_MID',
    initialEdgeBps: 600,
    hurdleBps: 100,
    competitorDensity: 0.25,
  });

  const latencyBreakdown = {
    discoveryMs: 45,
    modelEvaluationMs: 25,
    quoteMs: 20,
    simulationMs: 30,
    signingMs: 15,
    networkTransmissionMs: 65,
  };

  const auditReport = engine.auditAlphaBurn(600, estimate, latencyBreakdown);
  assert.equal(auditReport.initialEdgeBps, 600);
  assert.equal(auditReport.totalElapsedMs, 200);
  assert.ok(auditReport.totalBurnedBps > 0, 'Alpha burn must be non-zero');
  assert.ok(auditReport.remainingEdgeBps < 600, 'Remaining edge must be less than initial');
  assert.equal(auditReport.capturesPositiveEdge, true, 'Remaining edge must exceed hurdle');
  assert.equal(auditReport.phases.length, 6, 'Must audit all 6 subsystem latency phases');

  const fractionSum = auditReport.phases.reduce((sum, p) => sum + p.fractionOfTotalBurn, 0);
  assert.ok(Math.abs(fractionSum - 1.0) < 0.05, 'Phase fractions must sum to ~1.0');
});

test('Pass 37: Quote Decay Engine & Dynamic Execution Urgency (Section XVI & XX)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Fresh quote within 1 slot lag -> not stale
  const freshQuote = engine.evaluateQuoteDecay({
    initialPriceUsd: 0.00005,
    quoteSlot: 500_000n,
    currentSlot: 500_001n, // 1 slot lag
    quoteTimestampMs: 1_700_000_000_000,
    currentTimestampMs: 1_700_000_000_400, // 400ms lag
  });

  assert.equal(freshQuote.isQuoteStale, false, '1 slot lag must not be stale');
  assert.ok(freshQuote.decayBps > 0, 'Decay bps must be non-zero');
  assert.ok(freshQuote.degradedPriceUsd >= freshQuote.initialPriceUsd, 'Buy price degrades adversely');

  // 2. Stale quote beyond 2 slot lag -> stale
  const staleQuote = engine.evaluateQuoteDecay({
    initialPriceUsd: 0.00005,
    quoteSlot: 500_000n,
    currentSlot: 500_004n, // 4 slots lag
    quoteTimestampMs: 1_700_000_000_000,
    currentTimestampMs: 1_700_000_001_800, // 1800ms lag
  });

  assert.equal(staleQuote.isQuoteStale, true, '4 slot / 1800ms lag must be stale');
  assert.ok(staleQuote.decayBps > freshQuote.decayBps);

  // 3. Execution Urgency calculation
  const emergencyUrgency = engine.calculateExecutionUrgency({
    executablePositionValueUsd: 250.0,
    failureHazardRatePerSec: 0.15, // Severe failure hazard
    quoteDecayBps: 180,
    exitReachability: 0.40,
    capitalAuthorityUsd: 5_000.0,
  });

  assert.equal(emergencyUrgency.urgencyLevel, 'EMERGENCY');
  assert.ok(emergencyUrgency.recommendedFeeCapUsd <= 5.0, 'Fee cap must not exceed emergency policy cap');
  assert.ok(emergencyUrgency.recommendedTipLamports >= 10_000_000n);
});

test('Pass 37: End-to-End Decision Kernel Gating in processEvent for Quote Decay & Alpha Burn', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_700_000;
  const canonicalEvent = {
    eventId: 'evt_pass37_decay_001',
    eventType: 'TOKEN_CREATE',
    mint: 'DecayToken11111111111111111111111111111111',
    signature: '5decay_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 37010,
    slot: 490_000,
    parentSlot: 489_999,
    blockhash: 'BhashDecay001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'DECAY',
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

  // Case 1: Stale quote (elapsed slots = 4) triggers CHALLENGED_ABSTAIN
  const staleQuoteContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 60.0,
    marketCapSol: 120.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    elapsedQuoteSlots: 4,
    elapsedQuoteMs: 1800,
  };

  const staleResult = await engine.processEvent(canonicalEvent, staleQuoteContext);
  assert.equal(staleResult.decision, 'CHALLENGED_ABSTAIN', 'Stale quote decay must trigger CHALLENGED_ABSTAIN');
  assert.ok(staleResult.whyExecutionBlocked?.includes('STALE QUOTE DECAY'));
  assert.ok(staleResult.quoteDecay, 'quoteDecay attached');
  assert.equal(staleResult.quoteDecay?.isQuoteStale, true);

  // Case 2: Severe latency burn completely burns edge below hurdle -> CHALLENGED_ABSTAIN
  const severeLatencyBurnContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 60.0,
    marketCapSol: 120.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    elapsedQuoteSlots: 1,
    elapsedQuoteMs: 400,
    initialEdgeBps: 200,
    hurdleBps: 150,
    latencyBreakdown: {
      discoveryMs: 600,
      modelEvaluationMs: 400,
      quoteMs: 300,
      simulationMs: 300,
      signingMs: 200,
      networkTransmissionMs: 700, // Massive latency totaling 2500ms
    },
  };

  const burnResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass37_burn_002', signature: 'sig_burn_002' }, severeLatencyBurnContext);
  assert.equal(burnResult.decision, 'CHALLENGED_ABSTAIN', 'Alpha burned below hurdle must trigger CHALLENGED_ABSTAIN');
  assert.ok(burnResult.whyExecutionBlocked?.includes('LATENCY ALPHA BURNED'));
  assert.ok(burnResult.alphaBurnAudit, 'alphaBurnAudit attached');
  assert.equal(burnResult.alphaBurnAudit?.capturesPositiveEdge, false);

  // Case 3: Fresh, low-latency execution projects full telemetry
  const healthyContext = {
    tokenAgeSec: 25.0,
    txCount: 45,
    liquiditySol: 75.0,
    marketCapSol: 150.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    elapsedQuoteSlots: 1,
    elapsedQuoteMs: 350,
    initialEdgeBps: 550,
    hurdleBps: 80,
    latencyBreakdown: {
      discoveryMs: 25,
      modelEvaluationMs: 20,
      quoteMs: 15,
      simulationMs: 20,
      signingMs: 10,
      networkTransmissionMs: 35,
    },
  };

  const healthyResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass37_healthy_003', signature: 'sig_healthy_003' }, healthyContext);
  assert.ok(healthyResult.alphaHalfLife, 'alphaHalfLife attached');
  assert.ok(healthyResult.quoteDecay, 'quoteDecay attached');
  assert.ok(healthyResult.alphaBurnAudit, 'alphaBurnAudit attached');
  assert.ok(healthyResult.executionUrgency, 'executionUrgency attached');
  assert.equal(healthyResult.alphaBurnAudit?.capturesPositiveEdge, true);
  assert.equal(healthyResult.viewModel.urgencyLevel, healthyResult.executionUrgency?.urgencyLevel);
  assert.ok(healthyResult.viewModel.halfLifeMs > 0);
});

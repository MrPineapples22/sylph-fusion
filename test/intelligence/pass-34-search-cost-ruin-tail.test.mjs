import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 34: Runner Search Cost Engine & Economic Search Viability (Section XXV)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Viable runner search: runner capture exceeds friction and losses
  const viableOutcomes = [
    { candidateId: 'c1', isRunner: false, netRealizedPnLUsd: -95, feesAndFrictionUsd: 2.5 },
    { candidateId: 'c2', isRunner: false, netRealizedPnLUsd: -90, feesAndFrictionUsd: 2.5 },
    { candidateId: 'c3', isRunner: false, netRealizedPnLUsd: -100, feesAndFrictionUsd: 2.5 },
    { candidateId: 'c4', isRunner: true, netRealizedPnLUsd: 950, feesAndFrictionUsd: 4.0 },
  ];

  const viableReport = engine.evaluateRunnerSearchCost(viableOutcomes);
  assert.equal(viableReport.totalCandidatesEvaluated, 4);
  assert.equal(viableReport.runnerCount, 1);
  assert.ok(viableReport.totalRunnerSearchCostUsd > 280, 'Total search cost must include non-runner losses + cumulative friction');
  assert.ok(viableReport.netRunnerContributionUsd > 600, 'Net contribution must be positive');
  assert.equal(viableReport.isSearchEconomicallyViable, true, 'Viable search must be true');

  // 2. Unviable runner search: no runners discovered, high accumulated search cost
  const unviableOutcomes = [
    { candidateId: 'u1', isRunner: false, netRealizedPnLUsd: -95, feesAndFrictionUsd: 3.0 },
    { candidateId: 'u2', isRunner: false, netRealizedPnLUsd: -90, feesAndFrictionUsd: 3.0 },
    { candidateId: 'u3', isRunner: false, netRealizedPnLUsd: -100, feesAndFrictionUsd: 3.0 },
  ];

  const unviableReport = engine.evaluateRunnerSearchCost(unviableOutcomes);
  assert.equal(unviableReport.runnerCount, 0);
  assert.equal(unviableReport.isSearchEconomicallyViable, false, 'Search without runners must be non-viable');
  assert.ok(unviableReport.netRunnerContributionUsd < 0, 'Net contribution must be negative');
});

test('Pass 34: Tail Concentration & Outlier Fragility Engine (Section XXV)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Fragile edge: net PnL is only positive due to a single extreme outlier
  const fragilePnLs = [1200, -85, -90, -80, -95, -70, -85, -90];
  const fragileReport = engine.evaluateTailConcentration(fragilePnLs);
  assert.equal(fragileReport.isTailDependent, true, 'Must detect single winner dependence');
  assert.equal(fragileReport.robustnessClassification, 'TAIL_DEPENDENT_NOT_ROBUST');
  assert.ok(fragileReport.pnlExcludingTop1Usd < 0, 'PnL excluding top 1 must be negative');
  assert.ok(fragileReport.top1ShareOfPositiveGains > 0.90, 'Top 1 must account for over 90% of gains');

  // 2. Robust edge: distributed gains across multiple independent winners
  const robustPnLs = [450, 380, 520, -75, -80, 410, -60, -70, 350];
  const robustReport = engine.evaluateTailConcentration(robustPnLs);
  assert.equal(robustReport.isTailDependent, false, 'Robust edge must not be tail-dependent');
  assert.equal(robustReport.robustnessClassification, 'ROBUST_EDGE');
  assert.ok(robustReport.pnlExcludingTop1Usd > 1000, 'PnL excluding top 1 must remain solidly positive');
});

test('Pass 34: Portfolio Ruin Simulator Engine (Section XXVI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. High-risk scenario: aggressive bankroll erosion leading to non-zero ruin
  const highRiskParams = {
    initialBankrollUsd: 1_000, // Small bankroll ($1000)
    fixedPositionSizeUsd: 250,  // $250 / trade = 4 shots
    maxConcurrentPositions: 4,
    candidateWinRate: 0.015,   // Depressed 1.5% win rate
    averageWinMultiple: 3.0,
    averageLossPct: 0.50,
    landingFailureRate: 0.20,
    totalCandidateStreamCount: 50,
    monteCarloRuns: 60,
  };

  const highRiskRuin = engine.simulatePortfolioRuin(highRiskParams);
  assert.ok(typeof highRiskRuin.probRuin === 'number');
  assert.ok(highRiskRuin.probRuin >= 0.15, 'Small bankroll with 1.5% win rate must yield high ruin probability');
  assert.equal(highRiskRuin.isPortfolioSurvivable, false, 'High ruin probability must fail survivability');

  // 2. Well-capitalized conservative scenario: large bankroll with high survivability
  const conservativeParams = {
    initialBankrollUsd: 25_000,
    fixedPositionSizeUsd: 250,
    maxConcurrentPositions: 5,
    candidateWinRate: 0.0277,
    averageWinMultiple: 6.0,
    averageLossPct: 0.35,
    landingFailureRate: 0.05,
    totalCandidateStreamCount: 100,
    monteCarloRuns: 50,
  };

  const conservativeRuin = engine.simulatePortfolioRuin(conservativeParams);
  assert.equal(conservativeRuin.isPortfolioSurvivable, true, 'Well-capitalized strategy must be survivable');
  assert.ok(conservativeRuin.probRuin <= 0.05, 'Ruin probability must be <= 5%');
});

test('Pass 34: End-to-End Decision Kernel Ruin & Search Cost Gating in processEvent', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_400_000;
  const canonicalEvent = {
    eventId: 'evt_pass34_ruin_001',
    eventType: 'TOKEN_CREATE',
    mint: 'RuinGateToken11111111111111111111111111111',
    signature: '5ruin_gate_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 34010,
    slot: 460_000,
    parentSlot: 459_999,
    blockhash: 'BhashRuinGate001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 25.0,
      priceSol: 0.00005,
      symbol: 'RUINGATE',
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

  // Case 1: Critical ruin risk triggers SAFETY_LOCKED
  const ruinContext = {
    tokenAgeSec: 20.0,
    txCount: 30,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    ruinParameters: {
      initialBankrollUsd: 1_000,
      fixedPositionSizeUsd: 250,
      maxConcurrentPositions: 4,
      candidateWinRate: 0.01,
      averageWinMultiple: 3.0,
      averageLossPct: 0.50,
      landingFailureRate: 0.20,
      totalCandidateStreamCount: 50,
      monteCarloRuns: 50,
    },
  };

  const ruinResult = await engine.processEvent(canonicalEvent, ruinContext);
  assert.equal(ruinResult.decision, 'SAFETY_LOCKED', 'Critical ruin probability must trigger SAFETY_LOCKED');
  assert.ok(ruinResult.whyExecutionBlocked?.includes('PORTFOLIO RUIN PROBABILITY CRITICAL'));

  // Case 2: Healthy execution attaches telemetry to result and viewModel
  const healthyContext = {
    tokenAgeSec: 25.0,
    txCount: 45,
    liquiditySol: 35.0,
    marketCapSol: 65.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    historicalPositionPnLs: [400, 350, 500, -80, -75, 420],
    recentCandidateOutcomes: [
      { candidateId: '1', isRunner: true, netRealizedPnLUsd: 900, feesAndFrictionUsd: 3.0 },
      { candidateId: '2', isRunner: false, netRealizedPnLUsd: -90, feesAndFrictionUsd: 2.5 },
    ],
  };

  const healthyResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass34_healthy_002', signature: 'sig_healthy_002' }, healthyContext);
  assert.ok(healthyResult.runnerSearchCost, 'runnerSearchCost must be present');
  assert.ok(healthyResult.tailConcentration, 'tailConcentration must be present');
  assert.equal(healthyResult.tailConcentration?.robustnessClassification, 'ROBUST_EDGE');
  assert.ok(healthyResult.viewModel.runnerSearchCost, 'runnerSearchCost in viewModel');
  assert.ok(healthyResult.viewModel.tailConcentration, 'tailConcentration in viewModel');
  assert.equal(healthyResult.viewModel.tailRobustness, 'ROBUST_EDGE');
});

/**
 * SYLPH FUSION — PASS 56 VERIFICATION SUITE
 * Capital Tournament & Multi-Horizon Flow Toxicity Integration
 * Specifications: Master Blueprint Sections 23, 24 & Master Blueprint Major Update #4
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CapitalTournamentEngine,
} from '../../dist/intelligence/microstructure/microstructure-x.js';
import {
  FlowToxicityEngine,
} from '../../dist/intelligence/microstructure/flow-toxicity.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 56 Test 1: CapitalTournamentEngine Evaluation & Rank Dynamics (Sections 23, 24)', async () => {
  const mint = 'MintTournamentTest1111111111111111111111111';

  // 1. Dominant Rank: >= 35% share and non-negative momentum
  const dominantStatus = CapitalTournamentEngine.evaluateRank(
    mint,
    42.0, // token volume SOL
    100.0, // total universe volume SOL
    35.0, // previous share % -> momentum = +7%
    120.0,
    60.0
  );
  assert.equal(dominantStatus.mint, mint);
  assert.equal(Math.round(dominantStatus.capitalSharePct), 42);
  assert.equal(Math.round(dominantStatus.capitalShareMomentum), 7);
  assert.equal(dominantStatus.tournamentRank, 'DOMINANT');
  assert.equal(dominantStatus.externalReservoirSol, 120.0);
  assert.equal(dominantStatus.winnerProfitReservoirSol, 60.0);

  // 2. Leader Rank: >= 20% share
  const leaderStatus = CapitalTournamentEngine.evaluateRank(
    mint,
    24.0,
    100.0,
    22.0, // momentum = +2%
    80.0,
    40.0
  );
  assert.equal(Math.round(leaderStatus.capitalSharePct), 24);
  assert.equal(leaderStatus.tournamentRank, 'LEADER');

  // 3. Challenger Rank: >= 10% share
  const challengerStatus = CapitalTournamentEngine.evaluateRank(
    mint,
    14.0,
    100.0,
    13.0,
    50.0,
    25.0
  );
  assert.equal(Math.round(challengerStatus.capitalSharePct), 14);
  assert.equal(challengerStatus.tournamentRank, 'CHALLENGER');

  // 4. Losing Rank: momentum < -3%
  const losingStatus = CapitalTournamentEngine.evaluateRank(
    mint,
    8.0,
    100.0,
    15.0, // momentum = -7%
    30.0,
    10.0
  );
  assert.equal(Math.round(losingStatus.capitalSharePct), 8);
  assert.equal(Math.round(losingStatus.capitalShareMomentum), -7);
  assert.equal(losingStatus.tournamentRank, 'LOSING');

  // 5. Boundary Invariants
  assert.throws(() => {
    CapitalTournamentEngine.evaluateRank(mint, 150.0, 100.0, 10.0, 10.0, 10.0);
  }, /token volume exceeds universe volume/);

  assert.throws(() => {
    CapitalTournamentEngine.evaluateRank('', 10.0, 100.0, 10.0, 10.0, 10.0);
  }, /mint must be nonempty/);
});

test('Pass 56 Test 2: FlowToxicityEngine Multi-Horizon Adverse Selection Evaluation (Master Blueprint Major Update #4)', async () => {
  const engine = new FlowToxicityEngine();
  const now = 1_000_000;

  // Safe organic retail flow: mostly buys with gentle arrival
  const safeTrades = [
    { timestampMs: now - 800, isBuy: true, amountSol: 2.5 },
    { timestampMs: now - 500, isBuy: true, amountSol: 1.0 },
    { timestampMs: now - 200, isBuy: false, amountSol: 0.5 },
  ];

  const safeMetrics = engine.evaluateFlow(safeTrades, now, [250, 1_000, 5_000, 30_000]);
  assert.ok(safeMetrics[250]);
  assert.ok(safeMetrics[1_000]);
  assert.ok(safeMetrics[5_000]);
  assert.ok(safeMetrics[30_000]);

  // In 1000ms window: buy = 3.5, sell = 0.5 -> netFlow = +3.0 -> toxicityScore = 0.0
  assert.equal(safeMetrics[1_000].buyNotionalSol, 3.5);
  assert.equal(safeMetrics[1_000].sellNotionalSol, 0.5);
  assert.equal(safeMetrics[1_000].netFlowSol, 3.0);
  assert.equal(safeMetrics[1_000].toxicityScore, 0.0);

  // Toxic predatory sell flow: heavy selling with high arrival burst
  const toxicTrades = [];
  for (let i = 0; i < 15; i++) {
    toxicTrades.push({
      timestampMs: now - (i * 50),
      isBuy: false,
      amountSol: 3.0,
    });
  }
  toxicTrades.push({ timestampMs: now - 200, isBuy: true, amountSol: 0.5 });

  const toxicMetrics = engine.evaluateFlow(toxicTrades, now, [1_000]);
  assert.ok(toxicMetrics[1_000].tradeArrivalRatePerSec > 10.0);
  assert.ok(toxicMetrics[1_000].sellNotionalSol > 40.0);
  assert.ok(toxicMetrics[1_000].toxicityScore >= 0.70); // extreme adverse selection danger!
});

test('Pass 56 Test 3: MasterIntelligenceEngine Public Helper Methods for Tournament & Toxicity', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  const mint = 'MintPublicHelperTest111111111111111111111111';

  // Capital Tournament helper
  const tourney = engine.evaluateCapitalTournament(
    mint,
    30.0,
    100.0,
    25.0,
    75.0,
    35.0
  );
  assert.equal(tourney.mint, mint);
  assert.equal(Math.round(tourney.capitalSharePct), 30);
  assert.equal(Math.round(tourney.capitalShareMomentum), 5);
  assert.equal(tourney.tournamentRank, 'LEADER');

  // Flow Toxicity helper
  const trades = [
    { timestampMs: 500, isBuy: true, amountSol: 1.0 },
    { timestampMs: 700, isBuy: false, amountSol: 0.8 },
  ];
  const flow = engine.evaluateFlowToxicity(trades, 1000, [1000]);
  assert.ok(flow[1000]);
  assert.equal(flow[1000].buyNotionalSol, 1.0);
  assert.equal(flow[1000].sellNotionalSol, 0.8);
});

test('Pass 56 Test 4: Decision Kernel Fail-Closed Gating Under LOSING Tournament & Toxic Flow', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass56_tourn_gating',
    mint: 'MintTokenTournToxicity561111111111111111111',
    signature: '5sig_pass56_tourn',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51220,
    slot: 593_000,
    parentSlot: 592_999,
    blockhash: 'BhashPass56Tourn',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TOURN56',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const baseWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  const normalContext = {
    tokenAgeSec: 45,
    marketCapSol: 100,
    liquiditySol: 30,
    txCount: 8,
    rawWallets: baseWallets,
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  // Test 4A: Gating under LOSING tournament rank
  const losingTournContext = {
    ...normalContext,
    enforceCapitalTournamentGating: true,
    capitalTournament: {
      mint: baseEvent.mint,
      capitalSharePct: 4.5,
      capitalShareMomentum: -5.5,
      tournamentRank: 'LOSING',
      externalReservoirSol: 10.0,
      winnerProfitReservoirSol: 5.0,
    },
  };

  const losingResult = await engine.processEvent(baseEvent, losingTournContext);
  assert.equal(losingResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(losingResult.whyExecutionBlocked?.includes('CAPITAL TOURNAMENT DEFEAT'));
  assert.ok(losingResult.whyExecutionBlocked?.includes('Rank: LOSING'));

  // Test 4B: Gating under toxic adverse selection flow (>= 70%)
  const toxicFlowContext = {
    ...normalContext,
    enforceFlowToxicityGating: true,
    flowToxicityMetrics: {
      250: { horizonMs: 250, buyNotionalSol: 0.1, sellNotionalSol: 15.0, netFlowSol: -14.9, tradeArrivalRatePerSec: 12.0, toxicityScore: 0.95 },
      1000: { horizonMs: 1000, buyNotionalSol: 0.5, sellNotionalSol: 35.0, netFlowSol: -34.5, tradeArrivalRatePerSec: 8.0, toxicityScore: 0.88 },
    },
  };

  const toxicResult = await engine.processEvent(baseEvent, toxicFlowContext);
  assert.equal(toxicResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(toxicResult.whyExecutionBlocked?.includes('ADVERSE SELECTION FLOW TOXICITY'));
  assert.ok(toxicResult.whyExecutionBlocked?.includes('>= 70%'));
});

test('Pass 56 Test 5: ViewModel Projection and Telemetry Strip Invariants (Sections 23, 24, Major Update #4)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass56_vm_proj',
    mint: 'MintTokenTournVM56111111111111111111111111',
    signature: '5sig_pass56_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51250,
    slot: 593_100,
    parentSlot: 593_099,
    blockhash: 'BhashPass56VM',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TOURNVM56',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const baseWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  const normalContext = {
    tokenAgeSec: 45,
    marketCapSol: 100,
    liquiditySol: 30,
    txCount: 8,
    rawWallets: baseWallets,
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  const result = await engine.processEvent(baseEvent, normalContext);
  assert.ok(result.viewModel);

  const vm = result.viewModel;
  assert.ok(vm.capitalTournament);
  assert.equal(typeof vm.tournamentRank, 'string');
  assert.ok(['DOMINANT', 'LEADER', 'CHALLENGER', 'STABLE', 'LOSING'].includes(vm.tournamentRank));
  assert.equal(typeof vm.capitalSharePct, 'number');
  assert.equal(typeof vm.capitalShareMomentum, 'number');
  assert.ok(vm.flowToxicityMetrics);
  assert.equal(typeof vm.maxFlowToxicity, 'number');
  assert.equal(typeof vm.isFlowToxic, 'boolean');
  assert.equal(typeof vm.isTournamentAdmissible, 'boolean');
});

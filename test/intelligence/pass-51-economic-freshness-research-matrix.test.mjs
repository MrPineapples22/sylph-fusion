/**
 * SYLPH FUSION — PASS 51 VERIFICATION SUITE
 * Economic Freshness Engine (Study EXECUTABLE-PEAK-X, Section VIII)
 * Research Matrix Bridge & 50-Study AutonomousRDGovernorX (Sections XXIX, LIV, LXII)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EconomicFreshnessEngine } from '../../dist/intelligence/executable-alpha/observation/economic-freshness.js';
import { ResearchMatrixBridge, ALL_50_EXECUTABLE_ALPHA_STUDIES } from '../../dist/intelligence/executable-alpha/certification/research-matrix-bridge.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 51: Economic Freshness Engine Trajectory Analysis & Point-in-Time Quote Unavailable Invariant (Section VIII & Study EXECUTABLE-PEAK-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const initialPriceSol = 0.00004;
  const baseTime = 10_000_000;

  // Case 1: Standard trajectory with peak and subsequent 50% retracement
  const ticks = [
    {
      priceSol: 0.00005,
      priceUsd: 0.0075,
      timestampMs: baseTime,
      slot: 100_000n,
      quoteReservesLamports: 30_000_000_000n,
    },
    {
      priceSol: 0.00010, // 2.5x from initial 0.00004
      priceUsd: 0.0150,
      timestampMs: baseTime + 20_000,
      slot: 100_050n,
      quoteReservesLamports: 35_000_000_000n,
    },
    {
      priceSol: 0.000045, // Drops below 50% of peak (0.00010 * 0.5 = 0.00005)
      priceUsd: 0.00675,
      timestampMs: baseTime + 45_000,
      slot: 100_100n,
      quoteReservesLamports: 28_000_000_000n,
    },
  ];

  const analysis = engine.analyzeTrajectoryFreshness(initialPriceSol, ticks);

  assert.equal(analysis.status, 'OBSERVED_ONLY');
  assert.equal(analysis.evidenceClass, 'OBSERVED_PRICE_PATH_ONLY');
  assert.equal(analysis.observedPeakMultiple, 2.5);
  assert.equal(analysis.peakEvidenceSource, 'PRICE_TICK');
  // CRITICAL INSTITUTIONAL INVARIANT: Chart ATH is not an executable sell quote!
  assert.equal(analysis.executablePeakMultiple, null);
  assert.equal(analysis.executablePeakStatus, 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE');
  assert.equal(analysis.timeToPeakSeconds, 20); // 20s from first tick to peak
  assert.equal(analysis.postPeakDrop50Seconds, 25); // 45s - 20s = 25s
  assert.equal(analysis.isOutlierPeak, false);

  // Case 2: Outlier peak (> 1000x)
  const outlierTicks = [
    {
      priceSol: 0.050, // 1250x from 0.00004
      priceUsd: 7.5,
      timestampMs: baseTime,
      slot: 100_000n,
      quoteReservesLamports: 50_000_000_000n,
    },
  ];
  const outlierAnalysis = engine.analyzeTrajectoryFreshness(initialPriceSol, outlierTicks);
  assert.equal(outlierAnalysis.isOutlierPeak, true);
  assert.equal(outlierAnalysis.observedPeakMultiple, 1250);

  // Case 3: Empty observations
  const emptyAnalysis = engine.analyzeTrajectoryFreshness(initialPriceSol, []);
  assert.equal(emptyAnalysis.status, 'NO_OBSERVATIONS');
  assert.equal(emptyAnalysis.observedPeakMultiple, null);
  assert.equal(emptyAnalysis.executablePeakStatus, 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE');
});

test('Pass 51: Research Matrix Bridge Maps ALL 50 Studies to AutonomousRDGovernorX (Sections XXIX, LIV, LXII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Assert exactly 50 studies defined
  assert.equal(ALL_50_EXECUTABLE_ALPHA_STUDIES.length, 50);

  // Assert engine registered all 50 studies
  assert.equal(engine.getRegisteredStudiesCount(), 50);

  const governor = engine.getResearchGovernor();
  assert.ok(governor);

  // Verify sample hypotheses across distinct families
  const peakHyp = governor.getHypothesis('EXECUTABLE-PEAK-X');
  assert.ok(peakHyp);
  assert.equal(peakHyp.state, 'UNTESTED');
  assert.equal(peakHyp.proposerAgentId, 'research-matrix-bridge');
  assert.ok(peakHyp.falsificationCondition.length > 0);

  const selectiveHyp = governor.getHypothesis('SELECTIVE-PREDICTION-X');
  assert.ok(selectiveHyp);
  assert.equal(selectiveHyp.state, 'UNTESTED');

  const ruinHyp = governor.getHypothesis('PORTFOLIO-RUIN-X');
  assert.ok(ruinHyp);
  assert.equal(ruinHyp.state, 'UNTESTED');

  // Verify idempotency (no duplicate registrations)
  const reRegisterCount = ResearchMatrixBridge.registerAllStudies(governor);
  assert.equal(reRegisterCount, 0);
});

test('Pass 51: Master Intelligence Engine Public Helper Methods (Section VIII & XXIX)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const initialPriceSol = 0.00005;
  const analysis = engine.analyzeTrajectoryFreshness(initialPriceSol, [
    {
      priceSol: 0.00005,
      priceUsd: 0.0075,
      timestampMs: 5000,
      slot: 100n,
      quoteReservesLamports: 10_000_000_000n,
    },
  ]);
  assert.equal(analysis.status, 'OBSERVED_ONLY');
  assert.equal(analysis.observedPeakMultiple, 1.0);

  const gov = engine.getResearchGovernor();
  assert.ok(gov);
  assert.equal(engine.getRegisteredStudiesCount(), 50);
});

test('Pass 51: Decision Kernel Fail-Closed Gating Under Economic Freshness Anomaly', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const baseEvent = {
    eventId: 'evt_pass_51_gate_test',
    mint: 'MintPass51GateTest11111111111111111111111111',
    signature: '5sig_pass51_gate',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42010,
    slot: 570_000,
    parentSlot: 570_000 - 1,
    blockhash: 'BhashPass51Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P51GATE',
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

  const baseContext = {
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

  // Case 1: Outlier peak (> 1000x) fails closed
  const outlierResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceEconomicFreshnessGating: true,
    executablePeakAnalysis: {
      status: 'OBSERVED_ONLY',
      evidenceClass: 'OBSERVED_PRICE_PATH_ONLY',
      observedPeakMultiple: 1500,
      peakEvidenceSource: 'PRICE_TICK',
      executablePeakMultiple: null,
      executablePeakStatus: 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE',
      timeToPeakSeconds: 10,
      peakTimestampMs: eventTime,
      quoteReservesLamportsAtObservedPeak: 10_000_000_000n,
      isOutlierPeak: true,
    },
  });

  assert.equal(outlierResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(outlierResult.whyExecutionBlocked.includes('ECONOMIC FRESHNESS ANOMALY'));
  assert.ok(outlierResult.whyExecutionBlocked.includes('OUTLIER_PEAK_EXCEEDED'));

  // Case 2: Flash crash drop (< 15s) fails closed
  const flashCrashResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceEconomicFreshnessGating: true,
    executablePeakAnalysis: {
      status: 'OBSERVED_ONLY',
      evidenceClass: 'OBSERVED_PRICE_PATH_ONLY',
      observedPeakMultiple: 4.0,
      peakEvidenceSource: 'PRICE_TICK',
      executablePeakMultiple: null,
      executablePeakStatus: 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE',
      timeToPeakSeconds: 20,
      postPeakDrop50Seconds: 8, // Dropped 50% in only 8s!
      peakTimestampMs: eventTime,
      quoteReservesLamportsAtObservedPeak: 10_000_000_000n,
      isOutlierPeak: false,
    },
  });

  assert.equal(flashCrashResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(flashCrashResult.whyExecutionBlocked.includes('ECONOMIC FRESHNESS ANOMALY'));
  assert.ok(flashCrashResult.whyExecutionBlocked.includes('FLASH_CRASH_POST_PEAK_8S'));
});

test('Pass 51: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const event = {
    eventId: 'evt_pass_51_vm_test',
    mint: 'MintPass51VmTest111111111111111111111111111',
    signature: '5sig_pass51_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42020,
    slot: 570_010,
    parentSlot: 570_009,
    blockhash: 'BhashPass51Vm',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P51VM',
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

  const result = await engine.processEvent(event, {
    tokenAgeSec: 60,
    marketCapSol: 120,
    liquiditySol: 35,
    txCount: 12,
    rawWallets: defaultWallets,
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 15,
  });

  // Verify MasterPipelineResult fields
  assert.ok(result.executablePeakAnalysis);
  assert.equal(result.registeredStudiesCount, 50);

  // Verify AetherFluxViewModel fields
  const vm = result.viewModel;
  assert.ok(vm.executablePeakAnalysis);
  assert.equal(typeof vm.observedPeakMultiple, 'number');
  assert.equal(typeof vm.timeToPeakSeconds, 'number');
  assert.equal(vm.isOutlierPeak, false);
  assert.equal(vm.registeredStudiesCount, 50);
});

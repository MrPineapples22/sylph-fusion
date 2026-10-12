/**
 * SYLPH FUSION — PASS 50 VERIFICATION SUITE
 * Observability Gap Detector (Study OBSERVABILITY-GAP-X, Section VIII)
 * Informative Censoring & MNAR Engine (Studies INFORMATIVE-CENSORING-X, MNAR-WORST-CASE-X, Section VIII)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservabilityGapEngine } from '../../dist/intelligence/executable-alpha/observation/observability-gap.js';
import { CensoringModelEngine } from '../../dist/intelligence/executable-alpha/observation/censoring-model.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 50: Observability Gap Engine & Continuous Exit Pricing Verification (Section VIII & Study OBSERVABILITY-GAP-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Continuous healthy history (3600s span, 25 observations, max gap 100s <= 120s)
  const baseTime = 1_000_000;
  const continuousTimestamps = [];
  for (let i = 0; i < 25; i++) {
    continuousTimestamps.push(baseTime + (i * 150_000)); // 150s gap, total 3600s
  }
  // Let's create an exact valid continuous history with gaps <= 120s
  const validTimestamps = [];
  for (let i = 0; i < 40; i++) {
    validTimestamps.push(baseTime + (i * 100_000)); // 100s gap, 3900s total span
  }
  const healthyGaps = engine.evaluateObservabilityGaps(validTimestamps);

  assert.equal(healthyGaps.observationCount, 40);
  assert.equal(healthyGaps.totalSpanSeconds, 3900);
  assert.equal(healthyGaps.maxGapSeconds, 100);
  assert.equal(healthyGaps.exitObservabilityAvailable, true);
  assert.equal(healthyGaps.isContinuousHistory, true);
  assert.equal(healthyGaps.isShortHistory, false);
  assert.equal(healthyGaps.reason, undefined);

  // Case 2: Max gap exceeded (> 120s) -> Continuous exit pricing impossible
  const gappedTimestamps = [
    baseTime,
    baseTime + 30_000,
    baseTime + 60_000,
    baseTime + 220_000, // 160s gap!
    baseTime + 250_000,
  ];
  const gappedReport = engine.evaluateObservabilityGaps(gappedTimestamps);

  assert.equal(gappedReport.exitObservabilityAvailable, false);
  assert.equal(gappedReport.maxGapSeconds, 160);
  assert.ok(gappedReport.reason.includes('MAX_GAP_EXCEEDED'));

  // Case 3: Sparse short history (< 5 observations in < 300s)
  const sparseTimestamps = [baseTime, baseTime + 20_000, baseTime + 40_000];
  const sparseReport = engine.evaluateObservabilityGaps(sparseTimestamps);

  assert.equal(sparseReport.isShortHistory, true);
  assert.equal(sparseReport.exitObservabilityAvailable, false);
  assert.ok(sparseReport.reason.includes('SPARSE_SHORT_HISTORY'));

  // Case 4: Insufficient observation count (< 2 timestamps)
  const emptyReport = engine.evaluateObservabilityGaps([baseTime]);
  assert.equal(emptyReport.observationCount, 1);
  assert.equal(emptyReport.exitObservabilityAvailable, false);
  assert.equal(emptyReport.reason, 'INSUFFICIENT_OBSERVATION_COUNT');
});

test('Pass 50: Censoring Model Engine & MNAR Worst-Case Stress Invariants (Section VIII & Studies INFORMATIVE-CENSORING-X, MNAR-WORST-CASE-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const initialPriceSol = 0.00005;
  const currentPriceSol = 0.00010; // 2.0x gain
  const currentTimeMs = 10_000_000;

  // Case 1: Fresh observation (< 180s elapsed) -> Complete history, no haircut
  const freshObs = engine.evaluateCensoringModel({
    lastObservedPriceSol: currentPriceSol,
    initialPriceSol,
    finalTimestampMs: currentTimeMs - 30_000, // 30s ago
    currentTimeMs,
    poolActive: true,
  });

  assert.equal(freshObs.isCensored, false);
  assert.equal(freshObs.censoringType, 'COMPLETE');
  assert.equal(freshObs.lastObservedMultiple, 2.0);
  assert.equal(freshObs.conservativeReturnMultiple, 2.0);
  assert.equal(freshObs.missingExitPenalized, false);

  // Case 2: Degraded observation (elapsed > 180s, <= 900s) -> 50% conservative haircut
  const degradedObs = engine.evaluateCensoringModel({
    lastObservedPriceSol: currentPriceSol,
    initialPriceSol,
    finalTimestampMs: currentTimeMs - 300_000, // 300s / 5m ago
    currentTimeMs,
    poolActive: true,
  });

  assert.equal(degradedObs.isCensored, true);
  assert.equal(degradedObs.censoringType, 'RIGHT_CENSORED');
  assert.equal(degradedObs.lastObservedMultiple, 2.0);
  assert.equal(degradedObs.conservativeReturnMultiple, 1.0); // 2.0 * 0.50
  assert.equal(degradedObs.missingExitPenalized, true);

  // Case 3: Terminal pool collapse (poolActive: false) -> Total loss attribution (-100%)
  const collapsedObs = engine.evaluateCensoringModel({
    lastObservedPriceSol: currentPriceSol,
    initialPriceSol,
    finalTimestampMs: currentTimeMs - 20_000,
    currentTimeMs,
    poolActive: false,
  });

  assert.equal(collapsedObs.isCensored, true);
  assert.equal(collapsedObs.censoringType, 'TERMINAL_COLLAPSE');
  assert.equal(collapsedObs.conservativeReturnMultiple, 0.0);
  assert.equal(collapsedObs.attributedLossPct, 100.0);
  assert.equal(collapsedObs.missingExitPenalized, true);

  // Case 4: Unobserved exit (no observation for > 15m / 900s) -> Total loss attribution
  const unobservedExit = engine.evaluateCensoringModel({
    lastObservedPriceSol: currentPriceSol,
    initialPriceSol,
    finalTimestampMs: currentTimeMs - 1_000_000, // 1000s ago
    currentTimeMs,
    poolActive: true,
  });

  assert.equal(unobservedExit.isCensored, true);
  assert.equal(unobservedExit.censoringType, 'UNOBSERVED_EXIT');
  assert.equal(unobservedExit.conservativeReturnMultiple, 0.0);
  assert.equal(unobservedExit.attributedLossPct, 100.0);
  assert.equal(unobservedExit.missingExitPenalized, true);
});

test('Pass 50: Master Intelligence Engine Public Helper Methods (Section VIII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Direct engine method calls
  const gapReport = engine.evaluateObservabilityGaps([1000, 2000, 3000, 4000, 5000]);
  assert.equal(gapReport.observationCount, 5);
  assert.equal(gapReport.exitObservabilityAvailable, true);

  const censoringReport = engine.evaluateCensoringModel({
    lastObservedPriceSol: 0.00005,
    initialPriceSol: 0.00005,
    finalTimestampMs: 5000,
    currentTimeMs: 5010,
    poolActive: true,
  });
  assert.equal(censoringReport.censoringType, 'COMPLETE');
  assert.equal(censoringReport.isCensored, false);
});

test('Pass 50: Decision Kernel Fail-Closed Gating Under Observability Gaps & Informative Censoring', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const baseEvent = {
    eventId: 'evt_pass_50_gate_test',
    mint: 'MintPass50GateTest11111111111111111111111111',
    signature: '5sig_pass50_gate',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42010,
    slot: 570_000,
    parentSlot: 570_000 - 1,
    blockhash: 'BhashPass50Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P50GATE',
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

  // Case 1: Fail closed when observability gap exists
  const blockedGapResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceObservabilityGapGating: true,
    observabilityGap: {
      totalSpanSeconds: 400,
      observationCount: 3,
      maxGapSeconds: 250,
      averageGapSeconds: 125,
      isShortHistory: false,
      isContinuousHistory: false,
      exitObservabilityAvailable: false,
      reason: 'MAX_GAP_EXCEEDED: Largest gap was 250.0s; continuous exit pricing impossible',
    },
  });

  assert.equal(blockedGapResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(blockedGapResult.whyExecutionBlocked.includes('OBSERVABILITY GAP DETECTED'));

  // Case 2: Fail closed when informative censoring is detected under MNAR worst-case stress
  const blockedCensoringResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceCensoringGating: true,
    censoringAnalysis: {
      isCensored: true,
      censoringType: 'UNOBSERVED_EXIT',
      lastObservedMultiple: 1.5,
      conservativeReturnMultiple: 0.0,
      attributedLossPct: 100.0,
      missingExitPenalized: true,
    },
  });

  assert.equal(blockedCensoringResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(blockedCensoringResult.whyExecutionBlocked.includes('INFORMATIVE CENSORING DETECTED'));
});

test('Pass 50: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const event = {
    eventId: 'evt_pass_50_vm_test',
    mint: 'MintPass50VmTest111111111111111111111111111',
    signature: '5sig_pass50_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42020,
    slot: 570_010,
    parentSlot: 570_009,
    blockhash: 'BhashPass50Vm',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P50VM',
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
  assert.ok(result.observabilityGap);
  assert.equal(result.observabilityGap.observationCount, 3);
  assert.ok(result.censoringAnalysis);
  assert.equal(result.censoringAnalysis.isCensored, false);

  // Verify AetherFluxViewModel fields
  const vm = result.viewModel;
  assert.ok(vm.observabilityGap);
  assert.ok(vm.censoringAnalysis);
  assert.equal(typeof vm.exitObservabilityAvailable, 'boolean');
  assert.equal(typeof vm.maxObservationGapSeconds, 'number');
  assert.equal(typeof vm.isHistoryCensored, 'boolean');
  assert.equal(typeof vm.conservativeReturnMultiple, 'number');
});

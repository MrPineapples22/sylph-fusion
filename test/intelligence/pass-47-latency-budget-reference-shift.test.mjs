import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { LatencyBudgetProfiler } from '../../dist/intelligence/executable-alpha/execution/latency-budget.js';
import { FixedReferenceShiftEngine } from '../../dist/intelligence/executable-alpha/distribution/fixed-reference-shift.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 47: Execution Latency Budget Profiler (Section XVII & Study 36: DECISION-TO-LANDING-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Fast balanced execution trace with landing latency bottleneck
  const t0 = 1_000_000;
  const trace1 = {
    observationAt: t0,
    featuresReadyAt: t0 + 15,
    decisionAt: t0 + 35,
    permitIssuedAt: t0 + 45,
    buildCompletedAt: t0 + 60,
    signedAt: t0 + 75,
    submittedAt: t0 + 80,
    firstProviderAckAt: t0 + 90,
    landedAt: t0 + 180,
    terminalAt: t0 + 220,
  };

  const breakdown1 = LatencyBudgetProfiler.profileTrace(trace1);
  assert.equal(breakdown1.observationLatencyMs, 15);
  assert.equal(breakdown1.featureLatencyMs, 20);
  assert.equal(breakdown1.decisionLatencyMs, 10);
  assert.equal(breakdown1.authorityLatencyMs, 15);
  assert.equal(breakdown1.buildLatencyMs, 15);
  assert.equal(breakdown1.signatureLatencyMs, 5);
  assert.equal(breakdown1.submissionLatencyMs, 10);
  assert.equal(breakdown1.landingLatencyMs, 100);
  assert.equal(breakdown1.terminalityLatencyMs, 40);
  assert.equal(breakdown1.totalDecisionToLandingMs, 145);
  assert.equal(breakdown1.totalEndToEndMs, 220);
  assert.equal(breakdown1.criticalBottleneckStage, 'LANDING');

  // Case 2: Profiling via engine helper method with build/signature friction
  const trace2 = {
    observationAt: t0,
    featuresReadyAt: t0 + 10,
    decisionAt: t0 + 20,
    permitIssuedAt: t0 + 30,
    buildCompletedAt: t0 + 550, // 520ms authority build delay
    signedAt: t0 + 570,
    submittedAt: t0 + 580,
    firstProviderAckAt: t0 + 590,
    landedAt: t0 + 650,
    terminalAt: t0 + 700,
  };

  const breakdown2 = engine.profileExecutionLatencyTrace(trace2);
  assert.equal(breakdown2.authorityLatencyMs, 520);
  assert.equal(breakdown2.criticalBottleneckStage, 'AUTHORITY');
  assert.equal(breakdown2.totalDecisionToLandingMs, 630);
});

test('Pass 47: Fixed Reference Shift Engine (Section XI & Study FIXED-REFERENCE-SHIFT-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Pure SOL multiple with zero FX divergence
  const shiftSolStable = engine.calculateFixedReferenceShift({
    baselinePrice: 0.0001,
    currentPrice: 0.0005,
    currency: 'SOL',
    solPriceUsdAtT0: 150.0,
    solPriceUsdAtT1: 150.0,
  });

  assert.equal(shiftSolStable.isValidBaseline, true);
  assert.equal(shiftSolStable.grossMultiple, 5.0);
  assert.equal(shiftSolStable.solPriceUsdChangePct, 0.0);
  assert.equal(shiftSolStable.currencyDivergenceBps, 0);

  // Case 2: SOL multiple with significant USD price expansion (FX divergence)
  // SOL price rises from $100 to $130 (+30%), creating 3000 bps divergence
  const shiftSolFxSurge = engine.calculateFixedReferenceShift({
    baselinePrice: 0.0002,
    currentPrice: 0.0008,
    currency: 'SOL',
    solPriceUsdAtT0: 100.0,
    solPriceUsdAtT1: 130.0,
  });

  assert.equal(shiftSolFxSurge.isValidBaseline, true);
  assert.equal(shiftSolFxSurge.grossMultiple, 4.0);
  assert.equal(shiftSolFxSurge.solPriceUsdChangePct, 30.0);
  assert.equal(shiftSolFxSurge.currencyDivergenceBps, 3000);

  // Case 3: Invalid baseline inputs (e.g. non-positive or non-finite price)
  const invalidShift = engine.calculateFixedReferenceShift({
    baselinePrice: 0.0,
    currentPrice: 0.0005,
    currency: 'SOL',
  });

  assert.equal(invalidShift.isValidBaseline, false);
  assert.equal(invalidShift.grossMultiple, 1.0);
});

test('Pass 47: Decision Kernel Gating Fail-Closed Under Excessive Latency & FX Divergence', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_100_000;
  const canonicalEvent = {
    eventId: 'evt_pass47_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenLatencyGate111111111111111111111111111',
    signature: '5lat_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 41010,
    slot: 560_000,
    parentSlot: 559_999,
    blockhash: 'BhashPass47Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'LATG',
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

  // Case 1: Healthy execution latency (< 1200ms) and low FX divergence (< 1000 bps)
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
    latencyTrace: {
      observationAt: eventTime - 100,
      featuresReadyAt: eventTime - 70,
      decisionAt: eventTime - 40,
      permitIssuedAt: eventTime - 30,
      buildCompletedAt: eventTime - 20,
      signedAt: eventTime - 10,
      submittedAt: eventTime - 5,
      landedAt: eventTime + 80,
      terminalAt: eventTime + 120,
    },
    solPriceUsdAtT0: 150.0,
    solPriceUsdAtT1: 152.0, // ~133 bps divergence (< 1000 bps)
    enforceLatencyBudgetGating: true,
    enforceReferenceShiftGating: true,
  });

  assert.ok(healthyResult.latencyBreakdown);
  assert.ok(healthyResult.referenceShift);
  assert.ok((healthyResult.latencyBreakdown.totalDecisionToLandingMs ?? 0) < 1200);
  assert.ok(healthyResult.referenceShift.currencyDivergenceBps < 1000);

  // Case 2: Excessive decision-to-landing latency (> 1200ms) -> fail-closed CHALLENGED_ABSTAIN
  const slowResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass47_slow_002', signature: 'sig_slow_002' },
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
      latencyTrace: {
        observationAt: eventTime - 100,
        featuresReadyAt: eventTime - 80,
        decisionAt: eventTime - 50,
        permitIssuedAt: eventTime - 40,
        buildCompletedAt: eventTime - 20,
        signedAt: eventTime - 10,
        submittedAt: eventTime,
        landedAt: eventTime + 1450, // 1500ms decision-to-landing (> 1200ms threshold)
        terminalAt: eventTime + 1600,
      },
      enforceLatencyBudgetGating: true,
    }
  );

  assert.equal(slowResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(slowResult.whyExecutionBlocked?.includes('BLOCKED — EXCESSIVE DECISION-TO-LANDING LATENCY'));

  // Case 3: Excessive FX reference divergence (> 1000 bps) -> fail-closed CHALLENGED_ABSTAIN
  const fxDivergenceResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass47_fx_003', signature: 'sig_fx_003' },
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
      solPriceUsdAtT0: 100.0,
      solPriceUsdAtT1: 125.0, // 2500 bps divergence (> 1000 bps threshold)
      enforceReferenceShiftGating: true,
    }
  );

  assert.equal(fxDivergenceResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(fxDivergenceResult.whyExecutionBlocked?.includes('BLOCKED — CURRENCY REFERENCE DIVERGENCE'));

  // Case 4: Invalid baseline price -> fail-closed CHALLENGED_ABSTAIN
  const invalidBaselineResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass47_inv_004', signature: 'sig_inv_004' },
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
      baselinePrice: -1.0, // Invalid non-positive baseline
      enforceReferenceShiftGating: true,
    }
  );

  assert.equal(invalidBaselineResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(invalidBaselineResult.whyExecutionBlocked?.includes('BLOCKED — CURRENCY REFERENCE DIVERGENCE'));
});

test('Pass 47: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_100_000;
  const canonicalEvent = {
    eventId: 'evt_pass47_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenLatencyTelem11111111111111111111111111',
    signature: '5lat_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 41010,
    slot: 560_000,
    parentSlot: 559_999,
    blockhash: 'BhashPass47Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'LTTM',
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
  assert.ok(vm.latencyBreakdown, 'latencyBreakdown must be projected into ViewModel');
  assert.ok(vm.referenceShift, 'referenceShift must be projected into ViewModel');
  assert.equal(typeof vm.criticalLatencyStage, 'string');
  assert.equal(typeof vm.totalDecisionToLandingMs, 'number');
  assert.equal(typeof vm.currencyDivergenceBps, 'number');
  assert.equal(typeof vm.grossReferenceMultiple, 'number');
  assert.ok(result.latencyBreakdown, 'latencyBreakdown must be returned in MasterPipelineResult');
  assert.ok(result.referenceShift, 'referenceShift must be returned in MasterPipelineResult');
});

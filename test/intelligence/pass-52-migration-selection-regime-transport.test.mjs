/**
 * SYLPH FUSION — PASS 52 VERIFICATION SUITE
 * Migration Selection Engine (Studies: POST-MIGRATION-SELECTION-X, MIGRATION-CAUSAL-EFFECT-X, Section XI)
 * Regime Transport Engine (Studies: REGIME-TRANSPORTABILITY-X, FIXED-REFERENCE-SHIFT-X, Section XI)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MigrationSelectionEngine } from '../../dist/intelligence/executable-alpha/distribution/migration-selection.js';
import { RegimeTransportEngine } from '../../dist/intelligence/executable-alpha/distribution/regime-transport.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 52: Migration Selection Engine Empirical Base Rates & Survivorship Bias Invariant (Section XI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Unconditioned launch population
  const launchAnalysis = MigrationSelectionEngine.evaluateCandidate(false, 35.0);
  assert.equal(launchAnalysis.isMigrated, false);
  assert.equal(launchAnalysis.baseline2xRate, 0.1432); // 14.32% base rate
  assert.equal(launchAnalysis.givebackRate, 0.8036); // 80.36% failure rate
  assert.equal(launchAnalysis.causalEffectValid, true);
  assert.equal(launchAnalysis.survivorshipBiasPenalty, 0.0);
  assert.equal(launchAnalysis.evidenceStatus, 'UNVERIFIED_REFERENCE_PRIOR');
  assert.equal(launchAnalysis.curveProgressPct, 35.0);
  assert.ok(launchAnalysis.reason.includes('Unconditioned launch population'));

  // 2. Post-migration survived population
  const migratedAnalysis = MigrationSelectionEngine.evaluateCandidate(true, 100.0);
  assert.equal(migratedAnalysis.isMigrated, true);
  assert.equal(migratedAnalysis.baseline2xRate, 0.4176); // 41.76% reach >= 2x
  assert.equal(migratedAnalysis.givebackRate, 0.7229); // 72.29% still collapse below start
  // CRITICAL INVARIANT: Cannot project post-migration odds backward onto unbonded launches!
  assert.equal(migratedAnalysis.causalEffectValid, false);
  assert.equal(migratedAnalysis.survivorshipBiasPenalty, 0.35); // 35% discount for conditioning on curve survival
  assert.equal(migratedAnalysis.evidenceStatus, 'UNVERIFIED_REFERENCE_PRIOR');
  assert.equal(migratedAnalysis.curveProgressPct, 100.0);
  assert.ok(migratedAnalysis.reason.includes('Post-migration selected population'));

  // 3. Input validation
  assert.throws(() => MigrationSelectionEngine.evaluateCandidate('invalid', 50), /MIGRATION_STATUS_MUST_BE_BOOLEAN/);
  assert.throws(() => MigrationSelectionEngine.evaluateCandidate(false, -5), /CURVE_PROGRESS_MUST_BE_FINITE_PERCENT/);
  assert.throws(() => MigrationSelectionEngine.evaluateCandidate(false, 105), /CURVE_PROGRESS_MUST_BE_FINITE_PERCENT/);
  assert.throws(() => MigrationSelectionEngine.evaluateCandidate(false, NaN), /CURVE_PROGRESS_MUST_BE_FINITE_PERCENT/);
});

test('Pass 52: Regime Transport Engine Population Separation & Shift Bounds (Section XI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Within-regime transport with nominal shifts -> VALID
  const nominalCert = RegimeTransportEngine.evaluateTransportability(
    'NEW_LAUNCH',
    'NEW_LAUNCH',
    0.15,
    0.10,
    0.05
  );
  assert.equal(nominalCert.transportable, true);
  assert.equal(nominalCert.sourceRegime, 'NEW_LAUNCH');
  assert.equal(nominalCert.targetRegime, 'NEW_LAUNCH');
  assert.equal(nominalCert.covariateShift, 0.15);
  assert.equal(nominalCert.conceptShift, 0.10);
  assert.equal(nominalCert.calibrationShift, 0.05);
  assert.equal(nominalCert.blockers.length, 0);
  assert.equal(nominalCert.certificateDigest.length, 64);

  // 2. Blind pooling of NEW_LAUNCH and POST_MIGRATION is strictly forbidden
  const crossCert1 = RegimeTransportEngine.evaluateTransportability(
    'POST_MIGRATION',
    'NEW_LAUNCH',
    0.10,
    0.05,
    0.02
  );
  assert.equal(crossCert1.transportable, false);
  assert.ok(crossCert1.blockers.some((b) => b.includes('CROSS_POPULATION_SELECTION_BIAS')));

  const crossCert2 = RegimeTransportEngine.evaluateTransportability(
    'NEW_LAUNCH',
    'POST_MIGRATION',
    0.10,
    0.05,
    0.02
  );
  assert.equal(crossCert2.transportable, false);
  assert.ok(crossCert2.blockers.some((b) => b.includes('CROSS_POPULATION_SELECTION_BIAS')));

  // 3. Excessive shift thresholds
  const highCovCert = RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'BONDING_CURVE', 0.45, 0.10, 0.05);
  assert.equal(highCovCert.transportable, false);
  assert.ok(highCovCert.blockers.some((b) => b.includes('COVARIATE_SHIFT_EXCESSIVE')));

  const highConceptCert = RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'BONDING_CURVE', 0.15, 0.40, 0.05);
  assert.equal(highConceptCert.transportable, false);
  assert.ok(highConceptCert.blockers.some((b) => b.includes('CONCEPT_SHIFT_EXCESSIVE')));

  const highCalibCert = RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'BONDING_CURVE', 0.15, 0.10, 0.30);
  assert.equal(highCalibCert.transportable, false);
  assert.ok(highCalibCert.blockers.some((b) => b.includes('CALIBRATION_SHIFT_EXCESSIVE')));

  // 4. Input validation
  assert.throws(() => RegimeTransportEngine.evaluateTransportability('INVALID_REGIME', 'NEW_LAUNCH'), /MARKET_REGIME_INVALID/);
  assert.throws(() => RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'NEW_LAUNCH', -0.1), /COVARIATE_SHIFT_MUST_BE_FINITE_UNIT_INTERVAL/);
  assert.throws(() => RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'NEW_LAUNCH', 0.1, 1.5), /CONCEPT_SHIFT_MUST_BE_FINITE_UNIT_INTERVAL/);
});

test('Pass 52: Master Intelligence Engine Public Helper Methods (Section XI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // evaluateMigrationSelection helper
  const launch = engine.evaluateMigrationSelection(false, 12);
  assert.equal(launch.isMigrated, false);
  assert.equal(launch.survivorshipBiasPenalty, 0.0);

  const migrated = engine.evaluateMigrationSelection(true, 100);
  assert.equal(migrated.isMigrated, true);
  assert.equal(migrated.survivorshipBiasPenalty, 0.35);

  // evaluateRegimeTransport helper
  const transport = engine.evaluateRegimeTransport('BONDING_CURVE', 'BONDING_CURVE', 0.12, 0.08, 0.04);
  assert.equal(transport.transportable, true);
  assert.equal(transport.certificateDigest.length, 64);
  assert.equal(transport.blockers.length, 0);
});

test('Pass 52: Decision Kernel Fail-Closed Gating Under Migration Selection Bias & Transport Blockers', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_500_000;
  const baseEvent = {
    eventId: 'evt_pass_52_gate_test',
    mint: 'MintPass52Gate1111111111111111111111111111',
    signature: '5sig_pass52_gate',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 45010,
    slot: 580_000,
    parentSlot: 580_000 - 1,
    blockhash: 'BhashPass52Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P52GATE',
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

  // Case 1: Migration selection bias gating triggered (migrated candidate without permission)
  const migrationBlockedResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    isMigrated: true,
    enforceMigrationSelectionGating: true,
    allowPostMigrationTrading: false,
  });

  assert.equal(migrationBlockedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(migrationBlockedResult.whyExecutionBlocked.includes('MIGRATION SELECTION BIAS PENALTY'));
  assert.ok(migrationBlockedResult.whyExecutionBlocked.includes('35.0% haircut'));

  // Case 2: Regime transport gating triggered (forbidden cross-population transport)
  const transportBlockedResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    sourceDistributionRegime: 'POST_MIGRATION',
    targetDistributionRegime: 'NEW_LAUNCH',
    enforceRegimeTransportGating: true,
  });

  assert.equal(transportBlockedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(transportBlockedResult.whyExecutionBlocked.includes('REGIME TRANSPORT DISMISSED'));
  assert.ok(transportBlockedResult.whyExecutionBlocked.includes('CROSS_POPULATION_SELECTION_BIAS'));
});

test('Pass 52: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_500_000;
  const event = {
    eventId: 'evt_pass_52_vm_test',
    mint: 'MintPass52VmTest111111111111111111111111111',
    signature: '5sig_pass52_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 45020,
    slot: 580_010,
    parentSlot: 580_009,
    blockhash: 'BhashPass52Vm',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.00004,
      symbol: 'P52VM',
    },
    sourceConfidence: 0.98,
    freshnessMs: 12,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 25,
    marketCapSol: 80,
    liquiditySol: 25,
    txCount: 6,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    ],
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 5,
    isMigrated: false,
    bondingCurvePct: 42,
  };

  const result = await engine.processEvent(event, context);

  // MasterPipelineResult invariants
  assert.ok(result.migrationSelection);
  assert.equal(result.migrationSelection.isMigrated, false);
  assert.equal(result.migrationSelection.survivorshipBiasPenalty, 0.0);
  assert.equal(result.migrationSelection.curveProgressPct, 42);

  assert.ok(result.regimeTransport);
  assert.equal(result.regimeTransport.transportable, true);
  assert.equal(result.regimeTransport.certificateDigest.length, 64);

  // AetherFluxViewModel invariants
  const vm = result.viewModel;
  assert.ok(vm);
  assert.equal(vm.isMigratedCandidate, false);
  assert.equal(vm.survivorshipBiasPenalty, 0.0);
  assert.equal(vm.isRegimeTransportable, true);
  assert.ok(Array.isArray(vm.transportBlockers));
  assert.equal(vm.transportBlockers.length, 0);
  assert.ok(vm.migrationSelection);
  assert.ok(vm.regimeTransport);
});

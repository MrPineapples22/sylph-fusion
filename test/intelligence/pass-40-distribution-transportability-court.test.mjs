import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 40: Transportability Court Adjudication Across Regimes & Covariate Shifts (Section XI & Study Family 4)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Compatible regimes with nominal distribution shifts -> ADMISSIBLE
  const nominalRuling = engine.adjudicateDistributionTransportability({
    sourceRegime: 'NEW_LAUNCH',
    targetRegime: 'NEW_LAUNCH',
    covariateShift: 0.12,
    conceptShift: 0.08,
    calibrationShift: 0.04,
    isPostMigrationSample: false,
    solUsdVolatilityRatio: 1.05,
  });

  assert.equal(nominalRuling.admissible, true, 'Nominal shifts within NEW_LAUNCH must be admissible');
  assert.equal(nominalRuling.certificate.transportable, true);
  assert.equal(nominalRuling.referenceCurrencyStability, 1.0);
  assert.ok(nominalRuling.evidenceRoot.length === 64, 'Evidence root must be 64-char SHA-256 hex string');
  assert.ok(nominalRuling.judicialRationale.includes('Model transport admissible from'));
  assert.equal(nominalRuling.migrationSurvivorshipHaircut, 0.0);

  // 2. Forbidden population crossover (POST_MIGRATION -> NEW_LAUNCH) -> DISMISSED
  const crossPopulationRuling = engine.adjudicateDistributionTransportability({
    sourceRegime: 'POST_MIGRATION',
    targetRegime: 'NEW_LAUNCH',
    covariateShift: 0.12,
    conceptShift: 0.08,
    calibrationShift: 0.04,
  });

  assert.equal(crossPopulationRuling.admissible, false);
  assert.ok(crossPopulationRuling.certificate.blockers.some((b) => b.includes('CROSS_POPULATION_SELECTION_BIAS')));

  // 3. Excessive covariate shift (> 0.40) -> DISMISSED
  const excessiveShiftRuling = engine.adjudicateDistributionTransportability({
    sourceRegime: 'NEW_LAUNCH',
    targetRegime: 'BONDING_CURVE',
    covariateShift: 0.45,
    conceptShift: 0.10,
    calibrationShift: 0.05,
  });

  assert.equal(excessiveShiftRuling.admissible, false);
  assert.ok(excessiveShiftRuling.certificate.blockers.some((b) => b.includes('COVARIATE_SHIFT_EXCESSIVE')));
});

test('Pass 40: Post-Migration Conditioning & FX Reference Stability Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Post-migration sample conditioned in NEW_LAUNCH target -> MIGRATION_SELECTION_VIOLATION
  const migrationViolatingRuling = engine.adjudicateDistributionTransportability({
    sourceRegime: 'NEW_LAUNCH',
    targetRegime: 'NEW_LAUNCH',
    isPostMigrationSample: true,
  });

  assert.equal(migrationViolatingRuling.admissible, false);
  assert.ok(migrationViolatingRuling.judicialRationale.includes('MIGRATION_SELECTION_VIOLATION'));
  assert.ok(migrationViolatingRuling.migrationSurvivorshipHaircut > 0);

  // 2. High SOL/USD divergence ratio (> 1500 bps) -> REFERENCE_SHIFT_UNSTABLE
  const fxDivergentRuling = engine.adjudicateDistributionTransportability({
    sourceRegime: 'NEW_LAUNCH',
    targetRegime: 'NEW_LAUNCH',
    solUsdVolatilityRatio: 1.25, // 25% divergence (>1500 bps)
  });

  assert.equal(fxDivergentRuling.admissible, false);
  assert.equal(fxDivergentRuling.referenceCurrencyStability, 0.65, 'High currency divergence must haircut stability to 0.65');
  assert.ok(fxDivergentRuling.judicialRationale.includes('REFERENCE_SHIFT_UNSTABLE'));
});

test('Pass 40: Decision Kernel Gating & Fail-Closed Protection Under Distribution Inadmissibility', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass40_transport_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenTransportGate111111111111111111111111',
    signature: '5transport_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass40Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'XPORT',
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

  // Case 1: Admissible distribution conditions -> normal evaluation
  const admissibleResult = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
    enforceTransportabilityGating: true,
  });

  assert.ok(admissibleResult.transportabilityRuling);
  assert.equal(admissibleResult.transportabilityRuling.admissible, true);
  assert.equal(admissibleResult.viewModel.isDistributionAdmissible, true);

  // Case 2: Inadmissible distribution (post-migration conditioning in NEW_LAUNCH) -> fail-closed CHALLENGED_ABSTAIN
  const rejectedResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass40_rejected_002', signature: 'sig_rejected_002' },
    {
      tokenAgeSec: 25.0,
      marketCapSol: 130.0,
      liquiditySol: 65.0,
      txCount: 40,
      rawWallets: defaultWallets,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 10,
      isPostMigrationSample: true, // triggers MIGRATION_SELECTION_VIOLATION
      targetDistributionRegime: 'NEW_LAUNCH',
      enforceTransportabilityGating: true,
    }
  );

  assert.equal(rejectedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(rejectedResult.whyExecutionBlocked?.includes('BLOCKED — DISTRIBUTION TRANSPORTABILITY REJECTED'));
  assert.equal(rejectedResult.transportabilityRuling?.admissible, false);
  assert.equal(rejectedResult.viewModel.isDistributionAdmissible, false);
});

test('Pass 40: ViewModel and Telemetry Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_800_000;
  const canonicalEvent = {
    eventId: 'evt_pass40_telemetry_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenTransportTelem1111111111111111111111',
    signature: '5xport_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 38010,
    slot: 510_000,
    parentSlot: 509_999,
    blockhash: 'BhashPass40Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'XPORT',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const defaultWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
  ];

  const result = await engine.processEvent(canonicalEvent, {
    tokenAgeSec: 25.0,
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 15,
  });

  const vm = result.viewModel;
  assert.ok(vm.transportabilityRuling, 'transportabilityRuling must be on viewModel');
  assert.equal(typeof vm.isDistributionAdmissible, 'boolean');
  assert.ok(Number.isFinite(vm.migrationSurvivorshipHaircut));
  assert.ok(Number.isFinite(vm.referenceCurrencyStability));
  assert.equal(vm.isDistributionAdmissible, vm.transportabilityRuling.admissible);
  assert.equal(vm.migrationSurvivorshipHaircut, vm.transportabilityRuling.migrationSurvivorshipHaircut);
  assert.equal(vm.referenceCurrencyStability, vm.transportabilityRuling.referenceCurrencyStability);
});

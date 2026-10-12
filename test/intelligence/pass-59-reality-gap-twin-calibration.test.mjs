/**
 * SYLPH FUSION — PASS 59 VERIFICATION SUITE
 * Reality-Gap-X Digital Twin Calibration & Adversarial Red Team Integration
 * Specifications: Master Blueprint Section XVII (Reality Residuals), Section XVIII (Twin Trust Constraints),
 * Section 53 (Twin Red Team Adversarial Exploitation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certifyTwinCalibration,
  evaluateDownstreamConstraints,
  TwinRedTeamEngine,
} from '../../dist/intelligence/reality-gap/index.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 59 Test 1: certifyTwinCalibration Deterministic SHA-256 Certificate Issuance & Residual Sorting (Section XVII)', async () => {
  const venue = 'PUMP_AMM';

  // 1. Less than 10 samples produces CALIBRATING certificate
  const fewResiduals = [
    {
      predictionId: 'pred_1',
      mint: 'Mint111111111111111111111111111111111111111',
      targetSlot: 100n,
      landedSlot: 101n,
      priceResidualBps: 15,
      liquidityResidualSol: 0.1,
      routeResidual: 0,
      landingResidualSlots: 1,
      feeResidualLamports: 5000n,
      cuResidualUnits: 10000,
      clearanceResidualSec: 0.4,
      exitCapacityResidualSol: 0.2,
      evaluatedAtMs: Date.now(),
    },
  ];

  const certCalibrating = certifyTwinCalibration({ venue, residuals: fewResiduals });
  assert.equal(certCalibrating.sampleCount, 1);
  assert.equal(certCalibrating.trustLevel, 'CALIBRATING');
  assert.equal(certCalibrating.isCalibrationActive, false);
  assert.equal(certCalibrating.constraints.newExposurePermitted, false);
  assert.ok(certCalibrating.certificateId.startsWith('tcc_'));
  assert.equal(certCalibrating.certificateHash.length, 64);

  // 2. 10 well-calibrated samples produces SHADOW_TRUSTED
  const trustedResiduals = Array.from({ length: 12 }, (_, i) => ({
    predictionId: `pred_trusted_${i}`,
    mint: 'MintTrusted11111111111111111111111111111111',
    targetSlot: BigInt(200 + i),
    landedSlot: BigInt(200 + i + 1),
    priceResidualBps: 20 + (i % 5) * 5, // 20 - 40 bps
    liquidityResidualSol: 0.05,
    routeResidual: 0,
    landingResidualSlots: 1,
    feeResidualLamports: 4000n,
    cuResidualUnits: 9000,
    clearanceResidualSec: 0.3,
    exitCapacityResidualSol: 0.1,
    evaluatedAtMs: Date.now() - i * 1000,
  }));

  const certTrusted = certifyTwinCalibration({ venue, residuals: trustedResiduals });
  assert.equal(certTrusted.sampleCount, 12);
  assert.equal(certTrusted.trustLevel, 'SHADOW_TRUSTED');
  assert.equal(certTrusted.isCalibrationActive, true);
  assert.equal(certTrusted.constraints.newExposurePermitted, true);
  assert.equal(certTrusted.constraints.allocationMultiplier, 1.0);
  assert.ok(certTrusted.p95PriceResidualBps <= 200);

  // 3. Degraded samples (extreme price residual > 400 bps or lag > 3 slots)
  const degradedResiduals = Array.from({ length: 12 }, (_, i) => ({
    predictionId: `pred_degraded_${i}`,
    mint: 'MintDegraded1111111111111111111111111111111',
    targetSlot: BigInt(300 + i),
    landedSlot: BigInt(300 + i + 4),
    priceResidualBps: 450, // Severe pricing error
    liquidityResidualSol: -2.0,
    routeResidual: 1,
    landingResidualSlots: 4, // 4 slots lag
    feeResidualLamports: 25000n,
    cuResidualUnits: 45000,
    clearanceResidualSec: 1.8,
    exitCapacityResidualSol: -1.5,
    evaluatedAtMs: Date.now() - i * 1000,
  }));

  const certDegraded = certifyTwinCalibration({ venue, residuals: degradedResiduals });
  assert.equal(certDegraded.trustLevel, 'DEGRADED');
  assert.equal(certDegraded.constraints.allocationMultiplier, 0.40);
  assert.equal(certDegraded.constraints.costUncertaintyMultiplier, 2.0);
  assert.equal(certDegraded.constraints.maxPermitTtlSlots, 40);
});

test('Pass 59 Test 2: DownstreamTwinConstraints Dynamic Risk Adjustments (Section XVIII)', async () => {
  // Invariant verification across all 6 trust states
  const trusted = evaluateDownstreamConstraints('SHADOW_TRUSTED');
  assert.equal(trusted.allocationMultiplier, 1.0);
  assert.equal(trusted.costUncertaintyMultiplier, 1.0);
  assert.equal(trusted.maxPermitTtlSlots, 150);
  assert.equal(trusted.newExposurePermitted, true);

  const watch = evaluateDownstreamConstraints('WATCH');
  assert.equal(watch.allocationMultiplier, 0.75);
  assert.equal(watch.costUncertaintyMultiplier, 1.25);
  assert.equal(watch.maxPermitTtlSlots, 100);
  assert.equal(watch.newExposurePermitted, true);

  const degraded = evaluateDownstreamConstraints('DEGRADED');
  assert.equal(degraded.allocationMultiplier, 0.40);
  assert.equal(degraded.costUncertaintyMultiplier, 2.0);
  assert.equal(degraded.maxPermitTtlSlots, 40);
  assert.equal(degraded.newExposurePermitted, true);

  const calibrating = evaluateDownstreamConstraints('CALIBRATING');
  assert.equal(calibrating.allocationMultiplier, 0.0);
  assert.equal(calibrating.costUncertaintyMultiplier, 3.0);
  assert.equal(calibrating.maxPermitTtlSlots, 0);
  assert.equal(calibrating.newExposurePermitted, false);

  const quarantined = evaluateDownstreamConstraints('QUARANTINED');
  assert.equal(quarantined.allocationMultiplier, 0.0);
  assert.equal(quarantined.costUncertaintyMultiplier, 5.0);
  assert.equal(quarantined.maxPermitTtlSlots, 0);
  assert.equal(quarantined.newExposurePermitted, false);
});

test('Pass 59 Test 3: TwinRedTeamEngine Adversarial Exploit Discovery (Section 53)', async () => {
  const redTeam = new TwinRedTeamEngine();

  // 1. FATAL_BLINDNESS Exploit: Twin predicted safe, reality suffered liquidity collapse
  const pred1 = {
    scenarioId: 'scen_01',
    predictedNetReturnBps: 150,
    predictedSurvivalProbability: 0.95,
    predictedExitCostBps: 30,
    twinAssessedSafe: true,
  };
  const reality1 = {
    scenarioId: 'scen_01',
    actualNetReturnBps: -5000,
    actualSurvival: false,
    actualExitCostBps: 2500,
    liquidityCollapsed: true,
    routeFractured: true,
  };

  const report1 = redTeam.evaluateScenario(pred1, reality1);
  assert.equal(report1.exploitDiscovered, true);
  assert.equal(report1.severity, 'CATASTROPHIC');
  assert.equal(report1.trustPenaltyPoints, 50);
  assert.ok(report1.explanation?.includes('FATAL_BLINDNESS'));

  // Cumulative penalty is now 50 -> effective trust level is QUARANTINED!
  assert.equal(redTeam.getEffectiveTrustLevel(), 'QUARANTINED');

  // 2. PROFIT_MIRAGE Exploit
  const redTeam2 = new TwinRedTeamEngine();
  const pred2 = {
    scenarioId: 'scen_02',
    predictedNetReturnBps: 80,
    predictedSurvivalProbability: 0.90,
    predictedExitCostBps: 25,
    twinAssessedSafe: true,
  };
  const reality2 = {
    scenarioId: 'scen_02',
    actualNetReturnBps: -350, // Severely negative
    actualSurvival: true,
    actualExitCostBps: 50,
    liquidityCollapsed: false,
    routeFractured: false,
  };

  const report2 = redTeam2.evaluateScenario(pred2, reality2);
  assert.equal(report2.exploitDiscovered, true);
  assert.equal(report2.severity, 'HIGH');
  assert.equal(report2.trustPenaltyPoints, 25);
  assert.ok(report2.explanation?.includes('PROFIT_MIRAGE'));
  assert.equal(redTeam2.getEffectiveTrustLevel(), 'DEGRADED');

  // 3. SLIPPAGE_EXPLOSION Exploit
  const redTeam3 = new TwinRedTeamEngine();
  const pred3 = {
    scenarioId: 'scen_03',
    predictedNetReturnBps: 50,
    predictedSurvivalProbability: 0.85,
    predictedExitCostBps: 20,
    twinAssessedSafe: true,
  };
  const reality3 = {
    scenarioId: 'scen_03',
    actualNetReturnBps: 10,
    actualSurvival: true,
    actualExitCostBps: 120, // > 3x predicted
    liquidityCollapsed: false,
    routeFractured: false,
  };

  const report3 = redTeam3.evaluateScenario(pred3, reality3);
  assert.equal(report3.exploitDiscovered, true);
  assert.equal(report3.severity, 'MEDIUM');
  assert.equal(report3.trustPenaltyPoints, 15);
  assert.ok(report3.explanation?.includes('SLIPPAGE_EXPLOSION'));
  assert.equal(redTeam3.getEffectiveTrustLevel(), 'WATCH');
});

test('Pass 59 Test 4: Master Orchestrator Decision Kernel Fail-Closed Gating Under QUARANTINED Twin Trust', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintTwinTrustGating111111111111111111111111';
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass59_gating_01',
    eventType: 'TRADE',
    mint,
    signature: '5sig_pass59_gating',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51330,
    slot: 593_700,
    parentSlot: 593_699,
    blockhash: 'BhashPass59Gating',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'TWIN59',
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

  // 1. Quarantined twin calibration blocks exposure
  const quarantinedCert = {
    certificateId: 'tcc_quarantined_99',
    venue: 'PUMP_AMM',
    sampleCount: 15,
    medianPriceResidualBps: 800,
    p95PriceResidualBps: 1200,
    medianLandingLagSlots: 5,
    trustLevel: 'QUARANTINED',
    constraints: evaluateDownstreamConstraints('QUARANTINED'),
    isCalibrationActive: false,
    certificateHash: '0000000000000000000000000000000000000000000000000000000000000000',
    issuedAtMs: Date.now(),
  };

  const contextQuarantined = {
    ...normalContext,
    enforceTwinTrustGating: true,
    twinCalibration: quarantinedCert,
    twinConstraints: quarantinedCert.constraints,
  };

  const resultQuarantined = await engine.processEvent(baseEvent, contextQuarantined);
  assert.equal(resultQuarantined.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(resultQuarantined.whyExecutionBlocked?.includes('BLOCKED — TWIN TRUST RESTRICTION'));
  assert.ok(resultQuarantined.whyExecutionBlocked?.includes('Level: QUARANTINED'));

  // 2. Trusted twin calibration does NOT block exposure
  const trustedCert = certifyTwinCalibration({
    venue: 'PUMP_AMM',
    residuals: Array.from({ length: 12 }, (_, i) => ({
      predictionId: `p_${i}`,
      mint,
      targetSlot: BigInt(100 + i),
      landedSlot: BigInt(101 + i),
      priceResidualBps: 15,
      liquidityResidualSol: 0.1,
      routeResidual: 0,
      landingResidualSlots: 1,
      feeResidualLamports: 4000n,
      cuResidualUnits: 9000,
      clearanceResidualSec: 0.3,
      exitCapacityResidualSol: 0.1,
      evaluatedAtMs: Date.now(),
    })),
  });
  assert.equal(trustedCert.trustLevel, 'SHADOW_TRUSTED');

  const contextTrusted = {
    ...normalContext,
    enforceTwinTrustGating: true,
    twinCalibration: trustedCert,
    twinConstraints: trustedCert.constraints,
  };

  const resultTrusted = await engine.processEvent(baseEvent, contextTrusted);
  assert.notEqual(resultTrusted.whyExecutionBlocked?.includes('TWIN TRUST RESTRICTION'), true);
});

test('Pass 59 Test 5: ViewModel Projection and Telemetry Strip Invariants (Sections XVII, XVIII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintViewModelTwin59111111111111111111111111';
  const now = Date.now();
  const event = {
    eventId: 'evt_pass59_vm_01',
    eventType: 'TRADE',
    mint,
    slot: 140_000,
    sourceTimestampMs: now - 500,
    receivedTimestampMs: now - 490,
    payload: {
      amountSol: 1.0,
      isBuy: true,
    },
  };

  const context = {
    tokenAgeSec: 60,
    liquiditySol: 40.0,
    marketCapSol: 150.0,
    txCount: 80,
    programOwner: 'owner_vm_twin',
    rawWallets: [],
  };

  const result = await engine.processEvent(event, context);
  const vm = result.viewModel;

  // Assert presence and consistency of Reality-Gap-X telemetry fields
  assert.ok(vm.twinCalibration);
  assert.ok(vm.twinTrustLevel);
  assert.equal(vm.twinTrustLevel, vm.twinCalibration.trustLevel);
  assert.ok(vm.twinConstraints);
  assert.equal(vm.twinConstraints.newExposurePermitted, true);
  assert.ok(vm.medianPriceResidualBps !== undefined);
  assert.ok(vm.medianLandingLagSlots !== undefined);
  assert.ok(vm.twinCalibration.certificateId.startsWith('tcc_'));
  assert.equal(vm.twinCalibration.certificateHash.length, 64);
  assert.ok(vm.twinCalibration.sampleCount >= 10);
});

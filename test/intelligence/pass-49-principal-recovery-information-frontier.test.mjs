/**
 * SYLPH FUSION — PASS 49 VERIFICATION SUITE
 * Principal Recovery (Study 41: RUNNER-HOLD-vs-RECOVERY-X, Section XXXVIII)
 * Information Frontier & T* (Study EARLIEST-INFORMATION-TIME-X, Section IX)
 * Value of Sensor Engine & IPC (Study VALUE-OF-SENSOR-X, Section IX)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrincipalRecoveryEngine } from '../../dist/intelligence/executable-alpha/exit/principal-recovery.js';
import { InformationFrontierEngine } from '../../dist/intelligence/executable-alpha/information/information-frontier.js';
import { SensorValueEngine } from '../../dist/intelligence/executable-alpha/information/sensor-value.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 49: Principal Recovery Engine & Stressed Exit Proceeds (Section XXXVIII & Study 41)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Healthy 2x recovery with low slippage
  // Principal $250, fees $2.50 -> required $252.50. Position worth $600 with $20 exit costs -> net $580.
  // Recovery fraction: 252.50 / 580 = 43.53% (Never blindly 50%!)
  const healthyRecovery = engine.calculatePrincipalRecovery({
    principalInvestedUsd: 250.0,
    entryFeesPaidUsd: 2.50,
    desiredLockedProfitUsd: 0.0,
    executablePositionValueUsd: 600.0,
    projectedExitCostsUsd: 20.0,
  });

  assert.equal(healthyRecovery.requiredProceedsUsd, 252.50);
  assert.equal(healthyRecovery.executableNetValueUsd, 580.0);
  assert.ok(healthyRecovery.isPrincipalRecoverable);
  assert.ok(Math.abs(healthyRecovery.optimalRecoveryFraction - 0.4353) < 0.001);
  assert.equal(healthyRecovery.remainingPositionValueUsd, 327.50);

  // Case 2: Stressed illiquid exit where net value < required proceeds
  // Principal $250, fees $5 -> required $255. Mark is $300 but slippage is $80 -> net $220.
  const stressedUnrecoverable = engine.calculatePrincipalRecovery({
    principalInvestedUsd: 250.0,
    entryFeesPaidUsd: 5.0,
    desiredLockedProfitUsd: 0.0,
    executablePositionValueUsd: 300.0,
    projectedExitCostsUsd: 80.0,
  });

  assert.equal(stressedUnrecoverable.isPrincipalRecoverable, false);
  assert.equal(stressedUnrecoverable.optimalRecoveryFraction, 1.0);
  assert.equal(stressedUnrecoverable.remainingPositionValueUsd, 0.0);

  // Case 3: Policy factory check
  const recoveryPolicy = PrincipalRecoveryEngine.createPolicy(2.0, 0.10); // 2x target + 10% profit
  assert.equal(recoveryPolicy.policyId, 'principal-recovery-2x');

  const mockPosition = {
    currentMultiple: 2.5,
    principalInvestedUsd: 250.0,
    entryFeesPaidUsd: 2.50,
  };
  const mockLiquidation = {
    currentMarkUsd: 625.0,
    projectedFeesUsd: 5.0,
    ownImpactUsd: 15.0,
  };

  const proposal = recoveryPolicy.evaluate(mockPosition, {}, mockLiquidation);
  assert.equal(proposal.action, 'RECOVER_PRINCIPAL');
  assert.equal(proposal.expectedProceedsUsd, 277.50); // 250 + 2.50 + 25
  assert.ok(proposal.targetFraction > 0.40 && proposal.targetFraction < 0.50);
});

test('Pass 49: Information Frontier Engine & T* Earliest Decision Time (Section IX & Study EARLIEST-INFORMATION-TIME-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Early arrival (elapsed 5s, only 2 observations) -> Incomplete mutual information
  const earlyFrontier = engine.evaluateInformationFrontier({
    elapsedSeconds: 5.0,
    observationsCount: 2,
    featureCount: 15,
    targetMultiple: 10.0,
  });

  assert.equal(earlyFrontier.isSufficient, false);
  assert.ok(earlyFrontier.mutualInformationNats < earlyFrontier.minRequiredNats);
  assert.ok(earlyFrontier.reason.includes('ABSTAIN_INFORMATION_INSUFFICIENT'));
  assert.ok(earlyFrontier.earliestDecisionTimeSeconds > 5.0);

  // Case 2: Mature curve with sufficient observations and time
  const matureFrontier = engine.evaluateInformationFrontier({
    elapsedSeconds: 65.0,
    observationsCount: 25,
    featureCount: 15,
    targetMultiple: 10.0,
  });

  assert.equal(matureFrontier.isSufficient, true);
  assert.ok(matureFrontier.mutualInformationNats >= matureFrontier.minRequiredNats);
  assert.equal(matureFrontier.reason, undefined);
  assert.ok(matureFrontier.informationVelocity > 0);
  assert.ok(matureFrontier.informationAcceleration < 0); // Decay curvature
});

test('Pass 49: Value of Sensor Engine & Information-Per-Cost Optimization (Section IX & Study VALUE-OF-SENSOR-X)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Zero information deficit -> Tier 0 local cache sufficient
  const zeroDeficit = engine.evaluateSensorEscalation({
    currentInformationNats: 0.50,
    requiredInformationNats: 0.45,
    tradeSizeUsd: 250.0,
  });

  assert.equal(zeroDeficit.recommendedTier, 0);
  assert.equal(zeroDeficit.escalate, false);
  assert.ok(zeroDeficit.rationale.includes('Information already sufficient'));

  // Case 2: Moderate deficit (0.20 nats deficit) -> Tier 1 public stream or Tier 2 Geyser
  const moderateDeficit = engine.evaluateSensorEscalation({
    currentInformationNats: 0.25,
    requiredInformationNats: 0.45,
    tradeSizeUsd: 250.0,
  });

  assert.ok(moderateDeficit.recommendedTier >= 1);
  assert.equal(moderateDeficit.escalate, true);
  assert.ok(Number.isFinite(moderateDeficit.informationPerCost));
  assert.ok(moderateDeficit.rationale.includes('Escalate to Tier'));

  // Case 3: Prohibitive cost exceeding 0.05% trade capacity limit
  const expensiveDecision = SensorValueEngine.evaluateTier(0.05, 0.70, 10.0);
  assert.ok(expensiveDecision.recommendedTier >= 3);
});

test('Pass 49: Decision Kernel Gating Under Insufficient Information Frontier & Stressed Recovery', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const baseEvent = {
    eventId: 'evt_pass_49_test',
    mint: 'MintPass49Test11111111111111111111111111111',
    signature: '5sig_pass49_gate',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42010,
    slot: 570_000,
    parentSlot: 569_999,
    blockhash: 'BhashPass49Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P49',
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

  const baseContext = {
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    tokenAgeSec: 35.0,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  // Case 1: Fail closed when information frontier is insufficient
  const blockedFrontierResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceInformationFrontierGating: true,
    informationFrontier: {
      mutualInformationNats: 0.12,
      minRequiredNats: 0.45,
      informationVelocity: 0.002,
      informationAcceleration: -0.0001,
      earliestDecisionTimeSeconds: 45.0,
      currentElapsedSeconds: 15.0,
      isSufficient: false,
      reason: 'ABSTAIN_INFORMATION_INSUFFICIENT: I(t)=0.12 < I_min=0.45 or elapsed=15.0s < T*=45.0s',
    },
  });

  assert.equal(blockedFrontierResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(blockedFrontierResult.whyExecutionBlocked.includes('INSUFFICIENT INFORMATION FRONTIER'));

  // Case 2: Fail closed when principal is unrecoverable at 2x multiple under stressed exit
  const blockedRecoveryResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    currentMultiple: 2.2,
    enforcePrincipalRecoveryGating: true,
    principalRecovery: {
      requiredProceedsUsd: 252.50,
      executableNetValueUsd: 140.0,
      optimalRecoveryFraction: 1.0,
      isPrincipalRecoverable: false,
      remainingPositionValueUsd: 0.0,
    },
  });

  assert.equal(blockedRecoveryResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(blockedRecoveryResult.whyExecutionBlocked.includes('PRINCIPAL UNRECOVERABLE UNDER STRESSED EXIT'));
});

test('Pass 49: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const event = {
    eventId: 'evt_pass_49_vm_test',
    mint: 'MintPass49VmTest111111111111111111111111111',
    signature: '5sig_pass49_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42020,
    slot: 570_010,
    parentSlot: 570_009,
    blockhash: 'BhashPass49Vm',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P49VM',
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

  const context = {
    marketCapSol: 130.0,
    liquiditySol: 65.0,
    txCount: 40,
    tokenAgeSec: 45.0,
    rawWallets: defaultWallets,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  const result = await engine.processEvent(event, context);
  const vm = result.viewModel;

  // Verify Pass 49 properties on ViewModel
  assert.ok(vm.principalRecovery !== undefined);
  assert.ok(vm.informationFrontier !== undefined);
  assert.ok(vm.sensorDecision !== undefined);
  assert.ok(typeof vm.isPrincipalRecoverable === 'boolean');
  assert.ok(typeof vm.optimalRecoveryFraction === 'number');
  assert.ok(typeof vm.isInformationFrontierSufficient === 'boolean');
  assert.ok(typeof vm.earliestDecisionTimeSeconds === 'number');
  assert.ok(typeof vm.recommendedSensorTier === 'number');

  // Verify MasterPipelineResult properties
  assert.ok(result.principalRecovery !== undefined);
  assert.ok(result.informationFrontier !== undefined);
  assert.ok(result.sensorDecision !== undefined);
});

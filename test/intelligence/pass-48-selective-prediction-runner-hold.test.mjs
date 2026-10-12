import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { SelectivePredictionEngine } from '../../dist/intelligence/executable-alpha/information/selective-prediction.js';
import { InformationVelocityEngine } from '../../dist/intelligence/executable-alpha/information/information-velocity.js';
import { RunnerHoldManager } from '../../dist/intelligence/executable-alpha/exit/runner-hold.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 48: Selective Prediction & Split-Conformal Coverage Engine (Sections IX, XXVII & Study 11)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: High conviction unambiguous winner profile -> ENTER
  const enterResult = engine.evaluateSelectivePrediction({
    predictedMultiple: 6.5,
    uncertaintyWidth: 0.12,
    authenticityScore: 0.92,
    reachabilityScore: 0.88,
  });

  assert.equal(enterResult.decision, 'ENTER');
  assert.ok(enterResult.confidenceScore >= 0.72);
  assert.ok(enterResult.nonconformityScore <= 0.35);
  assert.ok(enterResult.predictionSet.includes('WINNER_10X'));
  assert.ok(!enterResult.predictionSet.includes('COLLAPSE_RUG'));
  assert.equal(enterResult.selectiveRiskEstimate, 0.12);

  // Case 2: Authenticity or reachability hard failure -> REJECT
  const rejectAuth = engine.evaluateSelectivePrediction({
    predictedMultiple: 7.0,
    uncertaintyWidth: 0.10,
    authenticityScore: 0.35, // < 0.50 threshold
    reachabilityScore: 0.80,
  });

  assert.equal(rejectAuth.decision, 'REJECT');
  assert.equal(rejectAuth.selectiveRiskEstimate, 0.95);
  assert.ok(rejectAuth.reason.includes('REJECT: Authenticity or reachability failed'));

  // Case 3: Ambiguous split-conformal set ({WINNER_10X, COLLAPSE_RUG}) -> ABSTAIN
  const abstainAmbiguous = engine.evaluateSelectivePrediction({
    predictedMultiple: 5.5,
    uncertaintyWidth: 0.85, // High uncertainty triggers COLLAPSE_RUG inclusion
    authenticityScore: 0.75,
    reachabilityScore: 0.70,
  });

  assert.equal(abstainAmbiguous.decision, 'ABSTAIN');
  assert.ok(abstainAmbiguous.predictionSet.includes('WINNER_10X'));
  assert.ok(abstainAmbiguous.predictionSet.includes('COLLAPSE_RUG'));
  assert.ok(abstainAmbiguous.reason.includes('ABSTAIN: Conformal prediction set is ambiguous'));

  // Case 4: Strictly collapse/rug prediction set -> REJECT
  const strictlyRug = engine.evaluateSelectivePrediction({
    predictedMultiple: 1.1, // < 1.5
    uncertaintyWidth: 0.70, // >= 0.50
    authenticityScore: 0.55, // < 0.60
    reachabilityScore: 0.60,
  });

  assert.equal(strictlyRug.decision, 'REJECT');
  assert.deepEqual(strictlyRug.predictionSet, ['COLLAPSE_RUG']);
});

test('Pass 48: Information Velocity & Stagnation Engine (Section IX & Study 10)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // Case 1: Rapidly accumulating information with sufficient terminal nats
  const rapidProfile = engine.calculateInformationVelocity({
    infoT0: 0.10,
    infoT1: 0.28,
    infoT2: 0.52,
    deltaSec: 4.0,
  });

  assert.equal(rapidProfile.currentInformationNats, 0.52);
  assert.ok(rapidProfile.velocityNatsPerSec > 0.05);
  assert.equal(rapidProfile.isStagnant, false);
  assert.equal(rapidProfile.recommendedAction, 'ENOUGH_DATA');

  // Case 2: Information stagnation below 0.35 nats with velocity < 0.001
  const stagnantProfile = engine.calculateInformationVelocity({
    infoT0: 0.15,
    infoT1: 0.15002,
    infoT2: 0.15003,
    deltaSec: 10.0,
  });

  assert.equal(stagnantProfile.currentInformationNats, 0.15003);
  assert.ok(stagnantProfile.velocityNatsPerSec < 0.001);
  assert.equal(stagnantProfile.isStagnant, true);
  assert.equal(stagnantProfile.recommendedAction, 'STAGNANT_ABSTAIN');
});

test('Pass 48: Runner Hold Manager & State Machine Lifecycle (Sections XXXVI & XXXVII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. State machine transitions
  const state1 = RunnerHoldManager.transitionState('PROTECTED', {
    isEmergencyTriggered: false,
    failureCommittorExceeded: false,
    multipleReached2x: true,
    principalRecovered: false,
    volumeExhausted: false,
    positionClosed: false,
  });
  assert.equal(state1, 'RUNNER_CANDIDATE');

  const state2 = RunnerHoldManager.transitionState('RUNNER_CANDIDATE', {
    isEmergencyTriggered: false,
    failureCommittorExceeded: false,
    multipleReached2x: true,
    principalRecovered: false,
    volumeExhausted: false,
    positionClosed: false,
  });
  assert.equal(state2, 'EXTREME_RUNNER');

  const state3 = RunnerHoldManager.transitionState('EXTREME_RUNNER', {
    isEmergencyTriggered: false,
    failureCommittorExceeded: false,
    multipleReached2x: true,
    principalRecovered: true,
    volumeExhausted: false,
    positionClosed: false,
  });
  assert.equal(state3, 'PRINCIPAL_RECOVERED');

  const stateEmergency = RunnerHoldManager.transitionState('EXTREME_RUNNER', {
    isEmergencyTriggered: true,
    failureCommittorExceeded: false,
    multipleReached2x: false,
    principalRecovered: false,
    volumeExhausted: false,
    positionClosed: false,
  });
  assert.equal(stateEmergency, 'EMERGENCY_EXIT');

  // 2. Cryptographic Hold Certificate Issuance
  const certAuthorized = engine.issueRunnerHoldCertificate({
    positionId: 'pos_runner_001',
    mint: 'TokenHold111111111111111111111111111111111',
    runnerState: 'RUNNER_CANDIDATE',
    currentSlot: 600_000n,
    informationSufficient: true,
    calibratedRunnerProb: 0.12, // lift = 0.12 / 0.0277 = 4.33 >= 2.0
    failureCommittor: 0.20,     // <= 0.45
    capitalRenewalScore: 0.65,  // >= 0.35
    inventoryLiabilityAcceptable: true,
    exitReachabilityPositive: true,
    liquidityStressAcceptable: true,
    authenticityStillValid: true,
  });

  assert.equal(certAuthorized.holdAuthorized, true);
  assert.equal(certAuthorized.validUntilSlot, 600_015n);
  assert.ok(certAuthorized.certificateDigest.length === 64);
  assert.ok(certAuthorized.liftVsBaseRate >= 2.0);

  // Denied hold due to high failure committor
  const certDenied = engine.issueRunnerHoldCertificate({
    positionId: 'pos_runner_002',
    mint: 'TokenHold111111111111111111111111111111111',
    runnerState: 'RUNNER_CANDIDATE',
    currentSlot: 600_000n,
    informationSufficient: true,
    calibratedRunnerProb: 0.12,
    failureCommittor: 0.68, // > 0.45
    capitalRenewalScore: 0.65,
    inventoryLiabilityAcceptable: true,
    exitReachabilityPositive: true,
    liquidityStressAcceptable: true,
    authenticityStillValid: true,
  });

  assert.equal(certDenied.holdAuthorized, false);
});

test('Pass 48: Decision Kernel Gating Fail-Closed Under Selective Prediction & Information Stagnation', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const canonicalEvent = {
    eventId: 'evt_pass48_gate_001',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenSelectiveGate11111111111111111111111111',
    signature: '5sel_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42010,
    slot: 570_000,
    parentSlot: 569_999,
    blockhash: 'BhashPass48Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'SLTG',
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

  // Case 1: Healthy selective prediction (ENTER) and active information velocity -> gates clear
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
    predictedMultiple: 6.0,
    uncertaintyWidth: 0.15,
    authenticityScore: 0.90,
    reachabilityScore: 0.85,
    infoT0: 0.10,
    infoT1: 0.25,
    infoT2: 0.48,
    infoDeltaSec: 4.0,
    enforceSelectivePredictionGating: true,
    enforceInformationVelocityGating: true,
  });

  assert.ok(healthyResult.selectivePrediction);
  assert.ok(healthyResult.informationVelocity);
  assert.ok(healthyResult.runnerHoldCertificate);
  assert.equal(healthyResult.selectivePrediction.decision, 'ENTER');
  assert.equal(healthyResult.informationVelocity.isStagnant, false);

  // Case 2: Selective Prediction REJECT -> fail-closed RISK_REJECTED
  const rejectResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass48_rej_002', signature: 'sig_rej_002' },
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
      selectivePrediction: {
        decision: 'REJECT',
        nonconformityScore: 0.75,
        confidenceScore: 0.25,
        predictionSet: ['COLLAPSE_RUG'],
        selectiveRiskEstimate: 0.95,
        targetCoverage: 0.007,
        reason: 'REJECT: Authenticity failed hard threshold',
      },
      enforceSelectivePredictionGating: true,
    }
  );

  assert.equal(rejectResult.decision, 'RISK_REJECTED');
  assert.ok(rejectResult.whyExecutionBlocked?.includes('BLOCKED — SELECTIVE PREDICTION REJECTED'));

  // Case 3: Selective Prediction ABSTAIN -> fail-closed CHALLENGED_ABSTAIN
  const abstainResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass48_abs_003', signature: 'sig_abs_003' },
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
      selectivePrediction: {
        decision: 'ABSTAIN',
        nonconformityScore: 0.45,
        confidenceScore: 0.55,
        predictionSet: ['WINNER_10X', 'COLLAPSE_RUG'],
        selectiveRiskEstimate: 0.45,
        targetCoverage: 0.007,
        reason: 'ABSTAIN: Conformal prediction set is ambiguous',
      },
      enforceSelectivePredictionGating: true,
    }
  );

  assert.equal(abstainResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(abstainResult.whyExecutionBlocked?.includes('BLOCKED — SELECTIVE PREDICTION ABSTAIN'));

  // Case 4: Stagnant Information Velocity -> fail-closed CHALLENGED_ABSTAIN
  const stagnantResult = await engine.processEvent(
    { ...canonicalEvent, eventId: 'evt_pass48_stag_004', signature: 'sig_stag_004' },
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
      informationVelocity: {
        currentInformationNats: 0.12,
        velocityNatsPerSec: 0.0003,
        accelerationNatsPerSec2: 0.00001,
        isStagnant: true,
        isAccelerating: false,
        recommendedAction: 'STAGNANT_ABSTAIN',
      },
      enforceInformationVelocityGating: true,
    }
  );

  assert.equal(stagnantResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(stagnantResult.whyExecutionBlocked?.includes('BLOCKED — STAGNANT INFORMATION VELOCITY'));
});

test('Pass 48: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_200_000;
  const canonicalEvent = {
    eventId: 'evt_pass48_telem_test',
    eventType: 'TOKEN_CREATE',
    mint: 'TokenSelectiveTelem11111111111111111111111',
    signature: '5sel_sig_telem',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 42010,
    slot: 570_000,
    parentSlot: 569_999,
    blockhash: 'BhashPass48Telem',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'SLTM',
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
  assert.ok(vm.selectivePrediction, 'selectivePrediction must be projected into ViewModel');
  assert.ok(vm.informationVelocity, 'informationVelocity must be projected into ViewModel');
  assert.ok(vm.runnerHoldCertificate, 'runnerHoldCertificate must be projected into ViewModel');
  assert.equal(typeof vm.selectiveDecision, 'string');
  assert.equal(typeof vm.selectiveConfidenceScore, 'number');
  assert.equal(typeof vm.informationVelocityNatsPerSec, 'number');
  assert.equal(typeof vm.isInformationStagnant, 'boolean');
  assert.equal(typeof vm.runnerHoldAuthorized, 'boolean');
  assert.equal(typeof vm.currentRunnerState, 'string');
  assert.ok(result.selectivePrediction, 'selectivePrediction must be returned in MasterPipelineResult');
  assert.ok(result.informationVelocity, 'informationVelocity must be returned in MasterPipelineResult');
  assert.ok(result.runnerHoldCertificate, 'runnerHoldCertificate must be returned in MasterPipelineResult');
});

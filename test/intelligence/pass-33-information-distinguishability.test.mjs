import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 33: Bayes Error Frontier & Minimax Information Limits', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. High feature divergence: distinct distributions between winners and losers
  const highDivergence = engine.evaluateBayesErrorBounds(0.85, 0.0277, 0.35);
  assert.equal(highDivergence.decision, 'PROCEED', 'High feature divergence must allow decision PROCEED');
  assert.ok(highDivergence.isBelowErrorCeiling, 'Bayes error floor must be below acceptable ceiling');
  assert.ok(highDivergence.leCamLowerBound < 0.20, 'Le Cam lower bound should be low under high divergence');

  // 2. Low feature divergence: ambiguous/noisy signals cannot distinguish outcome
  const lowDivergence = engine.evaluateBayesErrorBounds(0.10, 0.0277, 0.35);
  assert.equal(lowDivergence.decision, 'ABSTAIN_INFORMATION_INSUFFICIENT', 'Low divergence must fail-closed to ABSTAIN');
  assert.equal(lowDivergence.isBelowErrorCeiling, false, 'Error ceiling must be exceeded when divergence is low');
  assert.ok(lowDivergence.errorFloor > 0.35, 'Error floor must exceed acceptable risk tolerance');
  assert.ok(lowDivergence.reason?.includes('exceeds risk tolerance'), 'Clear rationale must be recorded');
});

test('Pass 33: Earliest Decision Time Horizon T* Calculation', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Immature token with insufficient elapsed time / observations
  const prematureProfile = engine.calculateEarliestDecisionTime(1.0, 0.20, 3);
  assert.equal(prematureProfile.isElapsedAdequate, false, '1s with 3 txs must be flagged as inadequate elapsed time');
  assert.ok(prematureProfile.tStar2xSeconds > 1.0, 'T* for 2x multiple must exceed 1s');
  assert.ok(prematureProfile.tStar5xSeconds > prematureProfile.tStar2xSeconds, 'T* must increase monotonically with target multiple');
  assert.ok(prematureProfile.tStar10xSeconds > prematureProfile.tStar5xSeconds, 'T*(10x) > T*(5x) > T*(2x)');

  // 2. Mature token with sufficient observations and elapsed time
  const adequateProfile = engine.calculateEarliestDecisionTime(18.0, 0.12, 35);
  assert.equal(adequateProfile.isElapsedAdequate, true, '18s with 35 txs must meet T* requirements');
});

test('Pass 33: 2x -> 10x Runner Distinguishability Court Base Rate Invariant', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Multiple < 2.0 cannot be certified for runner treatment
  const sub2xCert = engine.evaluate2xRunnerDistinguishability({
    currentMultiple: 1.6,
    capitalRenewalRatio: 1.8,
    independentCapitalAcceleration: 2.0,
    walletEntropy: 0.90,
    inventoryLiabilityCliff: false,
    exitReachabilityPositive: true,
    failureCommittor: 0.05,
  });
  assert.equal(sub2xCert.eligibleForRunnerTreatment, false, 'Sub-2x token must not receive runner treatment');
  assert.equal(sub2xCert.certificateDigest, 'REJECT_NOT_AT_2X');

  // 2. Reached 2x, but exhibits fatal failure indicators (inventory cliff / sybil cluster / high qFail)
  const disqualified2x = engine.evaluate2xRunnerDistinguishability({
    currentMultiple: 2.1,
    capitalRenewalRatio: 0.8,
    independentCapitalAcceleration: 0.5,
    walletEntropy: 0.25, // Concentrated sybil
    inventoryLiabilityCliff: true, // Creator dump cliff
    exitReachabilityPositive: true,
    failureCommittor: 0.70, // High failure committor
  });
  assert.equal(disqualified2x.eligibleForRunnerTreatment, false, 'High failure / sybil token must be disqualified at 2x');
  assert.ok(disqualified2x.liftVsBaseRate < 1.0, 'Disqualified token must have sub-baseline probability');

  // 3. Genuine extreme runner candidate at 2x crossing with verified statistical lift
  const qualified2x = engine.evaluate2xRunnerDistinguishability({
    currentMultiple: 2.2,
    capitalRenewalRatio: 1.65,
    independentCapitalAcceleration: 1.70,
    walletEntropy: 0.88,
    inventoryLiabilityCliff: false,
    exitReachabilityPositive: true,
    failureCommittor: 0.08,
  });
  assert.equal(qualified2x.eligibleForRunnerTreatment, true, 'High-quality token must qualify for runner treatment');
  assert.ok(qualified2x.liftVsBaseRate > 2.5, 'Must provide statistically significant lift over 2.77% base rate');
  assert.ok(qualified2x.calibratedRunnerProbability > 0.07, 'Calibrated probability must exceed 7% (vs 2.77% base)');
  assert.notEqual(qualified2x.certificateDigest, 'REJECT_NOT_AT_2X');
});

test('Pass 33: End-to-End Decision Kernel Gate & ViewModel Information Projection', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_200_000;
  const canonicalEvent = {
    eventId: 'evt_pass33_info_001',
    eventType: 'TOKEN_CREATE',
    mint: 'InformationFrontier1111111111111111111111111',
    signature: '5info_frontier_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 32010,
    slot: 450_000,
    parentSlot: 449_999,
    blockhash: 'BhashInfoFrontier001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00008,
      symbol: 'INFOFRONTIER',
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

  // Case 1: Premature token age (< 3.0s) blocks execution with CHALLENGED_ABSTAIN
  const prematureContext = {
    tokenAgeSec: 1.5,
    txCount: 4,
    liquiditySol: 25.0,
    marketCapSol: 40.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    featureDivergence: 0.75,
    rawWallets: defaultWallets,
  };

  const prematureResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass33_info_001', signature: 'sig_premature_001' }, prematureContext);
  assert.equal(prematureResult.decision, 'CHALLENGED_ABSTAIN', 'Premature token must be blocked');
  assert.ok(prematureResult.whyExecutionBlocked?.includes('PREMATURE OBSERVATION BEFORE T* MINIMUM HORIZON'));

  // Case 2: Inadequate feature divergence (high Bayes error floor) blocks execution
  const lowDivergenceContext = {
    tokenAgeSec: 10.0,
    txCount: 20,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    featureDivergence: 0.08, // Severe ambiguity
    acceptableErrorTolerance: 0.35,
    rawWallets: defaultWallets,
  };

  const lowDivergenceResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass33_info_002', signature: 'sig_low_div_002' }, lowDivergenceContext);
  assert.equal(lowDivergenceResult.decision, 'CHALLENGED_ABSTAIN', 'High Bayes error must be blocked');
  assert.ok(lowDivergenceResult.whyExecutionBlocked?.includes('Bayes error floor') || lowDivergenceResult.whyExecutionBlocked?.includes('ABSTAIN_INFORMATION_INSUFFICIENT'));

  // Case 3: Verify ViewModel projection of information metrics
  const matureContext = {
    tokenAgeSec: 25.0,
    txCount: 40,
    liquiditySol: 35.0,
    marketCapSol: 60.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    featureDivergence: 0.85,
    rawWallets: defaultWallets,
  };

  const matureResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass33_info_003', signature: 'sig_mature_003' }, matureContext);
  assert.ok(matureResult.bayesErrorAnalysis, 'bayesErrorAnalysis must be attached to result');
  assert.ok(matureResult.earliestDecisionProfile, 'earliestDecisionProfile must be attached to result');
  assert.ok(matureResult.runnerDistinguishability, 'runnerDistinguishability must be attached to result');
  assert.ok(matureResult.viewModel.bayesErrorAnalysis, 'bayesErrorAnalysis must be in viewModel');
  assert.ok(matureResult.viewModel.earliestDecisionProfile, 'earliestDecisionProfile must be in viewModel');
  assert.ok(matureResult.viewModel.runnerDistinguishability, 'runnerDistinguishability must be in viewModel');
  assert.equal(typeof matureResult.viewModel.bayesErrorFloor, 'number');
  assert.equal(typeof matureResult.viewModel.liftVsBaseRate, 'number');
  assert.equal(typeof matureResult.viewModel.eligibleForRunnerTreatment, 'boolean');
});

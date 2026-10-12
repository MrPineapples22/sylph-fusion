import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

function createMockAlphaEvaluationInput(overrides = {}) {
  const defaultState = {
    mint: 'MockAlphaMint111111111111111111111111111111',
    poolAddress: 'MockPool111111111111111111111111111111111111',
    observedAtMs: 1_700_000_000_000,
    observationSlot: 500_000n,
    evidenceRoot: '0x_evidence_root_v1',
    stateRoot: '0x_state_root_v1',
    tokenAgeMs: 15_000,
    price: { markPriceSol: 0.00005, confidenceInterval: [0.000048, 0.000052], isStale: false },
    liquidity: { poolLiquiditySol: 45.0, confidenceInterval: [44.0, 46.0], isStale: false },
    authenticity: { isAuthentic: true, manipulationSymptoms: [], confidenceScore: 0.95 },
    phaseTransition: {
      actorGrowthRate: 1.5,
      freshCapitalRate: 2.0,
      economicVolumeRate: 3.0,
      liquidityDepthRate: 1.8,
      exitCapacityRate: 1.2,
      concentrationRatio: 0.12,
      sellPressureRatio: 0.25,
      dtfScore: 0.85,
      phase: 'CRITICAL',
    },
    informationState: {
      mutualInformationNats: 2.5,
      informationVelocity: 0.45,
      earliestDecisionTimeSeconds: 4.5,
      bayesErrorBound: 0.12,
      sensorTier: 1,
      isSufficient: true,
    },
    reachabilityState: {
      reachabilityRatio: 0.92,
      viabilitySlack: 15.0,
      distanceToLiquidationBoundary: 8.0,
      maxReachableMultiple: 12.0,
      backwardReachableExitProb: 0.88,
      isOneWayRunner: false,
    },
    executableQuotes: {
      buyQuoteUsd: 250.0,
      buyImpactBps: 45,
      maxBuyCapacityUsd: 350.0,
      sellQuotes: {
        100: { exitPriceUsd: 250.0, impactBps: 60, proceedsUsd: 285.0 },
      },
      quoteValidUntilSlot: 500_150n,
      quoteHash: '0x_quote_hash_v1',
    },
    knowledgeCutRoot: '0x_knowledge_cut_root_v1',
  };

  const defaultObservationCert = {
    observationCoverage: 0.98,
    slotLag: 1,
    wallAgeMs: 45,
    interveningTrades: 0,
    missingnessRisk: 0.02,
    censoringRisk: 0.01,
    sourceAgreement: 0.99,
    sufficient: true,
    blockers: [],
    certificateDigest: '0x_obs_cert_digest',
  };

  const defaultRunnerCert = {
    baselineRunnerProbability: 0.0277,
    calibratedRunnerProbability: 0.22,
    failureProbability: 0.25,
    liftVsBaseRate: 7.94,
    calibrationError: 0.03,
    uncertaintyLow: 0.18,
    uncertaintyHigh: 0.26,
    eligibleForRunnerTreatment: true,
    certificateDigest: '0x_runner_cert_digest',
  };

  const defaultDistributionCert = {
    sourceRegime: 'TRENDING_EXPANSION',
    targetRegime: 'TRENDING_EXPANSION',
    covariateShift: 0.05,
    conceptShift: 0.04,
    calibrationShift: 0.03,
    transportable: true,
    blockers: [],
    certificateDigest: '0x_dist_cert_digest',
  };

  return {
    state: { ...defaultState, ...(overrides.state || {}) },
    observationCert: { ...defaultObservationCert, ...(overrides.observationCert || {}) },
    runnerCert: { ...defaultRunnerCert, ...(overrides.runnerCert || {}) },
    distributionCert: { ...defaultDistributionCert, ...(overrides.distributionCert || {}) },
    policyVersion: overrides.policyVersion || 'sylph-alpha-v1.0.0',
    releaseRoot: overrides.releaseRoot || 'urn:sylph:release:master-alpha-engine',
  };
}

test('Pass 35: Prospective Law Court Engine & Denominator Honesty (Section XXVIII & Study 47)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. Frozen policy contract creation
  const court = engine.createProspectiveLawCourt({
    sessionId: 'session_court_test_001',
    codeHash: '0x_release_code_hash_v1',
    featureSchemaRoot: '0x_schema_root_v1',
    decisionPolicyVersion: 'alpha-policy-v1.0',
    exitPolicyVersion: 'dynamic-stopping-v1.0',
    fixedStakeUsd: 250.0,
  });

  const contract = court.getFrozenContract();
  assert.equal(contract.courtSessionId, 'session_court_test_001');
  assert.equal(contract.fixedStakeUsd, 250.0);
  assert.ok(typeof contract.contractDigest === 'string' && contract.contractDigest.length === 64, 'Contract digest must be SHA-256');

  // 2. Under 100 trials -> INSUFFICIENT_EVIDENCE
  for (let i = 0; i < 50; i++) {
    court.recordTrialVerdict({
      candidateId: `cand_${i}`,
      mint: `mint_${i}`,
      decision: i % 2 === 0 ? 'ENTER' : 'ABSTAIN',
      outcomes: i % 2 === 0 ? ['PROFITABLE_AFTER_COST'] : [],
      netRealizedPnLUsd: i % 2 === 0 ? 50 : 0,
      isResolved: true,
    });
  }

  const under100Stats = court.adjudicate();
  assert.equal(under100Stats.totalCandidatesPresented, 50, 'All candidates must remain in denominator');
  assert.equal(under100Stats.courtRuling, 'PROMOTION_INSUFFICIENT_EVIDENCE', 'Under 100 candidates cannot be approved');

  // 3. Complete 100 trials with negative net expectancy -> PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY
  const failingCourt = engine.createProspectiveLawCourt({
    sessionId: 'session_court_failing_002',
    codeHash: '0x_release_code_hash_v1',
    featureSchemaRoot: '0x_schema_root_v1',
    decisionPolicyVersion: 'alpha-policy-v1.0',
    exitPolicyVersion: 'dynamic-stopping-v1.0',
    fixedStakeUsd: 250.0,
  });

  for (let i = 0; i < 100; i++) {
    failingCourt.recordTrialVerdict({
      candidateId: `fail_${i}`,
      mint: `mint_${i}`,
      decision: 'ENTER',
      outcomes: ['COLLAPSED_90'],
      netRealizedPnLUsd: -150.0,
      isResolved: true,
    });
  }

  const failingStats = failingCourt.adjudicate();
  assert.equal(failingStats.totalCandidatesPresented, 100);
  assert.equal(failingStats.courtRuling, 'PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY');
  assert.ok(failingStats.netExecutableExpectancyUsd < 0, 'Expectancy must be negative');

  // 4. 100 trials with positive net expectancy & verified runners -> PROMOTION_APPROVED
  const passingCourt = engine.createProspectiveLawCourt({
    sessionId: 'session_court_passing_003',
    codeHash: '0x_release_code_hash_v1',
    featureSchemaRoot: '0x_schema_root_v1',
    decisionPolicyVersion: 'alpha-policy-v1.0',
    exitPolicyVersion: 'dynamic-stopping-v1.0',
    fixedStakeUsd: 250.0,
  });

  for (let i = 0; i < 95; i++) {
    passingCourt.recordTrialVerdict({
      candidateId: `pass_loss_${i}`,
      mint: `mint_${i}`,
      decision: i < 30 ? 'ENTER' : 'ABSTAIN',
      outcomes: i < 30 ? ['COLLAPSED_90'] : [],
      netRealizedPnLUsd: i < 30 ? -80.0 : 0.0,
      isResolved: true,
    });
  }
  // 5 verified runners delivering outsized gains
  for (let i = 0; i < 5; i++) {
    passingCourt.recordTrialVerdict({
      candidateId: `pass_runner_${i}`,
      mint: `mint_runner_${i}`,
      decision: 'ENTER',
      outcomes: ['REACHED_10X', 'PROFITABLE_AFTER_COST'],
      netRealizedPnLUsd: 1200.0,
      isResolved: true,
    });
  }

  const passingStats = passingCourt.adjudicate();
  assert.equal(passingStats.totalCandidatesPresented, 100);
  assert.equal(passingStats.successfulRunnerCount, 5);
  assert.ok(passingStats.netExecutableExpectancyUsd > 0, 'Net expectancy must be positive');
  assert.equal(passingStats.courtRuling, 'PROMOTION_APPROVED');
});

test('Pass 35: Executable Alpha Certificate Evaluation (Section V & XXXI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  // 1. All 8 foundational gates pass -> decision ENTER
  const validAlphaInput = createMockAlphaEvaluationInput();
  const validCert = engine.issueExecutableAlphaCertificate(validAlphaInput);

  assert.equal(validCert.decision, 'ENTER', 'Must authorize ENTER when all gates pass');
  assert.equal(validCert.blockers.length, 0);
  assert.ok(validCert.expectedNetEdgeUsd > 0, 'Expected net edge must be positive');
  assert.ok(typeof validCert.certificateDigest === 'string' && validCert.certificateDigest.length === 64);

  // 2. Insufficient stressed exit capacity (< $250) -> ABSTAIN
  const lowExitCapacityInput = createMockAlphaEvaluationInput({
    state: {
      executableQuotes: {
        buyQuoteUsd: 250.0,
        buyImpactBps: 45,
        maxBuyCapacityUsd: 350.0,
        sellQuotes: {
          100: { exitPriceUsd: 150.0, impactBps: 200, proceedsUsd: 150.0 }, // Only $150 exit capacity
        },
        quoteValidUntilSlot: 500_150n,
        quoteHash: '0x_quote_hash_low_exit',
      },
    },
  });
  const lowExitCert = engine.issueExecutableAlphaCertificate(lowExitCapacityInput);
  assert.equal(lowExitCert.decision, 'ABSTAIN');
  assert.ok(lowExitCert.blockers.some(b => b.includes('STRESSED_EXIT_INSUFFICIENT')));

  // 3. Authenticity manipulation or catastrophic failure committor -> REJECT
  const manipulatedInput = createMockAlphaEvaluationInput({
    state: {
      authenticity: {
        isAuthentic: false,
        manipulationSymptoms: ['SYNTHETIC_CLUSTER_CONCENTRATION', 'CREATOR_SOL_RECYCLING'],
        confidenceScore: 0.10,
      },
    },
  });
  const manipulatedCert = engine.issueExecutableAlphaCertificate(manipulatedInput);
  assert.equal(manipulatedCert.decision, 'REJECT');
  assert.ok(manipulatedCert.blockers.some(b => b.includes('AUTHENTICITY_FAILED')));
});

test('Pass 35: End-to-End Decision Kernel Gating in processEvent for Executable Alpha & Court', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 3_500_000;
  const canonicalEvent = {
    eventId: 'evt_pass35_alpha_001',
    eventType: 'TOKEN_CREATE',
    mint: 'AlphaGateToken1111111111111111111111111111',
    signature: '5alpha_gate_sig_001',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 35010,
    slot: 470_000,
    parentSlot: 469_999,
    blockhash: 'BhashAlphaGate001',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'ALPHAGATE',
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

  // Case 1: REJECT alpha certificate fails closed to RISK_REJECTED
  const rejectAlphaInput = createMockAlphaEvaluationInput({
    state: {
      authenticity: {
        isAuthentic: false,
        manipulationSymptoms: ['SYBIL_CIRCULAR_ROUTING'],
        confidenceScore: 0.15,
      },
    },
  });

  const rejectContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    alphaEvaluationInput: rejectAlphaInput,
  };

  const rejectResult = await engine.processEvent(canonicalEvent, rejectContext);
  assert.equal(rejectResult.decision, 'RISK_REJECTED', 'Rejected alpha certificate must trigger RISK_REJECTED');
  assert.ok(rejectResult.whyExecutionBlocked?.includes('EXECUTABLE ALPHA REJECTED'));
  assert.ok(rejectResult.executableAlphaCertificate, 'Certificate attached to result');
  assert.equal(rejectResult.viewModel.executableAlphaCertificate?.decision, 'REJECT');

  // Case 2: ABSTAIN alpha certificate fails closed to CHALLENGED_ABSTAIN
  const abstainAlphaInput = createMockAlphaEvaluationInput({
    state: {
      executableQuotes: {
        buyQuoteUsd: 250.0,
        buyImpactBps: 45,
        maxBuyCapacityUsd: 350.0,
        sellQuotes: {
          100: { exitPriceUsd: 120.0, impactBps: 200, proceedsUsd: 120.0 }, // under $250
        },
        quoteValidUntilSlot: 500_150n,
        quoteHash: '0x_quote_hash_abstain',
      },
    },
  });

  const abstainContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    alphaEvaluationInput: abstainAlphaInput,
  };

  const abstainResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass35_abstain_002', signature: 'sig_abstain_002' }, abstainContext);
  assert.equal(abstainResult.decision, 'CHALLENGED_ABSTAIN', 'Abstained alpha certificate must trigger CHALLENGED_ABSTAIN');
  assert.ok(abstainResult.whyExecutionBlocked?.includes('EXECUTABLE ALPHA ABSTAIN'));

  // Case 3: Dismissed Law Court session triggers CHALLENGED_ABSTAIN
  const dismissedCourtVerdicts = [];
  for (let i = 0; i < 100; i++) {
    dismissedCourtVerdicts.push({
      candidateId: `c_${i}`,
      mint: `mint_${i}`,
      decision: 'ENTER',
      outcomes: ['COLLAPSED_90'],
      netRealizedPnLUsd: -120.0,
      isResolved: true,
    });
  }

  const dismissedCourtContext = {
    tokenAgeSec: 20.0,
    txCount: 35,
    liquiditySol: 30.0,
    marketCapSol: 50.0,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    rawWallets: defaultWallets,
    candidateTrialVerdicts: dismissedCourtVerdicts,
  };

  const courtResult = await engine.processEvent({ ...canonicalEvent, eventId: 'evt_pass35_court_003', signature: 'sig_court_003' }, dismissedCourtContext);
  assert.equal(courtResult.decision, 'CHALLENGED_ABSTAIN', 'Dismissed Law Court expectancy must trigger CHALLENGED_ABSTAIN');
  assert.ok(courtResult.whyExecutionBlocked?.includes('PROSPECTIVE LAW COURT DISMISSED'));
  assert.ok(courtResult.lawCourtSession, 'Law Court session attached to result');
  assert.equal(courtResult.lawCourtSession?.courtRuling, 'PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY');
  assert.equal(courtResult.viewModel.lawCourtRuling, 'PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY');
});

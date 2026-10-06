/**
 * SYLPH FUSION — RESEARCH MATRIX MASTER BLUEPRINT TEST SUITE
 * Specifications: Sections 1-35, 52-60, 65, 67, 68
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ResearchMatrixRegistry,
  BayesErrorFrontierX,
  PredictabilityFrontierX,
  ReachabilityEngineX,
  ViabilityKernelX,
  CommittorEngineX,
  TransitionPathEngineX,
  QSDMetastabilityAnalyzer,
  LiquidationHypergraphAnalyzer,
  InventorySurfaceAnalyzer,
  FlowReproductionAnalyzer,
  StructuralInformationAnalyzer,
  MultifidelitySensingController,
  DomainShiftAnalyzer,
  ConformalAbstainController,
  EarliestDecisionTimeSolver,
  MultiFamilyConsensusEngine,
  ExtremePredictionCertificateAuthority,
  ExitPolicyTournament,
  AllAttemptDatasetStore,
  CounterfactualRegretLedger,
  ResearchMatrixPolicyV1,
} from '../../dist/intelligence/research-matrix/index.js';

function createMockState(overrides = {}) {
  const now = Date.now();
  return {
    snapshotId: 'snap_test',
    mint: 'mint_test',
    capturedAtSlot: 100n,
    capturedAtMs: now,
    venue: 'PUMP_FUN_BONDING_CURVE',
    market: {
      tokenAgeSeconds: { value: 60 },
      priceSol: { value: 0.001 },
      priceUsd: { value: 0.15 },
      priceReturnsBps: { value: 100 },
      priceVelocityBpsPerSec: { value: 5 },
      priceAccelerationBpsPerSec2: { value: 0 },
      marketCapUsd: { value: 50000 },
      fdvUsd: { value: 50000 },
      realQuoteReservesSol: { value: 30 },
      virtualTokenReserves: { value: 1000000000n },
      executableDepthSol: { value: 10 },
      spreadBps: { value: 25 },
      quoteAgeMs: { value: 100 },
      volatilityBps: { value: 200 },
      transactionVelocityPerSec: { value: 2 },
      ...(overrides.market || {}),
    },
    flow: {
      buyCount: { value: 20 },
      sellCount: { value: 8 },
      buySellRatio: { value: 2.5 },
      economicBuyVolumeSol: { value: 15 },
      economicSellVolumeSol: { value: 5 },
      independentBuyers: { value: 14 },
      independentSellers: { value: 6 },
      buyerArrivalRatePerSec: { value: 0.3 },
      sellerArrivalRatePerSec: { value: 0.1 },
      capitalRenewalRateSolPerSec: { value: 0.2 },
      ...(overrides.flow || {}),
    },
    inventory: {
      top10HolderConcentrationPct: { value: 25 },
      creatorHoldingPct: { value: 5 },
      costBasisDistributionEntropy: { value: 1.2 },
      embeddedProfitInventorySol: { value: 5 },
      sellLiabilitySol: { value: 5 },
      inventoryActivationSurfaceBps: { value: 2000 },
      inventoryDephasingScore: { value: 0.6 },
      costBasisResetQualityScore: { value: 0.7 },
      whaleLiquidationExposureSol: { value: 4 },
      ...(overrides.inventory || {}),
    },
    authenticity: {
      independentActorRatio: { value: 0.8 },
      economicVolumeRatio: { value: 0.85 },
      fundingDiversityScore: { value: 0.75 },
      washTradingProbability: { value: 0.05 },
      bundlerCoordinatorProbability: { value: 0.1 },
      manipulationSymptomsDetected: { value: false },
      liquidityPersistenceScore: { value: 0.95 },
      temporalPersistenceScore: { value: 0.85 },
      ...(overrides.authenticity || {}),
    },
    information: {
      informationSufficiency: { value: true },
      mutualInformationScore: { value: 0.5 },
      informationVelocityPerSec: { value: 0.1 },
      informationAccelerationPerSec2: { value: 0.01 },
      calibrationConfidence: { value: 0.8 },
      effectiveSampleSize: { value: 100 },
      domainShiftScore: { value: 0.1 },
      structuralInformationGain: { value: 0.3 },
      ...(overrides.information || {}),
    },
    reachability: {
      nominalExtremeReturnProb: { value: 0.2 },
      economicReachabilityProb: { value: 0.15 },
      capturableProbability: { value: 0.12 },
      viabilityMarginBps: { value: 3000 },
      minimumConstraintSlack: { value: 0.25 },
      safeHorizonSeconds: { value: 180 },
      capitalDeficitSol: { value: 0 },
      rescueDistance: { value: 0.1 },
      exitReachabilityProb: { value: 0.8 },
      ...(overrides.reachability || {}),
    },
    rareEvent: {
      q2x: { value: 0.25 },
      q5x: { value: 0.08 },
      q10x: { value: 0.02 },
      q20x: { value: 0.005 },
      q100x: { value: 0.0005 },
      failureCommittor: { value: 0.4 },
      pathwayClass: { value: 'GRADUATION_SECONDARY_IGNITION' },
      pathwayEntropy: { value: 1.2 },
      distanceToExtremeManifold: { value: 0.4 },
      pathVelocity: { value: 0.15 },
      barrierCompressionScore: { value: 0.2 },
      criticalityGap: { value: 0.3 },
      ...(overrides.rareEvent || {}),
    },
    execution: {
      expectedDexFeeBps: { value: 100 },
      expectedPriceImpactBps: { value: 150 },
      expectedSlippageBps: { value: 200 },
      expectedLandingCostLamports: { value: 500000n },
      expectedFailureCostLamports: { value: 100000n },
      routeCapacitySol: { value: 5 },
      executablePositionSizeSol: { value: 0.5 },
      exitCapacitySol: { value: 8 },
      stressedExitCapacitySol: { value: 4 },
      ...(overrides.execution || {}),
    },
  };
}

test('1. Research Matrix Registry: 10,000 studies initialized as UNTESTED with zero capital authority', () => {
  const registry = new ResearchMatrixRegistry();
  const summary = registry.getSummary();

  assert.equal(summary.totalStudies, 10000, 'Must compile exactly 10,000 studies');
  assert.equal(summary.untestedCount, 10000, 'All studies must start UNTESTED');
  assert.equal(summary.graduatedCount, 0, 'Zero studies graduated at genesis');
  assert.equal(summary.activeCandidateCount, 0, 'Zero active candidates without evidence');

  const study = registry.getStudy('STUDY_MECH_001_LENS_001');
  assert.ok(study, 'Genesis study must exist');
  assert.equal(study.state, 'UNTESTED');
  assert.equal(study.assumedSharpe, 0);
  assert.equal(study.assumedProfitability, 0);
  assert.equal(study.capitalAuthorityAllowed, false);
});

test('2. Falsification Control: Sequential e-process and Benjamini-Hochberg FDR mark failing studies FALSIFIED', () => {
  const registry = new ResearchMatrixRegistry();
  const studyId = 'STUDY_MECH_001_LENS_001';

  // Record 35 consecutive adverse failures
  let result;
  for (let i = 0; i < 35; i++) {
    result = registry.recordStudyObservation({
      studyId,
      empiricalPnl: -0.15,
      isAdversarialFailure: true,
      verifierAgentId: 'INDEPENDENT_ASTRA_QA',
    });
  }

  assert.equal(result.falsified, true, 'High failure rate must trigger falsification');
  assert.equal(result.updatedState, 'FALSIFIED');

  const study = registry.getStudy(studyId);
  assert.equal(study.state, 'FALSIFIED');
});

test('3. Bayes Error Frontier: Indistinguishable early observations trigger ABSTAIN_INFORMATION_INSUFFICIENT', () => {
  const bayes = new BayesErrorFrontierX();

  // Test at 1 second age with sparse observations
  const stateEarly = createMockState({
    market: { tokenAgeSeconds: { value: 1 } },
    flow: { buyCount: { value: 1 }, sellCount: { value: 0 } },
  });
  const eval1s = bayes.evaluateFrontier(stateEarly, 'RUNNER_10X');
  assert.equal(eval1s.isInformationSufficient, false);
  assert.equal(eval1s.recommendedAction, 'ABSTAIN_INFORMATION_INSUFFICIENT');
  assert.ok(eval1s.minimumPossibleClassificationError > 0.20);

  // Test at 300 seconds age with mature transaction flow
  const stateMature = createMockState({
    market: { tokenAgeSeconds: { value: 300 } },
    flow: { buyCount: { value: 50 }, sellCount: { value: 20 } },
  });
  const eval300s = bayes.evaluateFrontier(stateMature, 'RUNNER_2X');
  assert.equal(eval300s.isInformationSufficient, true);
  assert.equal(eval300s.recommendedAction, 'PERMIT_PREDICTION');
});

test('4. Reachability & ONE_WAY_RUNNER veto: Cannot trade extreme multiple without exitability', () => {
  const reach = new ReachabilityEngineX();

  const stateUnreachable = createMockState({
    market: { realQuoteReservesSol: { value: 2.0 }, executableDepthSol: { value: 0.5 } },
    authenticity: { independentActorRatio: { value: 0.3 }, washTradingProbability: { value: 0.4 } },
    inventory: { sellLiabilitySol: { value: 20.0 } },
  });

  const evalReach = reach.evaluateReachability(stateUnreachable, 0.5);
  assert.ok(evalReach.recommendedAction === 'GOOD_PREDICTION_BAD_TRADE' || evalReach.recommendedAction === 'REJECT_UNFEASIBLE');
  assert.ok(evalReach.targetAnalyses.some(t => t.feasibilityGap > 0));
});

test('5. Liquidation Hypergraph: Grouping coordinated wallets prevents sybil bypass', () => {
  const holders = [
    { address: 'w1', balanceLamportsOrTokens: 100n, percentageOfSupply: 0.08, acquisitionSlot: 100, acquisitionTimeMs: 1000, costBasisUsdOrSol: 1.0, fundingSource: 'funder_alpha', isCreatorOrDeployer: false },
    { address: 'w2', balanceLamportsOrTokens: 100n, percentageOfSupply: 0.08, acquisitionSlot: 100, acquisitionTimeMs: 1000, costBasisUsdOrSol: 1.0, fundingSource: 'funder_alpha', isCreatorOrDeployer: false },
    { address: 'w3', balanceLamportsOrTokens: 100n, percentageOfSupply: 0.08, acquisitionSlot: 100, acquisitionTimeMs: 1000, costBasisUsdOrSol: 1.0, fundingSource: 'funder_alpha', isCreatorOrDeployer: false },
  ];

  const graph = LiquidationHypergraphAnalyzer.analyze(holders, 0.15);
  assert.equal(graph.totalDistinctWallets, 3);
  assert.equal(graph.effectiveIndependentActors, 1, 'Coordinated funder must collapse into 1 economic actor');
  assert.ok(graph.effectiveWhaleSize >= 0.24, 'Coordinated cluster must sum to 24% of supply');
  assert.equal(graph.liquidationHypergraphVeto, true, 'Must trigger hard veto on 24% whale cluster');
});

test('6. Flow Reproduction: R_buy > 1 and R_sell < 1 identifies constructive organic flow', () => {
  const tradesConstructive = [
    { timestampMs: 1000, isBuy: false, actorAddress: 's0', solAmount: 1.0, isFirstTimeActor: true },
    { timestampMs: 2000, isBuy: true, actorAddress: 'b1', solAmount: 1.0, isFirstTimeActor: true },
    { timestampMs: 3000, isBuy: false, actorAddress: 's1', solAmount: 0.5, isFirstTimeActor: true },
    { timestampMs: 4000, isBuy: true, actorAddress: 'b2', solAmount: 2.0, isFirstTimeActor: true },
    { timestampMs: 5000, isBuy: true, actorAddress: 'b3', solAmount: 2.5, isFirstTimeActor: true },
    { timestampMs: 6000, isBuy: true, actorAddress: 'b4', solAmount: 3.0, isFirstTimeActor: true },
  ];

  const flow = FlowReproductionAnalyzer.analyze(tradesConstructive, 60);
  assert.ok(flow.rBuy > 1.0, 'R_buy should be reproductive (>1.0)');
  assert.ok(flow.capitalRenewalRatio >= 0.35, 'Capital renewal ratio should be high');
  assert.equal(flow.isFlowConstructive, true);
});

test('7. Multi-Family Consensus: Orthogonal vetoes enforce NO TRADE on unexitability or manipulation', () => {
  // Case A: High alpha, but Exitability has hard veto -> Must REJECT
  const consensusReject = MultiFamilyConsensusEngine.evaluate({
    authenticity: { score: 0.9, confidence: 0.9, hasVeto: false },
    information: { score: 0.85, confidence: 0.85, hasVeto: false },
    reachability: { score: 0.8, confidence: 0.8, hasVeto: false },
    viability: { score: 0.8, confidence: 0.8, hasVeto: false },
    inventory: { score: 0.8, confidence: 0.8, hasVeto: false },
    capitalRenewal: { score: 0.8, confidence: 0.8, hasVeto: false },
    rareTransition: { score: 0.8, confidence: 0.8, hasVeto: false },
    execution: { score: 0.8, confidence: 0.8, hasVeto: false },
    exitability: { score: 0.1, confidence: 0.9, hasVeto: true, vetoReason: 'Exit capacity zero' },
    regime: { score: 0.9, confidence: 0.9, hasVeto: false },
  });
  assert.equal(consensusReject.decision, 'REJECT');
  assert.ok(consensusReject.triggeredVetoes.some(v => v.includes('Exitability')));

  // Case B: High reachability, but Information insufficient -> Must ABSTAIN
  const consensusAbstain = MultiFamilyConsensusEngine.evaluate({
    authenticity: { score: 0.9, confidence: 0.9, hasVeto: false },
    information: { score: 0.35, confidence: 0.5, hasVeto: true, vetoReason: 'Information insufficient' },
    reachability: { score: 0.85, confidence: 0.8, hasVeto: false },
    viability: { score: 0.8, confidence: 0.8, hasVeto: false },
    inventory: { score: 0.8, confidence: 0.8, hasVeto: false },
    capitalRenewal: { score: 0.8, confidence: 0.8, hasVeto: false },
    rareTransition: { score: 0.8, confidence: 0.8, hasVeto: false },
    execution: { score: 0.8, confidence: 0.8, hasVeto: false },
    exitability: { score: 0.8, confidence: 0.8, hasVeto: false },
    regime: { score: 0.9, confidence: 0.9, hasVeto: false },
  });
  assert.equal(consensusAbstain.decision, 'ABSTAIN');
  assert.ok(consensusAbstain.abstentionReasons.length > 0);
});

test('8. Extreme Prediction Certificate: Cryptographic sealing and tamper detection', () => {
  const cert = ExtremePredictionCertificateAuthority.issueCertificate({
    mint: 'Token111111111111111111111111111111111111111',
    target: '2x',
    predictionTimeMs: 1791250000000,
    baseRate: 0.14,
    posteriorProbability: 0.28,
    informationSufficiency: true,
    bayesErrorLowerBound: 0.12,
    informationVelocity: 0.15,
    predictabilityFrontierCrossed: true,
    calibrationError: 0.03,
    effectiveCalibrationN: 150,
    domainShiftScore: 0.10,
    conformalRiskBound: 0.12,
    abstain: false,
    pathwayClass: 'GRADUATION_SECONDARY_IGNITION',
    pathwayPredictability: 0.80,
    evidenceSources: ['RPC_POOL', 'PUMP_CURVE'],
    structuralInformationGain: 0.35,
    reachability: 0.75,
    capturability: 0.70,
    viabilityMargin: 0.40,
    exitReachability: 0.80,
  });

  assert.equal(cert.certificateStatus, 'VALID');
  assert.ok(cert.certificateRoot.length >= 32);
  assert.equal(ExtremePredictionCertificateAuthority.verifyCertificate(cert), true);

  // Tamper test
  const tamperedCert = { ...cert, posteriorProbability: 0.99 };
  assert.equal(ExtremePredictionCertificateAuthority.verifyCertificate(tamperedCert), false);
});

test('9. All-Attempt Dataset: Logs every candidate (ENTER, ABSTAIN, REJECT) without selection bias', () => {
  const store = new AllAttemptDatasetStore();

  store.recordAttempt({
    evaluatedAtMs: 1000,
    mint: 'mint_enter',
    symbol: 'ENT',
    decision: 'ENTER',
    responsibleGateOrVeto: 'CONSENSUS_PASS',
    pointInTimeState: {},
    consensusResult: { decision: 'ENTER', compositeScore: 0.8, aggregateConfidence: 0.85, triggeredVetoes: [], abstentionReasons: [], passingFamiliesCount: 9, totalFamiliesCount: 10, consensusDetails: {} },
    policyVersion: 'V1',
    modelVersion: '2026',
    codeRoot: 'c1',
    datasetRoot: 'd1',
  });

  store.recordAttempt({
    evaluatedAtMs: 2000,
    mint: 'mint_abstain',
    symbol: 'ABS',
    decision: 'ABSTAIN',
    responsibleGateOrVeto: 'INFORMATION_DEFICIT',
    pointInTimeState: {},
    consensusResult: { decision: 'ABSTAIN', compositeScore: 0.5, aggregateConfidence: 0.5, triggeredVetoes: [], abstentionReasons: ['Information deficient'], passingFamiliesCount: 4, totalFamiliesCount: 10, consensusDetails: {} },
    policyVersion: 'V1',
    modelVersion: '2026',
    codeRoot: 'c1',
    datasetRoot: 'd1',
  });

  const breakdown = store.getDecisionBreakdown();
  assert.equal(breakdown.total, 2);
  assert.equal(breakdown.enterCount, 1);
  assert.equal(breakdown.abstainCount, 1);
  assert.equal(breakdown.rejectCount, 0);
});

test('10. Runner Dependence RD_k: Identifies strategies carried exclusively by top outliers', () => {
  // Strategy A: Profit distributed evenly across 10 trades
  const evenPnls = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]; // Total 10 SOL
  const rdEven = ExitPolicyTournament.calculateRunnerDependence(evenPnls);
  assert.equal(rdEven.rd1, 0.1);
  assert.equal(rdEven.rd3, 0.3);
  assert.equal(rdEven.isHighlyRunnerDependent, false);

  // Strategy B: 9 trades break even (0.0), 1 trade made 10 SOL
  const outlierPnls = [10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  const rdOutlier = ExitPolicyTournament.calculateRunnerDependence(outlierPnls);
  assert.equal(rdOutlier.rd1, 1.0);
  assert.equal(rdOutlier.rd3, 1.0);
  assert.equal(rdOutlier.isHighlyRunnerDependent, true);
});

test('11. Unified ResearchMatrixPolicyV1: Shadows legacy HSI and governs autonomous paper entries', () => {
  // Candidate with low liquidity and short history -> Policy must reject or abstain, NOT blindly enter on HSI 95
  const result = ResearchMatrixPolicyV1.evaluate({
    mint: 'LowLiq111111111111111111111111111111111111111',
    symbol: 'LOWLIQ',
    ageSeconds: 2,
    priceUsd: 0.0001,
    launchPriceUsd: 0.0001,
    marketCapUsd: 10000,
    liquiditySol: 2.0, // Insufficient liquidity
    spreadBps: 200,
    hsi: 95.0, // Legacy would have bought!
    pod: 'UP',
    buyCount: 2,
    sellCount: 0,
    buyVolumeSol: 1.0,
    sellVolumeSol: 0,
    uniqueBuyers: 1,
    uniqueSellers: 0,
    top10HolderFraction: 0.65,
  });

  // HSI is 95 and PoD is UP, but Research Matrix Policy rejects/abstains due to low liquidity & information deficit
  assert.notEqual(result.action, 'ENTER', 'ResearchMatrixPolicyV1 must NOT blindly buy simply because HSI >= 80 and PoD is UP');
  assert.equal(result.legacyShadowDecision.hsi, 95.0);
  assert.ok(result.legacyShadowDecision.wouldHaveEntered === false || result.reasons.length > 0);
  assert.ok(result.reasons.length > 0, 'Must record clear reasons for non-entry');
});

/**
 * SYLPH FUSION — EXECUTABLE ALPHA MASTER VERIFICATION TEST SUITE
 * Blueprint Sections I - LXIX
 *
 * Comprehensive tests validating:
 * 1. $250 Fixed Sizing & Capacity Ceiling (Section IV, XXXIII)
 * 2. Master Executable Alpha Equation & Certificate (Section V, XXXI)
 * 3. 2x -> 10x Runner Distinguishability & Base Rate (Section X, XLVI)
 * 4. Transition-Path Physics: Committor Functions q_up and q_fail (Section XII)
 * 5. Flow Reproduction R_buy and R_sell & Exogenous Capital (Section XIII)
 * 6. Liquidation Surface & AMM Fatigue (Section XIV, XV, XVI)
 * 7. Latency Budget 9 Stages & Landing Physics (Section XVII, XVIII, XIX)
 * 8. Exit Tournament & Bellman Dynamic Stopping (Section XXI, XXII)
 * 9. Runner Search Cost & Tail Concentration Robustness (Section XXV)
 * 10. Portfolio Ruin Simulation (Section XXVI)
 * 11. Prospective Law Court & Denominator Honesty (Section XXVIII)
 * 12. Research Matrix Bridge & 50 UNTESTED Hypotheses (Section XXIX, LIV)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExecutableSizing,
} from '../../dist/intelligence/execution/position-sizer.js';
import {
  AutonomousRDGovernorX,
} from '../../dist/intelligence/research-governor/rd-governor.js';
import {
  // Types & Core
  computeCertificateDigest,
  // Observation
  ObservationQualityEngine,
  CensoringModelEngine,
  // Information
  RunnerDistinguishabilityCourt,
  HISTORICAL_2X_TO_10X_BASE_RATE,
  InformationFrontierEngine,
  BayesErrorFrontierEngine,
  SelectivePredictionEngine,
  // Distribution
  RegimeTransportEngine,
  MigrationSelectionEngine,
  TransportabilityCourt,
  // Transition
  RunnerCommittorEngine,
  FailureCommittorEngine,
  TransitionPathEngine,
  ReactiveFluxEngine,
  PathwayBottleneckEngine,
  MetastabilityEngine,
  // Flow
  FlowReproductionEngine,
  ExogenousCapitalClassifier,
  CapitalGenerationEngine,
  CapitalSurvivalEngine,
  InventoryAbsorptionEngine,
  // Liquidity
  LiquidationHypergraphEngine,
  ExitMinCutEngine,
  LiquidityFatigueEngine,
  ExecutableLiquidationSurfaceEngine,
  // Execution
  QuoteDecayEngine,
  LatencyBudgetProfiler,
  LandingPhysicsModel,
  FeeResponseSurfaceEngine,
  ExecutionUrgencyEngine,
  ExecutionLaneScorecardEngine,
  // Exit
  PrincipalRecoveryEngine,
  RunnerHoldManager,
  DynamicStoppingEngine,
  ExitPolicyTournament,
  ExitRegretLedger,
  // Portfolio
  RunnerSearchCostEngine,
  TailConcentrationEngine,
  PortfolioRuinEngine,
  PortfolioCapacityEngine,
  // Certification & Governance
  ExecutableAlphaCertificateIssuer,
  ProspectiveLawCourt,
  ResearchMatrixBridge,
  ALL_50_EXECUTABLE_ALPHA_STUDIES,
} from '../../dist/intelligence/executable-alpha/index.js';

test('Section IV & XXXIII: Executable $250 Sizing & Hard Abstain Gate', () => {
  // Case A: Pool supports $250 comfortably
  const validEvidence = {
    desiredResearchStakeUsd: 250,
    expectedExecutableEdgeUsd: 45.0,
    expectedExecutableEdgePct: 18.0,
    informationConfidence: 0.85,
    calibratedSuccessProbability: 0.12,
    uncertaintyWidth: 20.0,
    entryCapacityUsd: 1500,
    stressedExitCapacityUsd: 1200,
    estimatedEntryImpactUsd: 3.5,
    estimatedExitImpactUsd: 4.2,
    estimatedFeesUsd: 2.5,
    estimatedLandingCostUsd: 0.8,
    failureProbability: 0.35,
    liquidityFailureProbability: 0.05,
    maxCapitalAuthorityUsd: 1000,
  };
  const resultValid = calculateExecutableSizing(validEvidence);
  assert.equal(resultValid.authorizedSizeUsd, 250);
  assert.equal(resultValid.action, 'CONTINUE');

  // Case B: Pool liquidity only supports $63.
  // Invariant: MUST NOT silently downsize to $63! Must ABSTAIN_SIZE_NOT_EXECUTABLE!
  const illiquidEvidence = {
    ...validEvidence,
    entryCapacityUsd: 63,
  };
  const resultIlliquid = calculateExecutableSizing(illiquidEvidence);
  assert.equal(resultIlliquid.authorizedSizeUsd, 0);
  assert.equal(resultIlliquid.action, 'ABSTAIN_SIZE_NOT_EXECUTABLE');
});

test('Section X: 2x -> 10x Runner Distinguishability Court & 2.77% Base Rate', () => {
  assert.ok(Math.abs(HISTORICAL_2X_TO_10X_BASE_RATE - 0.0277) < 0.001);

  // Case A: High score candidate with strong lift
  const strongCandidate = RunnerDistinguishabilityCourt.evaluateAt2xCrossing({
    currentMultiple: 2.0,
    capitalRenewalRatio: 1.5,
    independentCapitalAcceleration: 1.3,
    walletEntropy: 0.85,
    inventoryLiabilityCliff: false,
    exitReachabilityPositive: true,
    failureCommittor: 0.25,
  });
  assert.equal(strongCandidate.eligibleForRunnerTreatment, true);
  assert.ok(strongCandidate.liftVsBaseRate >= 2.5);

  // Case B: Weak candidate (price doubled, but hollow volume & high failure committor)
  const weakCandidate = RunnerDistinguishabilityCourt.evaluateAt2xCrossing({
    currentMultiple: 2.0,
    capitalRenewalRatio: 0.8,
    independentCapitalAcceleration: 0.4,
    walletEntropy: 0.35,
    inventoryLiabilityCliff: true,
    exitReachabilityPositive: false,
    failureCommittor: 0.70,
  });
  assert.equal(weakCandidate.eligibleForRunnerTreatment, false);
});

test('Section VIII: Informative Censoring & MNAR Worst Case Stress', () => {
  const result = CensoringModelEngine.evaluateCensoring(
    0.0001,
    0.0001,
    Date.now() - 1000000,
    Date.now(),
    false
  );
  assert.equal(result.isCensored, true);
  assert.equal(result.attributedLossPct, 100.0);
  assert.equal(result.conservativeReturnMultiple, 0.0);
});

test('Section XII: Transition-Path Physics (q_up, q_fail, reactive flux, bottleneck)', () => {
  const committor = RunnerCommittorEngine.computeCommittor({
    currentMultiple: 2.0,
    capitalRenewalScore: 0.75,
    sellAbsorptionRatio: 2.5,
    exitReachability: 0.80,
    actorGrowthRate: 1.8,
  });
  assert.ok(committor.qUp > 0.05);
  assert.ok(committor.liftOverBaseRate > 2.0);

  const failure = FailureCommittorEngine.computeFailureCommittor({
    dtfScore: 0.75,
    sellPressureRatio: 0.85,
    creatorInventoryRatio: 0.18,
    top3HoldersShare: 0.55,
    liquidityDrainVelocity: 0.04,
  });
  assert.ok(failure.qFail > 0.60);
  assert.equal(failure.failureImminent, true);
  assert.equal(failure.dominantFailureMode, 'CREATOR_DUMP');

  const flux = ReactiveFluxEngine.computeFlux({
    qUp: committor.qUp,
    qFail: 0.20,
    arrivalVelocityTradesPerSec: 2.5,
    capitalFlowNetUsdPerSec: 150,
    poolDepthUsd: 15000,
  });
  assert.equal(flux.isNetForwardPositive, true);

  const bottleneck = PathwayBottleneckEngine.analyzeBottlenecks({
    dtfScore: 0.35,
    creatorRemainingPct: 0.01,
    topHoldersConcentrationPct: 0.12,
    poolLiquidityUsd: 25000,
  });
  assert.equal(bottleneck.isPathwayChoked, false);
});

test('Section XIII: Flow Reproduction (R_buy, R_sell) and Exogenous Capital', () => {
  const repro = FlowReproductionEngine.computeReproduction({
    uniqueBuyersT1: 50,
    uniqueBuyersT0: 40,
    uniqueSellersT1: 20,
    uniqueSellersT0: 30,
    secondaryBuyerFraction: 0.80,
    cascadingSellFraction: 0.25,
  });
  assert.ok(repro.rBuy > 1.0);
  assert.ok(repro.rSell < 1.0);
  assert.equal(repro.isFlowHealthy, true);

  const capital = ExogenousCapitalClassifier.classifyFlow({
    totalInflowUsd: 10000,
    fundingDiversityScore: 0.85,
    sameFunderClustersCount: 1,
    deployerRelatedFlowUsd: 200,
    circularTradeVolumeUsd: 300,
  });
  assert.equal(capital.dominantOrigin, 'NEW_CAPITAL');
  assert.equal(capital.isAuthenticInflow, true);
});

test('Section XV & XVI: Executable Liquidation Surface & Sequential AMM Fatigue', () => {
  const surface = ExecutableLiquidationSurfaceEngine.computeSurface({
    totalTokens: 1_000_000,
    currentMarkPriceUsd: 0.00025,
    poolSolReservesUsd: 15000,
    poolTokenReserves: 60_000_000,
    slot: 312000100n,
  });
  assert.equal(surface.base.points.length, 5); // 10, 25, 50, 75, 100
  assert.ok(surface.stressedExitCapacityUsd > 0);
  assert.ok(surface.stressedExitCapacityUsd < surface.currentMarkUsd);

  // Staged sales fatigue: State0 -> State1 -> State2 -> State3
  const fatigue = LiquidityFatigueEngine.simulateStagedSales({
    initialTokenPriceUsd: 0.00025,
    initialPoolSolReservesUsd: 15000,
    initialTokenReserves: 60_000_000,
    totalPositionTokens: 1_000_000,
  });
  assert.equal(fatigue.sequentialSteps.length, 4);
  assert.ok(fatigue.fatigueDiscountVsSingleSale >= 0);
  assert.ok(fatigue.terminalReserveFractionRemaining < 1.0);
});

test('Section XVII & XVIII: Latency Budget 9 Stages & Landing Physics Model', () => {
  const trace = {
    observationAt: 1000,
    featuresReadyAt: 1050,
    decisionAt: 1080,
    permitIssuedAt: 1100,
    buildCompletedAt: 1120,
    signedAt: 1130,
    submittedAt: 1140,
    firstProviderAckAt: 1200,
    landedAt: 1500,
    terminalAt: 1550,
  };
  const breakdown = LatencyBudgetProfiler.profileTrace(trace);
  assert.equal(breakdown.observationLatencyMs, 50);
  assert.equal(breakdown.landingLatencyMs, 360);
  assert.equal(breakdown.totalEndToEndMs, 550);
  assert.equal(breakdown.criticalBottleneckStage, 'LANDING');

  const landing = LandingPhysicsModel.estimateLanding({
    laneId: 'Jito-Bundle',
    priorityFeeMicroLamports: 200_000,
    tipLamports: 1_000_000n,
    writableAccountCount: 2,
    isLeaderJitoEnabled: true,
    networkCongestionTps: 1800,
    tradeType: 'ENTRY_BUY',
  });
  assert.ok(landing.landingProbability >= 0.85);
});

test('Section XXI, XXII & XXIV: Exit Tournament, Dynamic Stopping & Regret Ledger', () => {
  const tournament = new ExitPolicyTournament('dynamic-stopping');
  const pos = {
    positionId: 'pos-test-1',
    mint: 'TokenTest11111111111111111111111111111111111',
    poolAddress: 'PoolTest111111111111111111111111111111111111',
    entryPriceUsd: 0.00010,
    currentMarkPriceUsd: 0.00025,
    currentMultiple: 2.5,
    totalInitialTokens: 2_500_000,
    remainingTokens: 2_500_000,
    principalInvestedUsd: 250,
    entryFeesPaidUsd: 2.5,
    realizedProceedsUsd: 0,
    entrySlot: 312000000n,
    entryTimestampMs: Date.now() - 30000,
    runnerState: 'RUNNER_CANDIDATE',
  };
  const research = {
    qUp: 0.18,
    qFail: 0.25,
    dtfScore: 0.30,
    sellPressureRatio: 0.35,
    capitalRenewalScore: 0.65,
    exitReachability: 0.85,
    creatorDumpRisk: false,
    authenticityIntact: true,
    isEmergencyStopTriggered: false,
  };
  const liq = ExecutableLiquidationSurfaceEngine.computeSurface({
    totalTokens: 2_500_000,
    currentMarkPriceUsd: 0.00025,
    poolSolReservesUsd: 25000,
    poolTokenReserves: 100_000_000,
  });

  const record = tournament.evaluateTournament({
    position: pos,
    research,
    liquidation: liq,
    slot: 312000150n,
    evidenceRoot: 'urn:evidence:test',
    stateRoot: 'urn:state:test',
  });

  assert.equal(record.authoritativePolicyId, 'dynamic-stopping');
  assert.ok(record.shadowActions.length >= 8); // All shadow policies evaluated

  // Regret Ledger
  const regret = ExitRegretLedger.computeRegret({
    positionId: pos.positionId,
    realizedNetPnLUsd: 350.0,
    bestFeasibleExecutablePnLUsd: 420.0,
    exitTriggerPriceUsd: 0.00024,
    actualExecutedPriceUsd: 0.00023,
    tokensLiquidated: 2_500_000,
    maxPostExitExecutablePriceUsd: 0.00026,
  });
  assert.ok(regret.runnerCaptureEfficiency > 0.80);
});

test('Section XXV & XXVI: Search Cost, Tail Concentration & Ruin Simulator', () => {
  const searchCost = RunnerSearchCostEngine.calculateSearchCost([
    { candidateId: '1', isRunner: false, netRealizedPnLUsd: -95, feesAndFrictionUsd: 2.5 },
    { candidateId: '2', isRunner: false, netRealizedPnLUsd: -90, feesAndFrictionUsd: 2.5 },
    { candidateId: '3', isRunner: true, netRealizedPnLUsd: 850, feesAndFrictionUsd: 4.0 },
  ]);
  assert.ok(searchCost.totalRunnerSearchCostUsd > 180);
  assert.ok(searchCost.netRunnerContributionUsd > 600);
  assert.equal(searchCost.isSearchEconomicallyViable, true);

  // Tail concentration: single winner removal test
  const fragilePnLs = [1200, -80, -90, -85, -95, -70, -80];
  const tailAudit = TailConcentrationEngine.evaluateTailConcentration(fragilePnLs);
  assert.equal(tailAudit.isTailDependent, true);
  assert.equal(tailAudit.robustnessClassification, 'TAIL_DEPENDENT_NOT_ROBUST');

  // Portfolio ruin simulation
  const ruin = PortfolioRuinEngine.simulate({
    initialBankrollUsd: 10_000,
    fixedPositionSizeUsd: 250,
    maxConcurrentPositions: 5,
    candidateWinRate: 0.0277,
    averageWinMultiple: 4.5,
    averageLossPct: 0.3818,
    landingFailureRate: 0.12,
    totalCandidateStreamCount: 150,
    monteCarloRuns: 50,
  });
  assert.ok(typeof ruin.probRuin === 'number');
  assert.ok(typeof ruin.medianMaxDrawdownPct === 'number');
});

test('Section XXVIII: Prospective Law Court & Denominator Honesty', () => {
  const court = new ProspectiveLawCourt({
    sessionId: 'session-master-test-01',
    codeHash: 'hash-code-001',
    featureSchemaRoot: 'urn:schema:test',
    decisionPolicyVersion: 'v1.0.0',
    exitPolicyVersion: 'dyn-stop-v1.0.0',
  });

  court.recordTrialVerdict({
    candidateId: 'cand-1',
    mint: 'Mint1',
    decision: 'ENTER',
    outcomes: ['ENTRY_LANDED', 'REACHED_10X', 'PROFITABLE_AFTER_COST'],
    netRealizedPnLUsd: 650.0,
    isResolved: true,
  });
  court.recordTrialVerdict({
    candidateId: 'cand-2',
    mint: 'Mint2',
    decision: 'ENTER',
    outcomes: ['ENTRY_NOLAND'],
    netRealizedPnLUsd: -0.50,
    isResolved: true,
  });
  court.recordTrialVerdict({
    candidateId: 'cand-3',
    mint: 'Mint3',
    decision: 'ABSTAIN',
    outcomes: ['COLLAPSED_90'],
    netRealizedPnLUsd: 0,
    isResolved: true,
  });

  const stats = court.adjudicate();
  assert.equal(stats.totalCandidatesPresented, 3);
  assert.equal(stats.enteredCount, 2);
  assert.equal(stats.abstainedCount, 1);
  assert.equal(stats.noLandCount, 1);
  assert.ok(stats.netExecutableExpectancyUsd > 0);
});

test('Section XXIX & LIV: Research Matrix Bridge Maps ALL 50 Studies to AutonomousRDGovernorX', () => {
  assert.equal(ALL_50_EXECUTABLE_ALPHA_STUDIES.length, 50);

  const governor = new AutonomousRDGovernorX();
  const registeredCount = ResearchMatrixBridge.registerAllStudies(governor);
  assert.equal(registeredCount, 50);

  // Invariant check: every single study begins strictly as UNTESTED with 0 Sharpe
  for (const study of ALL_50_EXECUTABLE_ALPHA_STUDIES) {
    const hyp = governor.getHypothesis(study.hypothesisId);
    assert.ok(hyp, `Study ${study.hypothesisId} must exist in governor`);
    assert.equal(hyp.state, 'UNTESTED');
    assert.equal(hyp.observedSharpe, 0.0);
    assert.equal(hyp.outOfSampleSampleSize, 0);
    assert.ok(hyp.falsificationCondition.length > 10);
  }
});

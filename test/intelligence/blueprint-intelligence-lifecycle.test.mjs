import test from 'node:test';
import assert from 'node:assert/strict';

import { ExitabilityEngine } from '../../dist/intelligence/exitability/exitability-certificate.js';
import { CapitalBarrierKernel } from '../../dist/intelligence/capital/capital-barrier-kernel.js';
import { LifecycleXEngine } from '../../dist/intelligence/lifecycle/lifecycle-x.js';
import { CapitalFlowEngine } from '../../dist/intelligence/flow/capital-flow-x.js';
import { MultiplierResearchHeuristicEngine } from '../../dist/intelligence/multiplier/competing-hazards-multiplier.js';
import { MarketGrammarEngine } from '../../dist/intelligence/grammar/market-grammar.js';
import { HypothesisRegistry } from '../../dist/intelligence/research/hypothesis-registry.js';

import { TokenSemanticEngine } from '../../dist/platform/truth/token-semantic-root.js';

test('ExitabilityEngine: derives max safe position backward from stressed exit capacity', () => {
  const cleanSemantics = TokenSemanticEngine.evaluateSemantics({
    mint: 'IlliquidMint1111111111111111111111111111111',
    slot: 280_000_000,
    decodedState: {
      decimals: 6,
      rawSupply: 1_000_000_000_000n,
      isInitialized: true,
      mintAuthority: { kind: 'ABSENT_PROVEN' },
      freezeAuthority: { kind: 'ABSENT_PROVEN' },
      permanentDelegate: { kind: 'ABSENT_PROVEN' },
      transferHook: { kind: 'ABSENT_PROVEN' },
      parsedExtensions: [],
    },
  });

  // Sizing constrained: pool has 5 SOL, intended position is 10 SOL
  const illiquidCert = ExitabilityEngine.evaluateExitability({
    mint: 'IlliquidMint1111111111111111111111111111111',
    intendedPositionTokensRaw: 100_000_000n,
    intendedPositionSolValue: 10.0,
    tokenSemanticRoot: cleanSemantics,
    poolSolReserve: 5.0,
    poolTokenReserve: 50_000_000,
    availableRoutes: ['PUMP_BONDING_CURVE'],
    slot: 280_000_000,
  });

  assert.equal(illiquidCert.verdict, 'SIZING_REDUCED');
  assert.ok(illiquidCert.maxSafePositionSol < 1.0);

  // Totally unliquidatable: pool has only 0.1 SOL
  const collapsedCert = ExitabilityEngine.evaluateExitability({
    mint: 'DeadPoolMint11111111111111111111111111111111',
    intendedPositionTokensRaw: 100_000_000n,
    intendedPositionSolValue: 10.0,
    tokenSemanticRoot: cleanSemantics,
    poolSolReserve: 0.1,
    poolTokenReserve: 50_000_000,
    availableRoutes: ['PUMP_BONDING_CURVE'],
    slot: 280_000_000,
  });
  assert.equal(collapsedCert.isApprovedForExecution, false);
  assert.equal(collapsedCert.verdict, 'DENIED_EXIT_COLLAPSE');

  // Liquid token: pool has 100 SOL, intended position is 1 SOL
  const liquidCert = ExitabilityEngine.evaluateExitability({
    mint: 'LiquidMint222222222222222222222222222222222',
    intendedPositionTokensRaw: 10_000_000n,
    intendedPositionSolValue: 1.0,
    tokenSemanticRoot: cleanSemantics,
    poolSolReserve: 100.0,
    poolTokenReserve: 1_000_000_000,
    availableRoutes: ['RAYDIUM_AMM'],
    slot: 280_000_000,
  });

  assert.equal(liquidCert.isApprovedForExecution, true);
  assert.equal(liquidCert.verdict, 'PERMITTED');
  assert.ok(liquidCert.maxSafePositionSol >= 1.0);
});

test('CapitalBarrierKernel: enforces deterministic non-compensatory capital safety gating', () => {
  // Scenario 1: Clean healthy conditions with 1 SOL proposed
  const healthyVerdict = CapitalBarrierKernel.evaluateCapitalBarrier({
    proposedSizeSol: 1.0,
    totalBankrollSol: 100.0,
    currentDrawdownPct: 2.0,
    dailyRealizedLossSol: 0.5,
    maxDailyLossSol: 5.0,
    creatorClusterExposureSol: 1.0,
    maxCreatorExposureSol: 10.0,
    routeExposureSol: 1.0,
    maxRouteExposureSol: 10.0,
    stressedExitCapacitySol: 5.0,
    modelUncertainty: 0.1,
    executionReliability: 0.95,
    truthDebtCount: 0,
  });

  assert.equal(healthyVerdict.status, 'PERMITTED');
  assert.equal(healthyVerdict.authorizedSizeSol, 1.0);

  // Scenario 2: Drawdown breach -> Hard DENIED
  const ddVerdict = CapitalBarrierKernel.evaluateCapitalBarrier({
    proposedSizeSol: 1.0,
    totalBankrollSol: 100.0,
    currentDrawdownPct: 16.0, // > 15% limit
    dailyRealizedLossSol: 0.5,
    maxDailyLossSol: 5.0,
    creatorClusterExposureSol: 0.0,
    maxCreatorExposureSol: 10.0,
    routeExposureSol: 0.0,
    maxRouteExposureSol: 10.0,
    stressedExitCapacitySol: 5.0,
    modelUncertainty: 0.1,
    executionReliability: 0.95,
    truthDebtCount: 0,
  });

  assert.equal(ddVerdict.status, 'DENIED');
  assert.equal(ddVerdict.authorizedSizeSol, 0);
  assert.ok(ddVerdict.denialReasons[0].includes('MAX_DRAWDOWN_BREACH'));

  // Scenario 3: Stressed Exit Capacity throttles size
  const throttledVerdict = CapitalBarrierKernel.evaluateCapitalBarrier({
    proposedSizeSol: 2.0,
    totalBankrollSol: 100.0,
    currentDrawdownPct: 2.0,
    dailyRealizedLossSol: 0.0,
    maxDailyLossSol: 5.0,
    creatorClusterExposureSol: 0.0,
    maxCreatorExposureSol: 10.0,
    routeExposureSol: 0.0,
    maxRouteExposureSol: 10.0,
    stressedExitCapacitySol: 0.5, // Can only liquidate 0.5 SOL under stress
    modelUncertainty: 0.1,
    executionReliability: 0.95,
    truthDebtCount: 0,
  });

  assert.equal(throttledVerdict.status, 'THROTTLED');
  assert.equal(throttledVerdict.authorizedSizeSol, 0.5);
});

test('LifecycleXEngine: models 15 explicit phases and transition hazard distribution', () => {
  const engine = new LifecycleXEngine();
  const mint = 'LifecycleMint111111111111111111111111111';

  // Tick 1: Launch
  const s1 = engine.evaluateLifecycle({
    mint,
    ageSeconds: 5,
    bondingCurveProgressPct: 2.0,
    isMigratedToAmm: false,
    poolLiquiditySol: 30.0,
    peakLiquiditySol: 30.0,
    recentVolumeSol: 1.0,
    netCapitalFlowSol: 0.5,
    devHoldingPct: 2.0,
    isDevSold: false,
    currentSlot: 280_000_000,
    timestampMs: 1_000_000,
  });

  assert.equal(s1.currentPhase, 'LAUNCH');
  assert.ok(s1.pNextPhase.EARLY_BONDING > 0.5);

  // Tick 2: Curve Acceleration
  const s2 = engine.evaluateLifecycle(
    {
      mint,
      ageSeconds: 45,
      bondingCurveProgressPct: 65.0,
      isMigratedToAmm: false,
      poolLiquiditySol: 60.0,
      peakLiquiditySol: 60.0,
      recentVolumeSol: 30.0,
      netCapitalFlowSol: 15.0,
      devHoldingPct: 2.0,
      isDevSold: false,
      currentSlot: 280_000_100,
      timestampMs: 1_045_000,
    },
    s1
  );

  assert.equal(s2.currentPhase, 'CURVE_ACCELERATION');
  assert.equal(s2.previousPhase, 'LAUNCH');
  assert.equal(s2.transitionHistory.length, 2);
});

test('CapitalFlowEngine: tracks first/second derivatives, quality and toxicity', () => {
  const engine = new CapitalFlowEngine();
  const mint = 'CapitalFlowMint111111111111111111111111111';

  // Tick 1
  engine.evaluateFlow({
    mint,
    timestampMs: 1_000_000,
    slot: 280_000_000,
    grossBuySol: 5.0,
    grossSellSol: 1.0,
    independentEntityInflowSol: 4.5,
    uniqueBuyerCount: 10,
    uniqueEntityCount: 8,
    repeatBuyerCount: 2,
    creatorSellSol: 0.0,
    whaleBuySol: 1.0,
    poolLiquiditySol: 30.0,
  });

  // Tick 2: Accelerated inflow
  const state2 = engine.evaluateFlow({
    mint,
    timestampMs: 1_005_000, // 5s later
    slot: 280_000_012,
    grossBuySol: 20.0,
    grossSellSol: 2.0,
    independentEntityInflowSol: 18.0,
    uniqueBuyerCount: 25,
    uniqueEntityCount: 22,
    repeatBuyerCount: 8,
    creatorSellSol: 0.0,
    whaleBuySol: 5.0,
    poolLiquiditySol: 45.0,
  });

  assert.ok(state2.velocity > 0); // Positive dFlow/dt
  assert.ok(state2.quality >= 0.8); // High independent organic quality
  assert.equal(state2.toxicity, 0.0);
  assert.ok(state2.repeatBuyerRate > 0.2);
});

test('Multiplier-X: emits validated heuristic scores without probabilities or executable outcome claims', () => {
  const hazards = MultiplierResearchHeuristicEngine.evaluateResearchHeuristics({
    mint: 'HazardMint111111111111111111111111111111111',
    netCapitalFlowVelocity: 2.5,
    netCapitalFlowAcceleration: 0.8,
    poolLiquiditySol: 50.0,
    bondingCurveProgressPct: 75.0,
    authenticityProbability: 0.90,
    manipulationResistanceScore: 0.85,
    entityCount: 40,
    sellerAbsorptionRate: 0.92,
    currentMcapSol: 80.0,
    ageSeconds: 90,
    observationSlot: 280_000_000,
    timestampMs: 1_000_000,
  });

  assert.equal(hazards.status, 'UNCALIBRATED_RESEARCH_HEURISTIC');
  assert.ok(hazards.scores.expansion2x > 0.4);
  assert.ok(hazards.scores.relativeExpansion10xVersusFailureScore > 0.3);
  assert.ok(hazards.scores.rugRisk < 0.15);
  assert.equal('p10xBeforeFailure' in hazards, false);
  assert.equal('expectedTimeTo10xSec' in hazards, false);
  assert.equal(Object.isFrozen(hazards.scores), true);
  assert.throws(() => MultiplierResearchHeuristicEngine.evaluateResearchHeuristics({
    mint: 'bad', netCapitalFlowVelocity: 1, netCapitalFlowAcceleration: 1, poolLiquiditySol: 10,
    bondingCurveProgressPct: 50, authenticityProbability: 1.2, manipulationResistanceScore: 0.5,
    entityCount: 10, sellerAbsorptionRate: 0.5, currentMcapSol: 20, ageSeconds: 1,
    observationSlot: 5, timestampMs: 100,
  }), /MULTIPLIER_INVALID_FEATURE_RANGE/);
  assert.throws(() => MultiplierResearchHeuristicEngine.evaluateResearchHeuristics({
    mint: 'bad', netCapitalFlowVelocity: NaN, netCapitalFlowAcceleration: 1, poolLiquiditySol: 10,
    bondingCurveProgressPct: 50, authenticityProbability: 0.5, manipulationResistanceScore: 0.5,
    entityCount: 10, sellerAbsorptionRate: 0.5, currentMcapSol: 20, ageSeconds: 1,
    observationSlot: 5, timestampMs: 100,
  }), /MULTIPLIER_INVALID_FEATURE:netCapitalFlowVelocity/);

  // Caller-supplied chart prices plus assumed slippage are not executable evidence.
  const label = MultiplierResearchHeuristicEngine.analyzeObservedPath({
    mint: 'HazardMint111111111111111111111111111111111',
    observationSlot: 280_000_000,
    observationTimeMs: 1_000_000,
    entryPriceSol: 0.0001,
    peakPriceSol: 0.0011, // 11x chart peak
    troughPriceSol: 0.00009,
    exitPriceSol: 0.00095,
    entrySlippageBps: 150,
    exitSlippageBps: 200,
  });

  assert.equal(label.labelStatus, 'UNVERIFIED_RESEARCH_ONLY');
  assert.ok(label.chartPeakMultiple > 10);
  assert.ok(label.modeledMultipleAfterAssumedSlippage > 10);
  assert.equal('outcomeClass' in label, false);
  assert.throws(() => MultiplierResearchHeuristicEngine.analyzeObservedPath({
    mint: 'bad', observationSlot: 1, observationTimeMs: 1, entryPriceSol: 0,
    peakPriceSol: 1, troughPriceSol: 0.5, exitPriceSol: 0.8, entrySlippageBps: 0, exitSlippageBps: 0,
  }), /MULTIPLIER_INVALID_PATH_RANGE/);
});

test('MarketGrammarEngine: extracts sequential motifs and builds latent state distribution', () => {
  const grammar = new MarketGrammarEngine();
  const mint = 'GrammarMint1111111111111111111111111111';

  // Record organic progression: ORGANIC_BUY -> REPEAT_BUY -> LIQUIDITY_ADD
  grammar.recordEvent(mint, { type: 'CREATOR_INIT', entityId: 'e1', solAmount: 0.1, slot: 1, timestampMs: 1000 });
  grammar.recordEvent(mint, { type: 'ORGANIC_BUY', entityId: 'e2', solAmount: 1.0, slot: 2, timestampMs: 2000 });
  grammar.recordEvent(mint, { type: 'REPEAT_BUY', entityId: 'e2', solAmount: 1.5, slot: 3, timestampMs: 3000 });
  grammar.recordEvent(mint, { type: 'LIQUIDITY_ADD', entityId: 'e3', solAmount: 5.0, slot: 4, timestampMs: 4000 });

  const stateOrganic = grammar.evaluateGrammar(mint);
  assert.equal(stateOrganic.primaryLatentHypothesis, 'ORGANIC_EXPANSION');
  assert.ok(stateOrganic.latentStateDistribution.organicExpansion > 0.3);
  assert.ok(stateOrganic.sequenceCoherenceScore >= 0.7);

  // Now inject hostile sequence: SYBIL_SWARM -> PRICE_SPIKE -> PANIC_SELL
  grammar.recordEvent(mint, { type: 'SYBIL_SWARM', entityId: 'e_bot', solAmount: 0.05, slot: 5, timestampMs: 5000 });
  grammar.recordEvent(mint, { type: 'PRICE_SPIKE', entityId: 'e_bot', solAmount: 0.01, slot: 6, timestampMs: 6000 });
  grammar.recordEvent(mint, { type: 'PANIC_SELL', entityId: 'e_victim', solAmount: 2.0, slot: 7, timestampMs: 7000 });

  const stateHostile = grammar.evaluateGrammar(mint);
  assert.ok(stateHostile.sequenceSurpriseScore > 0.5);
  assert.ok(stateHostile.latentStateDistribution.coordinatedPump > 0.2);
});

test('HypothesisRegistry: manages 13-stage promotion ladder and Negative Knowledge DB', () => {
  const registry = new HypothesisRegistry();

  const h = registry.registerHypothesis({
    id: 'hypo_wallet_cohort_3',
    claim: 'Early buyer cohort 3 predicts 5x continuation',
    causalMechanism: 'Early smart money accumulation signal',
    expectedDirection: 'POSITIVE_ALPHA',
    targetPopulation: 'PumpFun graduated tokens',
    featureDefinition: 'cohort_3_retention_pct',
    predefinedMetric: 'precision_at_k',
    falsificationRule: 'Precision < 0.40 in out-of-sample walk-forward',
    datasetVersion: 'v2.1',
    codeVersion: 'git_hash_001',
  });

  assert.equal(h.currentStage, 'HYPOTHESIS');

  // Promote along ladder
  const p1 = registry.promote(h.id, 'DATA_AUDIT', 'audit_clean_evidence');
  assert.equal(p1.currentStage, 'DATA_AUDIT');

  const p2 = registry.promote(h.id, 'RETROSPECTIVE_RESEARCH', 'backtest_positive_evidence');
  assert.equal(p2.currentStage, 'RETROSPECTIVE_RESEARCH');

  // Attempting to skip stage throws
  assert.throws(() => {
    registry.promote(h.id, 'PRODUCTION', 'skip_attempt');
  }, /INVALID_PROMOTION_STEP/);

  // Falsify hypothesis
  registry.falsify(h.id, 'Walk forward precision fell to 0.18 under adversarial simulation', 'AstraFalsificationAgent', 'artifact_001');

  assert.equal(registry.getHypothesis(h.id)?.isFalsified, true);
  assert.equal(registry.getNegativeKnowledgeCount(), 1);

  // Attempting to re-register the same falsified idea is blocked by Negative Knowledge DB
  assert.throws(() => {
    registry.registerHypothesis({
      id: 'hypo_wallet_cohort_3',
      claim: 'Same claim again',
      causalMechanism: 'same',
      expectedDirection: 'POSITIVE_ALPHA',
      targetPopulation: 'same',
      featureDefinition: 'same',
      predefinedMetric: 'same',
      falsificationRule: 'same',
      datasetVersion: 'v2.2',
      codeVersion: 'git_hash_002',
    });
  }, /HYPOTHESIS_ALREADY_FALSIFIED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MarketStateEngine,
  CohortEngine,
  DivergenceEngine,
} from '../../dist/intelligence/context/market-state.js';

import {
  WorldModelEngineV2,
} from '../../dist/intelligence/world/world-state.js';

import {
  SurpriseEngine,
  InvestigationEngine,
} from '../../dist/intelligence/investigation/investigation-engine.js';

import {
  GOLDEN_SCENARIOS,
  SylphInvariantEngine,
  DatasetGuard,
} from '../../dist/intelligence/validation/golden-scenarios.js';

import {
  CanonicalTokenStore,
} from '../../dist/intelligence/truth/canonical-store.js';

test('Market State & Cohort Intelligence: Evaluates percentiles and market regime', () => {
  const store = new CanonicalTokenStore();
  const marketEngine = new MarketStateEngine();
  const cohortEngine = new CohortEngine();

  const token1 = store.registerToken({
    mint: 'MintCohort11111111111111111111111111111111',
    symbol: 'COH1',
    name: 'Cohort 1',
    creatorAddress: 'Creator1',
    initialLiquiditySol: 45.0,
  });

  const token2 = store.registerToken({
    mint: 'MintCohort22222222222222222222222222222222',
    symbol: 'COH2',
    name: 'Cohort 2',
    creatorAddress: 'Creator2',
    initialLiquiditySol: 20.0,
  });

  const market = marketEngine.computeMarketState([token1, token2], 190.0);
  assert.equal(market.solPriceUsd, 190.0);
  assert.ok(market.netLiquidityFlowSol >= 65.0);

  const cohort = cohortEngine.evaluateCohort(token1, [token1, token2]);
  assert.equal(cohort.liquidityPercentile, 1.0, 'Token 1 has highest liquidity in cohort');
});

test('Divergence Engine: Detects critical contradictions', () => {
  const divergenceEngine = new DivergenceEngine();
  const store = new CanonicalTokenStore();

  const token = store.registerToken({
    mint: 'MintDiv111111111111111111111111111111111111',
    symbol: 'DIV',
    name: 'Divergence Token',
    creatorAddress: 'CreatorDiv',
  });

  // Mutate into contradictory state: Extreme Pump but weak HSI
  const divergent = store.commitTransaction({
    transactionId: 'tx_div_1',
    mint: token.mint,
    mutation: () => ({
      pumpScore: 85,
      hsi: 25,
      volumeSol: 100.0,
      independentParticipantsCount: 2, // 100 SOL volume with only 2 participants!
    }),
    reason: 'Testing divergence detection',
    timestampMs: Date.now(),
  });

  const divergences = divergenceEngine.detectDivergences(divergent, true);
  assert.ok(divergences.length >= 2, 'Should detect at least 2 divergences');

  const types = divergences.map(d => d.type);
  assert.ok(types.includes('PUMP_UP_HSI_DOWN'));
  assert.ok(types.includes('VOLUME_UP_DIVERSITY_DOWN'));
});

test('Surprise Engine & Investigation: Unexpected deterioration triggers investigation with competing hypotheses', () => {
  const worldModel = new WorldModelEngineV2();
  const surpriseEngine = new SurpriseEngine();
  const invEngine = new InvestigationEngine();
  const store = new CanonicalTokenStore();

  const token = store.registerToken({
    mint: 'MintSurprise11111111111111111111111111111111',
    symbol: 'SURP',
    name: 'Surprise Token',
    creatorAddress: 'CreatorSurp',
    initialLiquiditySol: 50.0,
  });

  // Mutate token to high HSI -> World Model expects IMPROVING
  const strongToken = store.commitTransaction({
    transactionId: 'tx_strong',
    mint: token.mint,
    mutation: () => ({ hsi: 70, pumpScore: 65, podState: 'P', trajectory: 'IMPROVING' }),
    reason: 'Strong initial state',
    timestampMs: Date.now(),
  });

  const forecast = worldModel.generateForecast(strongToken, { marketRegime: 'NORMAL' });
  assert.equal(forecast.currentTrajectory, 'IMPROVING');

  // Sudden catastrophic real outcome: WEAKENING
  const evalResult = surpriseEngine.evaluate(forecast, 'WEAKENING');
  assert.equal(evalResult.isHighSurprise, true);
  assert.ok(evalResult.surpriseScore >= 0.70);

  // Open investigation case
  const invCase = invEngine.openInvestigation({
    mint: token.mint,
    reason: 'Sudden collapse when IMPROVING trajectory was forecasted',
    stateVersion: strongToken.stateVersion,
  });

  assert.equal(invCase.status, 'OPEN');
  assert.equal(invCase.hypotheses.length, 2);

  // Resolve case with verified root cause
  const resolved = invEngine.resolveCase({
    caseId: invCase.caseId,
    confirmedCategory: 'GRAPH',
    resolution: 'Coordinated Sybil cluster dumped 40% of supply simultaneously',
  });

  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.confirmedRootCause, 'GRAPH');

  const records = invEngine.getAllKnowledgeRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].rootCause, 'GRAPH');
  assert.ok(records[0].disprovenHypotheses.length > 0);
});

test('Golden Scenarios Library: Evaluates deterministic scenarios', () => {
  assert.ok(GOLDEN_SCENARIOS.length >= 5);
  for (const scen of GOLDEN_SCENARIOS) {
    assert.ok(scen.scenarioId);
    assert.ok(scen.type);
    assert.ok(scen.inputEvents.length > 0);
    assert.equal(scen.expectedInvariantPassed, true);
  }
});

test('SylphInvariantEngine & DatasetGuard: Enforces strict non-negotiable invariants', () => {
  const invariantEngine = new SylphInvariantEngine();
  const guard = new DatasetGuard();
  const store = new CanonicalTokenStore();

  const token = store.registerToken({
    mint: 'MintInv111111111111111111111111111111111111',
    symbol: 'INV',
    name: 'Invariant Token',
    creatorAddress: 'CreatorInv',
  });

  // Valid execution context
  const resValid = invariantEngine.assertInvariants(token, {
    hasDecisionId: true,
    hasModelVersion: true,
  });
  assert.equal(resValid.passed, true);
  assert.equal(resValid.violations.length, 0);

  // Violation: execution attempted without DecisionId
  const resInvalid = invariantEngine.assertInvariants(token, {
    hasDecisionId: false,
    hasModelVersion: true,
  });
  assert.equal(resInvalid.passed, false);
  assert.ok(resInvalid.violations[0].includes('DecisionId'));

  // Dataset Guard: Block REPLAY data entering PRODUCTION
  const guardRes = guard.validateDatasetEntry('REPLAY', 'PRODUCTION');
  assert.equal(guardRes.permitted, false);
  assert.ok(guardRes.reason?.includes('contaminate'));
});

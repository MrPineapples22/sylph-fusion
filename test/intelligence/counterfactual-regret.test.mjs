import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionRegretEngine,
  CounterfactualRegretStore,
} from '../../dist/intelligence/forensics/counterfactual-regret-store.js';

test('ExecutionRegretEngine: decomposes loss into orthogonal alpha destruction buckets', () => {
  const evalResult = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_test_1',
    opportunityId: 'opp_test_1',
    tokenId: 'mint_loss_1',
    slot: 100_000,
    actionTaken: 'FAST_BUY',
    expectedNetEvBps: 300,
    expectedSlippageBps: 50,
    realizedPnlBps: -150,
    realizedSlippageBps: 180, // +130 bps excess slippage! (Execution failure)
    realizedTipLamports: 100_000n,
    discoveryLagMs: 120, // Discovery was fine (< 150ms)
    peakObservedPriceBps: 200,
    drawdownObservedPriceBps: -250,
    subsequentSlotPriceDeltasBps: [50, -50, -100],
  });

  assert.equal(evalResult.decisionId, 'dec_test_1');
  assert.equal(evalResult.realizedPnlBps, -150);
  assert.equal(evalResult.alphaDecomposition.discoveryRegretBps, 0);
  assert.equal(evalResult.alphaDecomposition.executionRegretBps, 130); // 180 - 50 = 130 bps
  assert.equal(evalResult.primaryFailureSubsystem, 'EXIT'); // Peak was +200, closed at -150 (350 bps exit regret)
  assert.ok(evalResult.scenarios.length >= 5);
  assert.ok(evalResult.overallRegretBps > 0);
});

test('ExecutionRegretEngine: detects discovery regret on high lag', () => {
  const evalResult = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_test_2',
    opportunityId: 'opp_test_2',
    tokenId: 'mint_loss_2',
    slot: 100_010,
    actionTaken: 'FAST_BUY',
    expectedNetEvBps: 0,
    expectedSlippageBps: 50,
    realizedPnlBps: -80,
    realizedSlippageBps: 50,
    realizedTipLamports: 50_000n,
    discoveryLagMs: 650, // 500ms over baseline -> 200 bps discovery regret
    peakObservedPriceBps: -60, // Peak was already gone by late entry
    drawdownObservedPriceBps: -100,
  });

  assert.ok(evalResult.alphaDecomposition.discoveryRegretBps >= 150);
  assert.equal(evalResult.primaryFailureSubsystem, 'DISCOVERY');
  assert.match(evalResult.actionablePolicyTuning, /Yellowstone/);
});

test('CounterfactualRegretStore: records evaluations and computes rolling aggregate report', () => {
  const store = new CounterfactualRegretStore(50);

  // Record 2 trades where execution regret dominates
  const trade1 = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_1',
    opportunityId: 'opp_1',
    tokenId: 'mint_A',
    strategyVersion: 'sylph_momentum_v1.0',
    slot: 1000,
    actionTaken: 'FAST_BUY',
    expectedNetEvBps: 120,
    expectedSlippageBps: 50,
    realizedPnlBps: 100,
    realizedSlippageBps: 200, // 150 bps execution regret
    realizedTipLamports: 50_000n,
    discoveryLagMs: 100,
    peakObservedPriceBps: 120, // Pricing accurate
  });

  const trade2 = ExecutionRegretEngine.evaluateDecisionRegret({
    decisionId: 'dec_2',
    opportunityId: 'opp_2',
    tokenId: 'mint_B',
    strategyVersion: 'sylph_momentum_v1.0',
    slot: 1005,
    actionTaken: 'FAST_BUY',
    expectedNetEvBps: 70,
    expectedSlippageBps: 50,
    realizedPnlBps: 50,
    realizedSlippageBps: 220, // 170 bps execution regret
    realizedTipLamports: 50_000n,
    discoveryLagMs: 100,
    peakObservedPriceBps: 70, // Pricing accurate
  });

  store.recordEvaluation(trade1);
  store.recordEvaluation(trade2);

  assert.equal(store.getEvaluation('cfr_opp_1_1000')?.tokenId, 'mint_A');
  assert.equal(store.getEvaluationsForToken('mint_B').length, 1);

  const report = store.getAggregateRegretReport('sylph_momentum_v1.0');
  assert.equal(report.sampleCount, 2);
  assert.equal(report.meanRealizedPnlBps, 75); // (100 + 50) / 2
  assert.equal(report.dominantRegretSubsystem, 'EXECUTION');
  assert.match(report.recommendedAdjustment, /EXECUTION/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FisherStatisticalEvidenceEngine } from '../../dist/intelligence/science/fisher-evidence.js';
import { FranklinControlledExperimentationEngine } from '../../dist/intelligence/experimentation/franklin-experiment.js';
import { DaVinciStrategySynthesisEngine } from '../../dist/intelligence/synthesis/davinci-synthesis.js';
import { GalileoRealityReconciliationEngine } from '../../dist/intelligence/reconciliation/galileo-reconciliation.js';
import { PavlovOutcomeAttributionEngine } from '../../dist/intelligence/attribution/pavlov-attribution.js';
import { EdisonContinuousVerificationEngine } from '../../dist/intelligence/verification/edison-verification.js';

test('Layer 8 - Fisher Multiple Testing & Negative Experiment Archive', () => {
  const tests = [
    { test_id: 't1', hypothesis_name: 'h1', sample_size: 100, raw_p_value: 0.001, observed_alpha_bps: 80, transaction_cost_bps: 20, is_null_result: false, timestamp_ms: Date.now() },
    { test_id: 't2', hypothesis_name: 'h2', sample_size: 100, raw_p_value: 0.045, observed_alpha_bps: 25, transaction_cost_bps: 20, is_null_result: false, timestamp_ms: Date.now() }, // Not economically significant
    { test_id: 't3', hypothesis_name: 'h3', sample_size: 15,  raw_p_value: 0.002, observed_alpha_bps: 90, transaction_cost_bps: 20, is_null_result: false, timestamp_ms: Date.now() }  // Sample size < 30
  ];

  const evalBatch = FisherStatisticalEvidenceEngine.evaluateBatch(tests, 0.05);
  assert.equal(evalBatch.length, 3);
  // t1 is both statistically and economically significant with sample size >= 30
  assert.equal(evalBatch.find(e => e.test_id === 't1')?.accepted_as_valid_evidence, true);
  // t2 net alpha (5 bps) is too small relative to costs
  assert.equal(evalBatch.find(e => e.test_id === 't2')?.accepted_as_valid_evidence, false);
  // t3 sample size 15 is insufficient
  assert.equal(evalBatch.find(e => e.test_id === 't3')?.accepted_as_valid_evidence, false);

  const fisher = new FisherStatisticalEvidenceEngine();
  fisher.recordNegativeResult({
    test_id: 't_null',
    hypothesis_name: 'failed_indicator',
    sample_size: 200,
    raw_p_value: 0.85,
    observed_alpha_bps: -10,
    transaction_cost_bps: 20,
    is_null_result: true,
    timestamp_ms: Date.now()
  });
  assert.equal(fisher.getNegativeArchiveCount(), 1);
});

test('Layer 8 - Franklin 9-Stage Experimentation & Da Vinci Strategy Synthesis', () => {
  const franklin = new FranklinControlledExperimentationEngine();
  const exp = franklin.registerExperiment({
    name: 'adaptive_slippage_model',
    hypothesis: 'Dynamic slippage bounds reduce sandwich losses by 40%',
    rollback_version: '1.0.0'
  });
  assert.equal(exp.current_stage, 'STAGE_1_HYPOTHESIS');

  // Successful promotion to OFFLINE
  const promo = franklin.evaluatePromotion(exp.experiment_id, {
    samples: 50,
    sharpe: 2.1,
    win_rate: 0.65,
    drawdown_pct: 6.5,
    brier_score: 0.12
  });
  assert.equal(promo.promoted, true);
  assert.equal(promo.next_stage, 'STAGE_2_OFFLINE');

  // Excessive drawdown rejection
  const promoFail = franklin.evaluatePromotion(exp.experiment_id, {
    samples: 50,
    sharpe: 1.2,
    win_rate: 0.50,
    drawdown_pct: 18.0, // exceeds 15% ceiling
    brier_score: 0.15
  });
  assert.equal(promoFail.promoted, false);
  assert.ok(promoFail.rejection_reason?.includes('exceeds 15% safety limit'));

  // Da Vinci strategy synthesis
  const davinci = new DaVinciStrategySynthesisEngine();
  const hyp = davinci.synthesizeHypothesis({
    name: 'WhaleInflow_x_LowConcentration',
    feature_combination: ['whale_inflow_sol', 'top10_concentration'],
    condition_logic: 'whale_inflow > 10 AND top10 < 0.20',
    initial_rationale: 'Whale entering distributed token signals organic conviction'
  });
  assert.equal(hyp.status, 'PROPOSED');
  assert.equal(davinci.getActiveProposals().length, 1);
});

test('Layer 8 - Galileo Reality Reconciliation & Pavlov Decision Credit', () => {
  const galileo = new GalileoRealityReconciliationEngine();
  // Accurate forecast
  const compAccurate = galileo.reconcile({
    token_mint: 'MINT_A',
    forecast_ev_pnl: +15.0,
    observed_realized_pnl: +14.2
  });
  assert.ok(compAccurate.surprise_score < 0.20);
  assert.equal(compAccurate.thesis_decay_detected, false);

  // Large surprise / directional flip
  const compSurprise = galileo.reconcile({
    token_mint: 'MINT_B',
    forecast_ev_pnl: +25.0,
    observed_realized_pnl: -30.0
  });
  assert.ok(compSurprise.surprise_score > 0.60);
  assert.equal(compSurprise.thesis_decay_detected, true);

  // Pavlov attribution: Good decision / Bad outcome (neutral variance)
  const pavlov = new PavlovOutcomeAttributionEngine();
  const recVariance = pavlov.attributeOutcome({
    token_mint: 'MINT_VAR',
    action_taken: 'BUY',
    was_decision_sound: true, // Valid process
    realized_pnl_pct: -5.0   // Unlucky loss
  });
  assert.equal(recVariance.credit_archetype, 'GOOD_DECISION_BAD_OUTCOME');
  assert.equal(recVariance.policy_reinforcement_action, 'NEUTRAL_VARIANCE');

  // Pavlov attribution: Bad decision / Good outcome (do not reinforce luck!)
  const recLuck = pavlov.attributeOutcome({
    token_mint: 'MINT_LUCK',
    action_taken: 'BUY',
    was_decision_sound: false, // Bypassed checklist
    realized_pnl_pct: +40.0    // Got lucky
  });
  assert.equal(recLuck.credit_archetype, 'BAD_DECISION_GOOD_OUTCOME');
  assert.equal(recLuck.policy_reinforcement_action, 'DO_NOT_REINFORCE_LUCK');
});

test('Layer 8 - Edison golden scenario catalogue does not fabricate verification', () => {
  const results = EdisonContinuousVerificationEngine.runAllGoldenScenarios();
  assert.equal(results.length, 25);
  for (const r of results) {
    assert.equal(r.passed, false, `Scenario ${r.id} (${r.name}) must not claim verification without a harness`);
    assert.equal(r.status, 'UNIMPLEMENTED');
    assert.match(r.notes, /No executable scenario harness/);
    assert.ok(r.invariant_verified.length > 0);
  }
  assert.equal(results.some((result) => result.passed), false);
});

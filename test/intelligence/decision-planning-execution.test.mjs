import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TuringMetaReasoningEngine } from '../../dist/intelligence/orchestration/turing-orchestrator.js';
import { BayesDecisionTheoreticActionEngine } from '../../dist/intelligence/decision/bayes-decision.js';
import { ApolloMissionPlanner } from '../../dist/intelligence/planning/apollo-planner.js';
import { PrometheusPortfolioCapitalEngine } from '../../dist/intelligence/portfolio/prometheus-capital.js';
import { VonNeumannExecutionStateMachine } from '../../dist/intelligence/execution/von-neumann-machine.js';
import { HermesExecutionSynchronizationEngine } from '../../dist/intelligence/execution/hermes-timing.js';

test('Layer 7 - Turing Meta-Reasoning & Abstention on High Uncertainty', () => {
  // High uncertainty triggers automatic abstention ("INSUFFICIENT EVIDENCE")
  const resUncertain = TuringMetaReasoningEngine.arbitrate('MINT_TURING', [
    { engine_name: 'bohr', recommended_action: 'BUY', confidence: 0.9, rationale: 'Breakout' }
  ], 0.75); // 0.75 uncertainty mass > 0.65 ceiling

  assert.equal(resUncertain.synthesized_action, 'ABSTAIN');
  assert.equal(resUncertain.epistemic_state, 'HIGH_UNCERTAINTY_ABSTAIN');
  assert.ok(resUncertain.justification.includes('INSUFFICIENT EVIDENCE'));

  // Decisive consensus under acceptable uncertainty
  const resConsensus = TuringMetaReasoningEngine.arbitrate('MINT_TURING', [
    { engine_name: 'bohr', recommended_action: 'BUY', confidence: 0.85, rationale: 'Organic expansion' },
    { engine_name: 'kepler', recommended_action: 'BUY', confidence: 0.80, rationale: 'Accelerating trajectory' },
    { engine_name: 'bayes', recommended_action: 'BUY', confidence: 0.75, rationale: 'Positive expected utility' }
  ], 0.20);

  assert.equal(resConsensus.synthesized_action, 'BUY');
  assert.equal(resConsensus.consensus_level, 'UNANIMOUS');
});

test('Layer 7 - Bayes Action Logic & Stop-Thinking Rule', () => {
  // Candidate with positive EV, low uncertainty
  const decEnter = BayesDecisionTheoreticActionEngine.evaluateDecision({
    token_mint: 'MINT_BAYES',
    expected_ev_pnl: 22.0,
    tail_risk_drawdown: -8.0,
    exitability: 0.95,
    uncertainty_mass: 0.15,
    info_gain_potential: 0.05,
    delay_cost: 0.10, // delay cost > info gain -> stop thinking!
    current_position_size_sol: 0,
    max_position_size_sol: 1.0
  });

  assert.equal(decEnter.selected_action, 'ENTER');
  assert.equal(decEnter.stop_thinking_triggered, true);
  assert.ok(decEnter.expected_utility > 0);

  // Moderate uncertainty with high information gain -> INVESTIGATE / WAIT
  const decWait = BayesDecisionTheoreticActionEngine.evaluateDecision({
    token_mint: 'MINT_BAYES_2',
    expected_ev_pnl: 10.0,
    tail_risk_drawdown: -25.0,
    exitability: 0.60,
    uncertainty_mass: 0.50,
    info_gain_potential: 0.80, // high info gain potential
    delay_cost: 0.05,
    current_position_size_sol: 0,
    max_position_size_sol: 1.0
  });

  assert.ok(decWait.selected_action === 'WAIT' || decWait.selected_action === 'INVESTIGATE');
  assert.equal(decWait.stop_thinking_triggered, false);
});

test('Layer 7 - Apollo Mission Lifecycle & Prometheus Capital Sizing', () => {
  const apollo = new ApolloMissionPlanner();
  const mission = apollo.createMission({
    token_mint: 'MINT_APOLLO',
    priority: 'P3_HIGH_POTENTIAL',
    objective: 'Breakout capture',
    risk_budget_sol: 1.5,
    ttl_minutes: 30
  });
  assert.equal(mission.state, 'CREATED');

  apollo.transitionState('MINT_APOLLO', 'MONITORING_ACTIVE');
  const active = apollo.getActivePositions();
  assert.equal(active.length, 1);
  assert.equal(active[0].priority, 'P1_ACTIVE_POSITION');

  // Prometheus Capital allocation
  const portfolioState = {
    total_portfolio_value_sol: 50,
    unencumbered_cash_sol: 20,
    current_exposure_sol: 10,
    max_allowable_exposure_sol: 25,
    emergency_reserve_sol: 5,
    max_single_token_sol: 1.5,
    max_concurrent_positions: 5,
    active_positions_count: 1
  };

  const allocOk = PrometheusPortfolioCapitalEngine.allocateCapital({
    token_mint: 'MINT_APOLLO',
    pool_liquidity_sol: 100, // 2% of pool is 2 SOL
    exitability_factor: 0.90,
    confidence_score: 0.85,
    existing_cluster_exposure_sol: 0
  }, portfolioState);

  assert.equal(allocOk.is_zero_allocation, false);
  assert.ok(allocOk.allocated_size_sol > 0.5 && allocOk.allocated_size_sol <= 1.5);

  // Cash constrained allocation (emergency reserve inviolable)
  const brokeState = { ...portfolioState, unencumbered_cash_sol: 5.05 }; // only 0.05 spendable!
  const allocZero = PrometheusPortfolioCapitalEngine.allocateCapital({
    token_mint: 'MINT_BROKE',
    pool_liquidity_sol: 100,
    exitability_factor: 0.9,
    confidence_score: 0.9,
    existing_cluster_exposure_sol: 0
  }, brokeState);

  assert.equal(allocZero.is_zero_allocation, true);
  assert.ok(allocZero.limiting_constraint.includes('Emergency SOL reserve'));
});

test('Layer 7 - Von Neumann State Machine & Hermes Execution Sync', () => {
  // Formal execution flow
  let intent = VonNeumannExecutionStateMachine.createIntent({
    token_mint: 'MINT_EXEC',
    action: 'BUY',
    amount_lamports: 500_000_000,
    max_slippage_bps: 100
  });
  assert.equal(intent.state, 'OBSERVE');

  intent = VonNeumannExecutionStateMachine.transition(intent, 'ANALYZE');
  intent = VonNeumannExecutionStateMachine.transition(intent, 'PROPOSE');

  // Illegal transition check: PROPOSE cannot skip directly to SIGNED
  assert.throws(() => {
    VonNeumannExecutionStateMachine.transition(intent, 'SIGNED');
  }, /VON NEUMANN ILLEGAL TRANSITION/);

  // Transition to RISK_CHECKED requires guardian token
  assert.throws(() => {
    VonNeumannExecutionStateMachine.transition(intent, 'RISK_CHECKED');
  }, /without Guardian authorization/);

  intent = VonNeumannExecutionStateMachine.transition(intent, 'RISK_CHECKED', { guardian_token: 'guard_ok_99' });
  assert.equal(intent.state, 'RISK_CHECKED');

  // Hermes Timing: Requote on stale quote (>2500ms)
  const hermes = new HermesExecutionSynchronizationEngine();
  const timingStale = hermes.evaluateTiming({
    quote_age_ms: 3200,
    estimated_landing_latency_ms: 250,
    market_velocity_pct_per_sec: 0.5,
    max_slippage_bps: 100
  });
  assert.equal(timingStale.decision, 'REQUOTE');

  // Abandon if market velocity causes expected drift to exceed slippage
  const timingFast = hermes.evaluateTiming({
    quote_age_ms: 300,
    estimated_landing_latency_ms: 800,
    market_velocity_pct_per_sec: 2.0, // 2% per second!
    max_slippage_bps: 50 // 0.5% max slippage
  });
  assert.equal(timingFast.decision, 'ABANDON');
});

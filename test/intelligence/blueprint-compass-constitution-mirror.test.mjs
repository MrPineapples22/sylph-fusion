import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionCompassEngine } from '../../dist/intelligence/compass/mission-compass.js';
import { ConstitutionRegistry } from '../../dist/intelligence/governance/constitution-registry.js';
import { MirrorShadowEngine } from '../../dist/intelligence/mirror/shadow-portfolio.js';

test('COMPASS - Mission Modes, Hysteresis & Multi-Objective Decision Utility (DUO)', () => {
  const compass = new MissionCompassEngine();
  assert.equal(compass.getCurrentMode(), 'NORMAL');

  // 1. Mode Transition Hysteresis (Requires 3 samples)
  const t1 = compass.proposeModeTransition('DEFENSIVE', 'Rising volatility');
  assert.equal(t1.transitioned, false);
  assert.equal(compass.getCurrentMode(), 'NORMAL');

  const t2 = compass.proposeModeTransition('DEFENSIVE', 'Rising volatility');
  assert.equal(t2.transitioned, false);

  const t3 = compass.proposeModeTransition('DEFENSIVE', 'Rising volatility');
  assert.equal(t3.transitioned, true);
  assert.equal(compass.getCurrentMode(), 'DEFENSIVE');

  // 2. Multi-Objective Decision Utility (DUO)
  // Nominal scenario
  const evalNominal = compass.evaluateUtility({
    expected_edge_bps: 120,
    trapping_score: 0.2,
    optionality_score: 0.8,
    drawdown_pct: 5,
    systemic_risk_score: 0.2,
    uncertainty_score: 0.1,
  });

  assert.equal(evalNominal.hard_constraints_passed, true);
  assert.ok(evalNominal.composite_utility_score > 0);
  assert.equal(evalNominal.recommended_action_scaling, 1.0);

  // Hard constraint breach: Drawdown > 25%
  const evalBreach = compass.evaluateUtility({
    expected_edge_bps: 300,
    trapping_score: 0.2,
    optionality_score: 0.8,
    drawdown_pct: 28, // Breaches 25% hard constraint
    systemic_risk_score: 0.2,
    uncertainty_score: 0.1,
  });

  assert.equal(evalBreach.hard_constraints_passed, false);
  assert.equal(evalBreach.recommended_action_scaling, 0.0); // Complete veto
  assert.ok(evalBreach.hard_constraint_failures[0].includes('Drawdown breach'));
});

test('CONSTITUTION - Machine Governance, Authority Restriction Invariant & Lineage', () => {
  const constReg = new ConstitutionRegistry();
  const summary = constReg.getGovernanceSummary();

  assert.ok(summary.totalPolicies >= 4);
  assert.equal(summary.constitutionVersion, '1.0.0-immutable');

  // 1. Authority Principle: Subsystem cannot independently expand authority
  const clamped = constReg.verifyAuthorityClamp(2.5, 4.0); // Governor max is 2.5, requested 4.0
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.authorized_size_sol, 2.5);

  const within = constReg.verifyAuthorityClamp(2.5, 1.5);
  assert.equal(within.clamped, false);
  assert.equal(within.authorized_size_sol, 1.5);

  // 2. Policy Lineage Tracking
  const lineage = {
    constitution_version: '1.0.0',
    safety_policy_id: 'pol_safety_max_slippage_bound',
    mission_policy_id: 'pol_mission_capital_governor',
    capital_policy_id: 'pol_mission_capital_governor',
    strategy_policy_id: 'pol_strategy_proof_quorum',
    decision_id: 'dec_123',
    intent_id: 'intent_123',
    transaction_signature: 'sig_sol_mock',
  };
  constReg.recordLineage(lineage);
  assert.deepEqual(constReg.getLineage('dec_123'), lineage);

  // 3. Configuration Namespaces
  assert.equal(constReg.getConfig('safety/max_drawdown_limit_pct', 0), 25);
  constReg.setConfig('execution/jito_tip_max_sol', 0.02);
  assert.equal(constReg.getConfig('execution/jito_tip_max_sol', 0), 0.02);
});

test('MIRROR - Counterfactual Decision Forks, Friction & Decision Regret', () => {
  const mirror = new MirrorShadowEngine();
  const mint = 'SoL33333333333333333333333333333333333333334';

  // Live decision entered 1.0 SOL at price 1.0, exited at 1.2 (+20% gross)
  const simulation = mirror.forkDecision(mint, 1.0, 1.0, 1.2, {
    slippage_bps: 35,
    network_fee_sol: 0.0005,
    landing_probability: 0.95,
  });

  assert.equal(simulation.mint, mint);
  assert.equal(simulation.branches.length, 5); // LIVE, SKIP, WAIT, ENTER_25, ENTER_75

  const liveBranch = simulation.branches.find((b) => b.branch_type === 'LIVE');
  const skipBranch = simulation.branches.find((b) => b.branch_type === 'SKIP');
  assert.ok(liveBranch);
  assert.ok(skipBranch);
  assert.equal(skipBranch.realized_pnl_sol, 0); // Skip has 0 PnL
  assert.ok(liveBranch.realized_pnl_sol > 0.15); // Live made ~+0.199 SOL net

  // Decision regret: since price rose, live was best, so regret is 0
  assert.equal(simulation.decision_regret_sol, 0);
  assert.equal(simulation.best_counterfactual_branch, 'LIVE');

  // Verify ablations calculated
  assert.ok(simulation.ablation_results.without_wallet_graph_edge_bps > 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HawkingTokenDigitalTwinEngine } from '../../dist/intelligence/world/hawking-world.js';
import { LorentzSensitivityEngine } from '../../dist/intelligence/projections/lorentz-sensitivity.js';
import { MaxwellAdversarialSimulationEngine } from '../../dist/intelligence/simulation/maxwell-twin.js';

test('Layer 6 - Hawking Token Digital Twin Multi-Path Simulation', () => {
  const twin = HawkingTokenDigitalTwinEngine.simulateScenarios({
    token_mint: 'MINT_HAWKING',
    current_price_sol: 0.002,
    liquidity_sol: 50,
    position_size_sol: 2.0, // 4% of pool
    buy_pressure: 0.75,
    pod_score: 0.20,
    whale_holding_sol: 5
  });

  assert.equal(twin.scenario_distribution.length, 5);
  // Probabilities sum to approx 1.0
  const sumP = twin.scenario_distribution.reduce((acc, s) => acc + s.probability, 0);
  assert.ok(Math.abs(sumP - 1.0) < 0.05);

  assert.ok(twin.expected_value_pnl_pct > 0);
  assert.ok(twin.exitability_for_position_sol > 0.70); // 4% impact is liquid
  assert.ok(twin.tail_risk_drawdown_pct < 0);
});

test('Layer 6 - Lorentz Forecast Sensitivity & Fragility', () => {
  // Robust case: high EV, high liquidity
  const repRobust = LorentzSensitivityEngine.testSensitivity({
    token_mint: 'MINT_STABLE',
    baseline_ev_pnl: +25.0,
    liquidity_sol: 100,
    buy_pressure: 0.85,
    pod_score: 0.15
  });
  assert.ok(repRobust.forecast_fragility_score < 0.50);
  assert.ok(repRobust.decision_weight_multiplier > 0.60);
  assert.ok(repRobust.reliable_horizon_sec > 60);

  // Fragile case: tiny EV (+1.5%), thin liquidity (8 SOL)
  const repFragile = LorentzSensitivityEngine.testSensitivity({
    token_mint: 'MINT_FRAGILE',
    baseline_ev_pnl: +1.5,
    liquidity_sol: 8,
    buy_pressure: 0.52,
    pod_score: 0.40
  });
  // Minor perturbation flips action from BUY to NEGATIVE
  assert.ok(repFragile.forecast_fragility_score > 0.50);
  assert.ok(repFragile.decision_weight_multiplier < 0.50);
});

test('Layer 6 - Maxwell Adversarial Simulator', () => {
  // Safe configuration
  const safeRun = MaxwellAdversarialSimulationEngine.runAdversarialSuite({
    max_slippage_bps: 200, // 2% slippage cap protects against MEV
    guardian_active: true,
    fail_closed_on_rpc_loss: true,
    ttl_window_ms: 3000 // 3s TTL prevents stale quotes
  });

  for (const res of safeRun) {
    assert.equal(res.did_survive_safely, true);
    assert.equal(res.loss_contained_within_limit, true);
    assert.equal(res.executed_under_stale_data, false);
  }

  // Dangerous configuration (high slippage, no fail-closed, long TTL)
  const unsafeRun = MaxwellAdversarialSimulationEngine.runAdversarialSuite({
    max_slippage_bps: 1000,
    guardian_active: false,
    fail_closed_on_rpc_loss: false,
    ttl_window_ms: 15000
  });

  assert.ok(unsafeRun.some(r => !r.did_survive_safely));
});

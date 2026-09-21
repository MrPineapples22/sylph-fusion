import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CantorSearchUniverseEngine } from '../../dist/intelligence/discovery/cantor-universe.js';
import { BohrCompetingHypothesisEngine } from '../../dist/intelligence/bohr/competing-hypotheses.js';
import { KeplerTrajectoryEngine } from '../../dist/intelligence/trajectory/kepler-trajectory.js';
import { ChandrasekharCriticalityEngine } from '../../dist/intelligence/criticality/chandrasekhar-criticality.js';

test('Layer 4 - Cantor Universe Progressive Funnel & Resurrection', () => {
  const cantor = new CantorSearchUniverseEngine();

  // Register token
  const cand = cantor.registerOrUpdateCandidate('MINT_ALPHA', 'ALPHA', ['NOVELTY']);
  assert.equal(cand.current_stage, 'GLOBAL');
  assert.equal(cand.is_resurrected, false);

  // Fails cheap screen (liquidity < 0.5)
  const failed = cantor.evaluateCandidate('MINT_ALPHA', {
    has_active_pool: true,
    liquidity_sol: 0.2,
    structural_integrity_score: 80,
    unique_buyers_count: 5,
    whale_inflow_sol: 0
  });
  assert.equal(failed.current_stage, 'GLOBAL');
  assert.ok(failed.filtering_reason?.includes('Failed cheap screen'));

  // Resurrect when fresh liquidity arrives
  const resurrected = cantor.registerOrUpdateCandidate('MINT_ALPHA', 'ALPHA', ['LIQUIDITY_EXPANSION']);
  assert.equal(resurrected.is_resurrected, true);

  // Passes to Deep Investigation
  const deep = cantor.evaluateCandidate('MINT_ALPHA', {
    has_active_pool: true,
    liquidity_sol: 25.0,
    structural_integrity_score: 95,
    unique_buyers_count: 35,
    whale_inflow_sol: 18.0
  });
  assert.equal(deep.current_stage, 'DEEP_INVESTIGATION');
  assert.ok(deep.assigned_universes.includes('WHALE'));
  assert.ok(deep.assigned_universes.includes('BREAKOUT'));
});

test('Layer 4 - Bohr Attention Tiers (A0-A6)', () => {
  const bohr = new BohrCompetingHypothesisEngine();

  // Emergency bypass
  const a6 = bohr.computeAttentionTier({
    is_emergency: true,
    is_live_position: false,
    pod_score: 0.1,
    dominant_hypothesis: 'ORGANIC_EXPANSION',
    unique_buyers: 20,
    whale_activity: false
  });
  assert.equal(a6.tier, 'A6');
  assert.equal(a6.label, 'EMERGENCY');
  assert.equal(a6.refresh_rate_ms, 100);

  // Live position priority
  const a5 = bohr.computeAttentionTier({
    is_emergency: false,
    is_live_position: true,
    pod_score: 0.2,
    dominant_hypothesis: 'ORGANIC_EXPANSION',
    unique_buyers: 20,
    whale_activity: false
  });
  assert.equal(a5.tier, 'A5');
  assert.equal(a5.label, 'LIVE_POSITION');

  // Background tier
  const a0 = bohr.computeAttentionTier({
    is_emergency: false,
    is_live_position: false,
    pod_score: 0.1,
    dominant_hypothesis: 'UNKNOWN_MECHANISM',
    unique_buyers: 2,
    whale_activity: false
  });
  assert.equal(a0.tier, 'A0');
  assert.equal(a0.refresh_rate_ms, 15000);
});

test('Layer 4 - Kepler Trajectory & Chandrasekhar Criticality', () => {
  // Kepler trajectory
  const t0 = Date.now() - 120000;
  const points = [
    { timestamp_ms: t0, price_sol: 0.0010, liquidity_sol: 10, volume_sol: 2, buy_pressure: 0.8, unique_buyers: 5 },
    { timestamp_ms: t0 + 30000, price_sol: 0.0012, liquidity_sol: 11, volume_sol: 5, buy_pressure: 0.85, unique_buyers: 12 },
    { timestamp_ms: t0 + 60000, price_sol: 0.0016, liquidity_sol: 13, volume_sol: 9, buy_pressure: 0.90, unique_buyers: 22 },
    { timestamp_ms: t0 + 90000, price_sol: 0.0022, liquidity_sol: 16, volume_sol: 15, buy_pressure: 0.92, unique_buyers: 35 }
  ];

  const traj = KeplerTrajectoryEngine.evaluateTrajectory('MINT_TEST', points);
  assert.ok(traj.velocity > 0);
  assert.ok(traj.acceleration > 0);
  assert.ok(['ORGANIC_EXPANSION', 'BREAKOUT', 'PARABOLIC_EXPANSION'].includes(traj.archetype));

  // Chandrasekhar criticality: healthy state
  const stable = ChandrasekharCriticalityEngine.evaluateCriticality({
    liquidity_sol: 100,
    top10_holder_share: 0.15,
    largest_whale_balance_sol: 4,
    buyer_replacement_rate: 10,
    seller_velocity: 3,
    sell_pressure: 0.25,
    pool_slippage_per_sol_bps: 10
  });
  assert.equal(stable.state, 'STABLE');
  assert.ok(stable.stability_reserve_score > 80);

  // Chandrasekhar criticality: impending cascade
  const cascade = ChandrasekharCriticalityEngine.evaluateCriticality({
    liquidity_sol: 10,
    top10_holder_share: 0.85,
    largest_whale_balance_sol: 15, // whale balance > pool liquidity!
    buyer_replacement_rate: 1,
    seller_velocity: 15,
    sell_pressure: 0.95,
    pool_slippage_per_sol_bps: 200
  });
  assert.equal(cascade.state, 'CASCADE');
  assert.ok(cascade.stability_reserve_score <= 15);
  assert.ok(cascade.primary_vulnerability.includes('Whale position exceeds entire pool liquidity'));
});

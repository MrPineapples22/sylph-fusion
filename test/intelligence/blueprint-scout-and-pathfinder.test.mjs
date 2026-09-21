import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScoutStrategyCoordinator } from '../../dist/intelligence/scout/strategy-coordinator.js';
import { CapitalPathfinderEngine } from '../../dist/intelligence/pathfinder/capital-pathfinder.js';

test('SCOUT - Canonical Opportunity Deduplication & Internal Netting', () => {
  const scout = new ScoutStrategyCoordinator();
  const mint = 'SoL11111111111111111111111111111111111111112';

  // Create 3 intents: 2 from breakout family, 1 from dip recovery
  const intents = [
    {
      intent_id: 'i1',
      strategy_id: 'breakout_momentum_v1',
      strategy_version: '1.0.0',
      mint,
      opportunity_id: 'opp_test',
      thesis_id: 'th_1',
      action: 'ENTER',
      requested_size: 2.0,
      minimum_size: 0.5,
      maximum_size: 3.0,
      urgency: 'HIGH',
      horizon: 'SHORT_5M',
      expected_edge: 0.12,
      uncertainty: 0.1,
      belief_version: 'b1',
      state_version: 's1',
      evidence_refs: ['vel_4s'],
      risk_domains: ['liq'],
      valid_until: Date.now() + 60000,
      created_at: Date.now(),
    },
    {
      intent_id: 'i2',
      strategy_id: 'kol_flow_follower_v1', // Shares momentum lineage with breakout
      strategy_version: '1.0.0',
      mint,
      opportunity_id: 'opp_test',
      thesis_id: 'th_2',
      action: 'ENTER',
      requested_size: 1.5,
      minimum_size: 0.5,
      maximum_size: 2.0,
      urgency: 'MEDIUM',
      horizon: 'SHORT_5M',
      expected_edge: 0.08,
      uncertainty: 0.15,
      belief_version: 'b1',
      state_version: 's1',
      evidence_refs: ['kol_cluster'],
      risk_domains: ['liq'],
      valid_until: Date.now() + 60000,
      created_at: Date.now(),
    },
    {
      intent_id: 'i3',
      strategy_id: 'dip_recovery_v1',
      strategy_version: '1.0.0',
      mint,
      opportunity_id: 'opp_test',
      thesis_id: 'th_3',
      action: 'EXIT', // Opposing intent: wants to exit 1.0 SOL
      requested_size: 1.0,
      minimum_size: 0.1,
      maximum_size: 1.0,
      urgency: 'HIGH',
      horizon: 'SHORT_5M',
      expected_edge: -0.05,
      uncertainty: 0.2,
      belief_version: 'b1',
      state_version: 's1',
      evidence_refs: ['rsi_overbought'],
      risk_domains: ['vol'],
      valid_until: Date.now() + 60000,
      created_at: Date.now(),
    },
  ];

  // 1. Deduplication
  const canonical = scout.canonicalizeOpportunity(mint, intents, {
    symbol: 'TOKEN_X',
    liquidity_sol: 50,
  });

  assert.equal(canonical.mint, mint);
  assert.equal(canonical.supporting_strategies.length, 2);
  assert.equal(canonical.opposing_strategies.length, 1);
  // Breakout and KOL share momentum lineage, so effective independent families = 2
  assert.equal(canonical.effective_independent_families, 2);
  assert.ok(canonical.consensus_score > 0.6);

  // 2. Conflict Resolution & Internal Netting
  // Buy = 2.0 + 1.5 = 3.5 SOL. Sell = 1.0 SOL. Net = BUY 2.5 SOL.
  // Prevented round-trip volume = 1.0 SOL.
  const resolution = scout.resolveIntents(mint, intents, 1.0);

  assert.equal(resolution.net_action, 'ENTER');
  assert.equal(resolution.net_size_sol, 2.5);
  assert.equal(resolution.prevented_round_trip_volume_sol, 1.0);
  assert.equal(resolution.physical_execution_required, true);

  // 3. Virtual Books
  assert.equal(scout.getVirtualClaim('breakout_momentum_v1', mint), 2.0);
  assert.equal(scout.getVirtualClaim('kol_flow_follower_v1', mint), 1.5);

  // 4. Edge Capacity Ledger
  const cap = scout.getCapacityEntry(mint);
  assert.ok(cap);
  assert.equal(cap.allocated_capacity_sol, 2.5);
  assert.equal(cap.reserved_capacity_sol, 1.0);
});

test('PATHFINDER - Capital State, Trapping Risk & Receding-Horizon Planning', () => {
  const pathfinder = new CapitalPathfinderEngine(20.0);
  const initialState = pathfinder.getCapitalState();

  assert.equal(initialState.available_sol, 14.0); // 70% of 20
  assert.equal(initialState.exit_reserve_sol, 1.0);  // 5% emergency exit buffer

  const opportunity = {
    opportunity_id: 'opp_1',
    mint: 'SoL22222222222222222222222222222222222222223',
    edge_family: 'momentum',
    situation: 'BULLISH',
    evidence_lineage: [],
    wallet_cohort: 'organic',
    theme: 'defi',
    effective_independent_families: 2,
    supporting_strategies: ['strat1'],
    opposing_strategies: [],
    consensus_score: 1.0,
    internal_crowding: 'LOW',
    external_crowding: 'LOW',
    lifecycle_state: 'EMERGING',
    remaining_life_sec: 120,
    capacity_sol: 3.0,
  };

  const resolvedIntent = {
    resolution_id: 'res_1',
    mint: opportunity.mint,
    canonical_opportunity_id: opportunity.opportunity_id,
    net_action: 'ENTER',
    net_size_sol: 2.0,
    physical_execution_required: true,
    internal_reallocations: [],
    prevented_round_trip_volume_sol: 0,
    governing_policy_version: 'v1',
    timestamp_ms: Date.now(),
  };

  // 1. Trapping Risk Evaluation
  const trapping = pathfinder.evaluateTrappingRisk(opportunity, 25.0);
  assert.ok(trapping.trapping_score >= 0 && trapping.trapping_score <= 1.0);
  assert.ok(trapping.estimated_exit_slippage_pct > 0);

  // 2. Plan Capital Allocation
  const plan = pathfinder.planCapitalAllocation(resolvedIntent, opportunity, 25.0);
  assert.equal(plan.immediate_action.mint, opportunity.mint);
  assert.ok(plan.immediate_action.authorized_size_sol <= 2.0);
  assert.ok(plan.optionality_score > 0);
  assert.equal(plan.contingent_next_steps.length, 3);

  // 3. Commit & Release
  pathfinder.commitAllocation(opportunity.mint, 1.5);
  const afterCommit = pathfinder.getCapitalState();
  assert.equal(afterCommit.positions[opportunity.mint], 1.5);
  assert.equal(afterCommit.deployed_sol, initialState.deployed_sol + 1.5);

  pathfinder.releaseAllocation(opportunity.mint, 1.5, 0.3); // +0.3 SOL profit
  const afterRelease = pathfinder.getCapitalState();
  assert.equal(afterRelease.positions[opportunity.mint], undefined);
  assert.equal(afterRelease.available_sol, afterCommit.available_sol + 1.8);
});

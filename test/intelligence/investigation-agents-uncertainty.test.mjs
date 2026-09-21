import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TeslaInformationGainEngine } from '../../dist/intelligence/discovery/tesla-discovery.js';
import { NashMultiAgentIntentEngine } from '../../dist/intelligence/agents/nash-agents.js';
import { CurieUncertaintyEngine } from '../../dist/intelligence/curie/curie-uncertainty.js';

test('Layer 5 - Tesla Active Information Discovery & Value of Waiting', () => {
  const candidates = [
    {
      type: 'CREATOR_HISTORICAL_LAUNCHES',
      target: 'CREATOR_1',
      expected_info_gain: 0.75,
      time_cost_ms: 1200,
      compute_cost_score: 1,
      alpha_decay_rate_bps_sec: 50 // moderate decay
    },
    {
      type: 'WALLET_CLUSTERING_ANALYSIS',
      target: 'CLUSTER_TOP',
      expected_info_gain: 0.30,
      time_cost_ms: 5000,
      compute_cost_score: 3,
      alpha_decay_rate_bps_sec: 200 // high decay
    }
  ];

  // Low confidence (0.50): investigation value exceeds delay cost -> WAIT
  const resWait = TeslaInformationGainEngine.evaluateNextActions(candidates, 0.50);
  assert.equal(resWait.should_wait_and_investigate, true);
  assert.equal(resWait.top_investigation?.type, 'CREATOR_HISTORICAL_LAUNCHES');
  assert.ok(resWait.net_value_of_waiting > 0.15);

  // High confidence (0.90): waiting is NOT recommended due to decay
  const resAct = TeslaInformationGainEngine.evaluateNextActions(candidates, 0.90);
  assert.equal(resAct.should_wait_and_investigate, false);
});

test('Layer 5 - Nash Counterparty Intent Modeling', () => {
  const actors = [
    {
      address: 'CREATOR_WALLET',
      role: 'CREATOR',
      net_buy_sol_1h: 0,
      net_sell_sol_1h: 40,
      current_balance_sol: 50,
      tx_count: 5
    },
    {
      address: 'WHALE_ACCUMULATOR',
      role: 'WHALE',
      net_buy_sol_1h: 25,
      net_sell_sol_1h: 0,
      current_balance_sol: 25,
      tx_count: 3
    }
  ];

  const summary = NashMultiAgentIntentEngine.evaluateMarketIntents('MINT_TEST', actors);

  assert.ok(summary.insider_dump_risk_score >= 40); // Creator dumped >50% position
  assert.equal(summary.aggregate_whale_intent, 'ACCUMULATING');
  assert.equal(summary.actor_hypotheses[0].dominant_intent, 'EXITING');
  assert.equal(summary.actor_hypotheses[1].dominant_intent, 'ACCUMULATING');
});

test('Layer 5 - Curie Uncertainty Vector Decomposition', () => {
  const decomp = CurieUncertaintyEngine.decompose('MINT_TEST', {
    data_age_ms: 2000,
    model_ood_score: 0.15,
    orderbook_spread_bps: 25,
    counterparty_unknown_share: 0.70, // high epistemic agent uncertainty
    regime_entropy: 0.20,
    rpc_latency_ms: 150,
    noether_anomalies_count: 0,
    token_age_minutes: 10
  });

  assert.equal(decomp.dimensions.length, 8);
  assert.ok(decomp.total_epistemic_uncertainty > 0);
  assert.ok(decomp.total_aleatoric_uncertainty > 0);
  assert.ok(decomp.total_distributional_uncertainty > 0);
  assert.ok(decomp.confidence_ceiling >= 0.05 && decomp.confidence_ceiling <= 1.0);
  assert.ok(decomp.highest_reducible_gap?.includes('AGENT') || decomp.highest_reducible_gap?.includes('NOVELTY'));
});

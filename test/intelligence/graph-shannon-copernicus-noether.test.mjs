import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NewtonMarketGraph } from '../../dist/intelligence/graph/newton-graph.js';
import { ShannonInformationFlowEngine } from '../../dist/intelligence/signals/shannon-information.js';
import { CopernicusHierarchicalContextEngine } from '../../dist/intelligence/horizon/copernicus-context.js';
import { NoetherStructuralInvariantsEngine } from '../../dist/intelligence/safety/noether-invariants.js';

test('Layer 3 - Newton Market Graph & Probabilistic Clustering', () => {
  const graph = new NewtonMarketGraph();

  // Setup entities
  graph.addNode('funder_whale', 'WALLET');
  graph.addNode('wallet_alpha', 'WALLET');
  graph.addNode('wallet_beta', 'WALLET');
  graph.addNode('token_xyz', 'TOKEN');

  // Fund both wallets from same funder
  graph.addEdge('funder_whale', 'wallet_alpha', 'FUNDED', 1.0, 1.0, 50.0);
  graph.addEdge('funder_whale', 'wallet_beta', 'FUNDED', 1.0, 1.0, 45.0);

  // Both buy same token
  graph.addEdge('wallet_alpha', 'token_xyz', 'BOUGHT', 1.0, 1.0, 10.0);
  graph.addEdge('wallet_beta', 'token_xyz', 'BOUGHT', 1.0, 1.0, 12.0);

  const cluster = graph.getClusterConfidence('wallet_alpha', 'wallet_beta');
  assert.ok(cluster.cluster_confidence > 0.45);
  assert.ok(cluster.cluster_confidence <= 0.95); // probabilistic, never assumes 100% certainty
  assert.ok(cluster.shared_funders.includes('funder_whale'));
  assert.ok(cluster.co_entered_tokens.includes('token_xyz'));
});

test('Layer 3 - Shannon Information Flow & Signal Dependency Discounting', () => {
  const now = Date.now();

  // 6 signals stemming from the exact same underlying swap event
  const rootEventId = 'tx_swap_whale_in';
  const correlatedSignals = [
    { id: 's1', name: 'volume_spike', observed_at_ms: now - 5000, underlying_event_id: rootEventId, raw_strength: 0.9, source_type: 'ON_CHAIN_TX' },
    { id: 's2', name: 'price_impact', observed_at_ms: now - 4800, underlying_event_id: rootEventId, raw_strength: 0.85, source_type: 'POOL_EVENT' },
    { id: 's3', name: 'velocity_spike', observed_at_ms: now - 4500, underlying_event_id: rootEventId, raw_strength: 0.88, source_type: 'MODEL_DERIVED' },
    { id: 's4', name: 'dex_alert', observed_at_ms: now - 4000, underlying_event_id: rootEventId, raw_strength: 0.80, source_type: 'DEX_TICKER' },
    { id: 's5', name: 'whale_in_alert', observed_at_ms: now - 3500, underlying_event_id: rootEventId, raw_strength: 0.92, source_type: 'MODEL_DERIVED' },
    { id: 's6', name: 'hsi_tick', observed_at_ms: now - 3000, underlying_event_id: rootEventId, raw_strength: 0.70, source_type: 'MODEL_DERIVED' }
  ];

  const evalSignals = ShannonInformationFlowEngine.evaluateSignals(correlatedSignals, now);

  // Invariant: 6 correlated signals from 1 root event MUST NOT be counted as 6 independent confirmations
  assert.equal(evalSignals.effective_independent_signals, 1);
  assert.ok(evalSignals.originality_score < 0.20); // 1 / 6 = 0.167
  assert.equal(evalSignals.state, 'EARLY');
  assert.equal(evalSignals.is_stale, false);
});

test('Layer 3 - Copernicus Context Beta Decomposition & Noether Structural Invariants', () => {
  // Copernicus
  const copernicus = new CopernicusHierarchicalContextEngine();
  copernicus.updateContext({ sol_1h_change_pct: 2.0 }); // Macro SOL up 2%

  const decomp = copernicus.decomposeTokenMovement('MINT_TEST', 12.0, 1.5);
  assert.equal(decomp.market_beta_component, 3.0); // 2% * 1.5
  assert.equal(decomp.idiosyncratic_alpha, 9.0); // 12% - 3%
  assert.equal(decomp.regime_alignment, 'DIVERGENT'); // alpha > 2x beta

  // Noether: Hard identity violations (unrevoked mint auth + supply mismatch)
  const auditBad = NoetherStructuralInvariantsEngine.auditInvariants({
    token_mint: 'MINT_RUG',
    total_supply: 1_000_000,
    circulating_supply: 1_500_000, // impossible supply!
    pool_token_reserve: 800_000,
    pool_sol_reserve: 20,
    mint_authority_revoked: false, // vulnerable
    freeze_authority_revoked: true,
    lp_burn_percentage: 100,
    volume_5m_sol: 10,
    market_cap_sol: 100
  });

  assert.equal(auditBad.hard_invariants_pass, false);
  assert.ok(auditBad.broken_invariants.some(i => i.includes('Supply creation violation')));
  assert.ok(auditBad.broken_invariants.some(i => i.includes('Mint authority active')));
  assert.ok(auditBad.structural_integrity_score < 50);

  // Noether: Clean invariant pass
  const auditGood = NoetherStructuralInvariantsEngine.auditInvariants({
    token_mint: 'MINT_CLEAN',
    total_supply: 1_000_000,
    circulating_supply: 1_000_000,
    pool_token_reserve: 800_000,
    pool_sol_reserve: 50,
    mint_authority_revoked: true,
    freeze_authority_revoked: true,
    lp_burn_percentage: 100,
    volume_5m_sol: 15,
    market_cap_sol: 100
  });

  assert.equal(auditGood.hard_invariants_pass, true);
  assert.equal(auditGood.structural_integrity_score, 100);
});

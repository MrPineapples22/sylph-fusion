import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentinelXCounterintelligence } from '../../dist/intelligence/sentinel/counterintelligence.js';
import { HorizonExternalContext } from '../../dist/intelligence/horizon/external-context.js';
import { SageCapabilityAssurance } from '../../dist/intelligence/sage/capability-assurance.js';

test('SENTINEL-X - Effective Participation, Signal Saturation & Competing Explanations', () => {
  const sentinel = new SentinelXCounterintelligence();
  const mint = 'SoL44444444444444444444444444444444444444445';

  // 1. Sybil Cluster: 10 wallets, but 9 share same funder root!
  const sybilWallets = [
    { address: 'w1', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w2', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w3', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w4', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w5', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w6', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w7', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w8', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w9', funder: 'master_funder_1', buyVolumeSol: 1.0, txCount: 1, timingSlot: 100 },
    { address: 'w10', funder: 'independent_unlinked', buyVolumeSol: 1.0, txCount: 1, timingSlot: 102 },
  ];

  const assessment = sentinel.evaluateParticipation(mint, sybilWallets);

  assert.equal(assessment.raw_wallet_count, 10);
  // 9 funded by master_funder_1 count as 1 actor + 1 independent = 2.0 effective actors!
  assert.equal(assessment.effective_independent_participants, 2.0);
  assert.equal(assessment.participant_diversity_ratio, 0.2);
  assert.equal(assessment.competing_hypotheses.primary_hypothesis, 'COORDINATED_MANIPULATION');
  assert.ok(assessment.red_team_risk_score >= 0.8);

  // 2. Red-Team Simulation Generator (Research Only)
  const redTeamTrap = sentinel.generateSyntheticAdversarialTrap(mint, 'SYBIL_WASH');
  assert.ok(redTeamTrap.synthetic_mint.startsWith('synthetic_'));
  assert.equal(redTeamTrap.true_effective_actors, 1);
});

test('HORIZON - Cross-Market Macro Context, Spillover Events & Causal Chains', () => {
  const horizon = new HorizonExternalContext();

  // Nominal Context
  const nominal = horizon.evaluateContext({
    btc_price_usd: 62500,
    btc_1h_change_pct: 0.2,
    sol_price_usd: 148,
    sol_1h_change_pct: 1.5,
    solana_tps: 2700,
    priority_fee_median_micro_lamports: 75000,
    network_congestion_score: 0.2,
    dex_total_liquidity_usd: 480_000_000,
    stablecoin_net_inflow_24h_usd: 12_000_000,
  }, 448280000);

  assert.equal(nominal.primary_regime, 'LIQUIDITY_EXPANSION');
  assert.equal(nominal.network_stress_level, 'NOMINAL');

  // Macro Shock: BTC dump -4.5%, SOL dump -6.0%
  const shock = horizon.evaluateContext({
    btc_price_usd: 59000,
    btc_1h_change_pct: -4.5,
    sol_price_usd: 138,
    sol_1h_change_pct: -6.0,
    solana_tps: 2100,
    priority_fee_median_micro_lamports: 600000, // High fee spike
    network_congestion_score: 0.85,
    dex_total_liquidity_usd: 410_000_000,
    stablecoin_net_inflow_24h_usd: -25_000_000,
  }, 448280050);

  assert.equal(shock.network_stress_level, 'SEVERE');
  assert.ok(shock.active_spillovers.length > 0);
  assert.ok(shock.causal_transmission_chain.includes('congestion'));
});

test('SAGE - Capability Assurance Matrix & Execution Path Budgeting', () => {
  const sage = new SageCapabilityAssurance();

  // 1. Nominal Capability Audit
  const nominalAudit = sage.auditCapabilities({
    rpcHealthy: true,
    feedFresh: true,
    isRecovering: false,
    queueLag: 2,
    killSwitchActive: false,
  });

  assert.equal(nominalAudit.overall_capability_score, 100);
  assert.equal(nominalAudit.capabilities.NEW_ENTRY, 'AVAILABLE');
  assert.equal(nominalAudit.capabilities.EMERGENCY_EXIT, 'AVAILABLE');
  assert.equal(nominalAudit.cold_path_throttled, false);

  // 2. Recovery / Degraded Capability Audit
  const degradedAudit = sage.auditCapabilities({
    rpcHealthy: true,
    feedFresh: true,
    isRecovering: true, // Recovering after incident
    queueLag: 35,       // High queue lag
    killSwitchActive: false,
  });

  assert.equal(degradedAudit.capabilities.NEW_ENTRY, 'BLOCKED'); // New entries blocked
  assert.equal(degradedAudit.capabilities.EMERGENCY_EXIT, 'AVAILABLE'); // Exits remain available!
  assert.equal(degradedAudit.capabilities.RESEARCH, 'BLOCKED'); // Research blocked
  assert.equal(degradedAudit.cold_path_throttled, true);
});

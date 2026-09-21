import test from 'node:test';
import assert from 'node:assert/strict';

import { DarwinStrategyEcology } from '../../dist/intelligence/darwin/strategy-ecology.js';
import { MendelGeneHeredityEngine } from '../../dist/intelligence/mendel/gene-heredity.js';
import { PasteurResearchIntegrity } from '../../dist/intelligence/pasteur/research-integrity.js';
import { CurieScientificKnowledgeEngine } from '../../dist/intelligence/curie/replicated-knowledge.js';
import { AuthoritativeCapitalLedger } from '../../dist/intelligence/capital/authoritative-ledger.js';

test('Part IV & V - DARWIN Strategy Ecology & MENDEL Safe Recombination', async () => {
  const darwin = new DarwinStrategyEcology();
  const mendel = new MendelGeneHeredityEngine();

  // Test 1: Register genome in DARWIN
  darwin.registerGenome({
    strategy_id: 'strat_scalper_alpha',
    version: '1.0.0',
    parents: [],
    entry_policy: 'micro_burst_acceleration',
    exit_policy: 'trailing_stop_10pct',
    sizing_policy: 'fixed_0.5_sol',
    required_signals: ['volume_surge', 'wallet_diversity'],
    required_capabilities: ['RPC_BURST_SEND'],
    supported_regimes: ['BULL_MOMENTUM'],
    latency_requirements_ms: 150,
    liquidity_requirements_sol: 30,
    risk_class: 'MODERATE',
    authority_ceiling: 'A2_INFLUENCE',
    gene_ids: ['gene_entry_accel', 'gene_filter_pod'],
    artifact_hash: 'hash_genome_alpha',
    evidence_root: 'root_strat_alpha',
    stage: 'PROPOSED',
    total_simulated_trades: 25,
    win_rate: 0.60,
    sharpe_ratio: 1.5,
    max_drawdown_pct: 12.0,
    tail_risk_var99: 0.08,
    last_promoted_at: Date.now() - 3600000,
  });

  // Attempt slow promotion from PROPOSED -> SIMULATION
  const promo = darwin.attemptPromotion('strat_scalper_alpha');
  assert.equal(promo.promoted, true);
  assert.equal(promo.current_stage, 'SIMULATION');

  // Trigger fast demotion
  const demote = darwin.triggerDemotion('strat_scalper_alpha', 'Execution slippage breach > 8%');
  assert.equal(demote.demoted, true);
  assert.equal(demote.current_stage, 'RESTRICTED');

  // Test 2: MENDEL Safe Recombination Invariant
  // Hard Invariant: CERTIFIED PARENT + CERTIFIED PARENT != CERTIFIED CHILD.
  // Recombined children must strictly enter as UNVERIFIED.
  const proposal = mendel.recombineStrategies(
    { id: 'parent_strat_A', genes: ['gene_entry_accel', 'gene_exit_trailing'] },
    { id: 'parent_strat_B', genes: ['gene_filter_pod', 'gene_regime_vol'] }
  );

  assert.equal(proposal.certification_state, 'UNVERIFIED', 'Child strategy must strictly be UNVERIFIED');
  assert.equal(proposal.requires_verification_pipeline, true);
  assert.equal(proposal.inherited_genes.length >= 2, true);

  // Test 3: Gene Component Attribution
  const attr = mendel.attributeGeneEffect('gene_filter_pod', 4.5, 2.0);
  assert.equal(attr.marginal_contribution_sol, 2.5);
  assert.equal(attr.interaction, 'SYNERGISTIC');
});

test('Part VI & VII - PASTEUR Research Integrity & CURIE Replicated Knowledge', async () => {
  const pasteur = new PasteurResearchIntegrity();
  const curie = new CurieScientificKnowledgeEngine();

  // Test 1: PASTEUR 4-Clock Temporal Leakage Defense
  const validClocks = {
    event_time_ms: 1000,
    observation_time_ms: 1020,
    processing_time_ms: 1030,
    knowledge_time_ms: 1035,
    decision_time_ms: 1050,
  };
  const validCheck = pasteur.verifyTemporalIntegrity(validClocks);
  assert.equal(validCheck.is_leak_free, true);
  assert.equal(validCheck.violations.length, 0);

  // Test temporal violation (knowledge after decision / future leakage)
  const leakyClocks = {
    event_time_ms: 1000,
    observation_time_ms: 1020,
    processing_time_ms: 1030,
    knowledge_time_ms: 1100, // future knowledge!
    decision_time_ms: 1050,
  };
  const leakCheck = pasteur.verifyTemporalIntegrity(leakyClocks);
  assert.equal(leakCheck.is_leak_free, false);
  assert.ok(leakCheck.violations.some((v) => v.includes('LOOKAHEAD_VIOLATION')));

  // Test 2: Test Dataset Exposure Holdout Discipline
  for (let i = 0; i < 5; i++) {
    const exp = pasteur.recordTestExposure('dataset_holdout_sept_2026');
    assert.equal(exp.is_holdout_valid, true);
  }
  const overexposed = pasteur.recordTestExposure('dataset_holdout_sept_2026');
  assert.equal(overexposed.is_holdout_valid, false, 'Exposure > 5 must invalidate holdout set');
  assert.ok(overexposed.warning?.includes('HOLDOUT_CONTAMINATED'));

  // Test 3: Search Inflation Bonferroni Correction
  const searchCorr = pasteur.adjustSignificanceForSearchInflation({
    raw_p_value: 0.01,
    hypotheses_tested: 10,
    parameters_tested: 5,
  });
  assert.equal(searchCorr.inflation_factor, 50);
  assert.equal(searchCorr.adjusted_p_value, 0.50);
  assert.equal(searchCorr.is_significant_at_05, false, 'Inflation should penalize raw p=0.01 across 50 trials');

  // Test 4: CURIE Replicated Knowledge Lifecycle & Independence Graph
  curie.registerClaim({
    claim_id: 'claim_sybil_cluster_rug',
    statement: 'Shared funding roots across >70% of buyer wallets predicts LP drain within 10m.',
    scope: 'Raydium and Pump.fun micro-caps',
    population: 'Low liquidity launches',
    regime: 'ALL',
    time_horizon_sec: 600,
    replication_count: 0,
    independent_replication_count: 0,
    status: 'HYPOTHESIS',
    supporting_experiment_ids: [],
    contradicting_experiment_ids: [],
    created_at_ms: Date.now(),
    last_verified_ms: Date.now(),
    revalidation_deadline_ms: Date.now() + 604800000,
    evidence_root: 'root_sybil_claim',
  });

  // Replicate on independent dataset signature
  const rep1 = curie.recordReplication({
    claim_id: 'claim_sybil_cluster_rug',
    experiment_id: 'exp_indep_01',
    outcome_supported: true,
    dataset_signature: 'sig_independent_data_cluster_A',
  });
  assert.equal(rep1.is_independent, true);
  assert.equal(rep1.claim.status, 'HYPOTHESIS'); // Needs >= 2 supports for PRELIMINARY

  // Replicate second time with support on same dataset
  const rep2 = curie.recordReplication({
    claim_id: 'claim_sybil_cluster_rug',
    experiment_id: 'exp_overlap_02',
    outcome_supported: true,
    dataset_signature: 'sig_independent_data_cluster_A', // Duplicate source!
  });
  assert.equal(rep2.is_independent, false);
  assert.equal(rep2.claim.status, 'PRELIMINARY'); // 2 supports reached
});

test('Part XVII & XVIII - Authoritative Capital Ledger, Gene Exposure & Ambiguity State', async () => {
  const ledger = new AuthoritativeCapitalLedger();

  // Test 1: Open positions across strategies with shared genes
  ledger.registerPendingTransaction({
    tx_id: 'tx_init_A',
    mint: 'SoLTokenA111111111111111111111111111111111',
    strategy_id: 'strat_alpha',
    gene_ids: ['gene_entry_accel', 'gene_shared_sniper'],
    amount_sol: 4.0,
    signed_tx_signature: 'sig_a',
    state: 'SUBMITTED',
    submitted_at_slot: 290100,
    submitted_at_ms: Date.now(),
    last_checked_slot: 290100,
    blockhash_expiration_slot: 290150,
  });
  ledger.confirmFill('tx_init_A', 0.000020);

  ledger.registerPendingTransaction({
    tx_id: 'tx_init_B',
    mint: 'SoLTokenB222222222222222222222222222222222',
    strategy_id: 'strat_beta',
    gene_ids: ['gene_shared_sniper', 'gene_exit_trailing'], // Shared gene!
    amount_sol: 4.0,
    signed_tx_signature: 'sig_b',
    state: 'SUBMITTED',
    submitted_at_slot: 290100,
    submitted_at_ms: Date.now(),
    last_checked_slot: 290100,
    blockhash_expiration_slot: 290150,
  });
  ledger.confirmFill('tx_init_B', 0.000040);

  const report = ledger.auditExposures();
  assert.equal(report.total_portfolio_exposure_sol, 8.0);
  assert.equal(report.exposure_by_gene['gene_shared_sniper'], 8.0);
  assert.equal(report.hidden_shared_gene_risk_detected, true, 'Ledger must detect hidden shared-gene exposure > 40% of total portfolio');

  // Test 2: Execution Ambiguity State Machine
  ledger.registerPendingTransaction({
    tx_id: 'tx_sub_001',
    mint: 'SoLTokenA111111111111111111111111111111111',
    strategy_id: 'strat_alpha',
    gene_ids: ['gene_entry_accel'],
    amount_sol: 1.0,
    signed_tx_signature: 'sig_raw_solana_tx_001',
    state: 'SUBMITTED',
    submitted_at_slot: 290100,
    submitted_at_ms: Date.now(),
    last_checked_slot: 290100,
    blockhash_expiration_slot: 290150,
  });

  // Ambiguity reconciliation: current slot is 290120 (before expiration, unconfirmed) -> UNKNOWN_RECONCILING with RESEND_SAME_SIGNED_TX
  const reconEarly = ledger.handleSubmissionTimeout('tx_sub_001', 290120);
  assert.equal(reconEarly.tx_state, 'UNKNOWN_RECONCILING');
  assert.equal(reconEarly.action, 'RESEND_SAME_SIGNED_TX');

  // Ambiguity reconciliation: current slot is 290160 (after expiration, unconfirmed) -> EXPIRED with REBUILD_NEW_TX
  const reconLate = ledger.handleSubmissionTimeout('tx_sub_001', 290160);
  assert.equal(reconLate.tx_state, 'EXPIRED');
  assert.equal(reconLate.action, 'REBUILD_NEW_TX');
});

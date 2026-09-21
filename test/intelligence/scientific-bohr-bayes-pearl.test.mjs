import test from 'node:test';
import assert from 'node:assert/strict';

import { BohrCompetingHypothesisEngine } from '../../dist/intelligence/bohr/competing-hypotheses.js';
import { BayesBeliefEngine } from '../../dist/intelligence/bayes/hierarchical-belief.js';
import { PearlCausalEngine } from '../../dist/intelligence/pearl/causal-inference.js';
import { EinsteinRelativityEngine } from '../../dist/intelligence/einstein/regime-relativity.js';

test('Part VIII - BOHR Competing Hypotheses & Unknown Mass Preservation', async () => {
  const bohr = new BohrCompetingHypothesisEngine();

  // Test 1: Organic token scenario (low PoD, low HSI, high diversity, healthy pump score)
  const hypSet = bohr.evaluateTokenHypotheses({
    mint: 'SoL111111111111111111111111111111111111112',
    effective_participants: 25,
    raw_wallet_count: 30,
    top_cluster_share: 0.12,
    liquidity_sol: 80,
    volume_sol: 120,
    hsi_score: 20,
    pump_score: 75,
    pod_score: 15,
    sol_macro_regime: 'BULL_TREND',
    is_liquidity_locked: true,
  });

  assert.equal(hypSet.hypotheses.length, 8, 'Bohr must maintain exactly 8 candidate hypotheses');
  assert.equal(hypSet.dominant_hypothesis, 'ORGANIC_EXPANSION');
  assert.ok(hypSet.unknown_mass >= 0.05, 'Bohr must strictly preserve at least 5% UNKNOWN probability mass');

  // Verify total probability sums to 1.0 (within precision)
  const sumProb = hypSet.hypotheses.reduce((acc, h) => acc + h.posterior_probability, 0);
  assert.ok(Math.abs(sumProb - 1.0) < 0.01, `Hypothesis probabilities must sum to ~1.0, got ${sumProb}`);

  // Test 2: Coordinated Sybil scenario
  const sybilSet = bohr.evaluateTokenHypotheses({
    mint: 'SoLSybil11111111111111111111111111111111111',
    effective_participants: 2,
    raw_wallet_count: 50,
    top_cluster_share: 0.85,
    liquidity_sol: 5,
    volume_sol: 80,
    hsi_score: 15,
    pump_score: 95,
    pod_score: 10,
    sol_macro_regime: 'BEAR_VOLATILE',
    is_liquidity_locked: false,
  });

  assert.ok(['COORDINATED_PUMP', 'SYBIL_ACTIVITY'].includes(sybilSet.dominant_hypothesis));
  assert.ok(sybilSet.unknown_mass >= 0.05);

  // Test 3: System Diagnosis
  const diagnosis = bohr.diagnoseSystemDiscrepancy({
    reported_liquidity_sol: 0,
    provider_age_ms: 15_000,
    rpc_healthy: false,
    pool_exists_on_chain: true,
  });

  assert.equal(diagnosis.is_data_failure, true);
  assert.ok(diagnosis.diagnosis.includes('PROVIDER_FAILURE'));
  assert.ok(diagnosis.recommended_action.includes('RETRY'));
});

test('Part IX - BAYES Hierarchical Updating, Evidence Discounting & Missingness', async () => {
  const bayes = new BayesBeliefEngine();

  // Test 1: Hierarchical Prior derivation
  const prior = bayes.calculateHierarchicalPrior({
    global_population_prior: 0.04,
    launch_class_prior: 0.12,
    market_regime_prior: 0.20,
    liquidity_band_prior: 0.15,
    creator_class_prior: 0.25,
  });

  assert.ok(prior > 0.05 && prior < 0.30, `Hierarchical prior must borrow across strata, got ${prior}`);

  // Test 2: Evidence dependence discounting (burst trades sharing trigger_group)
  const belief = bayes.updateBelief({
    mint: 'SoL111111111111111111111111111111111111112',
    prior,
    observations: [
      { field: 'volume_sol', value: 0.85, trigger_group: 'burst_01', weight: 1.0 },
      { field: 'trade_velocity', value: 0.80, trigger_group: 'burst_01', weight: 1.0 }, // Correlated burst
      { field: 'pumpscore', value: 0.75, trigger_group: 'burst_01', weight: 1.0 }, // Correlated burst
      { field: 'wallet_diversity', value: 0.90, weight: 1.0 }, // Independent signal
    ],
    missing_fields: {
      creator_history: 'NOT_OBSERVED',
      rugcheck_verification: 'OBSERVED_ABSENT',
    },
  });

  assert.ok(belief.posterior_probability > belief.prior_probability);
  assert.equal(belief.discounted_overlap_count, 2, 'Two dependent burst signals must be discounted');
  assert.ok(belief.effective_evidence_count < 4, 'Effective evidence count must be discounted');
  assert.equal(belief.missingness_records.creator_history, 'NOT_OBSERVED');
  assert.ok(belief.unknown_probability_mass >= 0.05);

  // Test 3: Calibration evaluation
  const calib = bayes.evaluateCalibration([
    { predicted_prob: 0.8, actual_outcome: 1 },
    { predicted_prob: 0.7, actual_outcome: 1 },
    { predicted_prob: 0.2, actual_outcome: 0 },
    { predicted_prob: 0.9, actual_outcome: 0 },
  ]);

  assert.ok(calib.brier_score >= 0 && calib.brier_score <= 1.0);
  assert.equal(calib.evaluated_samples, 4);
});

test('Part X & XI - PEARL Causal Identification & EINSTEIN Reference Frames', async () => {
  const pearl = new PearlCausalEngine();
  const einstein = new EinsteinRelativityEngine();

  // Test 1: Causal identifiability evaluation
  const causalQ = pearl.evaluateIdentifiability({
    treatment: 'whale_buy_burst',
    outcome: 'sustained_price_expansion_5m',
    confounders: ['market_sentiment', 'sol_trend'],
    has_unobserved_confounder: false,
    has_collider_conditioning: false,
  });

  assert.equal(causalQ.identifiability_state, 'PLAUSIBLY_IDENTIFIED');
  assert.ok(causalQ.uncertainty < 0.5);

  // Test 2: Collider conditioning causes NOT_IDENTIFIABLE
  const colliderQ = pearl.evaluateIdentifiability({
    treatment: 'whale_buy_burst',
    outcome: 'sustained_price_expansion_5m',
    confounders: ['market_sentiment'],
    has_unobserved_confounder: false,
    has_collider_conditioning: true, // conditioned on trending bot collider
  });

  assert.equal(colliderQ.identifiability_state, 'NOT_IDENTIFIABLE');

  // Test 3: Natural experiment comparison
  const natExp = pearl.compareNaturalExperiment({
    token_treatment: { mint: 'mint_treat_001', treatment_present: true, return_5m_pct: 35.0 },
    token_control: { mint: 'mint_ctrl_002', treatment_present: false, return_5m_pct: 5.0 },
    matched_covariates: ['initial_liquidity_sol', 'token_age_sec', 'creator_tier'],
  });

  assert.equal(natExp.outcome_difference_pct, 30.0);
  assert.ok(natExp.causal_estimate > 0);

  // Test 4: Self-impact protection
  const mint = 'SoL111111111111111111111111111111111111112';
  pearl.registerSelfExecution(mint, 'tx_sylph_buy_001');
  assert.equal(pearl.isSelfCaused(mint, 'tx_sylph_buy_001'), true);
  assert.equal(pearl.isSelfCaused(mint, 'tx_external_trader_002'), false);

  // Test 5: EINSTEIN Reference Frames & Signal Normalization
  const bundle = einstein.normalizeContext({
    mint,
    raw_tx_velocity: 1.5,
    token_age_sec: 120,
    liquidity_sol: 45,
    market_cap_sol: 180,
    volume_sol: 75,
    sol_1h_pct: 2.5,
    token_1h_pct: 15.0,
    depth_sol_1pct: 12.0,
  });

  assert.equal(bundle.velocity_by_age.reference_frame, 'AGE_FRAME');
  assert.equal(bundle.liquidity_by_mcap.reference_frame, 'LIQUIDITY_FRAME');
  assert.equal(bundle.volume_by_liquidity.reference_frame, 'PAIR_FRAME');
  assert.equal(bundle.price_by_sol.reference_frame, 'SOL_FRAME');
  assert.equal(bundle.slippage_by_depth.reference_frame, 'EXECUTION_FRAME');

  // Both absolute and normalized values preserved
  assert.equal(bundle.liquidity_by_mcap.absolute_value, 0.25);
  assert.ok(bundle.liquidity_by_mcap.normalized_value >= 0 && bundle.liquidity_by_mcap.normalized_value <= 1.0);
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BayesBeliefEngine,
} from '../../dist/intelligence/bayes/hierarchical-belief.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 63: Bayesian Hierarchical Belief Engine & Evidence Dependence Discounting (REQ-079)', () => {
  test('Pass 63 Test 1: Hierarchical Prior Borrowing Across Multi-Tier Strata & Boundary Clamping (Part IX, Blueprint §12)', () => {
    const engine = new BayesBeliefEngine();

    // Standard multi-tier stratum context:
    // 0.15*0.04 (0.006) + 0.25*0.08 (0.02) + 0.20*0.20 (0.04) + 0.20*0.18 (0.036) + 0.20*0.12 (0.024) = 0.126
    const standardPrior = engine.calculateHierarchicalPrior({
      global_population_prior: 0.04,
      launch_class_prior: 0.08,
      market_regime_prior: 0.20,
      liquidity_band_prior: 0.18,
      creator_class_prior: 0.12,
    });

    assert.equal(standardPrior, 0.126);
    assert.ok(standardPrior >= 0.01 && standardPrior <= 0.95);

    // High conviction context:
    // 0.15*0.15 (0.0225) + 0.25*0.25 (0.0625) + 0.20*0.35 (0.07) + 0.20*0.30 (0.06) + 0.20*0.40 (0.08) = 0.295
    const bullishPrior = engine.calculateHierarchicalPrior({
      global_population_prior: 0.15,
      launch_class_prior: 0.25,
      market_regime_prior: 0.35,
      liquidity_band_prior: 0.30,
      creator_class_prior: 0.40,
    });
    assert.equal(bullishPrior, 0.295);

    // Boundary clamping: extremely low priors clamped to 0.01 floor
    const subFloorPrior = engine.calculateHierarchicalPrior({
      global_population_prior: 0.001,
      launch_class_prior: 0.001,
      market_regime_prior: 0.001,
      liquidity_band_prior: 0.001,
      creator_class_prior: 0.001,
    });
    assert.equal(subFloorPrior, 0.01, 'Hierarchical prior must clamp to 0.01 floor');

    // Boundary clamping: extremely high priors clamped to 0.95 ceiling
    const ceilingPrior = engine.calculateHierarchicalPrior({
      global_population_prior: 0.99,
      launch_class_prior: 0.99,
      market_regime_prior: 0.99,
      liquidity_band_prior: 0.99,
      creator_class_prior: 0.99,
    });
    assert.equal(ceilingPrior, 0.95, 'Hierarchical prior must clamp to 0.95 ceiling');
  });

  test('Pass 63 Test 2: Evidence Dependence Discounting for Correlated Bursts & Missingness Tracking (Part IX, Blueprint §12)', () => {
    const engine = new BayesBeliefEngine();
    const mint = 'SoLBayesTestMint1111111111111111111111111111111';

    // 1. Independent observations without trigger overlap
    const independentUpdate = engine.updateBelief({
      mint,
      prior: 0.10,
      observations: [
        { field: 'hsi', value: 0.80, weight: 1.0 },
        { field: 'diversity', value: 0.85, weight: 1.0 },
        { field: 'liquidity', value: 0.75, weight: 1.0 },
      ],
    });

    assert.equal(independentUpdate.discounted_overlap_count, 0);
    assert.equal(independentUpdate.effective_evidence_count, 3);
    assert.ok(independentUpdate.posterior_probability > 0.10);

    // 2. Correlated observations sharing a single trigger group (4 signals from one trade burst)
    const correlatedUpdate = engine.updateBelief({
      mint,
      prior: 0.10,
      observations: [
        { field: 'tx_speed', value: 0.90, trigger_group: 'trade_burst_alpha', weight: 1.0 },
        { field: 'volume_spike', value: 0.88, trigger_group: 'trade_burst_alpha', weight: 1.0 },
        { field: 'order_cluster', value: 0.85, trigger_group: 'trade_burst_alpha', weight: 1.0 },
        { field: 'gas_pressure', value: 0.82, trigger_group: 'trade_burst_alpha', weight: 1.0 },
      ],
    });

    // Obs 1 is original; Obs 2, 3, 4 are discounted overlap (total 3 overlapping claims)
    // Effective count: 1 + 1/2 + 1/3 + 1/4 = 2.0833
    assert.equal(correlatedUpdate.discounted_overlap_count, 3);
    assert.ok(Math.abs(correlatedUpdate.effective_evidence_count - 2.0833) < 0.01);
    assert.ok(correlatedUpdate.effective_evidence_count < 4.0, 'Correlated burst signals must be discounted');

    // 3. Missingness tracking
    assert.ok(correlatedUpdate.missingness_records);
    assert.equal(correlatedUpdate.missingness_records.secondary_dex_volume, 'NOT_OBSERVABLE');

    // Custom missingness propagation
    const updateWithMissing = engine.updateBelief({
      mint,
      prior: 0.10,
      observations: [{ field: 'hsi', value: 0.75, weight: 1.0 }],
      missing_fields: {
        dev_holding_pct: 'PARTIAL',
        kol_mentions: 'QUERY_FAILED',
      },
    });
    assert.equal(updateWithMissing.missingness_records.dev_holding_pct, 'PARTIAL');
    assert.equal(updateWithMissing.missingness_records.kol_mentions, 'QUERY_FAILED');
  });

  test('Pass 63 Test 3: Unknown Probability Mass Preservation, Confidence Capping & Fingerprint Invariants (Part IX, Blueprint §12, §14)', () => {
    const engine = new BayesBeliefEngine();
    const mint = 'SoLBayesFingerprint1111111111111111111111111111';

    // Maximum possible positive evidence
    const maxPositiveUpdate = engine.updateBelief({
      mint,
      prior: 0.50,
      observations: [
        { field: 'sig1', value: 0.99, weight: 1.0 },
        { field: 'sig2', value: 0.99, weight: 1.0 },
        { field: 'sig3', value: 0.99, weight: 1.0 },
        { field: 'sig4', value: 0.99, weight: 1.0 },
        { field: 'sig5', value: 0.99, weight: 1.0 },
      ],
    });

    // Confidence capping invariant: posterior never exceeds 0.95
    assert.ok(maxPositiveUpdate.posterior_probability <= 0.95, 'Posterior must not exceed 0.95');

    // Unknown probability mass preservation: at least 0.05
    assert.ok(
      maxPositiveUpdate.unknown_probability_mass >= 0.05,
      `Unknown mass must be >= 0.05, got ${maxPositiveUpdate.unknown_probability_mass}`
    );

    // Deterministic SHA-256 update hash
    assert.match(maxPositiveUpdate.update_hash, /^[a-f0-9]{64}$/, 'Update hash must be valid SHA-256');

    // Input validation guards
    assert.throws(
      () => engine.updateBelief({ mint: '', prior: 0.10, observations: [] }),
      TypeError,
      'Empty mint must throw TypeError'
    );
    assert.throws(
      () => engine.updateBelief({ mint, prior: -0.05, observations: [] }),
      RangeError,
      'Negative prior must throw RangeError'
    );
    assert.throws(
      () => engine.updateBelief({ mint, prior: 1.5, observations: [] }),
      RangeError,
      'Prior > 1 must throw RangeError'
    );

    // Verification helpers
    assert.equal(engine.isBeliefConfident(maxPositiveUpdate, 0.50), true);
    assert.equal(engine.isEvidenceSufficient(maxPositiveUpdate, 2.0), true);
  });

  test('Pass 63 Test 4: Binary Calibration Evaluation, Brier Score & Overconfidence Detection (Part IX, Blueprint §14)', () => {
    const engine = new BayesBeliefEngine();

    // 1. Well-calibrated prediction set (10 predictions)
    const wellCalibratedPredictions = [
      { predicted_prob: 0.10, actual_outcome: 0 },
      { predicted_prob: 0.15, actual_outcome: 0 },
      { predicted_prob: 0.20, actual_outcome: 0 },
      { predicted_prob: 0.35, actual_outcome: 0 },
      { predicted_prob: 0.40, actual_outcome: 0 },
      { predicted_prob: 0.60, actual_outcome: 1 },
      { predicted_prob: 0.70, actual_outcome: 1 },
      { predicted_prob: 0.80, actual_outcome: 1 },
      { predicted_prob: 0.85, actual_outcome: 1 },
      { predicted_prob: 0.90, actual_outcome: 1 },
    ];

    const wellReport = engine.evaluateCalibration(wellCalibratedPredictions);
    assert.equal(wellReport.status, 'EVALUATED');
    assert.equal(wellReport.evaluated_samples, 10);
    assert.ok(wellReport.brier_score < 0.20, `Expected Brier score < 0.20, got ${wellReport.brier_score}`);
    assert.ok(wellReport.expected_calibration_error <= 0.25, `Expected ECE <= 0.25, got ${wellReport.expected_calibration_error}`);
    assert.equal(wellReport.is_overconfident, false);

    // 2. Overconfident prediction set: predicts 0.90+ high confidence but outcome is 0
    const overconfidentPredictions = [
      { predicted_prob: 0.95, actual_outcome: 0 },
      { predicted_prob: 0.95, actual_outcome: 0 },
      { predicted_prob: 0.90, actual_outcome: 0 },
      { predicted_prob: 0.85, actual_outcome: 0 },
      { predicted_prob: 0.85, actual_outcome: 1 },
    ];

    const overReport = engine.evaluateCalibration(overconfidentPredictions);
    assert.equal(overReport.is_overconfident, true, 'Severe miscalibration must trigger is_overconfident flag');
    assert.ok(overReport.brier_score > 0.40, `Brier score must be elevated, got ${overReport.brier_score}`);
  });

  test('Pass 63 Test 5: Master Intelligence Engine Research Telemetry & Helper Methods (Blueprint §12, §14)', async () => {
    const master = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(master);

    const mint = 'SoLBayesMasterGate11111111111111111111111111111';
    const receivedAtMs = Date.now();
    const sourceAtMs = receivedAtMs - 40;

    const baseEvent = {
      eventId: 'evt_pass63_gate_01',
      eventType: 'TOKEN_CREATE',
      mint,
      slot: 448300100,
      timestampNs: BigInt(sourceAtMs) * 1_000_000n,
      sourceTimestampMs: sourceAtMs,
      receivedTimestampMs: receivedAtMs,
      sequenceId: 1,
      chainState: 'CONFIRMED',
      sourceConfidence: 0.99,
      freshnessMs: 10,
      provenance: ['PUMP_PORTAL_WS'],
      payload: {
        mint,
        amountSol: 30.0,
        priceSol: 0.00004,
        symbol: 'BAY63',
        creator: 'CreatorWalletAlpha1111111111111111111111111',
        initialLiquiditySol: 30.0,
      },
    };

    const baseWallets = [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ];

    const baseContext = {
      tokenAgeSec: 40,
      marketCapSol: 120,
      liquiditySol: 35,
      txCount: 12,
      rawWallets: baseWallets,
      isMintRenounced: true,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 12,
    };

    // Subtest 5A: A caller's Bayes threshold flag cannot turn an uncalibrated posterior into a decision gate
    const blockedResult = await master.processEvent(baseEvent, {
      ...baseContext,
    });

    assert.doesNotMatch(blockedResult.whyExecutionBlocked || '', /BAYESIAN POSTERIOR BELIEF/);

    // Subtest 5B: ViewModel telemetry verification
    assert.ok(blockedResult.viewModel.bayesBeliefUpdate);
    assert.ok(blockedResult.viewModel.bayesPosteriorProb !== undefined);
    assert.ok(blockedResult.viewModel.bayesPriorProb !== undefined);
    assert.ok(blockedResult.viewModel.bayesEffectiveEvidenceCount !== undefined);
    assert.ok(blockedResult.viewModel.bayesUnknownMass !== undefined);
    assert.ok(blockedResult.viewModel.bayesUnknownMass >= 0.05);

    // Subtest 5C: Public helper methods on MasterIntelligenceEngine
    assert.ok(master.getBayesBeliefEngine() instanceof BayesBeliefEngine);

    const calculatedPrior = master.calculateHierarchicalPrior({
      global_population_prior: 0.04,
      launch_class_prior: 0.08,
      market_regime_prior: 0.20,
      liquidity_band_prior: 0.18,
      creator_class_prior: 0.12,
    });
    assert.equal(calculatedPrior, 0.126);

    const directUpdate = master.updateBayesBelief({
      mint,
      prior: 0.10,
      observations: [{ field: 'test', value: 0.85, weight: 1.0 }],
    });
    assert.equal(directUpdate.mint, mint);
    assert.match(directUpdate.update_hash, /^[a-f0-9]{64}$/);

    const directCalibration = master.evaluateBayesCalibration([
      { predicted_prob: 0.10, actual_outcome: 0 },
      { predicted_prob: 0.90, actual_outcome: 1 },
    ]);
    assert.equal(directCalibration.status, 'EVALUATED');
    assert.equal(directCalibration.evaluated_samples, 2);
    assert.equal(directCalibration.is_overconfident, false);
  });
});

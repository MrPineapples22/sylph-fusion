import test from 'node:test';
import assert from 'node:assert/strict';
import { BayesBeliefEngine } from '../../dist/intelligence/bayes/hierarchical-belief.js';

test('calibration ECE compares forecast bins with observed event rates, not individual absolute error', () => {
  const report = new BayesBeliefEngine().evaluateCalibration([
    { predicted_prob: 0.11, actual_outcome: 0 },
    { predicted_prob: 0.12, actual_outcome: 1 },
    { predicted_prob: 0.13, actual_outcome: 0 },
  ]);

  assert.equal(report.status, 'EVALUATED');
  assert.equal(report.evaluated_samples, 3);
  assert.equal(report.brier_score, 0.2678);
  assert.equal(report.expected_calibration_error, 0.2133);
  assert.equal(report.mean_calibration_gap, -0.2133);
  assert.equal(report.is_overconfident, false);
});

test('empty calibration input reports insufficient evidence instead of synthetic scores', () => {
  assert.deepEqual(new BayesBeliefEngine().evaluateCalibration([]), {
    status: 'INSUFFICIENT_DATA',
    brier_score: null,
    expected_calibration_error: null,
    mean_calibration_gap: null,
    is_overconfident: null,
    evaluated_samples: 0,
  });
});

test('calibration rejects invalid probability values and non-binary outcomes without coercion', () => {
  const engine = new BayesBeliefEngine();
  for (const predicted_prob of [NaN, Infinity, -0.01, 1.01, '0.5']) {
    assert.throws(() => engine.evaluateCalibration([{ predicted_prob, actual_outcome: 1 }]), /CALIBRATION_PROBABILITY_INVALID/);
  }
  for (const actual_outcome of [2, '1', null]) {
    assert.throws(() => engine.evaluateCalibration([{ predicted_prob: 0.5, actual_outcome }]), /CALIBRATION_OUTCOME_INVALID/);
  }
});

test('perfectly calibrated examples return zero Brier loss and ECE', () => {
  const report = new BayesBeliefEngine().evaluateCalibration([
    { predicted_prob: 0, actual_outcome: 0 },
    { predicted_prob: 1, actual_outcome: 1 },
  ]);
  assert.equal(report.brier_score, 0);
  assert.equal(report.expected_calibration_error, 0);
  assert.equal(report.mean_calibration_gap, 0);
  assert.equal(report.is_overconfident, false);

  const overconfident = new BayesBeliefEngine().evaluateCalibration([
    { predicted_prob: 0.9, actual_outcome: 0 },
  ]);
  assert.equal(overconfident.expected_calibration_error, 0.9);
  assert.equal(overconfident.mean_calibration_gap, 0.9);
  assert.equal(overconfident.is_overconfident, true);
});

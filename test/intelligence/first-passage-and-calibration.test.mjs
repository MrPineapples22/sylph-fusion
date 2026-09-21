import test from 'node:test';
import assert from 'node:assert/strict';

import { FirstPassageEngine } from '../../dist/intelligence/science/first-passage.js';
import { ProbabilityCalibrator } from '../../dist/intelligence/science/calibrator.js';

test('FirstPassageEngine computes path-dependent competing risks, quantiles, excursions, and probability velocity', () => {
  const engine = new FirstPassageEngine();

  const forecast = engine.evaluateProbabilisticForecast({
    mint: 'So11111111111111111111111111111111111111112',
    pumpScore: 78,
    hsi: 25,
    podRiskScore: 15,
    regimeMultiplier: 1.2,
    liquidityQuality: 80,
    independentDemandScore: 85,
    clusterConcentrationPct: 15,
  });

  // 1. Competing risks sum to approximately 1.0 at each horizon
  for (const horizon of ['5s', '15s', '30s', '1m', '5m', '15m']) {
    const risk = forecast.horizons[horizon];
    assert.ok(risk, `Must provide risk for horizon ${horizon}`);
    const sum = risk.pTargetFirst + risk.pStopFirst + risk.pNeither;
    assert.ok(Math.abs(sum - 1.0) < 0.05, `Competing risk sum at ${horizon} should be ~1.0, got ${sum}`);
    assert.ok(risk.pTargetFirst >= 0 && risk.pTargetFirst <= 1);
    assert.ok(risk.pStopFirst >= 0 && risk.pStopFirst <= 1);
  }

  // 2. Quantile monotonicity: Q01 <= Q05 <= Q10 <= Q25 <= Q50 <= Q75 <= Q90 <= Q95 <= Q99
  const q = forecast.quantiles;
  assert.ok(q.q01 <= q.q05, 'Q01 <= Q05');
  assert.ok(q.q05 <= q.q10, 'Q05 <= Q10');
  assert.ok(q.q10 <= q.q25, 'Q10 <= Q25');
  assert.ok(q.q25 <= q.q50, 'Q25 <= Q50');
  assert.ok(q.q50 <= q.q75, 'Q50 <= Q75');
  assert.ok(q.q75 <= q.q90, 'Q75 <= Q90');
  assert.ok(q.q90 <= q.q95, 'Q90 <= Q95');
  assert.ok(q.q95 <= q.q99, 'Q95 <= Q99');

  // 3. Excursions: MFE > 0 and MAE < 0
  assert.ok(forecast.expectedMfePct > 0, 'Expected MFE must be positive');
  assert.ok(forecast.expectedMaePct < 0, 'Expected MAE must be negative');

  // 4. Probability velocity & shock detection
  // Second call with deteriorated metrics should register dP/dt negative
  const forecastShock = engine.evaluateProbabilisticForecast({
    mint: 'So11111111111111111111111111111111111111112',
    pumpScore: 20,
    hsi: 85,
    podRiskScore: 80,
    regimeMultiplier: 0.8,
    liquidityQuality: 20,
    independentDemandScore: 10,
    clusterConcentrationPct: 90,
  });

  assert.ok(forecastShock.probabilityVelocity.dPdt <= 0, 'Negative shift must produce negative dP/dt');
});

test('ProbabilityCalibrator maps raw probabilities via Platt scaling and evaluates Brier and ECE scores', () => {
  const calibrator = new ProbabilityCalibrator();

  // Test calibration mapping: monotonically increasing within [0.01, 0.99]
  const pLow = calibrator.calibrate(0.1);
  const pMid = calibrator.calibrate(0.5);
  const pHigh = calibrator.calibrate(0.9);

  assert.ok(pLow < pMid, 'Calibrator must preserve rank order (low < mid)');
  assert.ok(pMid < pHigh, 'Calibrator must preserve rank order (mid < high)');
  assert.ok(pLow >= 0.01 && pHigh <= 0.99, 'Calibrated probabilities must be bounded');

  // Record observations (predicted vs outcome)
  calibrator.recordOutcome(0.8, 1, 'TRENDING');
  calibrator.recordOutcome(0.75, 1, 'TRENDING');
  calibrator.recordOutcome(0.2, 0, 'TRENDING');
  calibrator.recordOutcome(0.15, 0, 'TRENDING');

  const report = calibrator.generateReliabilityReport();
  assert.ok(report.brierScore >= 0 && report.brierScore <= 1, 'Brier score in [0, 1]');
  assert.ok(report.logLoss >= 0, 'Log loss >= 0');
  assert.ok(report.expectedCalibrationErrorBps >= 0, 'ECE >= 0 bps');
  assert.ok(report.conformalCoveragePct >= 0 && report.conformalCoveragePct <= 100, 'Coverage pct in [0, 100]');
});

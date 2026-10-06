import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FixedReferenceShiftEngine,
  MigrationSelectionEngine,
  RegimeTransportEngine,
  TransportabilityCourt,
} from '../../dist/intelligence/executable-alpha/index.js';

test('transportability rejects invalid runtime regimes and shift metrics', () => {
  assert.throws(() => RegimeTransportEngine.evaluateTransportability('UNKNOWN', 'NEW_LAUNCH'), /MARKET_REGIME_INVALID/);
  for (const value of [NaN, Infinity, -0.1, 1.01]) {
    assert.throws(() => RegimeTransportEngine.evaluateTransportability('NEW_LAUNCH', 'MATURE_POOL', value), /COVARIATE_SHIFT/);
  }
});

test('fixed-reference shift rejects non-finite prices and incomplete or invalid FX pairs', () => {
  assert.equal(FixedReferenceShiftEngine.calculateReturn(NaN, 1, 'SOL').isValidBaseline, false);
  assert.equal(FixedReferenceShiftEngine.calculateReturn(1, 1, 'SOL', 150, Infinity).isValidBaseline, false);
  assert.equal(FixedReferenceShiftEngine.calculateReturn(1, 1, 'SOL', 150).isValidBaseline, false);
  assert.equal(FixedReferenceShiftEngine.calculateReturn(1, 1, 'SOL', 150, 157.5).currencyDivergenceBps, 500);
});

test('migration priors are marked unverified and progress is validated/retained', () => {
  const analysis = MigrationSelectionEngine.evaluateCandidate(true, 72.5);
  assert.equal(analysis.evidenceStatus, 'UNVERIFIED_REFERENCE_PRIOR');
  assert.equal(analysis.curveProgressPct, 72.5);
  for (const value of [NaN, -1, 101]) assert.throws(() => MigrationSelectionEngine.evaluateCandidate(false, value), /CURVE_PROGRESS/);
  assert.throws(() => MigrationSelectionEngine.evaluateCandidate('yes', 50), /MIGRATION_STATUS/);
});

test('court fingerprints the validated FX input and applies it once to a fixed SOL token multiple', () => {
  const base = { sourceRegime: 'NEW_LAUNCH', targetRegime: 'NEW_LAUNCH' };
  const stable = TransportabilityCourt.judge({ ...base, solUsdVolatilityRatio: 1.05 });
  const shifted = TransportabilityCourt.judge({ ...base, solUsdVolatilityRatio: 1.2 });
  assert.equal(stable.referenceCurrencyStability, 1);
  assert.equal(shifted.referenceCurrencyStability, 0.65);
  assert.notEqual(stable.evidenceRoot, shifted.evidenceRoot);
  for (const value of [NaN, 0, -1, Infinity]) {
    assert.throws(() => TransportabilityCourt.judge({ ...base, solUsdVolatilityRatio: value }), /SOL_USD_VOLATILITY_RATIO/);
  }
});

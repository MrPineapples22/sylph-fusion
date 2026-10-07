import test from 'node:test';
import assert from 'node:assert/strict';
import { EconomicFreshnessEngine } from '../../dist/intelligence/executable-alpha/observation/economic-freshness.js';

const tick = (priceSol, timestampMs, quoteReservesLamports = 10_000_000_000n) => ({
  priceSol,
  priceUsd: priceSol * 150,
  timestampMs,
  slot: BigInt(Math.floor(timestampMs / 400)),
  quoteReservesLamports,
});

test('price-path maximum is observed-only and never fabricated as an executable peak', () => {
  const result = EconomicFreshnessEngine.analyzeTrajectory(1, [
    tick(1, 1_000),
    tick(2, 2_000, 100_000_000_000n),
    tick(1, 3_000),
  ]);

  assert.equal(result.status, 'OBSERVED_ONLY');
  assert.equal(result.evidenceClass, 'OBSERVED_PRICE_PATH_ONLY');
  assert.equal(result.peakEvidenceSource, 'PRICE_TICK');
  assert.equal(result.observedPeakMultiple, 2);
  assert.equal(result.executablePeakMultiple, null);
  assert.equal(result.executablePeakStatus, 'UNAVAILABLE_NO_POINT_IN_TIME_SELL_QUOTE');
  assert.equal(result.peakTimestampMs, 2_000);
  assert.equal(result.timeToPeakSeconds, 1);
  assert.equal(result.postPeakDrop50Seconds, 1);
  assert.equal(result.quoteReservesLamportsAtObservedPeak, 100_000_000_000n);
});

test('same-timestamp observations before the peak cannot count as post-peak drops', () => {
  const result = EconomicFreshnessEngine.analyzeTrajectory(1, [
    tick(0.4, 1_000),
    tick(2, 1_000),
    tick(1.2, 1_000),
    tick(0.9, 2_500),
  ]);
  assert.equal(result.postPeakDrop50Seconds, 1.5);
  assert.equal(result.timeToPeakSeconds, 0);
});

test('empty histories remain unknown instead of becoming a 1x flat path', () => {
  const result = EconomicFreshnessEngine.analyzeTrajectory(1, []);
  assert.equal(result.status, 'NO_OBSERVATIONS');
  assert.equal(result.observedPeakMultiple, null);
  assert.equal(result.peakEvidenceSource, null);
  assert.equal(result.executablePeakMultiple, null);
  assert.equal(result.timeToPeakSeconds, null);
  assert.equal(result.postPeakDrop50Seconds, null);
});

test('measures a later 50% decline when the supplied baseline remains the peak', () => {
  const result = EconomicFreshnessEngine.analyzeTrajectory(1, [tick(0.8, 1_000), tick(0.4, 2_000)]);
  assert.equal(result.observedPeakMultiple, 1);
  assert.equal(result.peakEvidenceSource, 'INPUT_BASELINE');
  assert.equal(result.peakTimestampMs, 1_000);
  assert.equal(result.postPeakDrop50Seconds, 1);
});

test('rejects invalid baselines, non-finite ticks, and nonchronological timestamps', () => {
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(Number.NaN, []), /initialPriceSol/);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, [tick(0, 1_000)]), /priceSol/);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, [tick(1, 2_000), tick(2, 1_000)]), /timestampMs/);
});

test('rejects sparse observation arrays rather than treating holes as absent history', () => {
  const sparse = new Array(1);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, sparse), /data elements/);
});

test('rejects accessor and inherited array elements without executing them', () => {
  let getterCalls = 0;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', { get() { getterCalls++; return tick(2, 2_000); }, enumerable: true });
  accessorArray.length = 1;
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, accessorArray), /own enumerable data elements/);
  assert.equal(getterCalls, 0);

  const inheritedArray = new Array(1);
  Object.setPrototypeOf(inheritedArray, [tick(2, 2_000)]);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, inheritedArray), /standard array prototype/);
});

test('snapshots only plain data properties and rejects accessor/proxy ticks', () => {
  let getterCalls = 0;
  const accessorTick = tick(2, 2_000);
  Object.defineProperty(accessorTick, 'priceSol', { get() { getterCalls++; return 2; } });
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, [accessorTick]), /own data property/);
  assert.equal(getterCalls, 0);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, [new Proxy(tick(2, 2_000), {})]), /observation object/);
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(1, new Proxy([tick(2, 2_000)], {})), /array/);
});

test('rejects a non-finite derived peak multiple even when both prices are finite', () => {
  const enormousFiniteTick = { ...tick(1, 2_000), priceSol: Number.MAX_VALUE };
  assert.throws(() => EconomicFreshnessEngine.analyzeTrajectory(Number.MIN_VALUE, [enormousFiniteTick]), /not finite/);
});

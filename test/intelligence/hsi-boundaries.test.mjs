import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DecomposedHsiEngine} from '../../dist/intelligence/signals/hsi.js';
const engine = new DecomposedHsiEngine();
const valid = {buyerCount: 0, uniqueFundingClusters: 0, realQuoteReservesLamports: 0n,
  virtualTokenReserves: 0n, buyCount: 0, sellCount: 0, buyVolumeSol: 0, sellVolumeSol: 0,
  tokenAgeSeconds: 0, creatorNetDeltaPct: 0, averageTradeSizeSol: 0, tradeSizeVariance: 0};

test('zero observed buyers cannot create an independent participant', () => {
  const report = engine.evaluate(valid);
  assert.equal(report.effectiveIndependentParticipants, 0);
  assert.equal(report.families.participationQuality, 100);
  assert.ok(Number.isFinite(report.compositeHsi));
});

test('fully distributed participant set cannot retain an invented organic wallet', () => {
  const report = engine.evaluate({...valid, buyerCount: 5, uniqueFundingClusters: 5, vestingRecipientCount: 5});
  assert.equal(report.effectiveIndependentParticipants, 0);
});

test('HSI rejects malformed counts, units, concentration, and nonfinite metrics', () => {
  for (const patch of [{buyerCount: NaN}, {buyCount: -1}, {sellCount: 0.5},
    {buyVolumeSol: Infinity}, {creatorNetDeltaPct: NaN}, {tradeSizeVariance: -1},
    {realQuoteReservesLamports: -1n}, {virtualTokenReserves: 1n << 64n},
    {realQuoteReservesLamports: '100'}, {topTenHolderConcentrationBps: 10001}]) {
    assert.throws(() => engine.evaluate({...valid, ...patch}), /HSI_.*_INVALID/);
  }
});

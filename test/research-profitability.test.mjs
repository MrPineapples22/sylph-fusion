import test from 'node:test';
import assert from 'node:assert/strict';
import { researchProfitability } from '../scripts/research-profitability.mjs';
import { observationFrame } from '../scripts/record-research-market.mjs';

const params = { velocity: 1, trailing: 5, slippageBps: 100, tp: [10, 20, 30] };
const frame = (i, price = 100) => ({ timestamp: 1000 + i * 1000, assets: [{ id: 'A', price, volume: 5, velocity: 2 }] });
test('holdout changes cannot select different parameters', () => {
  const ticks = Array.from({ length: 30 }, (_, i) => frame(i, 100 + i));
  const config = { grid: [params, { ...params, velocity: 3 }], minClosedTrades: 1 };
  const original = researchProfitability({ ticks }, config);
  const altered = researchProfitability({ ticks: ticks.map((f, i) => i < 21 ? f : frame(i, 10000 - i * 100)) }, config);
  assert.deepEqual(original.selectedParams, altered.selectedParams);
  assert.deepEqual(original.training, altered.training);
  assert.equal(original.liveTradingAuthorized, false);
  assert.ok(original.reasons.includes('SYNTHETIC_OR_UNVERIFIED_INPUT'));
});
test('no-trade and malformed histories cannot establish profit', () => {
  const ticks = Array.from({ length: 20 }, (_, i) => ({ ...frame(i), assets: [] }));
  const r = researchProfitability({ ticks }, { grid: [params] });
  assert.equal(r.status, 'NOT_DEMONSTRATED');
  assert.equal(r.holdout.netReturnPct, 0);
  assert.ok(r.reasons.includes('INSUFFICIENT_HOLDOUT_TRADES'));
  assert.throws(() => researchProfitability({ ticks: [...ticks].reverse() }), /increasing/);
});
test('recorder derives causal velocity, filters stale data, resets gaps', () => {
  const previous = new Map();
  const snapshot = (at, price) => ({ feedStale: false, rows: [{ mint: 'A', at, price, volume5m: 10 }] });
  assert.equal(observationFrame(snapshot(10000, 100), 10000, previous).assets[0].velocity, 0);
  assert.ok(Math.abs(observationFrame(snapshot(12000, 104), 12000, previous).assets[0].velocity - 2) < 1e-10);
  assert.equal(observationFrame(snapshot(12000, 104), 12001, previous).assets[0].velocity, 0);
  assert.equal(observationFrame(snapshot(12000, 104), 20000, previous).assets.length, 0);
  assert.equal(observationFrame(snapshot(22000, 200), 22000, previous).assets[0].velocity, 0);
  assert.throws(() => observationFrame({ rows: [], feedStale: true }, 22000), /stale/);
});

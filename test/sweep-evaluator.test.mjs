import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrial } from '../scripts/sweep-evaluator.mjs';
const p = { velocity: 1, trailing: 5, slippageBps: 100, tp: [15, 35, 75] };
const asset = (id, price, velocity = 2) => ({ id, price, velocity, volume: 1 });
const frames = rows => rows.map((assets, i) => ({ timestamp: 1000 + i, assets }));
test('missing next observation cancels pending entry and tiny recoveries stay nonnegative', () => {
  const r = evaluateTrial(frames([[asset('A', 1)], [], [asset('A', 1, 0)]]), p);
  assert.equal(r.entries, 0);
  const crashed = evaluateTrial(frames([[asset('A', 1)], [asset('A', 1)], [asset('A', 1e-20, 0)]]), p);
  assert.ok(crashed.endingEquityUsd >= 90);
});
test('flat market loses costs; entries are not closed trades', () => {
  const r = evaluateTrial(frames([[asset('A', 1)], [asset('A', 1)]]), p);
  assert.equal(r.trades, 1); assert.equal(r.entries, 1); assert.equal(r.winRate, 0);
  assert.ok(r.netReturnPct < -0.39); assert.ok(r.totalFeesUsd > 0.2); assert.equal(r.profitabilityProven, false);
});
test('entry fills after jump and cannot capture prior jump', () => {
  assert.ok(evaluateTrial(frames([[asset('A', 1)], [asset('A', 2)], [asset('A', 2)]]), p).netReturnPct < 0);
});
test('disappearance cannot sell holdings at different asset price', () => {
  const r = evaluateTrial(frames([[asset('A', 1)], [asset('A', 1)], [asset('B', 100)]]), p);
  assert.ok(Math.abs(r.netReturnPct + 10) < 1e-10); assert.equal(r.missingLiquidations, 1);
});
test('one winning closed position reports 100 percent win rate', () => {
  const r = evaluateTrial(frames([[asset('A', 1)], [asset('A', 1)], [asset('A', 2)], [asset('A', 2, 0)]]), p);
  assert.equal(r.trades, 1); assert.equal(r.winRate, 100); assert.ok(r.netReturnPct > 0);
});
test('higher modeled costs reduce return deterministically', () => {
  const ticks = frames([[asset('A', 1)], [asset('A', 1)], [asset('A', 2)]]), low = evaluateTrial(ticks, p);
  assert.ok(evaluateTrial(ticks, { ...p, slippageBps: 800 }).netReturnPct < low.netReturnPct);
  assert.deepEqual(low, evaluateTrial(ticks, p));
});
test('invalid chronology, prices, duplicate identities and costs rejected', () => {
  const good = frames([[asset('A', 1)], [asset('A', 1)]]);
  assert.throws(() => evaluateTrial([good[1], good[0]], p));
  assert.throws(() => evaluateTrial(frames([[asset('A', 0)], []]), p));
  assert.throws(() => evaluateTrial(frames([[asset('A', 1), asset('A', 2)], []]), p));
  assert.throws(() => evaluateTrial(good, p, { fixedFeeUsd: -1 }));
});
test('drawdown halt prevents subsequent new entries', () => {
  const ticks = frames([[asset('A', 1)], [asset('A', 1)], [asset('A', 0.5), asset('B', 1)], [asset('A', 0.5), asset('B', 1)]]);
  const r = evaluateTrial(ticks, p, { maxDrawdownPct: 2 });
  assert.equal(r.halted, true); assert.equal(r.entries, 1);
});

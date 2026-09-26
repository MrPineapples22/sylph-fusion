import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExit } from '../dist/exit-policy.js';

const base = { entry: 100, mark: 100, peak: 100, stage: 0, openedAt: 1_000, now: 61_000, stopBps: 1200 };
test('exit policy is fail-closed for stale, malformed, and future marks', () => {
  assert.equal(decideExit({ ...base, mark: 80, markAt: 1 }), null);
  assert.equal(decideExit({ ...base, mark: 80, markAt: 70_000 }), null);
  assert.equal(decideExit({ ...base, mark: NaN }), null);
});
test('exit policy prioritizes loss containment and gap-safe profit protection', () => {
  assert.equal(decideExit({ ...base, mark: 88 }).reason, 'STOP_LOSS');
  assert.equal(decideExit({ ...base, now: 30_000, mark: 97, peak: 100.5 }).reason, 'FALSE_BREAKOUT');
  assert.equal(decideExit({ ...base, mark: 104, peak: 125 }).reason, 'TRAILING_PROFIT');
  assert.equal(decideExit({ ...base, mark: 150, peak: 200 }).reason, 'TRAILING_PROFIT', 'a breached runner stop cannot be delayed by an unfilled target');
});
test('exit policy ladders profits deterministically before runner protection', () => {
  assert.deepEqual(decideExit({ ...base, mark: 112 }), { reason: 'TAKE_PROFIT_1', fractionBps: 2500, emergency: false, nextStage: 1, protectiveStop: 100 });
  assert.equal(decideExit({ ...base, stage: 2, mark: 151, peak: 151 }).reason, 'TAKE_PROFIT_3');
  assert.equal(decideExit({ ...base, now: 130_000, mark: 103, peak: 103 }), null, 'a position outside the flat-band is not force-rotated');
  assert.equal(decideExit({ ...base, now: 130_000, mark: 100, peak: 100 }).reason, 'STAGNATION');
});

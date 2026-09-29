import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExit } from '../dist/exit-policy.js';

const base = { entry: 100, mark: 100, peak: 100, stage: 0, openedAt: 1_000, now: 61_000, stopBps: 1200, markAt: 61_000 };
test('exit policy is fail-closed for stale, malformed, and future marks', () => {
  for (const markAt of [undefined, null, NaN, Infinity, -1, 60_999.5, 1, 70_000]) {
    assert.equal(decideExit({ ...base, mark: 80, markAt }), null, `reject markAt ${markAt}`);
  }
  assert.equal(decideExit({ ...base, mark: NaN }), null);
});

test('exit policy rejects invalid freshness limits and expires evidence at its original timestamp', () => {
  for (const maxMarkAgeMs of [null, NaN, Infinity, -1, 0, 1.5, '10000']) {
    assert.equal(decideExit({ ...base, mark: 80, maxMarkAgeMs }), null, `reject maxMarkAgeMs ${maxMarkAgeMs}`);
  }
  const input = { ...base, mark: 80, markAt: base.now - 10_000 };
  assert.equal(decideExit(input).reason, 'STOP_LOSS');
  assert.equal(decideExit({ ...input, now: input.now + 1 }), null);
});
test('exit policy prioritizes loss containment and gap-safe profit protection', () => {
  assert.equal(decideExit({ ...base, mark: 88 }).reason, 'STOP_LOSS');
  assert.equal(decideExit({ ...base, now: 30_000, markAt: 30_000, mark: 97, peak: 100.5 }).reason, 'FALSE_BREAKOUT');
  assert.equal(decideExit({ ...base, mark: 104, peak: 125 }).reason, 'TRAILING_PROFIT');
  assert.equal(decideExit({ ...base, mark: 150, peak: 200 }).reason, 'TRAILING_PROFIT', 'a breached runner stop cannot be delayed by an unfilled target');
});
test('exit policy ladders profits deterministically before runner protection', () => {
  assert.deepEqual(decideExit({ ...base, mark: 112 }), { reason: 'TAKE_PROFIT_1', fractionBps: 2500, emergency: false, nextStage: 1, protectiveStop: 100 });
  assert.equal(decideExit({ ...base, stage: 2, mark: 151, peak: 151 }).reason, 'TAKE_PROFIT_3');
  assert.equal(decideExit({ ...base, now: 130_000, markAt: 130_000, mark: 103, peak: 103 }), null, 'a position outside the flat-band is not force-rotated');
  assert.equal(decideExit({ ...base, now: 130_000, markAt: 130_000, mark: 100, peak: 100 }).reason, 'STAGNATION');
});

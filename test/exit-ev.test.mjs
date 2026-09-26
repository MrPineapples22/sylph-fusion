import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExitEv } from '../dist/intelligence/spie/exit-ev.js';

const base = { positionValueUsd: 100, reduceFraction: .5, probabilityUpside: .6, upsideBps: 2000,
  probabilityReversal: .25, reversalBps: 1000, probabilityRug: .02, rugLossBps: 8000,
  holdCostBps: 20, exitCostBps: 75, uncertaintyBps: 25 };

test('exit EV selects hold when conditional upside exceeds costs and risks', () => {
  const result = evaluateExitEv(base);
  assert.equal(result.selectedAction, 'HOLD');
  assert.ok(result.evHoldBps > result.evReduceBps);
});
test('exit EV selects close when conditional tail and reversal dominate', () => {
  const result = evaluateExitEv({ ...base, probabilityUpside: .05, probabilityReversal: .8, probabilityRug: .3 });
  assert.equal(result.selectedAction, 'CLOSE');
});
test('exit EV rejects invalid quantities rather than inventing a decision', () => {
  assert.equal(evaluateExitEv({ ...base, reduceFraction: 1.01 }), null);
});

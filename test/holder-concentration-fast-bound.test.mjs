import assert from 'node:assert/strict';
import test from 'node:test';
import { assessFastBoundHolderConcentration } from '../dist/market.js';

test('fast holder bound rejects only observed concentration', () => {
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 400n,
    knownTopTenRaw: 350n,
    maxTopTenBps: 3_000,
  });
  assert.equal(assessment.status, 'UNSAFE');
  assert.equal(assessment.unknownTailRaw, 600n);
});

test('fast holder bound does not convert an unknown tail into a concentration veto', () => {
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 400n,
    knownTopTenRaw: 250n,
    maxTopTenBps: 3_000,
  });
  assert.equal(assessment.status, 'AMBIGUOUS');
  assert.equal(assessment.unknownTailRaw, 600n);
});

test('full observed supply can establish a safe fast-bound result', () => {
  const assessment = assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 1_000n,
    knownTopTenRaw: 300n,
    maxTopTenBps: 3_000,
  });
  assert.equal(assessment.status, 'SAFE');
});

test('fast holder bound rejects invalid policy input', () => {
  assert.throws(() => assessFastBoundHolderConcentration({
    supply: 1_000n,
    observedRaw: 1_000n,
    knownTopTenRaw: 300n,
    maxTopTenBps: 10_001,
  }), /inconsistent holder snapshot/);
});

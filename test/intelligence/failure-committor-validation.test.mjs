import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_IMMINENT_THRESHOLD, FailureCommittorEngine } from '../../dist/intelligence/executable-alpha/index.js';

test('failure committor validates every risk input and uses one imminent threshold', () => {
  const inputs = {
    dtfScore: 0.75,
    sellPressureRatio: 0.85,
    creatorInventoryRatio: 0.18,
    top3HoldersShare: 0.55,
    liquidityDrainVelocity: 0.04,
  };
  const result = FailureCommittorEngine.computeFailureCommittor(inputs);
  assert.ok(result.qFail > 0.60);
  assert.equal(result.failureImminent, result.qFail >= FAILURE_IMMINENT_THRESHOLD || inputs.dtfScore > 0.70);
  for (const field of Object.keys(inputs)) {
    for (const value of [NaN, Infinity, -0.01, 1.01]) {
      assert.throws(() => FailureCommittorEngine.computeFailureCommittor({ ...inputs, [field]: value }), /MUST_BE_FINITE_UNIT_INTERVAL/);
    }
  }
});

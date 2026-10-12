import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLearningSnapshot } from '../src/learning-projection.js';

test('learning projection preserves a recorded loss and reports policy attribution separately', () => {
  const projected = projectLearningSnapshot({
    totalRealizedPnlUsd: -12.5,
    policyRealizedPnlUsd: 3.25,
    totalTradesEvaluated: 4,
  });

  assert.equal(projected.totalRealizedPnlUsd, -12.5);
  assert.equal(projected.rawUnfilteredPnlUsd, -12.5);
  assert.equal(projected.policyFilteredRealizedPnlUsd, 3.25);
  assert.equal(projected.totalTradesEvaluated, 4);
});

test('learning projection preserves zero and leaves unavailable values unknown', () => {
  assert.equal(projectLearningSnapshot({ totalRealizedPnlUsd: 0, policyRealizedPnlUsd: 0 }).totalRealizedPnlUsd, 0);
  const projected = projectLearningSnapshot({ totalRealizedPnlUsd: Number.NaN, policyRealizedPnlUsd: undefined });
  assert.equal(projected.totalRealizedPnlUsd, null);
  assert.equal(projected.rawUnfilteredPnlUsd, null);
  assert.equal(projected.policyFilteredRealizedPnlUsd, null);
});

test('learning projection rejects non-object snapshots', () => {
  assert.throws(() => projectLearningSnapshot(null), /must be an object/);
  assert.throws(() => projectLearningSnapshot([]), /must be an object/);
});

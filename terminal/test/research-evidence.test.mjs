import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLandingLaneResearchResponse, buildRunnerSearchCostUnavailableResponse} from '../research-evidence.mjs';

test('landing lane response distinguishes no observations from measured performance', () => {
  const empty = buildLandingLaneResearchResponse([], 30);
  assert.equal(empty.evidenceStatus, 'NO_OBSERVATIONS');
  assert.equal(empty.sourceConnection, 'IN_MEMORY_SCORECARD_ONLY');
  assert.equal(empty.minimumEvidenceThresholdAttempts, 30);
  assert.deepEqual(empty.scorecards, []);
  assert.equal(empty.authority, 'RESEARCH_ONLY_NO_LANE_SELECTION_AUTHORITY');

  const observed = buildLandingLaneResearchResponse([{laneId: 'example', resolvedAttempts: 2}], 30);
  assert.equal(observed.evidenceStatus, 'UNVERIFIED_LOCAL_OBSERVATIONS');
  assert.equal(observed.scorecards[0].resolvedAttempts, 2);
});

test('runner search cost stays unavailable until source-attributed outcomes are connected', () => {
  assert.deepEqual(buildRunnerSearchCostUnavailableResponse(), {
    ok: true,
    evidenceStatus: 'UNAVAILABLE',
    report: null,
    reason: 'SOURCE_ATTRIBUTED_OUTCOMES_NOT_CONNECTED',
    authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY',
  });
});

test('server research routes do not seed synthetic lane attempts or demo runner outcomes', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /globalLaneScorecards\.recordAttempt\s*\(/);
  assert.doesNotMatch(source, /demoOutcomes|empiricalGroundTruth/);
  assert.match(source, /buildLandingLaneResearchResponse\(scorecards/);
  assert.match(source, /buildRunnerSearchCostUnavailableResponse\(\)/);
});

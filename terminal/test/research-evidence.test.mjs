import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLandingLaneResearchResponse, buildRunnerSearchCostUnavailableResponse} from '../research-evidence.mjs';
import {parseLandingLaneResearchResponse} from '../src/components/lane-evidence.js';

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

test('JEV and Laya panel labels local synthetic previews and keeps missing evidence unknown', async () => {
  const source = await readFile(new URL('../src/components/HostedJevControl.jsx', import.meta.url), 'utf8');
  assert.match(source, /Local synthetic preview recorded/);
  assert.match(source, /Fallback inputs are synthetic preview data, not certified market evidence/);
  assert.match(source, /Hosted calls require a certified/);
  assert.match(source, /Refresh live evidence/);
  assert.match(source, /handleRefreshHostedEvidence/);
  assert.match(source, /Latest Local Preview/);
  assert.match(source, /: 'UNKNOWN'/);
  assert.doesNotMatch(source, /Latest Verified Subject|>CERTIFIED<|16\/16 features/);
});

test('landing UI hides legacy, unidentifiable, and malformed scorecard payloads', () => {
  const legacy = parseLandingLaneResearchResponse({scorecards: [{laneId: 'Jito-Bundle', resolvedAttempts: 1, landingRate: 1}]});
  assert.equal(legacy.status, 'UNAVAILABLE');
  assert.deepEqual(legacy.scorecards, []);

  const envelope = {ok: true, sourceConnection: 'IN_MEMORY_SCORECARD_ONLY', authority: 'RESEARCH_ONLY_NO_LANE_SELECTION_AUTHORITY', minimumEvidenceThresholdAttempts: 30};
  const contradictory = parseLandingLaneResearchResponse({...envelope, evidenceStatus: 'NO_OBSERVATIONS', scorecards: [{laneId: 'fake', resolvedAttempts: 1}]});
  assert.equal(contradictory.status, 'UNAVAILABLE');
  assert.deepEqual(contradictory.scorecards, []);

  const malformed = parseLandingLaneResearchResponse({...envelope, evidenceStatus: 'UNVERIFIED_LOCAL_OBSERVATIONS', scorecards: [{laneId: '', resolvedAttempts: 1}]});
  assert.equal(malformed.status, 'UNAVAILABLE');
  assert.deepEqual(malformed.scorecards, []);

  const incomplete = parseLandingLaneResearchResponse({...envelope, evidenceStatus: 'UNVERIFIED_LOCAL_OBSERVATIONS', scorecards: [{laneId: 'lane-a', resolvedAttempts: 30, landingRate: .9, eligibleForOptimization: false}]});
  assert.equal(incomplete.status, 'UNAVAILABLE');
  assert.deepEqual(incomplete.scorecards, []);

  const contradictoryEligibility = parseLandingLaneResearchResponse({...envelope, evidenceStatus: 'UNVERIFIED_LOCAL_OBSERVATIONS', scorecards: [{laneId: 'lane-a', resolvedAttempts: 30, landingRate: .9, p95LandingMs: 100, averageFeeUsd: .01, averageTipUsd: .01, eligibleForOptimization: false}]});
  assert.equal(contradictoryEligibility.status, 'UNAVAILABLE');
  assert.deepEqual(contradictoryEligibility.scorecards, []);

  const valid = parseLandingLaneResearchResponse({...envelope, evidenceStatus: 'UNVERIFIED_LOCAL_OBSERVATIONS', scorecards: [{laneId: 'lane-a', resolvedAttempts: 30, landingRate: .9, p95LandingMs: 100, averageFeeUsd: .01, averageTipUsd: .01, eligibleForOptimization: true}]});
  assert.equal(valid.status, 'UNVERIFIED_LOCAL_OBSERVATIONS');
  assert.equal(valid.scorecards.length, 1);
});

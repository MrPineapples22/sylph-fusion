import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeTruthEngine, HORIZON_MS_MAP } from '../../src/intelligence/science/outcome-truth.ts';
import { CounterfactualEngine } from '../../src/intelligence/science/counterfactual.ts';
const engine = new OutcomeTruthEngine();
const point = (timestampMs, priceUsd = 1, liquidityUsd = 100) => ({ timestampMs, priceUsd, liquidityUsd });
const evaluate = (points, options = { evaluationCutoffMs: 60_000, labelHorizon: '1m' }) => engine.evaluateOutcome('mint', 1, 100, 0, points, options);
const full = () => [5_000, 10_000, 15_000, 30_000, 60_000].map(t => point(t, 2.2));
const comparison = outcome => new CounterfactualEngine().evaluateDecision('mint', 'ENTER', outcome);
test('a three-hour sample cannot impersonate earlier checkpoints', () => {
  const result = evaluate([point(10_800_000)], { evaluationCutoffMs: 10_800_000 });
  for (const h of Object.keys(HORIZON_MS_MAP).filter(h => h !== '3h')) assert.equal(result.checkpoints[h].status, 'MISSING_WITHIN_TOLERANCE');
  assert.equal(result.checkpoints['3h'].observedTimestampMs, 10_800_000);
});
test('inclusive bounded sampling and pending window states', () => {
  for (const t of [5000, 5100]) {
    const cp = evaluate([point(t)], { evaluationCutoffMs: 5100, checkpointToleranceMs: 100 }).checkpoints['5s'];
    assert.equal(cp.status, 'OBSERVED'); assert.equal(cp.samplingDelayMs, t - 5000);
  }
  assert.equal(evaluate([point(5101)], { evaluationCutoffMs: 5101, checkpointToleranceMs: 100 }).checkpoints['5s'].status, 'MISSING_WITHIN_TOLERANCE');
  assert.equal(evaluate([], { evaluationCutoffMs: 5050, checkpointToleranceMs: 100 }).checkpoints['5s'].status, 'NOT_YET_OBSERVABLE');
});
test('post-cutoff evidence does not change metrics or labels', () => {
  const a = evaluate(full()); const b = evaluate([...full(), point(60_001, 0)]);
  assert.equal(b.excludedPostCutoffCount, 1);
  assert.deepEqual({ ...b, excludedPostCutoffCount: 0 }, a);
});
test('sorting and duplicate collapse are deterministic without input mutation', () => {
  const reversed = full().reverse(); const copy = structuredClone(reversed);
  assert.deepEqual(evaluate(reversed), evaluate([...full(), full()[0]])); assert.deepEqual(reversed, copy);
  assert.throws(() => evaluate([point(5000), point(5000, 2)]), /conflicting duplicate/);
});
test('empty or exclusively pre-entry history has no fabricated flat label', () => {
  const empty = evaluate([]);
  for (const key of ['primaryLabel', 'observedPathLabel', 'mfePct', 'maePct', 'timeToPeakMs']) assert.equal(empty[key], null);
  assert.equal(empty.labelStatus, 'UNOBSERVED');
  assert.equal(comparison(empty).counterfactualReturns.enterNowPct, null);
  const before = engine.evaluateOutcome('mint', 1, 100, 100, [point(99)], { evaluationCutoffMs: 100 });
  assert.equal(before.labelStatus, 'UNOBSERVED'); assert.equal(before.excludedPreEntryCount, 1);
});
test('invalid values reject, including unsafe time arithmetic and return overflow', () => {
  for (const field of ['timestampMs', 'priceUsd', 'liquidityUsd']) for (const value of [NaN, Infinity, -1, null, '1']) assert.throws(() => evaluate([{ ...point(5000), [field]: value }]), /INVALID_OUTCOME/);
  for (const value of [NaN, Infinity, -1, 0.5]) assert.throws(() => evaluate([], { evaluationCutoffMs: 60_000, checkpointToleranceMs: value }), /INVALID_OUTCOME/);
  for (const entry of [0, -1, NaN, Infinity]) assert.throws(() => engine.evaluateOutcome('mint', entry, 100, 0, []), /INVALID_OUTCOME/);
  assert.throws(() => evaluate([], { evaluationCutoffMs: -1 }), /INVALID_OUTCOME/);
  assert.throws(() => engine.evaluateOutcome('mint', 1, 100, Number.MAX_SAFE_INTEGER, []), /overflow/);
  assert.throws(() => engine.evaluateOutcome('mint', Number.MIN_VALUE, 100, 0, [point(5000)]), /overflow/);
});
test('zero price and epoch-zero failure remain observable events on censored paths', () => {
  const result = evaluate([point(0, 0, 0)]);
  assert.equal(result.timeToFailureMs, 0); assert.equal(result.failureObservedTimestampMs, 0);
  assert.equal(result.observedPathLabel, 'RUG'); assert.equal(result.primaryLabel, null);
  assert.equal(result.labelStatus, 'CENSORED');
});
test('percentage fields use percentage points and MAE is positive magnitude', () => {
  const gain = evaluate([point(5000, 1.2), point(60_000, 1.2)]);
  assert.ok(Math.abs(gain.checkpoints['5s'].returnPct - 20) < 1e-10);
  assert.ok(Math.abs(comparison(gain).counterfactualReturns.enterNowPct - 20) < 1e-10);
  const loss = evaluate([point(5000, 0.8)]);
  assert.ok(Math.abs(loss.maePct - 20) < 1e-10); assert.ok(Math.abs(loss.checkpoints['5s'].returnPct + 20) < 1e-10);
});
test('complete declared coverage resolves, missing interior samples remain censored', () => {
  const resolved = evaluate(full()); assert.equal(resolved.primaryLabel, 'RUNNER'); assert.equal(resolved.labelStatus, 'RESOLVED');
  assert.equal(comparison(resolved).filterAssessment.isTruePositive, true);
  const partial = evaluate(full().filter(p => p.timestampMs !== 15_000));
  assert.equal(partial.observedPathLabel, 'RUNNER'); assert.equal(partial.primaryLabel, null);
  assert.equal(comparison(partial).filterAssessment.filterValueScore, null);
});
test('later extremes cannot affect the declared label window', () => {
  const result = evaluate([...full(), point(100_000, 100)], { evaluationCutoffMs: 100_000, labelHorizon: '1m' });
  assert.equal(result.primaryLabel, 'RUNNER'); assert.ok(Math.abs(result.mfePct - 120) < 1e-10);
  assert.equal(result.observationCount, 5); assert.equal(result.lastObservedTimestampMs, 60_000);
});
test('missing alternatives stay null without suppressing supported comparisons', () => {
  const result = comparison(evaluate([point(5000, 1), point(60_000, 2)]));
  assert.equal(result.counterfactualReturns.enterNowPct, 100); assert.equal(result.counterfactualReturns.wait5sPct, 100);
  assert.equal(result.counterfactualReturns.wait15sPct, null); assert.equal(result.unavailableReasons.wait15sPct, 'MISSING_CHECKPOINT');
});
test('legacy inferred cutoff is deterministic but cannot certify a resolved label', () => {
  const result = engine.evaluateOutcome('mint', 1, 100, 0, full());
  assert.equal(result.cutoffSource, 'INFERRED_FROM_TRAJECTORY'); assert.equal(result.primaryLabel, null);
  assert.ok(result.censoringReasons.includes('INFERRED_CUTOFF'));
});
test('serialization, deterministic evaluation and version rejection', () => {
  const result = evaluate(full()); assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(evaluate(full()), result); assert.deepEqual(comparison(result), comparison(result));
  assert.equal(comparison(result).evaluatedAtMs, 60_000);
  assert.throws(() => comparison({ ...result, schemaVersion: '1.0.0' }), /UNSUPPORTED/);
});
test('zero initial liquidity is unavailable for liquidity-drop inference', () => {
  const result = engine.evaluateOutcome('mint', 1, 0, 0, [point(5000, 1, 0)]);
  assert.equal(result.failureObservedTimestampMs, undefined);
});
test('endpoint tolerance is declared and a window must close before resolution', () => {
  const points = [point(5050, 1.2)];
  const open = evaluate(points, { evaluationCutoffMs: 5050, labelHorizon: '5s', checkpointToleranceMs: 100 });
  assert.equal(open.labelStatus, 'CENSORED'); assert.equal(open.labelWindowEndMs, 5100);
  assert.equal(evaluate(points, { evaluationCutoffMs: 5100, labelHorizon: '5s', checkpointToleranceMs: 100 }).labelStatus, 'RESOLVED');
});

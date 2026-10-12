import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderedObservationStagingEngine } from '../../src/platform/ingestion/ordered-observation-buffer.ts';

const observation = (slot, transactionIndex, signature, patch = {}) => ({
  slot,
  transactionIndex,
  signature,
  eventType: 'TRANSACTION',
  receivedAtMs: slot * 100 + transactionIndex,
  observationDigest: 'a'.repeat(64),
  ...patch,
});

test('ordering is stable across slot, transaction index, and signature without claiming completeness', () => {
  const engine = new OrderedObservationStagingEngine();
  engine.stageObservation(observation(12, 2, 'z'));
  engine.stageObservation(observation(10, 0, 'b'));
  engine.stageObservation(observation(12, 1, 'c'));
  engine.stageObservation(observation(10, 0, 'a'));

  const report = engine.getWatermarkReport();
  assert.equal(report.completeness, 'NOT_ESTABLISHED');
  assert.equal(report.hasObservedSlotHoles, true);
  assert.equal(report.observedSlotHoleCount, 1);
  assert.equal(report.status, 'SPARSE_SLOT_OBSERVATIONS');
  assert.deepEqual(engine.drainOrderedObservations().map((row) => row.signature), ['a', 'b', 'c', 'z']);
});

test('capacity overflow rejects the new item and preserves all existing observations', () => {
  const engine = new OrderedObservationStagingEngine({ maxBufferSize: 1 });
  engine.stageObservation(observation(1, 0, 'kept'));
  const report = engine.stageObservation(observation(2, 0, 'rejected'));
  assert.equal(report.status, 'CAPACITY_OVERFLOW');
  assert.equal(report.capacityOverflowed, true);
  assert.equal(report.pendingCount, 1);
  assert.deepEqual(engine.drainOrderedObservations().map((row) => row.signature), ['kept']);
  assert.equal(engine.getStats().totalCapacityRejections, 1);
});

test('identical duplicates are idempotent while conflicting identities are rejected', () => {
  const engine = new OrderedObservationStagingEngine();
  const first = observation(3, 4, 'same');
  engine.stageObservation(first);
  engine.stageObservation({ ...first, receivedAtMs: first.receivedAtMs + 100 });
  assert.equal(engine.getStats().totalDuplicates, 1);
  assert.equal(engine.getStats().pendingCount, 1);
  assert.throws(() => engine.stageObservation({ ...first, eventType: 'CREATE', observationDigest: 'b'.repeat(64) }), { message: 'OBSERVATION_IDENTITY_CONFLICT' });
});

test('malformed evidence and invalid drain bounds are rejected', () => {
  const engine = new OrderedObservationStagingEngine();
  assert.throws(() => engine.stageObservation(observation(-1, 0, 'bad')), { message: 'INVALID_STAGED_OBSERVATION' });
  assert.throws(() => engine.stageObservation(observation(1, 0, 'bad', { observationDigest: 'not-a-digest' })), { message: 'INVALID_STAGED_OBSERVATION' });
  assert.throws(() => engine.drainOrderedObservations(-1), { message: 'INVALID_DRAIN_SLOT' });
});

test('drained-slot arrivals remain visible as late observations instead of being discarded', () => {
  const engine = new OrderedObservationStagingEngine();
  engine.stageObservation(observation(8, 0, 'first'));
  engine.drainOrderedObservations();
  const report = engine.stageObservation(observation(8, 1, 'late'));
  assert.equal(report.hasLateObservations, true);
  assert.equal(report.status, 'LATE_OBSERVATIONS');
  assert.equal(report.completeness, 'NOT_ESTABLISHED');
});

test('events without transaction identity are visible as unordered evidence', () => {
  const engine = new OrderedObservationStagingEngine();
  const report = engine.recordUnorderedObservation();
  assert.equal(report.hasUnorderedObservations, true);
  assert.equal(report.status, 'UNORDERED_OBSERVATIONS');
  assert.equal(report.completeness, 'NOT_ESTABLISHED');
});

test('stored and returned observations cannot be mutated by the caller', () => {
  const engine = new OrderedObservationStagingEngine();
  const input = observation(1, 0, 'immutable');
  engine.stageObservation(input);
  input.eventType = 'CHANGED';
  const drained = engine.drainOrderedObservations();
  assert.equal(drained[0].eventType, 'TRANSACTION');
  assert.equal(Object.isFrozen(drained[0]), true);
  assert.equal(Object.isFrozen(engine.getWatermarkReport()), true);
});

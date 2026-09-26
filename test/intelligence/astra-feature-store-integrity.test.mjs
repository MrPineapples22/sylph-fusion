import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointInTimeFeatureStore } from '../../dist/intelligence/truth/feature-store.js';

const input = (overrides = {}) => ({
  snapshotId: 'snapshot-1', mint: 'mint-1', slot: 100, timestampMs: 1_000,
  tokenAgeSeconds: 10, featureSchemaVersion: '1.0.0',
  features: { score: 0.7, valid: true, source: 'chain' },
  dataQualityScore: 0.9, freshnessMs: 25, ...overrides,
});

const seal = (params) => new PointInTimeFeatureStore().recordSnapshot(params).snapshotHash;

test('ASTRA feature authority detaches and freezes snapshots and history views', () => {
  const store = new PointInTimeFeatureStore();
  const params = input({ features: { nested: { values: [1, { score: 2 }] } } });
  const snapshot = store.recordSnapshot(params);
  const originalHash = snapshot.snapshotHash;
  params.mint = 'changed';
  params.features.nested.values[1].score = 999;
  assert.equal(snapshot.features.nested.values[1].score, 2);
  assert.equal(snapshot.mint, 'mint-1');
  for (const mutation of [
    () => { snapshot.slot = 999; },
    () => { snapshot.features.nested.values[1].score = 999; },
    () => { snapshot.features.nested.values.push(999); },
    () => { store.getSnapshot('snapshot-1').features = {}; },
    () => { store.getSnapshotAsOf('mint-1', 1_000, 100).mint = 'changed'; },
    () => { store.getAllSnapshotsForMint('mint-1').pop(); },
  ]) assert.throws(mutation, TypeError);
  const history = store.getAllSnapshotsForMint('mint-1');
  store.recordSnapshot(input({ snapshotId: 'snapshot-2', slot: 101, timestampMs: 1_001 }));
  assert.equal(history.length, 1);
  assert.equal(store.getAllSnapshotsForMint('mint-1').length, 2);
  assert.equal(store.getSnapshot('snapshot-1').snapshotHash, originalHash);
});

test('ASTRA feature seals cover nested data and every persisted metadata field canonically', () => {
  const original = input({ features: { nested: { a: 1, b: [2, { c: 3 }] }, score: 4 } });
  const equivalent = input({ features: { score: 4, nested: { b: [2, { c: 3 }], a: 1 } } });
  assert.equal(seal(original), seal(equivalent));
  assert.notEqual(seal(original), seal(input({ features: { nested: { a: 1, b: [2, { c: 5 }] }, score: 4 } })));
  for (const [key, value] of Object.entries({
    snapshotId: 'snapshot-2', mint: 'mint-2', slot: 101, timestampMs: 1_001,
    tokenAgeSeconds: 11, featureSchemaVersion: '2.0.0', dataQualityScore: 0.8, freshnessMs: 26,
  })) assert.notEqual(seal(original), seal({ ...original, [key]: value }), key);
  // Concatenating unframed identity fields previously made these identical.
  assert.notEqual(seal(input({ snapshotId: 'ab', mint: 'c' })), seal(input({ snapshotId: 'a', mint: 'bc' })));
});

test('ASTRA feature recording is idempotent and conflicting identities preserve both indexes', () => {
  const store = new PointInTimeFeatureStore();
  const first = store.recordSnapshot(input());
  assert.equal(store.recordSnapshot(input({ features: { source: 'chain', valid: true, score: 0.7 } })), first);
  for (const change of [{ features: { score: 8 } }, { mint: 'mint-2' }, { freshnessMs: 26 }]) {
    assert.throws(() => store.recordSnapshot(input(change)), /Conflicting feature snapshot ID/);
  }
  assert.equal(store.getSnapshot('snapshot-1'), first);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-1'), [first]);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-2'), []);
});

test('ASTRA feature history uses deterministic slot/time/identity order and both as-of limits', () => {
  const rows = [
    input({ snapshotId: 'b', slot: 100, timestampMs: 1_100 }),
    input({ snapshotId: 'a', slot: 100, timestampMs: 1_100 }),
    input({ snapshotId: 'older', slot: 100, timestampMs: 1_000 }),
    input({ snapshotId: 'next-slot', slot: 101, timestampMs: 900 }),
    input({ snapshotId: 'future-time', slot: 99, timestampMs: 1_200 }),
  ];
  for (const sequence of [rows, [...rows].reverse()]) {
    const store = new PointInTimeFeatureStore();
    for (const row of sequence) store.recordSnapshot(row);
    assert.deepEqual(store.getAllSnapshotsForMint('mint-1').map((s) => s.snapshotId),
      ['future-time', 'older', 'a', 'b', 'next-slot']);
    assert.equal(store.getSnapshotAsOf('mint-1', 1_100, 100)?.snapshotId, 'b');
    assert.equal(store.getSnapshotAsOf('mint-1', 1_000, 100)?.snapshotId, 'older');
    assert.equal(store.getSnapshotAsOf('mint-1', 1_100, 101)?.snapshotId, 'next-slot');
    assert.equal(store.getSnapshotAsOf('mint-1', 999, 100), undefined);
    assert.equal(store.getSnapshotAsOf('unknown', 1_100, 101), undefined);
  }
});

test('ASTRA feature authority rejects invalid temporal coordinates before storing or querying', () => {
  const store = new PointInTimeFeatureStore();
  for (const value of [undefined, null, '1000', NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => store.recordSnapshot(input({ timestampMs: value })), TypeError);
    assert.throws(() => store.getSnapshotAsOf('unknown', value, 100), TypeError);
  }
  for (const value of [undefined, null, '100', NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => store.recordSnapshot(input({ slot: value })), TypeError);
    assert.throws(() => store.getSnapshotAsOf('unknown', 1_000, value), TypeError);
  }
  assert.equal(store.getSnapshot('snapshot-1'), undefined);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-1'), []);
  store.recordSnapshot(input({ slot: 0, timestampMs: 0 }));
  store.recordSnapshot(input({ snapshotId: 'fractional-time', slot: 1, timestampMs: 0.5 }));
  assert.equal(store.getSnapshotAsOf('mint-1', 0.5, 1)?.snapshotId, 'fractional-time');
});

test('ASTRA feature seals reject lossy JSON values and malformed required metadata atomically', () => {
  const store = new PointInTimeFeatureStore();
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, () => 1, new Date(), new Map(), cycle, [undefined]]) {
    assert.throws(() => store.recordSnapshot(input({ features: { bad: value } })), TypeError);
  }
  for (const change of [
    { features: null }, { features: [] }, { snapshotId: '' }, { mint: ' ' },
    { featureSchemaVersion: undefined }, { freshnessMs: NaN }, { tokenAgeSeconds: -1 },
    { dataQualityScore: Infinity }, { dataQualityScore: 1.1 },
  ]) assert.throws(() => store.recordSnapshot(input(change)), TypeError);
  assert.equal(store.getSnapshot('snapshot-1'), undefined);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-1'), []);
  const shared = { score: 1 };
  const snapshot = store.recordSnapshot(input({ features: { left: shared, right: shared } }));
  assert.deepEqual(snapshot.features.left, snapshot.features.right);
  assert.notEqual(snapshot.features.left, shared);
});

test('ASTRA feature retention evicts oldest unique arrivals consistently from both indexes', () => {
  for (const capacity of [0, -1, 1.5, Infinity, NaN, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new PointInTimeFeatureStore(capacity), TypeError);
  }
  const store = new PointInTimeFeatureStore(2);
  const oldest = store.recordSnapshot(input());
  store.recordSnapshot(input({ snapshotId: 'other-mint', mint: 'mint-2' }));
  assert.equal(store.recordSnapshot(input()), oldest);
  assert.throws(() => store.recordSnapshot(input({ freshnessMs: 1 })), /Conflicting/);
  assert.equal(store.getSnapshot('snapshot-1'), oldest);
  store.recordSnapshot(input({ snapshotId: 'newest', slot: 99, timestampMs: 900 }));
  assert.equal(store.getSnapshot('snapshot-1'), undefined);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-1').map((s) => s.snapshotId), ['newest']);
  assert.equal(store.getSnapshotAsOf('mint-1', 1_000, 100)?.snapshotId, 'newest');
  store.recordSnapshot(input({ snapshotId: 'last', mint: 'mint-3' }));
  assert.equal(store.getSnapshot('other-mint'), undefined);
  assert.deepEqual(store.getAllSnapshotsForMint('mint-2'), []);
  assert.equal(store.getSnapshotAsOf('mint-2', 1_000, 100), undefined);
  // Retention does not mutate snapshots or history views already held by readers.
  assert.equal(oldest.features.score, 0.7);
});

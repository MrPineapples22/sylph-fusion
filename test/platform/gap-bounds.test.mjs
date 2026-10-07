import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IngestionGapReconciler} from '../../dist/platform/ingestion/gap-reconciler.js';

const certificateFor = (gap, {includeStatuses = true} = {}) => {
  const perSlotStatus = Object.create(null);
  if (includeStatuses) {
    for (let slot = gap.startSlot; slot <= gap.endSlot; slot++) perSlotStatus[slot] = 'EMPTY';
  }
  return Object.freeze({
    certificateId: `certificate-${gap.gapId}`,
    gapId: gap.gapId,
    startSlot: gap.startSlot,
    endSlot: gap.endSlot,
    providerId: gap.providerId ?? 'fixture-provider',
    classification: gap.classification ?? 'UNKNOWN',
    lane: gap.lane ?? 'CHAIN_BLOCK',
    recoveredEventIds: Object.freeze([]),
    perSlotStatus: Object.freeze(perSlotStatus),
    stateRoot: 'a'.repeat(64),
    coverageRoot: 'b'.repeat(64),
    isVerified: true,
    certifiedAtMs: Date.now(),
  });
};

test('slot receipt deduplication remains bounded under descending out-of-order traffic', () => {
  const r=new IngestionGapReconciler(100);
  for(let slot=1000;slot>0;slot--)r.registerSlot(slot);
  assert.equal(r.seenSlots.size,100);
  assert.equal(r.getReport().circularBufferSize,100);
});

test('large backfill intervals remain compact but cannot resolve without bounded per-slot proof', () => {
  const r=new IngestionGapReconciler(100);
  r.registerSlot(1);r.registerSlot(1_000_000_000);
  const gap = r.getUnresolvedGaps()[0];
  assert.equal(r.markGapResolved(gap.startSlot,gap.endSlot,certificateFor(gap,{includeStatuses:false})),false);
  assert.equal(r.hasUnresolvedGaps(),true);
  assert.equal(r.getReport().totalSlotsBackfilled,0);
  assert.equal(r.seenSlots.size,2);
});

test('invalid ring capacities are rejected before allocation', () => {
  for(const size of [NaN,Infinity,0,-1,1.5,100001]) assert.throws(()=>new IngestionGapReconciler(size));
});

test('filtered transaction observations do not imply missing chain slots', () => {
  const r=new IngestionGapReconciler(100);
  r.registerSlot(10,1,false);r.registerSlot(1000,1,false);
  assert.equal(r.hasUnresolvedGaps(),false);
  assert.equal(r.getReport().gapsDetected,0);
  assert.equal(r.getReport().latestContinuousSlot,0,
    'filtered observations must not advance the chain-coverage frontier');
  assert.equal(r.getContinuousSlot(),0);
  r.registerSlot(1001,1,true);
  assert.equal(r.getContinuousSlot(),1001,
    'the first complete-source receipt establishes a baseline without certifying earlier slots');
  r.registerSlot(1003,1,true);
  assert.equal(r.getReport().gapsDetected,1,
    'subsequent complete-source discontinuities remain detectable');
});

test('filtered and foreign-provider receipts cannot shrink a gap, while a matching contiguous receipt can', () => {
  const r = new IngestionGapReconciler(100);
  r.registerSlot(1, 1, true, {providerId: 'provider-a'});
  r.registerSlot(3, 1, true, {providerId: 'provider-a'});
  assert.equal(r.getUnresolvedGaps().length, 1);

  r.registerSlot(2, 1, false, {providerId: 'provider-a'});
  assert.equal(r.getUnresolvedGaps().length, 1, 'filtered slot receipt is not contiguous coverage');
  r.registerSlot(2, 1, true, {providerId: 'provider-b'});
  assert.equal(r.getUnresolvedGaps().length, 1, 'another provider cannot close this provider-bound gap');

  r.registerSlot(2, 1, true, {providerId: 'provider-a'});
  assert.equal(r.getUnresolvedGaps().length, 0,
    'the earlier filtered receipt must not deduplicate away a later matching complete-source receipt');
  assert.equal(r.getReport().totalSlotsBackfilled, 0,
    'a directly observed slot is not counted as historical backfill');
});

test('backfill concurrency and overflow remain bounded and visible', async () => {
  const r=new IngestionGapReconciler(100);
  let calls=0,release,pendingGap;
  r.setBackfillHandler(gap=>{calls++;pendingGap=gap;return new Promise(resolve=>{release=resolve;});});
  for(let slot=1;slot<1000;slot+=2)r.registerSlot(slot);
  assert.equal(calls,1);
  assert.ok(r.pendingBackfills.length<=100);
  assert.ok(r.gaps.length<=100);
  assert.equal(r.getReport().unresolvedHistoryTruncated,true);
  assert.equal(r.hasUnresolvedGaps(),true);
  r.reset();
  release(certificateFor(pendingGap));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.getReport().gapsResolved,0,'Old completions cannot certify new state');
  assert.equal(r.getReport().totalSlotsBackfilled,0);
});

test('failed backfills and external mutation cannot erase unresolved evidence', async () => {
  const r=new IngestionGapReconciler(100);
  r.setBackfillHandler(async()=>{throw Error('offline');});
  r.registerSlot(1);r.registerSlot(3);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.getReport().backfillFailures,1);
  r.getUnresolvedGaps()[0].isResolved=true;
  assert.equal(r.hasUnresolvedGaps(),true);
});

test('plain success booleans and mismatched certificates cannot resolve a gap', async () => {
  const r = new IngestionGapReconciler(100);
  r.setBackfillHandler(async () => true);
  r.registerSlot(1);
  r.registerSlot(3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.hasUnresolvedGaps(), true);
  assert.equal(r.getReport().gapsResolved, 0);
  assert.equal(r.getReport().backfillFailures, 1);

  const gap = r.getUnresolvedGaps()[0];
  const wrongGap = Object.freeze({...certificateFor(gap), gapId: 'another-gap'});
  assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, wrongGap), false);
  assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, certificateFor(gap)), true);
  assert.equal(r.hasUnresolvedGaps(), false);
});

test('recovery certificates reject missing or unavailable per-slot evidence and snapshot accepted input', () => {
  const r = new IngestionGapReconciler(100);
  r.registerSlot(1);
  r.registerSlot(4);
  const gap = r.getUnresolvedGaps()[0];

  const incomplete = {...certificateFor(gap), certificateId: 'incomplete-certificate', perSlotStatus: {'3': 'EMPTY'}};
  assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, incomplete), false);

  const unavailable = {...certificateFor(gap), certificateId: 'unavailable-certificate', perSlotStatus: {'2': 'UNAVAILABLE', '3': 'EMPTY'}};
  assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, unavailable), false);

  const mutable = {
    ...certificateFor(gap),
    certificateId: 'mutable-certificate',
    recoveredEventIds: ['event-1'],
    perSlotStatus: {'2': 'RECOVERED', '3': 'EMPTY'},
  };
  assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, mutable), true);
  mutable.recoveredEventIds[0] = 'tampered';
  mutable.perSlotStatus['2'] = 'UNAVAILABLE';
  const stored = r.getRecoveryCertificate(gap.gapId);
  assert.deepEqual(stored.recoveredEventIds, ['event-1']);
  assert.equal(stored.perSlotStatus[2], 'RECOVERED');
  assert.equal(Object.isFrozen(stored), true);
});

test('replacing a backfill provider cannot let an old provider certify a gap', async () => {
  const r=new IngestionGapReconciler(100);
  let release, pendingGap;
  r.setBackfillHandler(gap=>{pendingGap = gap; return new Promise(resolve=>{release=resolve;});});
  r.registerSlot(1);r.registerSlot(3);
  r.setBackfillHandler(async()=>false);
  release(certificateFor(pendingGap));
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.hasUnresolvedGaps(),true);
  assert.equal(r.getReport().gapsResolved,0);
});

test('late contiguous receipts requeue exact child intervals after an in-flight backfill becomes stale', async () => {
  const r = new IngestionGapReconciler(100);
  let releaseOriginal;
  const calls = [];
  r.setBackfillHandler(async gap => {
    calls.push({startSlot: gap.startSlot, endSlot: gap.endSlot});
    if (calls.length === 1) {
      return await new Promise(resolve => { releaseOriginal = () => resolve(certificateFor(gap)); });
    }
    return certificateFor(gap);
  });

  r.registerSlot(1, 1, true, {providerId: 'provider-a'});
  r.registerSlot(10, 1, true, {providerId: 'provider-a'});
  assert.deepEqual(calls, [{startSlot: 2, endSlot: 9}]);

  r.registerSlot(5, 1, true, {providerId: 'provider-a'});
  releaseOriginal();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, [
    {startSlot: 2, endSlot: 9},
    {startSlot: 2, endSlot: 4},
    {startSlot: 6, endSlot: 9},
  ]);
  assert.equal(r.hasUnresolvedGaps(), false);
  assert.equal(r.getReport().backfillFailures, 1, 'the stale original-range certificate is rejected');
  assert.equal(r.getReport().totalSlotsBackfilled, 7);
});

test('recovery certificate retention stays bounded and exposes proof-history eviction', () => {
  const r = new IngestionGapReconciler(100);
  r.registerSlot(1);
  let firstGapId;
  let latestGapId;
  for (let index = 0; index < 120; index++) {
    r.registerSlot(3 + index * 2);
    const gap = r.getUnresolvedGaps()[0];
    assert.ok(gap, `gap ${index} should be detected`);
    if (index === 0) firstGapId = gap.gapId;
    latestGapId = gap.gapId;
    assert.equal(r.markGapResolved(gap.startSlot, gap.endSlot, certificateFor(gap)), true);
  }

  const certificates = r.getAllRecoveryCertificates();
  assert.ok(certificates.length <= 100, 'retained proof count remains within its capacity-derived bound');
  assert.equal(r.getRecoveryCertificate(firstGapId), undefined, 'old proof is evicted');
  assert.equal(r.getRecoveryCertificate(latestGapId)?.gapId, latestGapId, 'recent proof remains retrievable');
  assert.equal(r.getReport().unresolvedHistoryTruncated, true);
  assert.equal(r.hasUnresolvedGaps(), true, 'truncated proof history prevents a complete-coverage claim');
});

test('backfill proof is durable before the reconciler closes its gap', async () => {
  const r = new IngestionGapReconciler(100);
  let releaseJournal;
  let persisted;
  r.setRecoveryCertificateJournal({
    saveVerifiedRecoveryCertificate: certificate => {
      persisted = certificate;
      return new Promise(resolve => { releaseJournal = resolve; });
    },
  });
  r.setBackfillHandler(async gap => certificateFor(gap));
  r.registerSlot(1);
  r.registerSlot(3);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(persisted);
  assert.equal(r.hasUnresolvedGaps(), true, 'successful certificate must be committed to its journal before resolution');
  releaseJournal();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.hasUnresolvedGaps(), false);
  assert.equal(r.getRecoveryCertificate(persisted.gapId)?.certificateId, persisted.certificateId);
});

test('failed certificate persistence leaves the covered gap unresolved', async () => {
  const r = new IngestionGapReconciler(100);
  r.setRecoveryCertificateJournal({
    saveVerifiedRecoveryCertificate: async () => { throw new Error('disk unavailable'); },
  });
  r.setBackfillHandler(async gap => certificateFor(gap));
  r.registerSlot(1);
  r.registerSlot(3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.hasUnresolvedGaps(), true);
  assert.equal(r.getReport().gapsResolved, 0);
  assert.equal(r.getReport().backfillFailures, 1);
});

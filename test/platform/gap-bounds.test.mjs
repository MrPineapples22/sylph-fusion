import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IngestionGapReconciler} from '../../dist/platform/ingestion/gap-reconciler.js';

test('slot receipt deduplication remains bounded under descending out-of-order traffic', () => {
  const r=new IngestionGapReconciler(100);
  for(let slot=1000;slot>0;slot--)r.registerSlot(slot);
  assert.equal(r.seenSlots.size,100);
  assert.equal(r.getReport().circularBufferSize,100);
});

test('large backfill intervals resolve without materializing every missing slot', () => {
  const r=new IngestionGapReconciler(100);
  r.registerSlot(1);r.registerSlot(1_000_000_000);
  r.markGapResolved(2,999_999_999);
  assert.equal(r.hasUnresolvedGaps(),false);
  assert.equal(r.getReport().totalSlotsBackfilled,999_999_998);
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
});

test('backfill concurrency and overflow remain bounded and visible', async () => {
  const r=new IngestionGapReconciler(100);
  let calls=0,release;
  r.setBackfillHandler(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  for(let slot=1;slot<1000;slot+=2)r.registerSlot(slot);
  assert.equal(calls,1);
  assert.ok(r.pendingBackfills.length<=100);
  assert.ok(r.gaps.length<=100);
  assert.equal(r.getReport().unresolvedHistoryTruncated,true);
  assert.equal(r.hasUnresolvedGaps(),true);
  r.reset();
  release(true);
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

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

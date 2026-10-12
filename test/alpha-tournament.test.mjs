import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../scripts/alpha-tournament.mjs';
const row = (strategy, split, eventId, timestamp, exitValue=110) => ({ strategy, split, eventId, timestamp, entryValue:100, exitValue, networkFee:1, priorityFee:1, tip:1, priceImpact:2, otherCosts:1, baselinePnl:0 });
test('positive net holdout can only be research candidate', () => {
  const rows = [row('wallet_copy','train','a','2026-01-01T00:00:00Z'),row('wallet_copy','holdout','b','2026-02-01T00:00:00Z')];
  const r=evaluate(rows,{minHoldoutTrades:1});
  assert.equal(r.results.wallet_copy.status,'RESEARCH_CANDIDATE');
  assert.equal(r.results.wallet_copy.holdoutNetPnl,4);
  assert.equal(r.certification,'NOT_CERTIFIED');
  assert.equal(r.liveAuthority,'BLOCKED');
});
test('chronological leakage blocks promotion',()=>{
  const rows=[row('wallet_copy','train','a','2026-03-01T00:00:00Z'),row('wallet_copy','holdout','b','2026-02-01T00:00:00Z')];
  assert.equal(evaluate(rows,{minHoldoutTrades:1}).results.wallet_copy.status,'BLOCKED');
});
test('duplicate event is rejected',()=>{
  const x=row('wallet_copy','train','a','2026-01-01T00:00:00Z');
  assert.throws(()=>evaluate([x,x]),/DUPLICATE/);
});
test('missing fees fail closed',()=>{
  const x=row('wallet_copy','train','a','2026-01-01T00:00:00Z');
  delete x.tip;
  assert.throws(()=>evaluate([x]),/INVALID_tip/);
});
test('losses block candidate',()=>{
  const rows=[row('wallet_copy','train','a','2026-01-01T00:00:00Z'),row('wallet_copy','holdout','b','2026-02-01T00:00:00Z',90)];
  assert.equal(evaluate(rows,{minHoldoutTrades:1}).results.wallet_copy.status,'BLOCKED');
});

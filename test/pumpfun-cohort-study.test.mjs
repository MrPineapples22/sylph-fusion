import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePumpEvents} from '../scripts/pumpfun-cohort-study.mjs';
const e=(type,eventIndex,t,extra={})=>({type,eventIndex,signature:'sig'+eventIndex,slot:eventIndex+1,mint:'mintA',timestamp:t,...extra});
test('tracks token lifecycle and first-to-peak price',()=>{
 const r=analyzePumpEvents([e('CREATE',0,'2026-01-01T00:00:00Z',{creator:'creator'}),e('TRADE',1,'2026-01-01T00:00:01Z',{trader:'a',side:'BUY',quoteAmount:1,baseAmount:100}),e('TRADE',2,'2026-01-01T00:00:02Z',{trader:'b',side:'SELL',quoteAmount:3,baseAmount:100}),e('COMPLETE',3,'2026-01-01T00:00:03Z'),e('MIGRATE',4,'2026-01-01T00:00:04Z')]);
 assert.equal(r.summary.observedGraduations,1);assert.equal(r.tokens[0].peakMultiple,3);assert.equal(r.tokens[0].timeToPeakSeconds,1);assert.equal(r.liveAuthority,'BLOCKED');
});
test('rejects duplicate evidence',()=>assert.throws(()=>analyzePumpEvents([e('CREATE',0,'2026-01-01T00:00:00Z'),e('CREATE',0,'2026-01-01T00:00:00Z')]),/DUPLICATE_EVENT/));
test('rejects impossible migration order',()=>assert.throws(()=>analyzePumpEvents([e('COMPLETE',0,'2026-01-02T00:00:00Z'),e('MIGRATE',1,'2026-01-01T00:00:00Z')]),/MIGRATION_BEFORE_COMPLETE/));
test('excludes outside cohort dates',()=>assert.equal(analyzePumpEvents([e('CREATE',0,'2025-09-30T23:59:59Z')]).summary.uniqueMints,0));

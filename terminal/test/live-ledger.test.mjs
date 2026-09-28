import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reducer,metrics,restore,START_USD} from '../src/engine.js';
const now=1700000000000;
const pool=id=>({id,price:2,liquidity:1000000,history:[{time:now/1000,value:2}],volume:null});
const sync=(s,assets)=>reducer({...s,astraGate:false},{type:'SYNC_ASSETS',assets,now:s.now,at:s.now});
test('live ticks preserve observed prices and unknown volume; wallet cannot enter',()=>{
 let s=sync(initialState(now),[pool('A')]);
 s=reducer(s,{type:'START',now});
 s=reducer(s,{type:'TICK',now:now+1000});
 assert.equal(s.assets[1].price,2);assert.equal(s.assets[1].volume,null);
 s=reducer(s,{type:'ORDER',asset:'SOL',side:'buy',now:now+1000});
 assert.equal(s.pending.length,0);
});
test('rotation preserves held marks and cancels departed pending buys',()=>{
 let s=sync(initialState(now),[pool('A'),pool('B')]);
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now});
 s=reducer(s,{type:'SETTLE',now:now+401});
 assert.equal(s.positions.length,1);
 s=reducer(s,{type:'ORDER',asset:'B',side:'buy',now:now+401});
 s=sync(s,[pool('C')]);assert.equal(s.pending.length,0);
 assert.ok(Number.isFinite(metrics(s).equity));assert.ok(s.assets.some(a=>a.id==='A'));
 s=reducer(s,{type:'HALT',now:now+1000});assert.equal(s.positions.length,0);
 assert.ok(Number.isFinite(s.cash));
});
test('live ledger reload preserves funds and positions and requires a fresh basket',()=>{
 let s=sync(initialState(now),[pool('A')]);
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now});
 s=reducer(s,{type:'SETTLE',now:now+401});
 const restored=restore(JSON.stringify(s),now+1000);
 assert.equal(restored.cash,s.cash);assert.deepEqual(restored.positions,s.positions);
 assert.deepEqual(restored.eligibleIds,[]);assert.equal(restored.running,false);
});
test('stale baskets and absent liquidity reject entries without corrupting money',()=>{
 let s=sync(initialState(now),[pool('A'),{...pool('B'),liquidity:null}]);
 s=reducer(s,{type:'ORDER',asset:'B',side:'buy',now});assert.equal(s.pending.length,0);
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now:now+16000});assert.equal(s.pending.length,0);
 assert.equal(s.cash,START_USD);
});

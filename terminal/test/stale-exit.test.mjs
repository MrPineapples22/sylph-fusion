import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reducer} from '../src/engine.js';
test('refreshing other pools cannot freshen a departed holding for emergency fills',()=>{
 const now=1700000000000;
 const pool=id=>({id,price:2,liquidity:1000000,history:[{time:now/1000,value:2}]});
 let s=reducer(initialState(now),{type:'SYNC_ASSETS',assets:[pool('A')],at:now,now});
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now});
 s=reducer(s,{type:'SETTLE',now:now+401});assert.equal(s.positions.length,1);
 s=reducer(s,{type:'SYNC_ASSETS',assets:[pool('B')],at:now+20000,now:now+20000});
 const cash=s.cash;s=reducer(s,{type:'PANIC',now:now+20001});
 assert.equal(s.positions.length,1);assert.equal(s.cash,cash);assert.match(s.notice,/remain open/);
});
test('an empty observed basket revokes pending entry eligibility',()=>{
 const now=1700000000000;
 let s=reducer(initialState(now),{type:'SYNC_ASSETS',assets:[],at:now,now});
 s=reducer(s,{type:'START',now});s=reducer(s,{type:'TICK',now:now+1000});
 assert.equal(s.liveMode,true);assert.deepEqual(s.eligibleIds,[]);assert.equal(s.pending.length,0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reducer,START_USD} from '../src/engine.js';
import {rankObservedPairs} from '../astra-feed.mjs';
const now=1700000000000;
const pool=liquidity=>({id:'A',price:2,liquidity,history:[{time:now/1000,value:2}]});
const sync=(s,liquidity)=>reducer(s,{type:'SYNC_ASSETS',assets:[pool(liquidity)],now,at:now});
test('liquidity disappearance cancels pending fills without corrupting ledger',()=>{
 let s=sync(initialState(now),1000000);
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now});assert.equal(s.pending.length,1);
 s=sync(s,null);s=reducer(s,{type:'SETTLE',now:now+401});
 assert.equal(s.positions.length,0);assert.equal(s.cash,START_USD);assert.equal(s.logs[0].status,'cancelled');
});
test('emergency stop reports positions that lack executable liquidity',()=>{
 let s=sync(initialState(now),1000000);
 s=reducer(s,{type:'ORDER',asset:'A',side:'buy',now});s=reducer(s,{type:'SETTLE',now:now+401});
 s=sync(s,null);s=reducer(s,{type:'HALT',now:now+500});
 assert.equal(s.positions.length,1);assert.equal(s.running,false);assert.match(s.notice,/remain open/);assert.ok(Number.isFinite(s.cash));
});
test('provider null rows and malformed optional numbers cannot crash the basket',()=>{
 const rows=rankObservedPairs([null,{chainId:'solana',dexId:'raydium',pairAddress:'A',priceUsd:'2',volume:{h1:100,m5:'bad'},priceChange:{m5:'bad'},liquidity:{usd:'bad'}}],now);
 assert.equal(rows.length,1);assert.equal(rows[0].change5m,null);assert.equal(rows[0].liquidity,null);assert.equal(rows[0].volume5m,null);
});

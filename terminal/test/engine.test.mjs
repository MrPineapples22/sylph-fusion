import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState as astraInitialState,reducer,metrics,executionQuote,networkFee,restore,START_USD} from '../src/engine.js';
// Legacy simulation mechanics tests explicitly opt into the isolated test harness. Production starts gated.
const initialState=(...args)=>({...astraInitialState(...args),astraGate:false,config:{...astraInitialState(...args).config,tp1:25,tp2:50,tp3:100,stop:12,trailing:8}});
const now=1700000000000;
const run=(s,type,extra={})=>reducer(s,{type,now:s.now,...extra});
const buy=(s,id='SOL')=>{s=run(s,'ORDER',{asset:id,side:'buy'});return run(s,'SETTLE',{now:s.now+401});};
test('seeded market is deterministic, bounded, and does not mutate prior state',()=>{
 const s=initialState(now),snapshot=JSON.stringify(s),a=run(s,'TICK',{now:now+250}),b=run(s,'TICK',{now:now+250});assert.deepEqual(a,b);assert.equal(JSON.stringify(s),snapshot);
 let next=a;for(let i=0;i<1500;i++)next=run(next,'TICK',{now:next.now+250});assert.ok(next.assets.every(a=>a.price>0&&a.history.length<=300));
});
test('priority fee rounds compute units to lamports exactly',()=>assert.equal(networkFee({priority:1,tip:0},150),(.000000001+.000005)*150));
test('pool impact increases with size and decreases with liquidity',()=>{
 const s=initialState(now),a=s.assets[0];assert.ok(executionQuote(a,'buy',1000,s.config,150).impact>executionQuote(a,'buy',100,s.config,150).impact);assert.ok(executionQuote({...a,liquidity:10000},'buy',100,s.config,150).impact>executionQuote(a,'buy',100,s.config,150).impact);
});
test('pending orders reserve cash and reject duplicate submission',()=>{
 let s=initialState(now);s=run(s,'ORDER',{asset:'SOL',side:'buy'});assert.equal(s.pending.length,1);assert.ok(metrics(s).reserved>0);assert.equal(s.positions.length,0);
 s=run(s,'ORDER',{asset:'SOL',side:'buy'});assert.equal(s.pending.length,1);s=run(s,'SETTLE',{now:now+99});assert.equal(s.positions.length,0);s=run(s,'SETTLE',{now:now+401});assert.equal(s.positions.length,1);assert.equal(s.pending.length,0);
 const cash=s.cash;s=run(s,'SETTLE',{now:s.now+500});assert.equal(s.cash,cash);
});
test('round trip loses modeled costs and reconciles realized PnL',()=>{
 let s=buy(initialState(now));assert.ok(metrics(s).equity<s.initial);s=run(s,'ORDER',{asset:'SOL',side:'sell'});s=run(s,'SETTLE',{now:s.now+401});assert.equal(s.positions.length,0);assert.ok(s.realized<0);assert.ok(Math.abs(s.cash-s.initial-s.realized)<1e-8);
});
test('audit event identities stay unique through pending, fill and cancel transitions',()=>{
 let s=buy(initialState(now));s=run(s,'ORDER',{asset:'WIF',side:'buy'});s=run(s,'PANIC');assert.equal(new Set(s.logs.map(l=>l.id)).size,s.logs.length);
});
test('slippage rejection charges only network fee without opening a position',()=>{
 let s=run(initialState(now),'CONFIG',{key:'slippage',value:.1});s=run(s,'ORDER',{asset:'SOL',side:'buy'});const fee=s.pending[0].fee;s=run(s,'SETTLE',{now:s.now+401});assert.equal(s.positions.length,0);assert.equal(s.realized,-fee);assert.equal(s.cash,s.initial-fee);assert.equal(s.logs[0].status,'rejected');
});
test('adverse movement during pending latency trips submitted slippage cap',()=>{
 let s=run(initialState(now),'ORDER',{asset:'SOL',side:'buy'});s.assets[0].price*=1.1;s=run(s,'SETTLE',{now:s.now+401});assert.equal(s.positions.length,0);assert.equal(s.logs[0].status,'rejected');
});
test('cash reservations prevent concurrent overspending',()=>{
 let s=initialState(now);s.cash=20;s.config.stop=1;s.config.slippage=.5;s=run(s,'ORDER',{asset:'SOL',side:'buy'});s=run(s,'ORDER',{asset:'WIF',side:'buy'});assert.equal(s.pending.length,1);s=run(s,'SETTLE',{now:s.now+401});assert.ok(s.cash>=0);
});
test('panic cancels pending buys and closes positions before stale fills can execute',()=>{
 let s=buy(initialState(now));s=run(s,'ORDER',{asset:'WIF',side:'buy'});s=run(s,'PANIC');assert.equal(s.positions.length,0);assert.equal(s.pending.length,0);assert.equal(s.running,false);const cash=s.cash;s=run(s,'SETTLE',{now:s.now+1000});assert.equal(s.cash,cash);assert.ok(Math.abs(s.cash-s.initial-s.realized)<1e-8);
});
test('halt also liquidates and bypasses slippage cap',()=>{
 let s=buy(initialState(now));s.config.slippage=.1;s=run(s,'HALT');assert.equal(s.positions.length,0);assert.ok(s.logs.some(l=>l.source==='Emergency'&&l.status==='filled'));
});
test('trailing stop never moves down when price retraces or settings loosen',()=>{
 let s=buy(initialState(now));s.assets[0].price*=1.1;s=run(s,'TICK',{now:s.now+250});const stop=s.positions[0].stop;s.config.trailing=50;s.assets[0].price*=.96;s=run(s,'TICK',{now:s.now+250});assert.ok(s.positions[0].stop>=stop);
});
test('TP tiers fill only once and conserve quantities and cost basis',()=>{
 let s=buy(initialState(now));const qty=s.positions[0].qty,cost=s.positions[0].cost;s=run(s,'START');s.assets[0].price=s.positions[0].entry*1.3;s=run(s,'TICK',{now:s.now+501});assert.equal(s.pending[0].tier,0);s=run(s,'SETTLE',{now:s.now+401});assert.ok(Math.abs(s.positions[0].qty-qty*.75)<1e-8);assert.ok(Math.abs(s.positions[0].cost-cost*.75)<1e-8);assert.deepEqual(s.positions[0].tiers,[0]);
 s.assets[0].price=s.positions[0].entry*1.6;s=run(s,'TICK',{now:s.now+501});assert.equal(s.pending[0].tier,1);s=run(s,'SETTLE',{now:s.now+401});assert.ok(Math.abs(s.positions[0].qty-qty*.5)<1e-8);
 s.assets[0].price=s.positions[0].entry*2.1;s=run(s,'TICK',{now:s.now+501});assert.equal(s.pending[0].tier,2);s=run(s,'SETTLE',{now:s.now+401});assert.equal(s.positions.length,0);assert.ok(Math.abs(s.cash-s.initial-s.realized)<1e-8);
});
test('stop takes precedence over profit targets',()=>{
 let s=buy(initialState(now));s=run(s,'START');s.positions[0].stop=s.assets[0].price*1.2;s=run(s,'TICK',{now:s.now+501});assert.match(s.pending[0].reason,/stop/i);assert.equal(s.pending[0].tier,null);
});
test('invalid settings and corrupt snapshots cannot enter state',()=>{
 let s=initialState(now);s=run(s,'CONFIG',{key:'size',value:NaN});assert.equal(s.config.size,.1);s=run(s,'CONFIG',{key:'size',value:-9});assert.equal(s.config.size,.1);s=run(s,'CONFIG',{key:'tp1',value:200});assert.ok(s.config.tp1<s.config.tp2&&s.config.tp2<s.config.tp3);assert.equal(restore('{bad',now).cash,START_USD);
});
test('reload restores ledger but cancels pending work and disarms bot',()=>{
 let s=buy(initialState(now));s=run(s,'START');s=run(s,'ORDER',{asset:'WIF',side:'buy'});const restored=restore(JSON.stringify(s),s.now+5000);assert.equal(restored.running,false);assert.equal(restored.pending.length,0);assert.equal(restored.positions.length,1);assert.equal(restored.cash,s.cash);
});
test('breakout signal submits a single automatic entry per asset',()=>{
 let s=initialState(now);s=run(s,'START');const a=s.assets[0];a.sigma=0;a.spike=5;a.price*=1.1;s=run(s,'TICK',{now:now+1000});assert.ok(s.pending.some(o=>o.asset==='SOL'&&o.source==='Auto-Bot'));s=run(s,'TICK',{now:s.now+1});assert.equal(s.pending.filter(o=>o.asset==='SOL').length,1);
});
test('dip strategy uses RSI recovery and MA confirmation',()=>{
 let s=initialState(now);s.config.strategy='dip';s=run(s,'START');const a=s.assets[0];a.sigma=0;a.rsi=20;a.price=120;a.history=Array.from({length:21},(_,i)=>({time:Math.floor(now/1000)-21+i,value:i<16?90:100}));s=run(s,'TICK',{now:now+1000});assert.ok(s.pending.some(o=>o.asset==='SOL'&&o.reason==='RSI recovery + MA confirmation'));
});

// Reference sharing is required for chart/audit memoization to skip unchanged data.
test('configuration keeps market history and audit identities stable',()=>{
 const s=initialState(now);const next=run(s,'CONFIG',{key:'size',value:2});assert.equal(next.assets,s.assets);assert.equal(next.logs,s.logs);assert.notEqual(next.config,s.config);
 const tick=run(s,'TICK',{now:now+250});assert.equal(tick.logs,s.logs);assert.equal(tick.config,s.config);assert.notEqual(tick.assets,s.assets);
});
import {riskBudget} from '../src/engine.js';
import {rankObservedPairs} from '../astra-feed.mjs';
test('Astra observed-data mode permits simulated entries and restores paused',()=>{
 let s=astraInitialState(now);s=run(s,'ORDER',{asset:'SOL',side:'buy'});assert.equal(s.pending.length,1);s=run(s,'START');assert.equal(s.running,true);const restored=restore(JSON.stringify({...s,astraGate:true}),now);assert.equal(restored.astraGate,false);
});
test('Astra 2 percent modeled loss includes slippage and fees',()=>{
 assert.equal(riskBudget(1000,200,7,3,1).allowed,false);assert.equal(riskBudget(1000,100,7,3,1).allowed,true);
});
test('volume ranking excludes other chains and venues and unknown volumes',()=>{
 const pair=(id,volume,extra={})=>({chainId:'solana',dexId:'raydium',pairAddress:id,priceUsd:'2',volume:{h1:volume,m5:5},liquidity:{usd:20000},...extra});
 const ranked=rankObservedPairs([pair('a',10),pair('b',20),pair('c',100,{dexId:'other'}),pair('d',100,{chainId:'ethereum'}),pair('e',null)]);assert.deepEqual(ranked.map(p=>p.pair),['b','a']);assert.equal(ranked[0].ofi,null);assert.equal(ranked[0].countImbalance,null);
});

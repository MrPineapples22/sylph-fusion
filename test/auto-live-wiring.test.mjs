import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePairs} from '../dist/market-hub.js';
import {mapLiveObservations} from '../terminal/src/live-observations.js';
import {createAutomationController} from '../terminal/src/automation-controller.js';
import {initialState,reducer} from '../terminal/src/engine.js';

const mint='So11111111111111111111111111111111111111112';
const pair={chainId:'solana',baseToken:{address:mint,symbol:'TEST'},pairAddress:'pool',dexId:'raydium',priceUsd:'1',liquidity:{usd:100000},volume:{h24:90000,h1:12000,m5:4000}};

test('live provider volume reaches Auto-Simulate and permits a qualifying breakout',async()=>{
 const now=Date.now(),histories=new Map();
 mapLiveObservations(normalizePairs([pair],now-2000),histories);
 const assets=mapLiveObservations(normalizePairs([{...pair,priceUsd:'1.04'}],now),histories);
 assert.equal(assets[0].volume,4);
 assert.equal(assets[0].velocity,2);
 let state=reducer(initialState(now),{type:'SYNC_ASSETS',assets,at:now,now});
 state=reducer(state,{type:'SET_EXECUTION_MODE',mode:'external'});
 state=reducer(state,{type:'START'});
 const orders=[];
 createAutomationController().evaluate(state,{submitUsdOrder:async order=>orders.push(order)},150);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(orders.length,1);assert.equal(orders[0].side,'BUY');assert.equal(orders[0].poolAddress,'pool');
});

test('cached responses cannot manufacture new price observations or renew freshness',()=>{
 const now=Date.now(),histories=new Map(),rows=normalizePairs([pair],now-20000);
 mapLiveObservations(rows,histories);
 const assets=mapLiveObservations(rows,histories);
 assert.equal(assets[0].history.length,1);
 const state=reducer(initialState(now),{type:'SYNC_ASSETS',assets,at:now,now});
 assert.equal(state.assets.find(a=>a.id==='pool').observedAt,now-20000);
});

test('absent volume stays unknown and is explained instead of silently blocking',()=>{
 const now=Date.now(),histories=new Map(),row={...pair,volume:{h24:10000}};
 mapLiveObservations(normalizePairs([row],now-2000),histories);
 const assets=mapLiveObservations(normalizePairs([{...row,priceUsd:'1.04'}],now),histories);
 assert.equal(assets[0].volume,null);
 let state=reducer(initialState(now),{type:'SYNC_ASSETS',assets,at:now,now});
 state={...state,running:true,executionMode:'external'};
 const status=createAutomationController().evaluate(state,{submitUsdOrder:()=>assert.fail('Missing volume must not pass')},150);
 assert.match(status,/provider volume data/);
});

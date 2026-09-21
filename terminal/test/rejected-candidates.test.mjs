import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomationController} from '../src/automation-controller.js';
import {initialState,reducer} from '../src/engine.js';

test('screened tokens enter the rejected tape without touching the ledger or repeating every tick',()=>{
 const now=Date.now(),controller=createAutomationController();
 let state={...initialState(now),logs:[],running:true,executionMode:'external'};
 state.assets=[{id:'pool',mint:'mint',symbol:'TEST',price:1,liquidity:100000,volume:4,history:[{time:now/1000-2,value:1},{time:now/1000,value:1}]}];
 const positions=state.positions,cash=state.cash,fees=state.fees;
 const execution={recordCandidateRejection(payload){state=reducer(state,{type:'CANDIDATE_REJECTED',payload});},submitUsdOrder(){assert.fail('Low velocity must not place an order');}};
 controller.evaluate(state,execution,150);
 assert.equal(state.logs[0].symbol,'TEST');assert.equal(state.logs[0].code,'LOW_VELOCITY');assert.equal(state.logs[0].status,'rejected');
 controller.evaluate({...state,now:now+1000},execution,150);
 assert.equal(state.logs.length,1);
 controller.evaluate({...state,now:now+31000},execution,150);
 assert.equal(state.logs.length,2);
 assert.equal(state.positions,positions);assert.equal(state.cash,cash);assert.equal(state.fees,fees);
 state.assets[0].liquidity=0;
 controller.evaluate({...state,now:now+32000},execution,150);
 assert.equal(state.logs[0].code,'MISSING_LIQUIDITY');assert.equal(state.logs.length,3);
 const count=state.logs.length;
 controller.evaluate({...state,running:false,now:now+33000},execution,150);
 assert.equal(state.logs.length,count);
});

test('execution rejections preserve token identity for the tape',()=>{
 const state=initialState();state.assets.push({id:'pool',symbol:'TOKEN',mint:'mint'});
 const next=reducer(state,{type:'REJECT',payload:{asset:'pool',side:'BUY',reason:'SLIPPAGE_EXCEEDED',feeUsd:.01}});
 assert.equal(next.logs[0].symbol,'TOKEN');assert.equal(next.logs[0].mint,'mint');
 assert.equal(next.cash,state.cash-.01);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {atomicArbPreflight,curveScalpDecision} from '../dist/strategy.js';
const quote={venue:'A',mint:'token',buyLamports:10000n,sellLamports:20000n,feeLamports:10n,slot:100,observedAt:10000};
test('both arbitrage legs must be fresh regardless of ordering',()=>{
 assert.equal(atomicArbPreflight({...quote,observedAt:1000},{...quote,venue:'B'},10000).accepted,false);
 assert.equal(atomicArbPreflight(quote,{...quote,venue:'B',observedAt:1000},10000).accepted,false);
 assert.equal(atomicArbPreflight(quote,{...quote,venue:'B'},10000).accepted,true);
});
test('invalid quote time and negative fees cannot create an accepted spread',()=>{
 for(const changes of [{observedAt:NaN},{observedAt:10001},{feeLamports:-1n},{slot:-1}])assert.equal(atomicArbPreflight({...quote,...changes},{...quote,venue:'B'},10000).accepted,false);
});
test('expired entry window does not mask a trailing exit or profit target',()=>{
 const input={ageMs:60000,holdMs:20000,returnBps:1400,peakBps:2100,migrated:false,creatorSold:false,buyVelocityBps:0};
 assert.equal(curveScalpDecision(input).action,'exit');
 assert.equal(curveScalpDecision({...input,returnBps:4000,peakBps:4000}).action,'scale-out');
});

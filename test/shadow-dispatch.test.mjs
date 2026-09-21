import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../dist/fusion.js';
import {config} from '../dist/config.js';

const cases = [
  ['missing evaluator', undefined, false],
  ['incomplete features', {scoreCandidate: async()=>{throw Error('must not run');}}, true],
  ['model rejection', {scoreCandidate: async()=>({score:0.1,accept:false})}, false],
  ['model error', {scoreCandidate: async()=>{throw Error('inference failed');}}, false],
  ['deadline exceeded', {scoreCandidate: async()=>new Promise(()=>{})}, false],
];
for (const mode of ['shadow','ml_gated']) for (const [name,evaluator,incomplete] of cases) {
  test(`${mode}: ${name} ${mode==='shadow'?'preserves':'blocks'} deterministic entry`, async()=>{
    const engine=Object.create(Engine.prototype);
    const events=[],rejections=[],trades=[];
    const candidate={mint:'test-mint',creator:'creator',born:Date.now()-15000,slot:100,next:0,
      buyers:new Map(Array.from({length:6},(_,i)=>['buyer'+i,1])),buy:100n,sell:0n,devSold:false};
    const snapshot={curve:{complete:false,isMayhemMode:false,realQuoteReserves:1000000000n,
      virtualQuoteReserves:31000000000n,virtualTokenReserves:1000000000000n}};
    Object.assign(engine,{
      cfg:config({RPC_URLS:'https://rpc.invalid',WS_URLS:'wss://rpc.invalid',MODE:'paper'}),
      state:{cash:'10000000000',positions:{},closed:{},day:new Date().toISOString().slice(0,10),dayPnl:'0',halted:false},
      candidates:new Map([[candidate.mint,candidate]]),marks:new Map(),feed:{healthy:()=>true},
      market:{snapshot:async()=>structuredClone(snapshot),safety:async()=>{},validateEntry:()=>{}},
      sessionLogger:{writeEvent:(type,data)=>events.push({type,data})},
      gateMode:mode,modelEvaluator:evaluator,stopped:false,
      snapshotCandidate:()=>({candidateId:'candidate-1',evaluationDisposition:'cleared',dispositionReason:null,
        missingFeatureCount:incomplete?1:0,featureAvailability:incomplete?0.9:1}),
      recordRejection:(...args)=>rejections.push(args),trade:async(...args)=>trades.push(args),
    });
    await engine.tick();
    assert.equal(trades.length,mode==='shadow'?1:0);
    assert.equal(rejections.length,mode==='shadow'?0:1);
    if(mode==='shadow') {
      assert.equal(events.length,1);
      assert.equal(events[0].type,'model_shadow_evaluation');
      assert.equal(events[0].data.candidateId,'candidate-1');
      assert.ok(events[0].data.modelDecision);
    }
  });
}

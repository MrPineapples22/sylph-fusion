import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SimulacrumXEngine} from '../../src/platform/simulation/simulacrum-x.ts';
const e = new SimulacrumXEngine();
const c = {model:'CONSTANT_PRODUCT_SCENARIO',solReserveLamports:30_000_000_000n,tokenReserveRaw:1_000_000_000_000n,walletSolLamports:10_000_000_000n,walletTokenRaw:1_000_000_000n};
const p = {economicIntentId:'i',side:'SELL',inputTokenRaw:1_000_000_000n,assumedNetworkCostLamports:155_000n,assumedRouteCostLamports:100_000n,assumedAdverseCostLamports:119_880n,maxPriceImpactBps:1};
test('SELL separates token raw from SOL and deducts each declared cost exactly once',()=>{
 const r=e.simulateExecution(c,p,1000); assert.equal(r.outputLamports,29_970_029n);assert.equal(r.solCashDeltaLamports,29_595_149n);
 assert.equal(r.tokenDeltaRaw,-1_000_000_000n);assert.equal(r.outputTokenRaw,0n);assert.equal(r.priceImpactBps,10);
 assert.equal(r.priceImpactLimitExceeded,true); assert.equal(r.isSimulationCertificate,false);assert.equal(r.evidenceClass,'RESEARCH_ONLY_SYNTHETIC');
 for(const key of ['messageHash','simulationLogsHash','expectedLandingProbability','digest']) assert.equal(key in r,false);
});
test('BUY reports negative cash flow and separate token inventory, never proceeds',()=>{
 const {inputTokenRaw,...base}=p;const r=e.simulateExecution(c,{...base,side:'BUY',inputLamports:100_000_000n},1000);
 assert.equal(r.outputTokenRaw,3_322_259_136n);assert.equal(r.solCashDeltaLamports,-100_374_880n);assert.equal(r.outputLamports,0n);
});
test('fees exceeding SELL output retain negative cash delta',()=>{
 assert.ok(e.simulateExecution(c,{...p,assumedNetworkCostLamports:100_000_000n},1000).solCashDeltaLamports<0n);
});
test('wallet feasibility is explicit and zero reserves never fall back',()=>{
 assert.equal(e.simulateExecution({...c,walletSolLamports:0n},p,1000).walletFeasibleUnderAssumptions,false);
 assert.equal(e.simulateExecution({...c,walletTokenRaw:0n},p,1000).walletFeasibleUnderAssumptions,false);
 assert.throws(()=>e.simulateExecution({...c,solReserveLamports:0n},p,1000));
});
test('rejects invalid input denominations, types, ranges, models and clocks',()=>{
 for(const value of [0n,-1n,1,NaN,Infinity,'1',null,1n<<64n]) assert.throws(()=>e.simulateExecution(c,{...p,inputTokenRaw:value},1000));
 for(const patch of [{inputLamports:1n},{side:'BAD'},{assumedNetworkCostLamports:-1n},{maxPriceImpactBps:NaN},{maxPriceImpactBps:10001},{economicIntentId:''}]) assert.throws(()=>e.simulateExecution(c,{...p,...patch},1000));
 for(const value of [-1,NaN,Infinity,1.5]) assert.throws(()=>e.simulateExecution(c,p,value));
 assert.throws(()=>e.simulateExecution({...c,model:'AMM'},p,1000));
});
test('complete immutable scenario hash binds each known input and timestamp',()=>{
 const a=e.simulateExecution(c,p,1000);assert.equal(a.scenarioHash,e.simulateExecution(c,p,1000).scenarioHash);
 for(const key of ['solReserveLamports','tokenReserveRaw','walletSolLamports','walletTokenRaw']) assert.notEqual(a.scenarioHash,e.simulateExecution({...c,[key]:c[key]+1n},p,1000).scenarioHash);
 for(const key of ['inputTokenRaw','assumedNetworkCostLamports','assumedRouteCostLamports','assumedAdverseCostLamports']) assert.notEqual(a.scenarioHash,e.simulateExecution(c,{...p,[key]:p[key]+1n},1000).scenarioHash);
 for(const patch of [{economicIntentId:'j'},{maxPriceImpactBps:2}]) assert.notEqual(a.scenarioHash,e.simulateExecution(c,{...p,...patch},1000).scenarioHash);
 assert.notEqual(a.scenarioHash,e.simulateExecution(c,p,1001).scenarioHash);assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.assumptions));
});
test('zero residual baseline is undefined, never perfect accuracy; signed and huge values compare exactly',()=>{
 const a=e.simulateExecution(c,p,1000);const zero={...a,solCashDeltaLamports:0n};
 assert.equal(e.evaluateResiduals(zero,1_000_000_000n).status,'ZERO_BASELINE_UNDEFINED');assert.equal(e.evaluateResiduals(zero,0n).errorRatioBps,null);
 assert.equal(e.evaluateResiduals({...a,solCashDeltaLamports:-100n},-115n).status,'WITHIN_POLICY_THRESHOLD');
 assert.equal(e.evaluateResiduals({...a,solCashDeltaLamports:-100n},-116n).status,'POLICY_THRESHOLD_EXCEEDED');
 assert.equal(e.evaluateResiduals({...a,solCashDeltaLamports:10n**400n},0n).errorRatioBps,10000n);
 assert.throws(()=>e.evaluateResiduals(a,1));
});

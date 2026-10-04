import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CommandGateway} from '../dist/command-gateway.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
const command=(id,payload)=>({commandId:id,type:'SUBMIT_ORDER',timestamp:Date.now(),initiator:'test',payload:{mint:'mint',poolAddress:'pool',side:'BUY',usdAmount:100,...payload}});
const authorizeEvidence=gateway=>gateway.setPaperEntryEvidenceProvider(async(mint,poolAddress)=>({mint,poolAddress,priceUsd:1,liquidityUsd:1_000_000,observedAt:Date.now(),solPriceUsd:150,solObservedAt:Date.now(),marketObservationValid:true,source:'TEST',entryAllowed:true}));
test('retry without explicit order id cannot create a second economic effect',async()=>{
 globalLifecycle.bootstrapToHealthy();const gateway=CommandGateway.resetInstance();authorizeEvidence(gateway);const cmd=command('retry-identity');
 const a=await gateway.executeCommand(cmd),balance=gateway.getSnapshot().cashUsd;
 assert.equal(a.success,true);const b=await gateway.executeCommand(cmd);assert.equal(b.success,false);assert.match(b.error,/DUPLICATE_INTENT/);assert.equal(gateway.getSnapshot().cashUsd,balance);
});
test('unowned sells and invalid quantities cannot create simulated money',async()=>{
 globalLifecycle.bootstrapToHealthy();const gateway=CommandGateway.resetInstance();
 for(const payload of [{side:'SELL',tokenQty:10},{usdAmount:-100},{usdAmount:NaN},{usdAmount:0},{side:'INVALID'}]){
  const r=await gateway.executeCommand(command('invalid-'+JSON.stringify(payload),payload));assert.equal(r.success,false);
 }
 assert.equal(gateway.getSnapshot().cashUsd,10000);assert.equal(gateway.getSnapshot().positions.length,0);
});
test('partial exit preserves remaining exposure and cost basis',async()=>{
 globalLifecycle.bootstrapToHealthy();const gateway=CommandGateway.resetInstance();authorizeEvidence(gateway);assert.equal((await gateway.executeCommand(command('entry'))).success,true);
 const before=gateway.getSnapshot().positions[0],qty=before.qty,cost=before.costBasisUsd;
 const result=await gateway.executeCommand(command('partial',{side:'SELL',tokenQty:qty/2}));assert.equal(result.success,true);
 const after=gateway.getSnapshot().positions[0];assert.ok(after);assert.ok(Math.abs(after.qty-qty/2)<1e-7);assert.ok(Math.abs(after.costBasisUsd-cost/2)<1e-5);
});
test('a second entry cannot overwrite recorded exposure',async()=>{
 globalLifecycle.bootstrapToHealthy();const gateway=CommandGateway.resetInstance();authorizeEvidence(gateway);await gateway.executeCommand(command('first'));
 const balance=gateway.getSnapshot().cashUsd;const result=await gateway.executeCommand(command('second'));
 assert.equal(result.success,false);assert.match(result.error,/POSITION_EXISTS/);assert.equal(gateway.getSnapshot().cashUsd,balance);
});

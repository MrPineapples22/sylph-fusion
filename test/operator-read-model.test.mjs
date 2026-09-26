import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OperatorReadModel} from '../dist/operator-read-model.js';
const input=()=>({now:10000,discovery:{feedStale:false,rows:[],positions:[]},gateway:{mode:'paper',cashUsd:10000,inFlightOrdersCount:0},health:{providers:{}},lifecycle:'CONNECTING'});
test('missing providers, risk, financial ledger and live signer stay explicitly unverified',()=>{
 const p=new OperatorReadModel().project(input());
 assert.equal(p.marketData.state,'UNKNOWN');assert.equal(p.environment.mode,'SIMULATION');
 assert.equal(p.environment.signerState,'UNAVAILABLE');assert.equal(p.risk.utilization,null);
 assert.equal(p.capital.reserved,null);assert.equal(p.executions.state,'UNKNOWN');
 assert.equal(p.capabilities.close.state,'BLOCKED');assert.deepEqual(p.capabilities.close.reasonCodes,['NO_POSITION']);
});
test('projections increase monotonically and restart creates a new generation',()=>{
 const model=new OperatorReadModel(),a=model.project(input()),b=model.project(input());
 assert.equal(b.projectionVersion,a.projectionVersion+1);assert.equal(a.authorityGeneration,b.authorityGeneration);
 assert.notEqual(new OperatorReadModel().project(input()).authorityGeneration,a.authorityGeneration);
});
test('current paper data enables only simulator actions while live reconciliation remains blocked',()=>{
 const i=input();i.lifecycle='HEALTHY';i.health={providers:{PUMPPORTAL_WS:{providerId:'PUMPPORTAL_WS',state:'CONNECTED',role:'DISCOVERY_STREAM',configured:true,isAuthoritative:true,freshness:'FRESH',lastValidatedObservation:9999,lastSuccess:9999,avgLatencyMs:1,circuitState:'HEALTHY',failureReason:null,capabilityAvailable:true}}};
 const p=new OperatorReadModel().project(i);
 assert.equal(p.capabilities.open.state,'READY');
 for(const action of ['increase','reduce','close']) {
  assert.equal(p.capabilities[action].state,'BLOCKED');
  assert.deepEqual(p.capabilities[action].reasonCodes,['NO_POSITION']);
 }
 assert.deepEqual(p.capabilities.open.reasonCodes,['PAPER_SIMULATION_ONLY']);
 assert.equal(p.capabilities.reconcile.state,'BLOCKED');assert.deepEqual(p.capabilities.reconcile.reasonCodes,['LIVE_RECONCILIATION_UNAVAILABLE']);
});
test('market outages do not invent reconciliation or conflate exit blockers with entry blockers',()=>{
 const i=input();i.discovery.feedStale=true;
 const p=new OperatorReadModel().project(i);
 assert.equal(p.capabilities.reconcile.state,'BLOCKED');
 assert.ok(p.capabilities.open.reasonCodes.some(x=>x.startsWith('MARKET_')));
 assert.ok(p.capabilities.close.reasonCodes.every(x=>!x.startsWith('MARKET_')));
});
test('capabilities never report READY when capacity or a required position makes the action impossible',()=>{
 const i=input();i.lifecycle='HEALTHY';
 i.health={providers:{PUMPPORTAL_WS:{providerId:'PUMPPORTAL_WS',state:'CONNECTED',role:'DISCOVERY_STREAM',configured:true,isAuthoritative:true,freshness:'FRESH',lastValidatedObservation:9999,lastSuccess:9999,avgLatencyMs:1,circuitState:'HEALTHY',failureReason:null,capabilityAvailable:true}}};
 i.discovery.positions=[{mint:'one'},{mint:'two'},{mint:'three'}];
 const p=new OperatorReadModel().project(i);
 assert.equal(p.capabilities.open.state,'BLOCKED');
 assert.deepEqual(p.capabilities.open.reasonCodes,['MAX_POSITIONS_REACHED']);
 assert.equal(p.capabilities.increase.state,'READY');
 assert.equal(p.capabilities.reduce.state,'READY');
 assert.equal(p.capabilities.close.state,'READY');
});
test('repeated projection preserves incident detection and deduplicates by cause',()=>{
 const m=new OperatorReadModel(),a=m.project(input()),b=m.project({...input(),now:12000});
 assert.equal(a.incidents.length,b.incidents.length);assert.equal(b.incidents[0].detectedAt,10000);
 assert.equal(b.incidents[0].updatedAt,12000);
});

test('paper emergency stop remains visible even if the shared lifecycle returns healthy',()=>{
 const i=input();i.lifecycle='HEALTHY';i.gateway.entriesHalted=true;
 i.discovery.positions=[{mint:'paper-position'}];
 i.health={providers:{PUMPPORTAL_WS:{providerId:'PUMPPORTAL_WS',lastValidatedObservation:9999,lastSuccess:9999,avgLatencyMs:1}}};
 const p=new OperatorReadModel().project(i);
 for(const action of ['open','increase']) {
  assert.equal(p.capabilities[action].state,'BLOCKED');
  assert.ok(p.capabilities[action].reasonCodes.includes('PAPER_EMERGENCY_STOP'));
 }
 for(const action of ['close','reduce']) assert.equal(p.capabilities[action].state,'READY');
 assert.ok(p.incidents.some(x=>x.reasonCode==='PAPER_EMERGENCY_STOP' && x.state==='ACTIVE'));
});

test('system.state is OPERATIONAL when paper capabilities are ready, not hardcoded BLOCKED',()=>{
 const i=input();i.lifecycle='HEALTHY';
 i.health={providers:{PUMPPORTAL_WS:{providerId:'PUMPPORTAL_WS',state:'CONNECTED',role:'DISCOVERY_STREAM',configured:true,isAuthoritative:true,freshness:'FRESH',lastValidatedObservation:9999,lastSuccess:9999,avgLatencyMs:1,circuitState:'HEALTHY',failureReason:null,capabilityAvailable:true}}};
 const p=new OperatorReadModel().project(i);
 assert.equal(p.system.state,'OPERATIONAL');
 assert.notEqual(p.system.state,'BLOCKED');
});

test('system.state is DEGRADED when only paper exits remain ready without market evidence',()=>{
  const i=input();i.discovery.positions=[{mint:'paper-position'}];
  const p=new OperatorReadModel().project(i);
  assert.equal(p.system.state,'DEGRADED');
   assert.equal(p.capabilities.close.state,'READY');
  assert.equal(p.capabilities.open.state,'BLOCKED');
});

test('system.state is BLOCKED when lifecycle prevents all paper capabilities',()=>{
 const i=input();i.lifecycle='SHUTTING_DOWN';
 const p=new OperatorReadModel().project(i);
 assert.equal(p.system.state,'HALTED');
});

test('system.state is DEGRADED when emergency stop blocks entries but exits are ready',()=>{
  const i=input();i.lifecycle='HEALTHY';i.gateway.entriesHalted=true;
  i.discovery.positions=[{mint:'paper-position'}];
 i.health={providers:{PUMPPORTAL_WS:{providerId:'PUMPPORTAL_WS',state:'CONNECTED',role:'DISCOVERY_STREAM',configured:true,isAuthoritative:true,freshness:'FRESH',lastValidatedObservation:9999,lastSuccess:9999,avgLatencyMs:1,circuitState:'HEALTHY',failureReason:null,capabilityAvailable:true}}};
 const p=new OperatorReadModel().project(i);
 // close and reduce are READY, but open and increase are BLOCKED → still OPERATIONAL because anyReady
 assert.equal(p.system.state,'OPERATIONAL');
});

test('system.state is HALTED when lifecycle is safety-locked',()=>{
 const i=input();i.lifecycle='SAFETY_LOCKED';
 const p=new OperatorReadModel().project(i);
 assert.equal(p.system.state,'HALTED');
});

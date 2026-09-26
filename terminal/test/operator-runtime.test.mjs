import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendTokenEvidenceHistory,createProjectionGuard,initialWorkspace,isProjectionCurrent,isProjectionReceiptCurrent,startOperatorConnection,workspaceReducer,stableTokenOrder} from '../src/operator-runtime.js';
const p=(generation,version,at=100)=>({schemaVersion:1,authorityGeneration:generation,projectionVersion:version,generatedAt:at,validUntil:at+4000,tokens:[],positions:[],capabilities:Object.fromEntries(['observe','score','open','increase','reduce','close','reconcile','persist'].map(key=>[key,{state:'UNKNOWN',reasonCodes:[]}])),system:{},environment:{mode:'SIMULATION'},marketData:{},risk:{},capital:{},executions:{},envelopes:{},providers:[],incidents:[]});
test('old and duplicate projections cannot roll back truth',()=>{const accept=createProjectionGuard();assert.ok(accept(p('a',3)));assert.equal(accept(p('a',2)),false);assert.equal(accept(p('a',3)),false);assert.ok(accept(p('a',4)));});
test('restart accepts a new stream but fences late old-generation responses',()=>{const accept=createProjectionGuard();assert.ok(accept(p('a',99)));assert.ok(accept(p('b',1,200)));assert.equal(accept(p('a',100,300)),false);});
test('investigating another token cannot mutate locked execution',()=>{let s=workspaceReducer(initialWorkspace(),{type:'PREPARE',review:{tokenId:'XYZ',amount:.25}});s=workspaceReducer(s,{type:'INVESTIGATE',mint:'ABC'});assert.equal(s.investigation,'ABC');assert.equal(s.execution.tokenId,'XYZ');assert.equal(s.execution.amount,.25);assert.ok(Object.isFrozen(s.execution));assert.equal(workspaceReducer(s,{type:'PREPARE',review:{tokenId:'ABC'}}).execution.tokenId,'XYZ');});
test('market updates retain spatial order and comparison is capped at four',()=>{assert.deepEqual(stableTokenOrder(['a','b'],[{mint:'b'},{mint:'c'},{mint:'a'}]),['a','b','c']);let s=initialWorkspace();for(const mint of ['a','b','c','d','e'])s=workspaceReducer(s,{type:'COMPARE',mint});assert.equal(s.comparison.length,4);});
test('malformed capability and token payloads fail closed before publication',()=>{for(const mutate of [x=>delete x.capabilities.close,x=>x.capabilities.open.state='GO',x=>x.tokens.push({mint:'a'}),x=>delete x.providers,x=>x.validUntil=x.generatedAt]){const data=p('a',1);mutate(data);assert.equal(createProjectionGuard()(data),false);}});
test('revalidation preserves position workspace and locked execution context',()=>{let s=workspaceReducer(initialWorkspace(),{type:'NAVIGATE',workspace:'Positions'});s=workspaceReducer(s,{type:'REVALIDATE'});s=workspaceReducer(s,{type:'CONNECTED'});assert.equal(s.mode,'POSITION_MANAGEMENT');assert.equal(s.workspace,'Positions');});

test('preferred rows reject malformed presentation records without consuming the projection version',()=>{
  const row={mint:'a',tier:'OBSERVED',pending:[],vetoes:[]};
  for(const rows of [{},'invalid',false,[null],[{mint:'a'}],[{...row,tier:'SAFE'}],[{...row,pending:null}],[{...row,vetoes:null}]]){
    const accept=createProjectionGuard();
    assert.equal(accept({...p('a',1),rows}),false);
    assert.equal(accept({...p('a',1),rows:[row]}),true);
  }
});

test('preferred rows accept valid records and optional rows preserve token fallback',()=>{
  const token={mint:'a',tier:'DEVELOPING',pending:['SCAN_PENDING'],vetoes:[]};
  for(const rows of [undefined,null,[],[token]]){
    const data={...p('a',1),tokens:[token],rows};
    assert.equal(createProjectionGuard()(data),true);
    assert.doesNotThrow(()=>{for(const row of data.rows||data.tokens){row.pending.map(String);assert.equal(row.vetoes.length,0);}});
  }
  assert.equal(createProjectionGuard()({...p('a',1),tokens:[{mint:'bad'}],rows:[token]}),false);
});

test('observation-level quarantines remain visible without being relabelled as safety vetoes',()=>{
  const quarantined={mint:'restricted',tier:'QUARANTINED',pending:['Safety evidence unavailable'],vetoes:['Provider finding']};
  assert.equal(createProjectionGuard()({...p('a',1),tokens:[quarantined],rows:[quarantined]}),true);
});

test('session token history records accepted evidence transitions without persisting duplicate snapshots',()=>{
  const first={...p('a',1),rows:[{mint:'token',tier:'DEVELOPING',safety:'UNKNOWN',pending:['scan'],vetoes:[],evidence:[{type:'Risk',state:'UNAVAILABLE'}]}]};
  const second={...p('a',2,200),rows:[{...first.rows[0],tier:'QUARANTINED',pending:[],vetoes:['provider finding'],evidence:[{type:'Risk',state:'CURRENT'}]}]};
  const initial=appendTokenEvidenceHistory(new Map(),first);
  assert.equal(initial.get('token').length,1);
  assert.equal(appendTokenEvidenceHistory(initial,first).get('token').length,1);
  const changed=appendTokenEvidenceHistory(initial,second).get('token');
  assert.equal(changed.length,2);
  assert.equal(changed[0].tier,'QUARANTINED');
  assert.equal(changed[0].version,2);
});

test('session history resets its baseline at a new authority generation',()=>{
  const first={...p('a',1),rows:[{mint:'token',tier:'DEVELOPING',pending:[],vetoes:[],evidence:[]}]};
  const restart={...p('b',1,200),rows:[{mint:'token',tier:'QUARANTINED',pending:[],vetoes:['finding'],evidence:[]}]};
  const history=appendTokenEvidenceHistory(appendTokenEvidenceHistory(new Map(),first),restart).get('token');
  assert.equal(history.length,1);
  assert.equal(history[0].generation,'b');
});

test('generation reset records a new baseline even when semantic token evidence is unchanged',()=>{
  const row={mint:'token',tier:'DEVELOPING',pending:[],vetoes:[],evidence:[]};
  const first={...p('a',1),rows:[row]};
  const restart={...p('b',1,200),rows:[row]};
  const history=appendTokenEvidenceHistory(appendTokenEvidenceHistory(new Map(),first),restart).get('token');
  assert.equal(history.length,1);
  assert.equal(history[0].generation,'b');
});

test('session history bounds tokens by least recently changed observation',()=>{
  const projection=(version, rows)=>({...p('a',version,version * 100),rows});
  const row=(mint,tier='DEVELOPING')=>({mint,tier,pending:[],vetoes:[],evidence:[]});
  const initial=projection(1,Array.from({length:100},(_,index)=>row(`token-${index}`)));
  const changed=projection(2,[row('token-0','QUARANTINED'),row('token-100')]);
  const history=appendTokenEvidenceHistory(appendTokenEvidenceHistory(new Map(),initial),changed);
  assert.equal(history.size,100);
  assert.ok(history.has('token-0'));
  assert.ok(history.has('token-100'));
  assert.equal(history.has('token-1'),false);
});

test('projection currentness requires a connected, in-window projection',()=>{
  const data=p('a',1,100);
  assert.equal(isProjectionCurrent(data,'CONNECTED',200),true);
  assert.equal(isProjectionCurrent(data,'REVALIDATING',200),false);
  assert.equal(isProjectionCurrent(data,'CONNECTED',data.validUntil+1),false);
});

test('receipt freshness rejects future and expired projections before their version is accepted',()=>{
  const data=p('a',1,100);
  assert.equal(isProjectionReceiptCurrent(data,200),true);
  assert.equal(isProjectionReceiptCurrent(data,99),false);
  assert.equal(isProjectionReceiptCurrent(data,data.validUntil+1),false);
});

test('an expired receipt cannot consume an epoch/version before a corrected retry arrives', async()=>{
  const listeners=new Map();
  const events={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const visibility={visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}};
  const responses=[p('a',1,-5_000),p('a',1,100)];
  const received=[],states=[];
  const stop=startOperatorConnection({
    request:async()=>responses.shift(),onSnapshot:data=>received.push(data),onState:state=>states.push(state),
    events,visibility,intervalMs:60_000,now:()=>200,
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  listeners.get('focus')();
  await new Promise(resolve=>setTimeout(resolve,0));
  stop();
  assert.equal(received.length,1);
  assert.equal(received[0].projectionVersion,1);
  assert.ok(states.includes('REVALIDATING'));
  assert.equal(states.at(-1),'CONNECTED');
});

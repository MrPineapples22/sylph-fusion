import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const rootTestDist=process.env.RUNTIME_ROOT_SCHEMA_TEST_DIST;
const moduleUrl=(name)=>rootTestDist?pathToFileURL(join(rootTestDist,'platform',...name.split('/'))).href:
  new URL(`../../dist/platform/${name}`,import.meta.url).href;
const {EnvironmentCertificationEngine,verifyRuntimeRootIntegrity,verifyProgramRootIntegrity,verifyProgramRootForestIntegrity}=await import(moduleUrl('truth/runtime-program-root.js'));
const {SimulationCertificateBuilder,verifySimulationCertificate}=await import(moduleUrl('simulation/simulation-certificate.js'));

function legacyRoot({transactionVersionSupported='all',activeFeatures=['warp_core_v1','simd_0033','blake3_syscall']}={}) {
  const cluster='mainnet-beta';const genesisHash='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const epoch=650;const contextSlot=280_000_000;const agaveVersion='v4.3.0';const resourcePolicyVersion='res_pol_2026_q4';
  const activeFeatureSetHash=createHash('sha256').update(JSON.stringify([...activeFeatures].sort())).digest('hex').slice(0,16);
  const oldPreimage={cluster,genesisHash,epoch,contextSlot,agaveVersion,activeFeatureSetHash,resourcePolicyVersion};
  return {cluster,genesisHash,epoch,contextSlot,agaveVersion,activeFeatureSetHash,transactionVersionSupported,resourcePolicyVersion,
    runtimeRootHash:createHash('sha256').update(JSON.stringify(oldPreimage)).digest('hex')};
}

function rehashLegacyWithFeatureDigest(root) {
  const {cluster,genesisHash,epoch,contextSlot,agaveVersion,activeFeatureSetHash,resourcePolicyVersion}=root;
  return createHash('sha256').update(JSON.stringify({cluster,genesisHash,epoch,contextSlot,agaveVersion,activeFeatureSetHash,resourcePolicyVersion})).digest('hex');
}

function certificateInput(runtimeRoot,transactionVersion='v0') {
  return {lane:'SHADOW_SIMULATION',transactionVersion,messageHash:'message',wireTransactionHash:'',routeHash:'route',quoteHash:'quote',
    accountKeys:['account'],provider:'rpc',runtimeRoot,programRoots:[],commitment:'confirmed',minContextSlot:runtimeRoot.contextSlot,
    simulationSlot:runtimeRoot.contextSlot+1,blockhash:'blockhash',lastValidBlockHeight:9,error:null,logs:[],invokedPrograms:[],
    unitsConsumed:1,loadedAccountsDataSize:0,requestedComputeLimit:2,priorityFeeLamports:0n,simulatedFeeLamports:0n,
    preSolLamports:0n,postSolLamports:0n,preTokensRaw:0n,postTokensRaw:1n,simulatedOutputRaw:1n,criticalAccounts:[]};
}

function certificateCanonical(value) {
  if(value===null)return 'null;';
  if(value===undefined)return 'undefined;';
  if(typeof value==='string')return `string:${JSON.stringify(value)};`;
  if(typeof value==='boolean')return value?'boolean:true;':'boolean:false;';
  if(typeof value==='number')return `number:${JSON.stringify(value)};`;
  if(typeof value==='bigint')return `bigint:${JSON.stringify(value.toString())};`;
  if(Array.isArray(value))return `array:${value.map(certificateCanonical).join('')}end-array;`;
  const keys=Object.keys(value).sort();
  return `object:{${keys.map(key=>certificateCanonical(key)+certificateCanonical(value[key])).join('')}}end-object;`;
}

function rehashCertificate(certificate) {
  const {evidenceHash,...preimage}=certificate;
  return createHash('sha256').update('SYLPH_SIMULATION_CERTIFICATE\0v2\0').update(certificateCanonical(preimage)).digest('hex');
}

test('legacy RuntimeRoot without a schema marker keeps the exact v1 hash and remains certifiable',()=>{
  const oldRoot=legacyRoot();
  assert.equal(oldRoot.activeFeatureSetHash,'83505cdbf07e2611');
  assert.equal(oldRoot.runtimeRootHash,'38dc72daec28484ae24b08e767fb0a68fb24c451c782faffff0adbe75ec5fb40');
  assert.equal(Object.hasOwn(oldRoot,'runtimeRootHashSchemaVersion'),false);
  const cert=SimulationCertificateBuilder.buildCertificate(certificateInput(oldRoot));
  assert.equal(verifySimulationCertificate(cert),true);

  // Historical v1 producers always emitted `all`; because the field is not in the v1 hash,
  // any other value is unauthenticated and must not be treated as a valid root.
  const oldRootWithRestrictedVersion={...oldRoot,transactionVersionSupported:'legacy'};
  assert.equal(verifyRuntimeRootIntegrity(oldRootWithRestrictedVersion),false);
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput(oldRootWithRestrictedVersion,'legacy')),
    /SIMULATION_RUNTIME_ROOT_HASH_MISMATCH/);
  for(const activeFeatureSetHash of ['a'.repeat(15),'a'.repeat(17),'g'.repeat(16),'A'.repeat(16),'not-hex-value!']) {
    const forgedLegacy={...oldRoot,activeFeatureSetHash};
    forgedLegacy.runtimeRootHash=rehashLegacyWithFeatureDigest(forgedLegacy);
    assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput(forgedLegacy)),/SIMULATION_RUNTIME_ROOT_INVALID/);
  }
});

test('v2 RuntimeRoot commits full feature digest and transaction-version support',()=>{
  const common={epoch:650,contextSlot:280_000_000,activeFeatures:['warp_core_v1','simd_0033','blake3_syscall']};
  const all=EnvironmentCertificationEngine.createRuntimeRoot({...common,transactionVersionSupported:'all'});
  const legacy=EnvironmentCertificationEngine.createRuntimeRoot({...common,transactionVersionSupported:'legacy'});
  assert.equal(all.runtimeRootHashSchemaVersion,2);
  assert.equal(all.activeFeatureSetHash,'83505cdbf07e261172ecc1bd3918bc3c83053660daf198ec135ba196a94c62f4');
  assert.equal(all.runtimeRootHash,'bfbd0598f09affee0b5f059d0f775b216e221768d3600c21de070a3a45110dc5');
  assert.equal(legacy.runtimeRootHash,'3660f11bc8c5c0c7681ea7303e89eca2c6873833680107f2bf5738ee3d57ec63');
  assert.notEqual(all.runtimeRootHash,legacy.runtimeRootHash);
  const currentCertificate=SimulationCertificateBuilder.buildCertificate(certificateInput(all));
  assert.equal(currentCertificate.schemaVersion,'2.1.0');
  assert.equal(currentCertificate.cpiTraceStatus,'UNAVAILABLE');
  assert.equal(verifySimulationCertificate(currentCertificate),true);
  const legacyCertificate={...currentCertificate,schemaVersion:'2.0.0'};
  delete legacyCertificate.cpiTraceStatus;
  legacyCertificate.evidenceHash=rehashCertificate(legacyCertificate);
  assert.equal(verifySimulationCertificate(legacyCertificate),true);
  const falseGraphClaim={...currentCertificate,cpiTraceStatus:'COMPLETE'};
  falseGraphClaim.evidenceHash=rehashCertificate(falseGraphClaim);
  assert.equal(verifySimulationCertificate(falseGraphClaim),false);
  const mislabeledLegacy={...legacyCertificate,cpiTraceStatus:'UNAVAILABLE'};
  mislabeledLegacy.evidenceHash=rehashCertificate(mislabeledLegacy);
  assert.equal(verifySimulationCertificate(mislabeledLegacy),false);
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput({...all,transactionVersionSupported:'legacy'},'legacy')),
    /SIMULATION_RUNTIME_ROOT_HASH_MISMATCH/);

  const v1Marker={...legacyRoot(),runtimeRootHashSchemaVersion:1};
  assert.equal(verifySimulationCertificate(SimulationCertificateBuilder.buildCertificate(certificateInput(v1Marker))),true);
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput({...all,runtimeRootHashSchemaVersion:3})),
    /SIMULATION_RUNTIME_ROOT_INVALID/);
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput({...all,runtimeRootHashSchemaVersion:null})),
    /SIMULATION_RUNTIME_ROOT_INVALID/);
  const markerRemoved={...all};delete markerRemoved.runtimeRootHashSchemaVersion;
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate(certificateInput(markerRemoved)),/SIMULATION_RUNTIME_ROOT_INVALID/);
});

test('v2 RuntimeRoot input rejects JSON-coerced epochs, slots, and malformed feature arrays',()=>{
  const valid={epoch:1,contextSlot:2};
  for(const epoch of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'1',null])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,epoch}),/RUNTIME_ROOT_SLOT_OR_EPOCH_INVALID/);
  for(const contextSlot of [-1,2.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'2',null])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,contextSlot}),/RUNTIME_ROOT_SLOT_OR_EPOCH_INVALID/);
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,activeFeatures:['ok',3]}),/RUNTIME_ROOT_FEATURES_INVALID/);
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,activeFeatures:new Array(1)}),/RUNTIME_ROOT_FEATURES_INVALID/);
  for(const activeFeatures of [new Array(4097),[''],['a','a'],['x'.repeat(1025)]])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,activeFeatures}),/RUNTIME_ROOT_FEATURES_INVALID/);
  for(const genesisHash of ['', 'g'.repeat(4097), 5])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,genesisHash}),/RUNTIME_ROOT_TEXT_FIELD_INVALID/);
  for(const agaveVersion of ['', 'a'.repeat(4097), {}])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,agaveVersion}),/RUNTIME_ROOT_TEXT_FIELD_INVALID/);
  for(const resourcePolicyVersion of ['', 'p'.repeat(4097), null])
    assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,resourcePolicyVersion}),/RUNTIME_ROOT_TEXT_FIELD_INVALID/);
  let getterCalls=0;const features=[];Object.defineProperty(features,'0',{enumerable:true,get(){getterCalls+=1;return 'x';}});features.length=1;
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,activeFeatures:features}),/RUNTIME_ROOT_FEATURES_INVALID/);
  assert.equal(getterCalls,0);
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,activeFeatures:new Proxy([], {})}),/RUNTIME_ROOT_FEATURES_INVALID/);
  const params={epoch:1,contextSlot:2};Object.defineProperty(params,'activeFeatures',{enumerable:true,get(){getterCalls+=1;return ['x'];}});
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot(params),/RUNTIME_ROOT_PARAMS_INVALID/);
  assert.equal(getterCalls,0);
  assert.throws(()=>EnvironmentCertificationEngine.createRuntimeRoot({...valid,transactionVersionSupported:'future'}),
    /RUNTIME_ROOT_TRANSACTION_VERSION_INVALID/);
});

test('runtime compatibility invalidates chain identity, runtime policy, software, and transaction support drift',()=>{
  const certified=EnvironmentCertificationEngine.createRuntimeRoot({epoch:650,contextSlot:280_000_000});
  const noPrograms=[];
  const laterContext=EnvironmentCertificationEngine.createRuntimeRoot({epoch:650,contextSlot:certified.contextSlot+10});
  assert.equal(EnvironmentCertificationEngine.verifyCompatibility(laterContext,certified,noPrograms,noPrograms).isCompatible,true,
    'context slots advance normally; certificate slot rules handle their temporal bounds');
  const staleContext=EnvironmentCertificationEngine.createRuntimeRoot({epoch:650,contextSlot:certified.contextSlot-1});
  const staleResult=EnvironmentCertificationEngine.verifyCompatibility(staleContext,certified,noPrograms,noPrograms);
  assert.equal(staleResult.isCompatible,false,'an older current observation cannot establish compatibility with a later certificate');
  assert.ok(staleResult.invalidatedReasons.some(reason=>reason.startsWith('CURRENT_CONTEXT_BEHIND_CERTIFICATE:')));
  for(const [field,value,reason] of [
    ['genesisHash','different-genesis','GENESIS_HASH_MISMATCH'],
    ['agaveVersion','vNext','AGAVE_VERSION_DRIFT'],
    ['resourcePolicyVersion','res_pol_next','RESOURCE_POLICY_DRIFT'],
    ['transactionVersionSupported','legacy','TRANSACTION_VERSION_SUPPORT_DRIFT'],
  ]) {
    const result=EnvironmentCertificationEngine.verifyCompatibility(EnvironmentCertificationEngine.createRuntimeRoot({epoch:650,contextSlot:280_000_000,[field]:value}),certified,noPrograms,noPrograms);
    assert.equal(result.isCompatible,false,field);
    assert.ok(result.invalidatedReasons.some(reasonText=>reasonText.startsWith(reason)),field);
  }
});

test('shared integrity validators reject field tampering, accessors, proxies, cycles and oversized trees',()=>{
  const runtime=EnvironmentCertificationEngine.createRuntimeRoot({epoch:3,contextSlot:9});
  assert.equal(verifyRuntimeRootIntegrity(runtime),true);
  assert.equal(Object.isFrozen(runtime),true);
  assert.equal(verifyRuntimeRootIntegrity({...runtime,epoch:runtime.epoch+1}),false);
  let getterCalls=0;const accessor={...runtime};Object.defineProperty(accessor,'epoch',{enumerable:true,get(){getterCalls++;return runtime.epoch;}});
  assert.equal(verifyRuntimeRootIntegrity(accessor),false);assert.equal(getterCalls,0);
  assert.equal(verifyRuntimeRootIntegrity(new Proxy(runtime,{})),false);

  const child=EnvironmentCertificationEngine.createProgramRoot({programId:'child',deploymentSlot:2,executableBytecodeHash:'bytecode-child'});
  const parent=EnvironmentCertificationEngine.createProgramRoot({programId:'parent',deploymentSlot:3,executableBytecodeHash:'bytecode-parent',transitiveCpiProgramRoots:[child]});
  assert.equal(verifyProgramRootIntegrity(parent),true);assert.equal(Object.isFrozen(parent),true);
  assert.equal(Object.isFrozen(parent.transitiveCpiProgramRoots[0]),true);
  assert.throws(()=>EnvironmentCertificationEngine.createProgramRoot({programId:'null-children',deploymentSlot:0,executableBytecodeHash:'x',transitiveCpiProgramRoots:null}),/PROGRAM_ROOT_CHILDREN_INVALID/);
  const immutableSource=EnvironmentCertificationEngine.createProgramRoot({programId:'source',deploymentSlot:1,executableBytecodeHash:'source'});
  const sourceChild={...immutableSource};
  const detached=EnvironmentCertificationEngine.createProgramRoot({programId:'detached-parent',deploymentSlot:4,executableBytecodeHash:'parent',transitiveCpiProgramRoots:[sourceChild]});
  assert.notEqual(detached.transitiveCpiProgramRoots[0],sourceChild);
  assert.equal(Object.isFrozen(sourceChild),false);
  assert.throws(()=>{ detached.transitiveCpiProgramRoots[0].programId='mutated'; },TypeError);
  const tampered={...parent,executableBytecodeHash:'changed'};
  assert.equal(verifyProgramRootIntegrity(tampered),false);
  const accessorProgram={...parent};Object.defineProperty(accessorProgram,'programId',{enumerable:true,get(){getterCalls++;return 'parent';}});
  assert.equal(verifyProgramRootIntegrity(accessorProgram),false);assert.equal(getterCalls,0);
  assert.equal(verifyProgramRootIntegrity(new Proxy(parent,{})),false);
  const cyclic={programId:'cycle',deploymentSlot:0,executableBytecodeHash:'x',isImmutable:true,transitiveCpiProgramRoots:[],programRootHash:'0'.repeat(64)};
  cyclic.transitiveCpiProgramRoots.push(cyclic);
  assert.equal(verifyProgramRootIntegrity(cyclic),false);
  const tooMany=Array.from({length:513},(_,i)=>EnvironmentCertificationEngine.createProgramRoot({programId:`p${i}`,deploymentSlot:0,executableBytecodeHash:'x'}));
  assert.equal(verifyProgramRootForestIntegrity(tooMany),false);
  assert.equal(verifyProgramRootForestIntegrity(tooMany.slice(0,512)),true);
});

test('verifyCompatibility refuses roots whose fields no longer match their embedded hashes',()=>{
  const current=EnvironmentCertificationEngine.createRuntimeRoot({epoch:4,contextSlot:10});
  const certified=EnvironmentCertificationEngine.createRuntimeRoot({epoch:4,contextSlot:10});
  const invalidRuntime={...current,transactionVersionSupported:'legacy'};
  const runtimeResult=EnvironmentCertificationEngine.verifyCompatibility(invalidRuntime,certified,[],[]);
  assert.equal(runtimeResult.isCompatible,false);
  assert.ok(runtimeResult.invalidatedReasons.some(reason=>reason.startsWith('CURRENT_RUNTIME_ROOT_INVALID:')));

  const currentProgram=EnvironmentCertificationEngine.createProgramRoot({programId:'p',deploymentSlot:1,executableBytecodeHash:'current'});
  const certifiedProgram=EnvironmentCertificationEngine.createProgramRoot({programId:'p',deploymentSlot:1,executableBytecodeHash:'certified'});
  assert.equal(EnvironmentCertificationEngine.verifyCompatibility(current,certified,[currentProgram],[certifiedProgram]).isCompatible,false,
    'separately valid ProgramRoots still produce the existing program-drift result');
  const invalidProgram={...currentProgram,executableBytecodeHash:'forged'};
  const programResult=EnvironmentCertificationEngine.verifyCompatibility(current,certified,[invalidProgram],[certifiedProgram]);
  assert.equal(programResult.isCompatible,false);
  assert.ok(programResult.invalidatedReasons.some(reason=>reason.startsWith('CURRENT_PROGRAM_ROOT_INVALID:')));
  const futureProgram=EnvironmentCertificationEngine.createProgramRoot({programId:'future',deploymentSlot:11,executableBytecodeHash:'future'});
  const futureResult=EnvironmentCertificationEngine.verifyCompatibility(current,certified,[futureProgram],[futureProgram]);
  assert.equal(futureResult.isCompatible,false);
  assert.ok(futureResult.invalidatedReasons.some(reason=>reason.startsWith('CURRENT_PROGRAM_ROOT_INVALID:')));
  assert.equal(verifyProgramRootForestIntegrity([currentProgram,currentProgram]),false,'ambiguous duplicate top-level program IDs fail closed');
});

test('certificate builder and verifier reject duplicate top-level program IDs with valid conflicting roots',()=>{
  const runtime=EnvironmentCertificationEngine.createRuntimeRoot({epoch:8,contextSlot:20});
  const first=EnvironmentCertificationEngine.createProgramRoot({programId:'same-id',deploymentSlot:10,executableBytecodeHash:'first-code'});
  const second=EnvironmentCertificationEngine.createProgramRoot({programId:'same-id',deploymentSlot:11,executableBytecodeHash:'second-code'});
  assert.notEqual(first.programRootHash,second.programRootHash);
  assert.throws(()=>SimulationCertificateBuilder.buildCertificate({...certificateInput(runtime),programRoots:[first,second]}),
    /SIMULATION_PROGRAM_ROOT_FOREST_INVALID/);

  const valid=SimulationCertificateBuilder.buildCertificate(certificateInput(runtime));
  const forgedSelfConsistent={...valid,programRoots:[first,second]};
  forgedSelfConsistent.evidenceHash=rehashCertificate(forgedSelfConsistent);
  assert.equal(verifySimulationCertificate(forgedSelfConsistent),false,
    'the enclosing evidence hash cannot make an ambiguous root forest valid');
});

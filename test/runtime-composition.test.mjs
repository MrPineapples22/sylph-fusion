import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeContext} from '../dist/runtime-context.js';
import {composePaperRuntime} from '../dist/runtime-composition.js';
const env={MODE:'paper',RPC_URLS:'https://rpc-a.example,https://rpc-b.example',WS_URLS:'wss://ws-a.example'};
test('composition preserves one injected paper runtime identity',()=>{
 const context=createRuntimeContext(env,{now:1,runtimeGeneration:'r'});
 const composed=composePaperRuntime({context,market:{},execution:{},reconciliation:{}});
 assert.equal(composed.context.runtimeGeneration,'r'); assert.equal(Object.isFrozen(composed),true);
});
test('composition cannot promote a live configuration',()=>{
 const context=createRuntimeContext({...env,MODE:'live',KEYPAIR_PATH:'unused'});
 assert.throws(()=>composePaperRuntime({context,market:{},execution:{},reconciliation:{}}),/LIVE_RUNTIME_COMPOSITION_UNAVAILABLE/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/read-json.js';
test('deadline cancels stalled bodies and later requests can recover',async t=>{
 t.mock.method(globalThis,'fetch',async (_url,{signal})=>({ok:true,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}));
 await assert.rejects(readJson('/test',undefined,5),/timed out/);
 globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true})});
 assert.deepEqual(await readJson('/test'),{ok:true});
});
test('cancelled lifecycle cannot publish a response even if transport ignores abort',async t=>{
 const controller=new AbortController();controller.abort(new Error('Cancelled'));
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({old:true})}));
 await assert.rejects(readJson('/test',controller.signal),/Cancelled/);
});

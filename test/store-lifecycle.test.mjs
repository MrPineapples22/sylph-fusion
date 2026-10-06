import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../dist/store.js';
test('concurrent close drains accepted writes and rejects late requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sylph-store-audit-'));
 const path=join(dir,'state.sqlite');let db=new Store(path);
 try{
  const write=db.save({audit:'preserved'});
  const evidence=db.appendAuditEvent('candidate_discovered_v1',{candidateId:'candidate-1',lamports:12n});
  const first=db.close();assert.equal(db.close(),first);
  await assert.rejects(db.load(),/closing/);
  await Promise.all([write,evidence,first]);await db.close();
  db=new Store(path);assert.deepEqual(await db.load(),{audit:'preserved'});
  const events=await db.getAuditEvents('candidate_discovered_v1');
  assert.equal(events.length,1);assert.equal(events[0].id,1);assert.equal(events[0].event,'candidate_discovered_v1');
  assert.deepEqual(JSON.parse(events[0].body),{candidateId:'candidate-1',lamports:'12'});
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});
test('audit journal validates event identity, payload size, and bounded reads',async()=>{
 const db=new Store(':memory:');
 try{
  await assert.rejects(db.appendAuditEvent('BAD EVENT',{}),/event name/);
  await assert.rejects(db.appendAuditEvent('candidate_discovered_v1',[]),/payload/);
  await assert.rejects(db.appendAuditEvent('candidate_discovered_v1',{oversized:'x'.repeat(65_537)}),/size limit/);
  await assert.rejects(db.getAuditEvents('candidate_discovered_v1',0),/limit/);
  await db.appendAuditEvent('candidate_discovered_v1',{candidateId:'a'});
  await db.appendAuditEvent('candidate_discovered_v1',{candidateId:'b'});
  assert.deepEqual((await db.getAuditEvents('candidate_discovered_v1',1)).map(row=>JSON.parse(row.body).candidateId),['a']);
 }finally{await db.close();}
});
test('database queue rejects overload without losing accepted requests',async()=>{
 const db=new Store(':memory:');
 try{
  const requests=Array.from({length:129},()=>db.load());
  const results=await Promise.allSettled(requests);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,128);
  assert.match(results[128].reason.message,/queue full/);
 }finally{await db.close();}
});

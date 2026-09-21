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
  const first=db.close();assert.equal(db.close(),first);
  await assert.rejects(db.load(),/closing/);
  await Promise.all([write,first]);await db.close();
  db=new Store(path);assert.deepEqual(await db.load(),{audit:'preserved'});
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
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

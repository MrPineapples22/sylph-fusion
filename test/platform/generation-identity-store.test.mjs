import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../../dist/store.js';
import {DurableLiveSigner,signingMessageHash} from '../../dist/platform/signing/durable-live-signer.js';
import {snapshotRegistration} from '../../dist/platform/storage/generation-identity.js';
import {sqliteRuntimeEligible,openGenerationDatabase,registerInitialGenerationSync,immediateTransaction} from '../../dist/platform/storage/generation-sqlite.js';
import {legacySigningSchema,generationSigningSchema,generationTriggers} from '../../dist/platform/storage/generation-schema.js';

const digest='a'.repeat(64);
const request=(id='intent',req=`request-${id}`,hash=digest)=>({intentId:id,registrationRequestId:req,intentSha256:hash});
const prepared=id=>({economicIntentId:id,grantId:`grant-${id}`,wallet:'fixture-wallet',messageSha256:digest,controlEpoch:1,preparedAtMs:1});
const code=expected=>error=>error.code===expected;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'sylph-generation-'));
  const path=join(dir,'state.sqlite');
  const stores=[],children=[];
  t.after(async()=>{
    for(const child of children) if(child.exitCode===null && child.signalCode===null) child.kill();
    await Promise.all(children.map(child=>child.exited.catch(()=>{})));
    await Promise.all(stores.map(store=>store.close().catch(()=>{})));
    const target=resolve(dir),root=resolve(tmpdir());
    assert.ok(target.startsWith(root+sep) && target.slice(root.length+1).startsWith('sylph-generation-'));
    await rm(target,{recursive:true,force:true});
  });
  return {dir,path,store:()=>{const store=new Store(path);stores.push(store);return store;},
    child:(mode,...args)=>{
      const child=fork(new URL('../fixtures/generation-process.mjs',import.meta.url),[mode,path,...args],
        {execPath:process.execPath,execArgv:[],env:{SystemRoot:process.env.SystemRoot},stdio:['ignore','ignore','pipe','ipc']});
      child.stderr.resume();
      child.exited=once(child,'exit');
      child.messages=[];child.on('message',m=>child.messages.push(m));
      children.push(child);return child;
    }};
}
async function message(child,kind,timeout=15000) {
  const started=Date.now();
  while(Date.now()-started<timeout) {
    const found=child.messages.find(m=>m.kind===kind);
    if(found)return found;
    if(child.exitCode!==null || child.signalCode!==null)throw new Error(`child exited before ${kind}: ${JSON.stringify(child.messages)}`);
    await delay(10);
  }
  throw new Error(`child timeout waiting for ${kind}`);
}
async function markerReached(child,marker) {
  const started=Date.now();
  while(Date.now()-started<15000) {
    try {await access(marker);return;}catch{}
    if(child.exitCode!==null || child.signalCode!==null)throw new Error('fault child exited without reaching barrier');
    await delay(10);
  }
  throw new Error('fault barrier timeout');
}
function legacyFixture(path) {
  const db=new DatabaseSync(path);
  db.exec(legacySigningSchema);
  const insert=db.prepare("INSERT INTO signing_intents VALUES(?,?,?,?,?,?,?, ?,?)");
  insert.run('legacy','g1','w',digest,2,null,3,'PREPARED',null);
  insert.run('old\0key','g2','w',digest,2,9,3,'SIGNED','unverified-old-signature');
  db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO unrelated VALUES(1,\'keep\')');
  const rows=db.prepare('SELECT * FROM signing_intents ORDER BY grant_id').all().map(row=>({...row}));
  db.close();return rows;
}
function snapshot(db) {
  return {version:db.prepare('PRAGMA user_version').get().user_version,
    objects:db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all().map(x=>({...x})),
    rows:db.prepare('SELECT * FROM signing_intents ORDER BY grant_id').all().map(x=>({...x}))};
}
async function rejectOpen(path,expected='SCHEMA_UNSUPPORTED') {
  const store=new Store(path);
  try{await assert.rejects(store.load(),code(expected));}finally{await store.close().catch(()=>{});}
}

test('initial registration is snapshotted, durable, exact-idempotent and non-authorizing',async t=>{
  const f=await fixture(t),store=f.store();
  assert.deepEqual(await store.readGenerationIdentity('intent'),{kind:'MISSING'});
  const mutable=request();const pending=store.registerInitialGeneration(mutable);mutable.intentSha256='b'.repeat(64);
  const created=await pending;
  assert.equal(created.disposition,'CREATED');assert.equal(created.identity.generation,1);
  assert.equal(created.identity.intentSha256,digest);assert.equal(created.identity.state,'REGISTERED');
  assert.ok(Number.isSafeInteger(created.identity.registeredAtMs));
  assert.deepEqual(Object.keys(created.identity).sort(),['generation','intentId','intentSha256','registeredAtMs','registrationRequestId','state']);
  await store.close();const reopened=f.store();
  assert.deepEqual(await reopened.registerInitialGeneration(request()),{disposition:'ALREADY_REGISTERED',identity:created.identity});
  assert.deepEqual(await reopened.readGenerationIdentity('intent'),{kind:'REGISTERED',identity:created.identity});
  await assert.rejects(reopened.registerInitialGeneration(request('intent','different')),code('IDENTITY_CONFLICT'));
  await assert.rejects(reopened.registerInitialGeneration(request('intent','request-intent','b'.repeat(64))),code('IDENTITY_CONFLICT'));
  await assert.rejects(reopened.registerInitialGeneration(request('different','request-intent')),code('REQUEST_ID_CONFLICT'));
  const db=new DatabaseSync(f.path);const row=db.prepare('SELECT * FROM signing_intents').get();db.close();
  for(const key of ['grant_id','wallet','message_sha256','control_epoch','revocation_epoch','prepared_at','signature_base64']) assert.equal(row[key],null);
});

test('registration validates exact data fields and rejects NUL/newline at public, worker and SQL boundaries',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  const {db,registrationCapable}=openGenerationDatabase(f.path);
  try {
    const invalid=[null,[],{},Object.create(request()),{...request(),generation:1},{...request(),[Symbol()]:1},
      {...request(),intentId:3},{...request(),intentSha256:'A'.repeat(64)}, {...request(),intentId:'constructor'},
      {...request(),intentId:'Prototype'}, {...request(),intentId:'a\n'},{...request(),intentSha256:digest+'\n'},
      Object.defineProperty(request(),'intentId',{get(){throw new Error('accessor must not run');}})];
    for(const value of invalid)await assert.rejects(store.registerInitialGeneration(value),code('INVALID_REGISTRATION'));
    for(const field of ['intentId','registrationRequestId','intentSha256']) {
      const base=field==='intentSha256'?digest:'a'.repeat(256);
      for(const value of ['\0'+base,base.slice(0,2)+'\0'+base.slice(2),base+'\0',base+'\0junk']) {
        const input={...request(),[field]:value};
        await assert.rejects(store.registerInitialGeneration(input),code('INVALID_REGISTRATION'));
        await assert.rejects(store.call('register-initial-generation',JSON.stringify(input)),code('INVALID_REGISTRATION'));
        assert.throws(()=>registerInitialGenerationSync(db,registrationCapable,JSON.stringify(input)),code('INVALID_REGISTRATION'));
        assert.throws(()=>db.prepare("INSERT INTO signing_intents(economic_intent_id,record_kind,state,generation,registration_request_id,intent_sha256,registered_at,revocation_epoch) VALUES(?,'INITIAL_GENERATION','REGISTERED',1,?,?,0,NULL)")
          .run(input.intentId,input.registrationRequestId,input.intentSha256),/CHECK constraint/);
      }
    }
    assert.throws(()=>registerInitialGenerationSync(db,true,'{broken'),code('INVALID_REGISTRATION'));
    assert.throws(()=>registerInitialGenerationSync(db,true,' '.repeat(4097)),code('INVALID_REGISTRATION'));
    const boundary=request('a'.repeat(256),'b'.repeat(256));
    assert.equal((await store.registerInitialGeneration(boundary)).disposition,'CREATED');
    await assert.rejects(store.registerInitialGeneration(request('a'.repeat(257))),code('INVALID_REGISTRATION'));
  }finally{db.close();}
});

test('independent Stores serialize identical, conflicting and distinct registrations',async t=>{
  const f=await fixture(t),stores=Array.from({length:6},()=>f.store());
  await Promise.all(stores.map(s=>s.load()));
  const identical=await Promise.all(stores.map(s=>s.registerInitialGeneration(request())));
  assert.equal(identical.filter(r=>r.disposition==='CREATED').length,1);
  assert.equal(new Set(identical.map(r=>r.identity.registeredAtMs)).size,1);
  const conflicting=await Promise.allSettled(stores.map((s,i)=>s.registerInitialGeneration(request('conflict',`req-${i}`))));
  assert.equal(conflicting.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(conflicting.filter(r=>r.status==='rejected').every(r=>r.reason.code==='IDENTITY_CONFLICT'));
  await Promise.all(stores.map((s,i)=>s.registerInitialGeneration(request(`distinct-${i}`))));
  const db=new DatabaseSync(f.path);assert.equal(db.prepare('SELECT count(*) AS n FROM signing_intents').get().n,8);db.close();
});

test('independent OS processes race identical/conflicting/distinct registration behind a start barrier',async t=>{
  const f=await fixture(t);await f.store().load();
  for(const mode of ['identical','conflicting','distinct']) {
    const children=Array.from({length:3},()=>f.child('register'));
    await Promise.all(children.map(c=>message(c,'ready')));
    children.forEach((child,i)=>child.send({input:mode==='identical'?request('process-identical'):
      mode==='conflicting'?request('process-conflicting',`process-req-${i}`):request(`process-distinct-${i}`)}));
    const results=await Promise.all(children.map(c=>message(c,'result')));
    await Promise.all(children.map(c=>c.exited));
    assert.equal(results.filter(r=>r.ok && r.result.disposition==='CREATED').length,mode==='distinct'?3:1);
    if(mode==='identical')assert.equal(results.filter(r=>r.ok && r.result.disposition==='ALREADY_REGISTERED').length,2);
    if(mode==='conflicting')assert.equal(results.filter(r=>r.code==='IDENTITY_CONFLICT').length,2);
  }
});

test('legacy signing and registration share one namespace across processes and cannot sign a registration',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  for(let n=0;n<3;n++) {
    const id=`cross-${n}`,registration=f.child('register'),legacy=f.child('legacy');
    await Promise.all([message(registration,'ready'),message(legacy,'ready')]);
    registration.send({input:request(id)});legacy.send({input:prepared(id)});
    const results=await Promise.all([message(registration,'result'),message(legacy,'result')]);
    await Promise.all([registration.exited,legacy.exited]);
    assert.equal(results.filter(r=>r.ok).length,1);
    const row=await store.readGenerationIdentity(id);
    assert.ok(row.kind==='REGISTERED'||row.kind==='LEGACY_TOMBSTONE');
  }
  await store.prepareSigningIntent(prepared('legacy-first'));
  await assert.rejects(store.registerInitialGeneration(request('legacy-first')),code('LEGACY_INTENT_BLOCKED'));
  await assert.rejects(store.prepareSigningIntent({...prepared('other'),grantId:'grant-legacy-first'}),/UNIQUE constraint/);
  await store.registerInitialGeneration(request('registration-first'));
  await assert.rejects(store.markSigningIntentSigned('registration-first',digest,Buffer.alloc(64).toString('base64')),/missing, altered/);
  let signerCalls=0;const bytes=Buffer.from('fixture message');
  const signer=new DurableLiveSigner({wallet:'fixture-wallet',signAuthorizedMessage:async()=>{signerCalls++;return new Uint8Array(64);}},store,()=>1,()=>100);
  await assert.rejects(signer.sign({grantId:'new-grant',economicIntentId:'registration-first',wallet:'fixture-wallet',messageSha256:signingMessageHash(bytes),issuedAtMs:1,expiresAtMs:1000,controlEpoch:1},bytes),/UNIQUE constraint/);
  assert.equal(signerCalls,0);
});

test('read-only signing intent lookup preserves message, wallet, state, and signature across reopen',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  const absent=await store.getSigningIntent('not-present');assert.equal(absent,null);
  await store.prepareSigningIntent(prepared('read-signing'));
  assert.deepEqual(await store.getSigningIntent('read-signing'),{
    economicIntentId:'read-signing',wallet:'fixture-wallet',messageSha256:digest,state:'PREPARED',signatureBase64:null,
  });
  const signature=Buffer.alloc(64,7).toString('base64');
  await store.markSigningIntentSigned('read-signing',digest,signature);
  const expected={economicIntentId:'read-signing',wallet:'fixture-wallet',messageSha256:digest,state:'SIGNED',signatureBase64:signature};
  assert.deepEqual(await store.getSigningIntent('read-signing'),expected);
  await store.close();
  const reopened=f.store();await reopened.load();
  assert.deepEqual(await reopened.getSigningIntent('read-signing'),expected);
  await reopened.registerInitialGeneration(request('read-registered'));
  assert.equal(await reopened.getSigningIntent('read-registered'),null);
  await assert.rejects(reopened.getSigningIntent(''),/Invalid signing intent lookup/);
  assert.equal(Object.isFrozen(await reopened.getSigningIntent('read-signing')),true);
});

test('legacy migration preserves all columns, NUL keys, tombstones and consistent fixture backup',async t=>{
  const f=await fixture(t),before=legacyFixture(f.path);
  const old=new DatabaseSync(f.path),backup=join(f.dir,'backup.sqlite');
  old.exec('CREATE INDEX sqliteXunrelated ON unrelated(value)');
  const unrelatedIndex={...old.prepare("SELECT * FROM sqlite_schema WHERE name='sqliteXunrelated'").get()};
  old.prepare('VACUUM INTO ?').run(backup);old.close();
  const store=f.store();await store.load();
  const db=new DatabaseSync(f.path);
  const columns=Object.keys(before[0]).join(',');
  assert.deepEqual(db.prepare(`SELECT ${columns} FROM signing_intents ORDER BY grant_id`).all().map(r=>({...r})),before);
  assert.equal(db.prepare('SELECT value FROM unrelated').get().value,'keep');
  assert.deepEqual({...db.prepare("SELECT * FROM sqlite_schema WHERE name='sqliteXunrelated'").get()},unrelatedIndex);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
  const copy=new DatabaseSync(backup);assert.equal(copy.prepare('PRAGMA user_version').get().user_version,0);assert.equal(copy.prepare('SELECT count(*) AS n FROM signing_intents').get().n,2);copy.close();
  assert.deepEqual(await store.readGenerationIdentity('legacy'),{kind:'LEGACY_TOMBSTONE',intentId:'legacy',legacyState:'PREPARED'});
  await assert.rejects(store.registerInitialGeneration(request('legacy')),code('LEGACY_INTENT_BLOCKED'));
  await assert.rejects(store.readGenerationIdentity('old\0key'),code('INVALID_REGISTRATION'));
  await store.markSigningIntentSigned('legacy',digest,Buffer.alloc(64).toString('base64'));
  assert.equal((await store.readGenerationIdentity('legacy')).legacyState,'SIGNED');
});

test('concurrent initializers migrate once and retain every legacy row',async t=>{
  const f=await fixture(t);legacyFixture(f.path);
  const children=[f.child('register'),f.child('register')];
  await Promise.all(children.map(c=>message(c,'ready')));
  children.forEach((c,i)=>c.send({input:request(`initializer-${i}`)}));
  assert.ok((await Promise.all(children.map(c=>message(c,'result')))).every(r=>r.ok));
  await Promise.all(children.map(c=>c.exited));
  const db=new DatabaseSync(f.path);assert.equal(db.prepare('SELECT count(*) AS n FROM signing_intents').get().n,4);db.close();
});

test('migration process death at every schema boundary recovers old or fully committed schema',async t=>{
  for(const point of ['migration-copy','migration-drop','migration-rename','migration-version','after-commit']) {
    await t.test(point,async t=>{
      const f=await fixture(t),before=legacyFixture(f.path),marker=join(f.dir,'barrier');
      const child=f.child('migration-crash',point,marker);await markerReached(child,marker);child.kill();await child.exited;
      const db=new DatabaseSync(f.path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,point==='after-commit'?1:0);
      assert.deepEqual(db.prepare(`SELECT ${Object.keys(before[0]).join(',')} FROM signing_intents ORDER BY grant_id`).all().map(r=>({...r})),before);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='signing_intents_v1'").get().n,0);db.close();
      await f.store().load();
    });
  }
});

test('registration process death before commit leaves no row; after commit recovers same identity',async t=>{
  for(const point of ['registration-insert','before-commit','after-commit']) {
    await t.test(point,async t=>{
      const f=await fixture(t),marker=join(f.dir,'barrier');
      const child=f.child('registration-crash',point,marker);await markerReached(child,marker);child.kill();await child.exited;
      const store=f.store(),read=await store.readGenerationIdentity('crash-intent');
      assert.equal(read.kind,point==='after-commit'?'REGISTERED':'MISSING');
      const retry=await store.registerInitialGeneration(request('crash-intent','crash-request'));
      assert.equal(retry.disposition,point==='after-commit'?'ALREADY_REGISTERED':'CREATED');
      if(read.kind==='REGISTERED')assert.deepEqual(retry.identity,read.identity);
    });
  }
});

test('held locks yield bounded busy, then exact retry works; initializers also time out',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  const holder=f.child('lock');await message(holder,'ready');
  const start=Date.now();
  await assert.rejects(store.registerInitialGeneration(request('locked')),code('STORAGE_BUSY'));
  assert.ok(Date.now()-start>=4500 && Date.now()-start<12000);
  const initializing=new Store(f.path);
  try {await assert.rejects(initializing.load(),code('STORAGE_BUSY'));}finally{await initializing.close().catch(()=>{});}
  holder.send('release');await holder.exited;
  assert.equal((await store.readGenerationIdentity('locked')).kind,'MISSING');
  assert.equal((await store.registerInitialGeneration(request('locked'))).disposition,'CREATED');
});

test('initializer timeout applies before converting a locked legacy file to WAL',async t=>{
  const f=await fixture(t);const before=legacyFixture(f.path);
  const holder=f.child('lock');await message(holder,'ready');
  const start=Date.now();await rejectOpen(f.path,'STORAGE_BUSY');
  assert.ok(Date.now()-start>=4500 && Date.now()-start<12000);
  holder.send('release');await holder.exited;
  const db=new DatabaseSync(f.path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
  assert.deepEqual(db.prepare('SELECT * FROM signing_intents ORDER BY grant_id').all().map(r=>({...r})),before);db.close();
  await f.store().load();
});

test('worker death rejects accepted registrations as unknown and public process death permits exact recovery',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  const holder=f.child('lock');await message(holder,'ready');
  const pending=store.registerInitialGeneration(request('worker-death'));
  const rejected=assert.rejects(pending,code('STORAGE_OUTCOME_UNKNOWN'));
  await store.worker.terminate();await rejected;
  holder.send('release');await holder.exited;
  const recovered=f.store();assert.equal((await recovered.readGenerationIdentity('worker-death')).kind,'MISSING');
  const child=f.child('register');await message(child,'ready');
  const blocker=f.child('lock');await message(blocker,'ready');
  child.send({input:request('public-death')});await delay(50);child.kill();await child.exited;
  blocker.send('release');await blocker.exited;
  assert.equal((await recovered.readGenerationIdentity('public-death')).kind,'MISSING');
  assert.equal((await recovered.registerInitialGeneration(request('public-death'))).disposition,'CREATED');
});

test('memory Store retains ordinary persistence but refuses generation capability',async()=>{
  const store=new Store(':memory:');
  try {
    await store.save({fixture:true});assert.deepEqual(await store.load(),{fixture:true});
    await assert.rejects(store.registerInitialGeneration(request()),code('REGISTRATION_STORAGE_UNSUPPORTED'));
    await assert.rejects(store.readGenerationIdentity('intent'),code('REGISTRATION_STORAGE_UNSUPPORTED'));
  }finally{await store.close();}
});

test('runtime gate rejects unpatched or malformed versions before target open and connection mismatch before writes',async t=>{
  const accepted=['3.51.3','3.52.0','3.53.4','3.44.6','3.50.7'];
  const rejected=['3.51.2','3.50.6','3.44.5','3.45.0','3.49.9','3.50.8',null,undefined,'','3.51.3-extra','3.51.3\n','+3.51.3','03.51.3','3.051.3','3.51.03','3.51.3.0','9007199254740992.1.1'];
  for(const v of accepted)assert.equal(sqliteRuntimeEligible(v),true,v);
  for(const v of rejected)assert.equal(sqliteRuntimeEligible(v),false,String(v));
  const f=await fixture(t);
  for(const v of rejected) {
    const opened=[];
    assert.throws(()=>openGenerationDatabase(f.path,{open:(p,o)=>{opened.push(p);return new DatabaseSync(p,o??{});},version:()=>v}),code('SQLITE_RUNTIME_UNSUPPORTED'));
    assert.deepEqual(opened,[':memory:']);
    await assert.rejects(access(f.path));
  }
  let reads=0;
  assert.throws(()=>openGenerationDatabase(f.path,{version:()=>++reads===1?'3.53.4':'3.52.0'}),code('SQLITE_RUNTIME_UNSUPPORTED'));
  const db=new DatabaseSync(f.path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n,0);db.close();
});

test('migration refuses dependencies, collisions, unknown versions and mutated legacy schema without row changes',async t=>{
  const mutations={
    incoming_fk:'CREATE TABLE incoming(id TEXT REFERENCES signing_intents(economic_intent_id))',
    view:'CREATE VIEW prior_view AS SELECT * FROM signing_intents',
    trigger:'CREATE TRIGGER custom_trigger AFTER INSERT ON signing_intents BEGIN SELECT 1; END',
    outside_trigger:'CREATE TRIGGER other_trigger AFTER INSERT ON unrelated BEGIN SELECT * FROM signing_intents; END',
    index:'CREATE INDEX custom_index ON signing_intents(state)',
    staging_table:'CREATE TABLE signing_intents_v1(id INTEGER)',
    staging_view:'CREATE VIEW signing_intents_v1 AS SELECT 1',
    update_collision:'CREATE TABLE initial_generation_no_update(id INTEGER)',
    delete_collision:'CREATE VIEW initial_generation_no_delete AS SELECT 1',
    kind_collision:'CREATE TRIGGER signing_intent_no_kind_change AFTER INSERT ON unrelated BEGIN SELECT 1; END',
    unknown_version:'PRAGMA user_version=2',
    mutated_table:'ALTER TABLE signing_intents ADD COLUMN surprise TEXT',
  };
  for(const [name,sql] of Object.entries(mutations))await t.test(name,async t=>{
    const f=await fixture(t);legacyFixture(f.path);let db=new DatabaseSync(f.path);db.exec(sql);const before=snapshot(db);db.close();
    await rejectOpen(f.path);db=new DatabaseSync(f.path);assert.deepEqual(snapshot(db),before);db.close();
  });
});

test('literal sqlite_ prefix filtering retains similarly named user dependencies and their data',async t=>{
  const mutations={
    incoming_fk:"CREATE TABLE sqliteXchild(id TEXT REFERENCES signing_intents(economic_intent_id) ON DELETE CASCADE); INSERT INTO sqliteXchild VALUES('legacy')",
    view:'CREATE VIEW sqliteXview AS SELECT * FROM signing_intents',
    trigger:'CREATE TRIGGER sqliteXtrigger AFTER INSERT ON signing_intents BEGIN SELECT 1; END',
    outside_trigger:'CREATE TRIGGER sqliteXoutside AFTER INSERT ON unrelated BEGIN SELECT * FROM signing_intents; END',
    index:'CREATE INDEX sqliteXindex ON signing_intents(state)',
  };
  for(const version of [0,1])for(const prefix of ['sqliteX','SqliteX'])for(const [name,sql] of Object.entries(mutations))await t.test(`${version}-${prefix}-${name}`,async t=>{
    const f=await fixture(t);legacyFixture(f.path);
    if(version===1){const store=f.store();await store.load();await store.close();}
    let db=new DatabaseSync(f.path);
    db.exec('PRAGMA foreign_keys=ON');db.exec(sql.replaceAll('sqliteX',prefix));
    const before=snapshot(db);
    const childRows=name==='incoming_fk'?db.prepare('SELECT * FROM sqliteXchild').all().map(row=>({...row})):undefined;
    db.close();
    await rejectOpen(f.path);
    db=new DatabaseSync(f.path);
    try {
      assert.deepEqual(snapshot(db),before);
      if(childRows)assert.deepEqual(db.prepare('SELECT * FROM sqliteXchild').all().map(row=>({...row})),childRows);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
  });
});

test('version one reopens only with exact constraints, indexes and triggers',async t=>{
  const mutations={
    trigger:'DROP TRIGGER initial_generation_no_update',
    changed_trigger:"DROP TRIGGER signing_intent_no_kind_change; CREATE TRIGGER signing_intent_no_kind_change BEFORE UPDATE ON signing_intents BEGIN SELECT 1; END",
    index:'CREATE INDEX extraneous ON signing_intents(state)',
    constraints:'ALTER TABLE signing_intents ADD COLUMN surprise INTEGER',
  };
  for(const [name,sql] of Object.entries(mutations))await t.test(name,async t=>{
    const f=await fixture(t),store=f.store();await store.registerInitialGeneration(request());await store.close();
    let db=new DatabaseSync(f.path);db.exec(sql);const before=snapshot(db);db.close();
    await rejectOpen(f.path);db=new DatabaseSync(f.path);assert.deepEqual(snapshot(db),before);db.close();
  });
});

test('fingerprint refuses missing unique constraints and changed SQL literal whitespace',async t=>{
  for(const [version,ddl] of [
    [0,legacySigningSchema.replace('NOT NULL UNIQUE','NOT NULL')],
    [1,generationSigningSchema.replace('signing_intents_v1','signing_intents').replace('registration_request_id TEXT UNIQUE','registration_request_id TEXT')],
    [1,generationSigningSchema.replace('signing_intents_v1','signing_intents').replace("state='REGISTERED'","state='REGIST ERED'")],
  ])await t.test(`${version}-${ddl.length}`,async t=>{
    const f=await fixture(t);let db=new DatabaseSync(f.path);db.exec(ddl);
    if(version===1)db.exec(generationTriggers);
    db.exec(`PRAGMA user_version=${version}`);const before=snapshot(db);db.close();
    await rejectOpen(f.path);db=new DatabaseSync(f.path);assert.deepEqual(snapshot(db),before);db.close();
  });
});

test('SQL enforces required fields, generation one and UPDATE/DELETE/kind immutability',async t=>{
  const f=await fixture(t),store=f.store();const initial=await store.registerInitialGeneration(request());
  await store.prepareSigningIntent(prepared('legacy-sql'));
  const db=new DatabaseSync(f.path);
  try {
    for(const sql of ["UPDATE signing_intents SET generation=2 WHERE economic_intent_id='intent'",
      "UPDATE signing_intents SET intent_sha256='b' WHERE economic_intent_id='intent'",
      "DELETE FROM signing_intents WHERE economic_intent_id='intent'",
      "UPDATE signing_intents SET record_kind='LEGACY_SIGNING' WHERE economic_intent_id='intent'",
      "UPDATE signing_intents SET record_kind='INITIAL_GENERATION' WHERE economic_intent_id='legacy-sql'"])assert.throws(()=>db.exec(sql),/IMMUTABLE/);
    for(const field of ['economic_intent_id','generation','registration_request_id','intent_sha256','registered_at']) {
      const values={economic_intent_id:'sql-extra',record_kind:'INITIAL_GENERATION',state:'REGISTERED',generation:1,registration_request_id:'sql-request',intent_sha256:digest,registered_at:0,revocation_epoch:null,[field]:null};
      assert.throws(()=>db.prepare(`INSERT INTO signing_intents(${Object.keys(values).join(',')}) VALUES(${Object.values(values).map(()=>'?').join(',')})`).run(...Object.values(values)),/constraint/);
    }
    assert.throws(()=>db.prepare("INSERT INTO signing_intents(economic_intent_id,record_kind,state,generation,registration_request_id,intent_sha256,registered_at,revocation_epoch) VALUES('gen-2','INITIAL_GENERATION','REGISTERED',2,'gen-2-request',?,0,NULL)").run(digest),/constraint/);
    assert.deepEqual((await store.readGenerationIdentity('intent')).identity,initial.identity);
  }finally{db.close();}
});

test('raw REPLACE bypass is an excluded SQL boundary; supported APIs preserve both keys',async t=>{
  const f=await fixture(t),store=f.store();await store.registerInitialGeneration(request('protected','protected-request'));
  await assert.rejects(store.registerInitialGeneration(request('protected','other-request')),code('IDENTITY_CONFLICT'));
  await assert.rejects(store.registerInitialGeneration(request('other','protected-request')),code('REQUEST_ID_CONFLICT'));
  for(const conflict of ['intent','request']) {
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(generationSigningSchema.replace('signing_intents_v1','signing_intents'));db.exec(generationTriggers);db.exec('PRAGMA recursive_triggers=0');
      const sql="INSERT OR REPLACE INTO signing_intents(economic_intent_id,record_kind,state,generation,registration_request_id,intent_sha256,registered_at,revocation_epoch) VALUES(?,'INITIAL_GENERATION','REGISTERED',1,?,?,0,NULL)";
      db.prepare(sql).run('raw-intent','raw-request',digest);
      db.prepare(sql).run(conflict==='intent'?'raw-intent':'changed-intent',conflict==='request'?'raw-request':'changed-request','b'.repeat(64));
      assert.equal(db.prepare('SELECT count(*) AS n FROM signing_intents').get().n,1);
      assert.equal(db.prepare('SELECT intent_sha256 FROM signing_intents').get().intent_sha256,'b'.repeat(64));
    }finally{db.close();}
  }
  const worker=await readFile(new URL('../../src/db-worker.ts',import.meta.url),'utf8');
  const implementation=await readFile(new URL('../../src/platform/storage/generation-sqlite.ts',import.meta.url),'utf8');
  assert.doesNotMatch(worker+implementation,/\b(?:INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/i);
  const fusion=await readFile(new URL('../../src/fusion.ts',import.meta.url),'utf8');
  assert.doesNotMatch(fusion,/registerInitialGeneration|readGenerationIdentity/);
});

test('internal commit/rollback adapter retains original cause and poisons uncertain connections',()=>{
  for(const rollbackFails of [false,true]) {
    const original=Object.assign(new Error('injected commit failure'),{errcode:10});
    let transaction=false,closed=false;
    const adapter={get isTransaction(){return transaction;},exec(sql){
      if(sql==='BEGIN IMMEDIATE')transaction=true;
      if(sql==='COMMIT')throw original;
      if(sql==='ROLLBACK'){if(rollbackFails)throw new Error('secondary rollback failure');transaction=false;}
    },close(){closed=true;}};
    assert.throws(()=>immediateTransaction(adapter,()=>42),error=>{
      assert.equal(error.code,'STORAGE_OUTCOME_UNKNOWN');assert.equal(error.cause,original);assert.equal(error.sqliteCode,10);
      assert.equal(!!error.poisoned,rollbackFails);return true;
    });
    assert.equal(closed,rollbackFails);
  }
  const original=Object.assign(new Error('unexpected constraint'),{errcode:275});
  let transaction=false;
  const adapter={get isTransaction(){return transaction;},exec(sql){transaction=sql==='BEGIN IMMEDIATE';},close(){}};
  assert.throws(()=>immediateTransaction(adapter,()=>{throw original;}),error=>error.code==='STORAGE_INVARIANT_FAILURE'&&error.cause===original);
});

test('unexpected missing schema fails without false registration or fallback',async t=>{
  const f=await fixture(t),store=f.store();await store.load();
  const db=new DatabaseSync(f.path);db.exec('DROP TABLE signing_intents');db.close();
  await assert.rejects(store.registerInitialGeneration(request()),code('STORAGE_FAILURE'));
  const check=new DatabaseSync(f.path);assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='signing_intents'").get().n,0);check.close();
});

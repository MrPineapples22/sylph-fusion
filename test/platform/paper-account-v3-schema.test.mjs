import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {PaperAccountV3BootstrapStore} from '../../dist/platform/storage/paper-account-v3-store.js';
import {bootstrapPaperAccountV3,verifyPaperAccountV3Bootstrap} from '../../dist/platform/storage/paper-account-v3-bootstrap.js';
import {serializeSylphJcs1} from '../../dist/platform/storage/paper-account-v3-codec.js';
import {initializePaperAccountV3Schema,verifyPaperAccountV3Schema,paperAccountV3SchemaSha256} from '../../dist/platform/storage/paper-account-v3-schema.js';
import {initializePaperLedgerSchema,migratePaperLedgerV1ToV2,verifyPaperLedgerV1,verifyPaperLedgerV2} from '../../dist/platform/storage/paper-ledger-schema.js';

async function dbPath(t,name='ledger.sqlite') {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-account-v3-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return join(folder,name);
}
function open(path) { return new DatabaseSync(path,{timeout:5000}); }
function seedV1(path) {
  const db=open(path);
  initializePaperLedgerSchema(db);
  db.exec(`INSERT INTO paper_generations VALUES('acct','gen','900719925474099312345',10);
    INSERT INTO paper_commands VALUES('acct','gen','cmd','fp','{"amount":"11"}',11);
    INSERT INTO paper_command_events(account_id,generation_id,command_id,event_type,occurred_at_ms,payload_json)
      VALUES('acct','gen','cmd','ACCEPTED',11,'{}');
    INSERT INTO paper_command_events(account_id,generation_id,command_id,event_type,occurred_at_ms,payload_json)
      VALUES('acct','gen','cmd','UNRESOLVED',12,'{"reasonCode":"test"}');`);
  db.close();
}
function createV2(path) {
  const db=open(path); initializePaperLedgerSchema(db); migratePaperLedgerV1ToV2(db); db.close();
}
function bootstrapGenesis(accountId='acct-bootstrap',generationId='gen-bootstrap',overrides={}) {
  return Buffer.from(serializeSylphJcs1({accountId,accountingPolicyHash:'0'.repeat(64),configHash:'0'.repeat(64),conversionPolicyHash:'0'.repeat(64),createdAtMs:7,
    createdBy:'operator:creator',generationId,initialCapitalUsdMicro:'123456',initialCashAvailableUsdMicro:'123456',openingCashUsdMicro:'123456',
    origin:'EXPLICIT_OPERATOR_GENESIS',priorGenerationId:null,reason:'isolated bootstrap fixture',riskPolicyHash:'0'.repeat(64),schemaVersion:2,
    simulatorBuildHash:'0'.repeat(64),simulatorReportSchema:'fill-report-v1',tokenMetadataPolicyHash:'0'.repeat(64),...overrides}));
}

test('virgin v0 becomes exact v3 atomically with no account, generation, event, or capital',async t=>{
  const path=await dbPath(t); const db=open(path);
  try {
    const result=initializePaperAccountV3Schema(db);
    assert.deepEqual(result,{sourceUserVersion:0,targetUserVersion:3,schemaSha256:paperAccountV3SchemaSha256});
    verifyPaperAccountV3Schema(db);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
    for(const table of ['pa2_accounts','pa2_generations','pa2_events','pa2_commands','pa2_reservations','pa2_position_lots','pa2_fills'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
    assert.equal(db.prepare('SELECT source_user_version FROM pa2_schema_metadata').get().source_user_version,0);
  } finally { db.close(); }
  const reopened=open(path); try {verifyPaperAccountV3Schema(reopened);} finally {reopened.close();}
});

test('v1 migration preserves legacy rows byte-for-byte and installs empty canonical v3 namespace',async t=>{
  const path=await dbPath(t); seedV1(path); const db=open(path);
  try {
    verifyPaperLedgerV1(db);
    const before={generation:{...db.prepare('SELECT * FROM paper_generations').get()},command:{...db.prepare('SELECT * FROM paper_commands').get()},events:db.prepare('SELECT * FROM paper_command_events ORDER BY event_id').all().map(row=>({...row}))};
    const result=initializePaperAccountV3Schema(db);
    assert.equal(result.sourceUserVersion,1);
    verifyPaperAccountV3Schema(db);
    assert.equal(db.prepare('SELECT source_user_version FROM pa2_schema_metadata').get().source_user_version,1);
    assert.deepEqual({...db.prepare('SELECT * FROM paper_generations').get()},before.generation);
    assert.deepEqual({...db.prepare('SELECT * FROM paper_commands').get()},before.command);
    assert.deepEqual(db.prepare('SELECT * FROM paper_command_events ORDER BY event_id').all().map(row=>({...row})),before.events);
    assert.equal(db.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM pa2_generations').get().n,0);
  } finally {db.close();}
});

test('exact marker v2 migration removes only its verified marker and retains legacy rows',async t=>{
  const path=await dbPath(t); seedV1(path);
  let db=open(path); migratePaperLedgerV1ToV2(db); verifyPaperLedgerV2(db);
  const legacyCount=db.prepare('SELECT count(*) AS n FROM paper_command_events').get().n; db.close();
  db=open(path);
  try {
    const result=initializePaperAccountV3Schema(db);
    assert.equal(result.sourceUserVersion,2);
    verifyPaperAccountV3Schema(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM paper_command_events').get().n,legacyCount);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='paper_kernel_prototype_marker'").get().n,0);
    assert.equal(db.prepare('SELECT source_user_version FROM pa2_schema_metadata').get().source_user_version,2);
  } finally {db.close();}
});

test('invalid v0, malformed v1, and marker v2 data refuse before WAL/schema mutation',async t=>{
  const emptyish=await dbPath(t,'sqliteXkeep.sqlite'); let db=open(emptyish);
  db.exec('CREATE TABLE sqliteXkeep(value TEXT)');
  assert.throws(()=>initializePaperAccountV3Schema(db),/UNVERSIONED_DATABASE_NOT_EMPTY/);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,0); db.close();

  const malformedV1=await dbPath(t,'v1.sqlite'); db=open(malformedV1); initializePaperLedgerSchema(db);
  db.exec("DROP TRIGGER paper_fills_no_update; CREATE TRIGGER paper_fills_no_update BEFORE UPDATE ON paper_fills BEGIN SELECT 1; END;");
  assert.throws(()=>initializePaperAccountV3Schema(db),/SCHEMA_UNSUPPORTED/);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete'); db.close();

  const malformedV2=await dbPath(t,'v2.sqlite'); db=open(malformedV2); initializePaperLedgerSchema(db); migratePaperLedgerV1ToV2(db);
  db.exec('DELETE FROM paper_kernel_prototype_marker');
  assert.throws(()=>initializePaperAccountV3Schema(db),/SCHEMA_UNSUPPORTED/);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2); db.close();
});

test('v3 exact schema verifier rejects forged same-name trigger and leaves source unchanged',async t=>{
  const path=await dbPath(t); let db=open(path); initializePaperAccountV3Schema(db); db.close();
  db=open(path); db.exec("DROP TRIGGER pa2_events_no_update; CREATE TRIGGER pa2_events_no_update BEFORE UPDATE ON pa2_events BEGIN SELECT 1; END;");
  db.exec('PRAGMA journal_mode=DELETE'); db.close();
  db=open(path);
  assert.throws(()=>initializePaperAccountV3Schema(db),/SCHEMA_UNSUPPORTED/);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,3); db.close();
});

test('v1 and v2 DDL/version/drop-marker changes roll back together at each precommit fault',async t=>{
  for(const source of [1,2]) for(const point of ['after-marker-drop','after-v3-ddl-before-version','after-v3-version-before-commit','before-v3-commit']) {
    if(source===1&&point==='after-marker-drop') continue;
    const path=await dbPath(t,`v${source}-${point}.sqlite`);
    if(source===1) seedV1(path); else createV2(path);
    const db=open(path);
    assert.throws(()=>initializePaperAccountV3Schema(db,actual=>{if(actual===point)throw new Error(`fault:${point}`);}),new RegExp(`fault:${point}`));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,source);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='pa2_schema_metadata'").get().n,0);
    if(source===1) verifyPaperLedgerV1(db); else {
      verifyPaperLedgerV2(db);
      assert.equal(db.prepare('SELECT count(*) AS n FROM paper_kernel_prototype_marker').get().n,1);
    }
    db.close();
    const reopened=open(path);
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,source);
    reopened.close();
  }
});

test('process death before, during, and after v0 schema commit has exact reopen outcomes',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-account-v3-kill-')); t.after(()=>rm(folder,{recursive:true,force:true}));
  const schemaUrl=new URL('../../dist/platform/storage/paper-account-v3-schema.js',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite'; import {initializePaperAccountV3Schema} from ${JSON.stringify(schemaUrl)}; const db=new DatabaseSync(process.argv[1]); initializePaperAccountV3Schema(db,p=>{if(p===process.env.FAIL_POINT)process.exit(87)}); db.close();`;
  for(const [point,expectV3] of [['before-v3-transaction',false],['after-v3-ddl-before-version',false],['after-v3-version-before-commit',false],['after-v3-commit',true]]) {
    const path=join(folder,`${point}.sqlite`); const created=open(path); created.close();
    const child=spawnSync(process.execPath,['--input-type=module','-e',script,path],{encoding:'utf8',env:{...process.env,FAIL_POINT:point}});
    assert.equal(child.status,87,child.stderr||point);
    const reopened=open(path);
    if(expectV3) {
      verifyPaperAccountV3Schema(reopened);
      assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,3);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,0);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_generations').get().n,0);
    } else {
      assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,0);
      assert.equal(reopened.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").get().n,0);
      assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    }
    reopened.close();
  }
});

test('abrupt child termination and reopen preserve v1/v2 before commit and recover committed v3',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-account-v3-migrate-kill-')); t.after(()=>rm(folder,{recursive:true,force:true}));
  const schemaUrl=new URL('../../dist/platform/storage/paper-account-v3-schema.js',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite'; import {writeSync} from 'node:fs'; import {initializePaperAccountV3Schema} from ${JSON.stringify(schemaUrl)}; const db=new DatabaseSync(process.argv[1]); initializePaperAccountV3Schema(db,p=>{if(p===process.env.FAIL_POINT){writeSync(1,'KILL_NOW');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)}}); db.close();`;
  async function killAt(path,point) {
    return await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',script,path],{stdio:['ignore','pipe','pipe'],env:{...process.env,FAIL_POINT:point}});
      let killed=false;let stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error(`child did not reach ${point}: ${stderr}`));},15000);
      child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.stdout.on('data',chunk=>{if(!killed&&chunk.toString().includes('KILL_NOW')){killed=true;child.kill('SIGKILL');}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,killed,stderr});});
    });
  }
  for(const [source,point,expected] of [[1,'after-v3-ddl-before-version',1],[1,'after-v3-version-before-commit',1],[1,'after-v3-commit',3],
      [2,'after-marker-drop',2],[2,'after-v3-ddl-before-version',2],[2,'after-v3-version-before-commit',2],[2,'after-v3-commit',3]]) {
    const path=join(folder,`source-${source}-${point}.sqlite`);
    if(source===1)seedV1(path);else createV2(path);
    const child=await killAt(path,point);assert.equal(child.killed,true,`${point}: ${child.stderr}`);assert.notEqual(child.code,0);
    const reopened=open(path);
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,expected,point);
    if(expected===1)verifyPaperLedgerV1(reopened);
    else if(expected===2){verifyPaperLedgerV2(reopened);assert.equal(reopened.prepare('SELECT count(*) AS n FROM paper_kernel_prototype_marker').get().n,1);}
    else {verifyPaperAccountV3Schema(reopened);assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,0);}
    reopened.close();
  }
});

test('two independent schema workers converge on one empty v3 database',async t=>{
  const path=await dbPath(t); const a=new PaperAccountV3BootstrapStore(path); const b=new PaperAccountV3BootstrapStore(path);
  try {
    const [as,bs]=await Promise.all([a.ready(),b.ready()]);
    assert.equal(as.userVersion,3); assert.equal(bs.userVersion,3);
    assert.equal((await a.inspect()).accountCount,0);
    assert.equal((await b.inspect()).generationCount,0);
  } finally {await Promise.all([a.close(),b.close()]);}
});

test('explicit bootstrap creates only blocked epoch-zero state and exact retries are no-ops',async t=>{
  const path=await dbPath(t);const genesis=bootstrapGenesis();const store=new PaperAccountV3BootstrapStore(path);
  let finalEventSha256='';
  try {
    await store.ready();
    const first=await store.bootstrap(genesis,'operator:authorization',800);
    assert.equal(first.created,true);assert.equal(first.admissionState,'BLOCKED');assert.equal(first.generationState,'PENDING');assert.equal(first.ownerEpoch,0);
    const retry=await store.bootstrap(genesis,'operator:authorization',900);
    finalEventSha256=retry.lastEventSha256;
    assert.equal(retry.created,false);assert.equal(retry.firstEventId,first.firstEventId);assert.equal(retry.secondEventId,first.secondEventId);
    assert.equal(retry.lastEventSha256,first.lastEventSha256);
    assert.equal(typeof store.activate,'undefined');assert.equal(typeof store.appendEvent,'undefined');assert.equal(typeof store.acquireLease,'undefined');
    await assert.rejects(store.bootstrap(bootstrapGenesis('acct-bootstrap','gen-bootstrap',{reason:'changed genesis'}),'operator:authorization',901),/BOOTSTRAP_CONFLICT/);
    await assert.rejects(store.bootstrap(genesis,'different authorization identity',902),/AUTHORIZATION_IDENTITY_MISMATCH/);
  } finally {await store.close();}
  const db=open(path);try {
    verifyPaperAccountV3Schema(db);
    const account=db.prepare('SELECT * FROM pa2_accounts').get();
    assert.equal(account.active_generation_id,null);assert.equal(account.admission_state,'BLOCKED');assert.equal(account.owner_epoch,0);assert.equal(account.owner_id,null);
    assert.equal(account.lease_id,null);assert.equal(account.state_version,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM pa2_generations').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM pa2_events').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM pa2_commands').get().n,0);
    const verified=verifyPaperAccountV3Bootstrap(db,genesis,'operator:authorization');assert.equal(verified.lastEventSha256,finalEventSha256);
  } finally {db.close();}
});

test('bootstrap rejects genesis with missing, unknown, or unattested fields before creating state',async t=>{
  const path=await dbPath(t);const store=new PaperAccountV3BootstrapStore(path);const genesis=bootstrapGenesis();
  try {
    await store.ready();
    const object=JSON.parse(genesis.toString('utf8'));
    const missing={...object};delete missing.reason;
    const extra={...object,unreviewedAuthority:'yes'};
    const attested={...object,origin:'ATTESTED_GENESIS'};
    for(const invalid of [missing,extra,attested]) {
      await assert.rejects(store.bootstrap(Buffer.from(serializeSylphJcs1(invalid)),'operator:authorization',800),/GENESIS_(SHAPE_INVALID|INVALID)/);
    }
    assert.equal((await store.inspect()).accountCount,0);
    assert.equal((await store.inspect()).generationCount,0);
    assert.equal((await store.inspect()).eventCount,0);
  } finally {await store.close();}
});

test('bootstrap verifier rejects a persisted command-scoped bootstrap event',async t=>{
  const path=await dbPath(t);const genesis=bootstrapGenesis();const store=new PaperAccountV3BootstrapStore(path);
  try {await store.ready();await store.bootstrap(genesis,'operator:authorization',800);} finally {await store.close();}
  const db=open(path);
  try {
    db.exec('DROP TRIGGER pa2_events_no_update; UPDATE pa2_events SET command_id=\'forged-command\' WHERE account_sequence=1;');
    assert.throws(()=>verifyPaperAccountV3Bootstrap(db,genesis,'operator:authorization'),/EVENT_COMMAND_SCOPE_INVALID/);
  } finally {db.close();}
});

test('rollback failure poisons the database handle and requires exact reopen verification',async t=>{
  const path=await dbPath(t);const setup=open(path);initializePaperAccountV3Schema(setup);setup.close();
  const db=open(path);const realExec=db.exec.bind(db);
  Object.defineProperty(db,'exec',{configurable:true,value(sql){if(sql==='ROLLBACK')throw new Error('injected rollback failure');return realExec(sql);}});
  const genesis=bootstrapGenesis('acct-rollback-failure','gen-rollback-failure');
  assert.throws(()=>bootstrapPaperAccountV3(db,genesis,'operator:authorization',800,point=>{
    if(point==='after-account-before-commit')throw new Error('injected transaction failure');
  }),/ROLLBACK_FAILED/);
  assert.throws(()=>db.prepare('SELECT count(*) FROM pa2_accounts'),/closed|open/i);
  const reopened=open(path);
  try {
    verifyPaperAccountV3Schema(reopened);
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,0);
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_generations').get().n,0);
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_events').get().n,0);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally {reopened.close();}
});

test('two bootstrap workers serialize an identical retry and refuse concurrent fingerprint conflicts',async t=>{
  const path=await dbPath(t);const a=new PaperAccountV3BootstrapStore(path);const b=new PaperAccountV3BootstrapStore(path);
  try {
    await Promise.all([a.ready(),b.ready()]);
    const genesis=bootstrapGenesis();const results=await Promise.all([a.bootstrap(genesis,'operator:authorization',1000),b.bootstrap(genesis,'operator:authorization',1100)]);
    assert.equal(results.filter(value=>value.created).length,1);assert.equal(results.filter(value=>!value.created).length,1);
    assert.equal(results[0].firstEventId,results[1].firstEventId);assert.equal(results[0].lastEventSha256,results[1].lastEventSha256);
    const inspect=await a.inspect();assert.equal(inspect.accountCount,1);assert.equal(inspect.generationCount,1);assert.equal(inspect.eventCount,2);
  } finally {await Promise.all([a.close(),b.close()]);}
  const conflictPath=await dbPath(t);const c=new PaperAccountV3BootstrapStore(conflictPath);const d=new PaperAccountV3BootstrapStore(conflictPath);
  try {
    await Promise.all([c.ready(),d.ready()]);
    const competing=await Promise.allSettled([c.bootstrap(bootstrapGenesis('acct-bootstrap','gen-bootstrap',{reason:'A'}),'operator:authorization',1200),
      d.bootstrap(bootstrapGenesis('acct-bootstrap','gen-bootstrap',{reason:'B'}),'operator:authorization',1200)]);
    assert.equal(competing.filter(value=>value.status==='fulfilled').length,1);
    assert.equal(competing.filter(value=>value.status==='rejected').length,1);
    const rejected=competing.find(value=>value.status==='rejected');assert.match(rejected.reason.message,/BOOTSTRAP_CONFLICT/);
    const inspect=await c.inspect();assert.equal(inspect.accountCount,1);assert.equal(inspect.generationCount,1);assert.equal(inspect.eventCount,2);
  } finally {await Promise.all([c.close(),d.close()]);}
});

test('bootstrap process death before COMMIT rolls back; death after COMMIT is verified and retry is idempotent',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-account-v3-bootstrap-kill-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const bootstrapUrl=new URL('../../dist/platform/storage/paper-account-v3-bootstrap.js',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite';import {writeSync} from 'node:fs';import {bootstrapPaperAccountV3} from ${JSON.stringify(bootstrapUrl)};const db=new DatabaseSync(process.argv[1],{timeout:5000});db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;');bootstrapPaperAccountV3(db,Buffer.from(process.argv[2],'base64'),process.argv[3],Number(process.argv[4]),p=>{if(p===process.env.FAIL_POINT){writeSync(1,'KILL_NOW');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000)}});db.close();`;
  async function killAt(path,bytes,authorization,recordedAtMs,point) {
    return await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',script,path,bytes.toString('base64'),authorization,String(recordedAtMs)],{stdio:['ignore','pipe','pipe'],env:{...process.env,FAIL_POINT:point}});
      let killed=false,stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error(`bootstrap child did not reach ${point}: ${stderr}`));},15000);
      child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.stdout.on('data',chunk=>{if(!killed&&chunk.toString().includes('KILL_NOW')){killed=true;child.kill('SIGKILL');}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,killed,stderr});});
    });
  }
  for(const point of ['after-account-before-commit','after-first-event-before-commit','after-second-event-before-commit','after-commit-before-ack']) {
    const path=join(folder,`${point}.sqlite`);const db=open(path);initializePaperAccountV3Schema(db);db.close();
    const genesis=bootstrapGenesis(`acct-${point}`,'gen-bootstrap');const child=await killAt(path,genesis,'operator:authorization',1500,point);
    assert.equal(child.killed,true,`${point}: ${child.stderr}`);assert.notEqual(child.code,0);
    const reopened=open(path);
    if(point==='after-commit-before-ack') {
      const result=verifyPaperAccountV3Bootstrap(reopened,genesis,'operator:authorization');assert.equal(result.admissionState,'BLOCKED');
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,1);assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_events').get().n,2);
      const retried=bootstrapPaperAccountV3(reopened,genesis,'operator:authorization',2000);assert.equal(retried.created,false);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_events').get().n,2);
    } else {
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_accounts').get().n,0);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_generations').get().n,0);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM pa2_events').get().n,0);
      assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    }
    reopened.close();
  }
});

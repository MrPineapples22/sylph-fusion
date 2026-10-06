import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {PaperLedgerStore} from '../../dist/platform/storage/paper-ledger.js';
import {initializePaperLedgerSchema, migratePaperLedgerV1ToV2, verifyPaperLedgerV1, verifyPaperLedgerV2, isPaperLedgerSqliteVersionSupported} from '../../dist/platform/storage/paper-ledger-schema.js';
import {createPaperLedgerKernelState, reducePaperLedgerKernelEvent, canonicalPaperLedgerKernelJson, paperLedgerKernelSha256, paperLedgerKernelStateHash} from '../../dist/platform/storage/paper-ledger-kernel-prototype.js';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-paper-ledger-'));
  const path = join(folder, 'paper.sqlite');
  let store = new PaperLedgerStore(path);
  t.after(async () => { try { await store.close(); } catch {} await rm(folder, {recursive:true,force:true}); });
  const scope = {accountId:'paper-account-A',generationId:'generation-1'};
  await store.createGeneration({...scope,openingCashLamports:'5000000000',createdAtMs:1});
  return {get store(){return store;},setStore(value){store=value;},path,scope};
}
const command = (scope, request = {kind:'BUY',amountLamports:'1000',mint:'mint-A'}) => ({...scope,commandId:'cmd-1',request,acceptedAtMs:10});
const report = {status:'FILLED',inputLamports:'1000',outputRaw:'42'};
const fill = (scope, overrides={}) => ({...scope,commandId:'cmd-1',fillId:'fill-1',filledAtMs:12,cashDeltaLamports:'-1000',tokenDeltaRaw:'42',mint:'mint-A',simulationReport:report,...overrides});

test('paper ledger is generation/account scoped and command retry is fingerprint-idempotent', async t => {
  const f = await fixture(t);
  const first = await f.store.beginCommand(command(f.scope));
  assert.equal(first.disposition,'CREATED');
  assert.equal(first.command.state,'ACCEPTED');
  const retry = await f.store.beginCommand(command(f.scope,{mint:'mint-A',amountLamports:'1000',kind:'BUY'}));
  assert.equal(retry.disposition,'EXISTING');
  assert.equal(retry.command.requestFingerprint,first.command.requestFingerprint);
  await assert.rejects(f.store.beginCommand(command(f.scope,{kind:'SELL'})),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.store.beginCommand(command({...f.scope,generationId:'missing'})),/GENERATION_NOT_FOUND/);
  const otherGeneration = {...f.scope,generationId:'generation-2'};
  await f.store.createGeneration({...otherGeneration,openingCashLamports:'0',createdAtMs:2});
  assert.equal((await f.store.listCommands(otherGeneration)).length,0);
});

test('two independent workers serialize concurrent retries of the same command', async t => {
  const f = await fixture(t);
  const second = new PaperLedgerStore(f.path);
  try {
    const results = await Promise.all([
      f.store.beginCommand(command(f.scope)),
      second.beginCommand(command(f.scope,{mint:'mint-A',kind:'BUY',amountLamports:'1000'})),
    ]);
    assert.deepEqual(results.map(result => result.disposition).sort(),['CREATED','EXISTING']);
    assert.equal(results[0].command.requestFingerprint,results[1].command.requestFingerprint);
    assert.equal((await f.store.listCommands(f.scope)).length,1);
  } finally { await second.close(); }
});

test('simulation report and fill commit as append-only idempotent settlement facts', async t => {
  const f = await fixture(t);
  await f.store.beginCommand(command(f.scope));
  await f.store.recordSimulation({...f.scope,commandId:'cmd-1',report,recordedAtMs:11});
  await f.store.recordSimulation({...f.scope,commandId:'cmd-1',report,recordedAtMs:99});
  assert.equal((await f.store.getCommand({...f.scope,commandId:'cmd-1'})).state,'SIMULATED');
  assert.equal(await f.store.appendFill(fill(f.scope)),'APPENDED');
  assert.equal(await f.store.appendFill(fill(f.scope)),'EXISTING');
  await assert.rejects(f.store.appendFill(fill(f.scope,{cashDeltaLamports:'-1001'})),/FILL_CONFLICT/);
  const saved = await f.store.getCommand({...f.scope,commandId:'cmd-1'});
  assert.equal(saved.state,'SETTLED');
  assert.equal(saved.fillId,'fill-1');
  assert.deepEqual((await f.store.listFills(f.scope)).map(x=>[x.cashDeltaLamports,x.tokenDeltaRaw]),[['-1000','42']]);
  const db = new DatabaseSync(f.path);
  try {
    assert.throws(() => db.exec("UPDATE paper_fills SET fill_id='changed'"),/PAPER_LEDGER_APPEND_ONLY/);
    assert.throws(() => db.exec("DELETE FROM paper_command_events"),/PAPER_LEDGER_APPEND_ONLY/);
  } finally { db.close(); }
});

test('restart preserves accepted work as unresolved; it does not synthesize a fill or replay it', async t => {
  const f = await fixture(t);
  await f.store.beginCommand(command(f.scope));
  await f.store.close();
  f.setStore(new PaperLedgerStore(f.path));
  const restored = await f.store.getCommand({...f.scope,commandId:'cmd-1'});
  assert.equal(restored.state,'ACCEPTED');
  assert.equal(restored.fillId,null);
  assert.deepEqual(await f.store.listFills(f.scope),[]);
  await f.store.markUnresolved({...f.scope,commandId:'cmd-1',reasonCode:'SIMULATOR_OUTCOME_NOT_DURABLY_RECORDED',atMs:20});
  await f.store.markUnresolved({...f.scope,commandId:'cmd-1',reasonCode:'SIMULATOR_OUTCOME_NOT_DURABLY_RECORDED',atMs:20});
  assert.equal((await f.store.getCommand({...f.scope,commandId:'cmd-1'})).state,'UNRESOLVED');
  await f.store.close();
  f.setStore(new PaperLedgerStore(f.path));
  assert.equal((await f.store.getCommand({...f.scope,commandId:'cmd-1'})).state,'UNRESOLVED');
  await f.store.markUnresolved({...f.scope,commandId:'cmd-1',reasonCode:'SIMULATOR_OUTCOME_NOT_DURABLY_RECORDED',atMs:20});
  await assert.rejects(f.store.markUnresolved({...f.scope,commandId:'cmd-1',reasonCode:'OTHER_REASON',atMs:20}),/UNRESOLVED_CONFLICT/);
  await assert.rejects(f.store.markUnresolved({...f.scope,commandId:'cmd-1',reasonCode:'SIMULATOR_OUTCOME_NOT_DURABLY_RECORDED',atMs:21}),/UNRESOLVED_CONFLICT/);
  assert.deepEqual(await f.store.listFills(f.scope),[]);
});

test('invalid decimal/noncanonical accounting values fail before storage', async t => {
  const f = await fixture(t);
  await f.store.beginCommand(command(f.scope));
  await f.store.recordSimulation({...f.scope,commandId:'cmd-1',report,recordedAtMs:11});
  await assert.rejects(f.store.appendFill(fill(f.scope,{cashDeltaLamports:'1.5'})),/CASH_DELTA_INVALID/);
  await assert.rejects(f.store.beginCommand(command(f.scope,{amount:1.2})),/SAFE_INTEGERS/);
  const accessorRequest = {};
  Object.defineProperty(accessorRequest,'kind',{enumerable:true,get(){throw new Error('getter must not execute');}});
  await assert.rejects(f.store.beginCommand(command(f.scope,accessorRequest)),/REQUEST_INVALID/);
  assert.equal((await f.store.getCommand({...f.scope,commandId:'cmd-1'})).state,'SIMULATED');
});

test('startup refuses an unrelated unversioned database without modifying its schema or journal mode', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-paper-ledger-foreign-'));
  const path = join(folder,'foreign.sqlite');
  const foreign = new DatabaseSync(path);
  foreign.exec('CREATE TABLE sqliteXkeep(id INTEGER PRIMARY KEY);');
  assert.equal(foreign.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  foreign.close();
  const store = new PaperLedgerStore(path);
  try { await assert.rejects(store.createGeneration({accountId:'a',generationId:'g',openingCashLamports:'0',createdAtMs:0}),/UNVERSIONED_DATABASE_NOT_EMPTY/); }
  finally { await store.close(); }
  const verify = new DatabaseSync(path);
  try {
    assert.equal(verify.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
    assert.ok(verify.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqliteXkeep'").get());
    assert.equal(verify.prepare("SELECT 1 FROM sqlite_schema WHERE name='paper_generations'").get(),undefined);
  } finally { verify.close(); await rm(folder,{recursive:true,force:true}); }
});

test('startup rejects a forged same-name append-only trigger before changing the ledger', async t => {
  const f = await fixture(t);
  await f.store.close();
  const tamper = new DatabaseSync(f.path);
  try {
    tamper.exec("DROP TRIGGER paper_fills_no_update; CREATE TRIGGER paper_fills_no_update BEFORE UPDATE ON paper_fills BEGIN SELECT 1; END;");
  } finally { tamper.close(); }
  const rejected = new PaperLedgerStore(f.path);
  try { await assert.rejects(rejected.listFills(f.scope),/SCHEMA_UNSUPPORTED/); }
  finally { await rejected.close(); }
  const verify = new DatabaseSync(f.path);
  try {
    const trigger = verify.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='paper_fills_no_update'").get();
    assert.match(trigger.sql,/SELECT 1/);
    assert.equal(verify.prepare('PRAGMA user_version').get().user_version,2);
  } finally { verify.close(); }
});

test('schema DDL and version roll back atomically across reopen and can be safely retried', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-paper-ledger-schema-'));
  t.after(() => rm(folder,{recursive:true,force:true}));
  const path = join(folder,'schema.sqlite');
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => initializePaperLedgerSchema(db, point => {
      if (point === 'after-ddl-before-version') throw new Error('injected initialization failure');
    }),/injected initialization failure/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").get().n,0);
  } finally { db.close(); }
  const reopened = new DatabaseSync(path);
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").get().n,0);
    initializePaperLedgerSchema(reopened);
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    initializePaperLedgerSchema(reopened); // existing canonical schema is verified, not rewritten
  } finally { reopened.close(); }
  const verified = new DatabaseSync(path);
  try {
    assert.equal(verified.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(verified.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { verified.close(); }
});

test('schema version rolls back with DDL when failure occurs immediately before commit', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-paper-ledger-version-'));
  t.after(() => rm(folder,{recursive:true,force:true}));
  const path = join(folder,'schema.sqlite');
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => initializePaperLedgerSchema(db, point => {
      if (point === 'before-commit') throw new Error('injected pre-commit failure');
    }),/injected pre-commit failure/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").get().n,0);
  } finally { db.close(); }
  const reopened = new DatabaseSync(path);
  try {
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE lower(substr(name,1,7)) <> 'sqlite_'").get().n,0);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { reopened.close(); }
});

test('SQLite WAL runtime gate accepts fixed upstream releases and rejects vulnerable or unknown versions', () => {
  assert.equal(isPaperLedgerSqliteVersionSupported('3.51.3'),true);
  assert.equal(isPaperLedgerSqliteVersionSupported('3.53.4'),true);
  assert.equal(isPaperLedgerSqliteVersionSupported('3.44.6'),true);
  assert.equal(isPaperLedgerSqliteVersionSupported('3.50.7'),true);
  assert.equal(isPaperLedgerSqliteVersionSupported('3.51.2'),false);
  assert.equal(isPaperLedgerSqliteVersionSupported('3.50.8'),false);
  assert.equal(isPaperLedgerSqliteVersionSupported('unknown'),false);
});

test('v1 to inert v2 marker migration preserves legacy rows without account data', async t => {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-ledger-v2-migrate-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'ledger.sqlite'); const db=new DatabaseSync(path);
  try {
    initializePaperLedgerSchema(db);
    db.exec("INSERT INTO paper_generations VALUES('a','g','1000',1);");
    db.exec("INSERT INTO paper_commands VALUES('a','g','c','fp','{}',2);");
    db.exec("INSERT INTO paper_command_events(account_id,generation_id,command_id,event_type,occurred_at_ms,payload_json) VALUES('a','g','c','ACCEPTED',2,'{}');");
    db.exec("INSERT INTO paper_command_events(account_id,generation_id,command_id,event_type,occurred_at_ms,payload_json) VALUES('a','g','c','SIMULATED',3,'{}');");
    db.exec("INSERT INTO paper_simulation_reports VALUES('a','g','c','rfp','{}',3);");
    db.exec("INSERT INTO paper_fills VALUES('a','g','c','f',4,'mint','-1','5','rfp','{}');");
    verifyPaperLedgerV1(db);
    migratePaperLedgerV1ToV2(db);
    verifyPaperLedgerV2(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
    assert.deepEqual({...db.prepare('SELECT * FROM paper_fills').get()},{
      account_id:'a',generation_id:'g',command_id:'c',fill_id:'f',filled_at_ms:4,mint:'mint',cash_delta_lamports:'-1',token_delta_raw:'5',report_fingerprint:'rfp',report_json:'{}'
    });
    assert.equal(db.prepare('SELECT count(*) AS n FROM paper_generations').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM paper_commands').get().n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM paper_command_events').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM paper_simulation_reports').get().n,1);
    for(const table of ['paper_kernel_prototype_marker'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,1,`${table} is only a marker; no account events are writable`);
  } finally {db.close();}
  const reopened=new DatabaseSync(path);
  try {
    verifyPaperLedgerV2(reopened);
    assert.ok(reopened.prepare("SELECT 1 FROM sqlite_schema WHERE name='paper_kernel_prototype_marker'").get());
  } finally {reopened.close();}
  assert.equal(PaperLedgerStore.prototype.activateGeneration,undefined);
  assert.equal(PaperLedgerStore.prototype.createAccountGeneration,undefined);
  const legacyStore=new PaperLedgerStore(path);
  try {assert.equal(await legacyStore.createGeneration({accountId:'a',generationId:'legacy-only',openingCashLamports:'0',createdAtMs:5}),'CREATED');}
  finally {await legacyStore.close();}
  const inactive=new DatabaseSync(path);
  try {
    assert.equal(inactive.prepare('SELECT count(*) AS n FROM paper_kernel_prototype_marker').get().n,1);
    assert.equal(inactive.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name GLOB 'paper_kernel*'").get().n,1,'migration adds only the single prototype marker');
  } finally {inactive.close();}
});

test('v2 migration DDL and user_version roll back together and reopen as canonical v1', async t => {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-ledger-v2-rollback-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'ledger.sqlite'); let db=new DatabaseSync(path);
  initializePaperLedgerSchema(db);
  assert.throws(()=>migratePaperLedgerV1ToV2(db,point=>{if(point==='after-v2-ddl-before-version')throw new Error('injected v2 migration failure');}),/injected v2 migration failure/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='paper_kernel_prototype_marker'").get(),undefined);
  db.close(); db=new DatabaseSync(path);
  try {
    verifyPaperLedgerV1(db);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
    migratePaperLedgerV1ToV2(db);
    verifyPaperLedgerV2(db);
  } finally {db.close();}
});

test('worker rejects malformed v1 before persistent WAL setup', async t => {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-ledger-v1-order-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'ledger.sqlite'); const db=new DatabaseSync(path);
  initializePaperLedgerSchema(db);
  db.exec("DROP TRIGGER paper_fills_no_update; CREATE TRIGGER paper_fills_no_update BEFORE UPDATE ON paper_fills BEGIN SELECT 1; END;");
  db.close();
  const store=new PaperLedgerStore(path);
  try { await assert.rejects(store.listFills({accountId:'a',generationId:'g'}),/SCHEMA_UNSUPPORTED/); }
  finally { await store.close(); }
  const verify=new DatabaseSync(path);
  try {
    assert.equal(verify.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(verify.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  } finally {verify.close();}
});

test('WAL process death during v2 DDL or after version assignment rolls back; death after COMMIT is recovered', async t => {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-ledger-v2-process-fault-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const makeV1=path=>{const db=new DatabaseSync(path);initializePaperLedgerSchema(db);db.close();};
  const schemaUrl=new URL('../../dist/platform/storage/paper-ledger-schema.js',import.meta.url).href;
  const script=`import {DatabaseSync} from 'node:sqlite'; import {migratePaperLedgerV1ToV2,verifyPaperLedgerV1,isPaperLedgerSqliteVersionSupported} from ${JSON.stringify(schemaUrl)}; const db=new DatabaseSync(process.argv[1]); if(!isPaperLedgerSqliteVersionSupported(db.prepare('SELECT sqlite_version() AS v').get().v))process.exit(86); verifyPaperLedgerV1(db); if(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode!=='wal')process.exit(85); db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;'); if(db.prepare('PRAGMA synchronous').get().synchronous!==2)process.exit(84); migratePaperLedgerV1ToV2(db,p=>{if(p===process.env.FAIL_POINT)process.exit(87)}); db.close();`;

  const beforePath=join(folder,'before.sqlite'); makeV1(beforePath);
  const before=spawnSync(process.execPath,['--input-type=module','-e',script,beforePath],{encoding:'utf8',env:{...process.env,FAIL_POINT:'after-v2-ddl-before-version'}});
  assert.equal(before.status,87,before.stderr);
  const beforeDb=new DatabaseSync(beforePath);
  try {verifyPaperLedgerV1(beforeDb);assert.equal(beforeDb.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(beforeDb.prepare("SELECT 1 FROM sqlite_schema WHERE name='paper_kernel_prototype_marker'").get(),undefined);}
  finally {beforeDb.close();}

  const versionPath=join(folder,'version.sqlite'); makeV1(versionPath);
  const versionDeath=spawnSync(process.execPath,['--input-type=module','-e',script,versionPath],{encoding:'utf8',env:{...process.env,FAIL_POINT:'after-v2-version-before-commit'}});
  assert.equal(versionDeath.status,87,versionDeath.stderr);
  const versionDb=new DatabaseSync(versionPath);
  try {verifyPaperLedgerV1(versionDb);assert.equal(versionDb.prepare('PRAGMA user_version').get().user_version,1);assert.equal(versionDb.prepare("SELECT 1 FROM sqlite_schema WHERE name='paper_kernel_prototype_marker'").get(),undefined);assert.equal(versionDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}
  finally {versionDb.close();}

  const afterPath=join(folder,'after.sqlite'); makeV1(afterPath);
  const after=spawnSync(process.execPath,['--input-type=module','-e',script,afterPath],{encoding:'utf8',env:{...process.env,FAIL_POINT:'after-v2-commit'}});
  assert.equal(after.status,87,after.stderr);
  const afterDb=new DatabaseSync(afterPath);
  try {verifyPaperLedgerV2(afterDb);assert.equal(afterDb.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(afterDb.prepare('PRAGMA user_version').get().user_version,2);}
  finally {afterDb.close();}
});

test('offline kernel prototype uses exact integers, deterministic hashes, monotone watermarks, and sticky unresolved holds', () => {
  const genesis={accountId:'paper-A',generationId:'g-1',openingCashLamports:'900719925474099312345',createdAtMs:1,watermarkFreshnessMs:10,watermarkPolicyVersion:'paper-risk-v1',expectedOwnerEpoch:1};
  let state=createPaperLedgerKernelState(genesis);
  let sequence=0;
  const apply=(eventId,event)=>{const envelope={eventId,eventSequence:++sequence,ownerEpoch:1,event};state=reducePaperLedgerKernelEvent(state,envelope);return envelope;};
  const fingerprint='a'.repeat(64);
  apply('event-command',{type:'COMMAND_ACCEPTED',commandId:'cmd',requestFingerprint:fingerprint,atMs:2});
  const reportJson='{}'; const reportFingerprint=paperLedgerKernelSha256(reportJson);
  apply('event-simulated',{type:'SIMULATED',commandId:'cmd',reportFingerprint,reportJson,recordedAtMs:3});
  const fillEvent={type:'SETTLEMENT',commandId:'cmd',fillId:'fill',reportFingerprint,atMs:4,mint:'mint-X',tokenDecimals:6,cashDeltaLamports:'-100000000000000000001',tokenDeltaRaw:'42'};
  const fillEnvelope=apply('event-fill',fillEvent); const afterFill=state;
  assert.equal(reducePaperLedgerKernelEvent(state,fillEnvelope),afterFill,'exact latest-event retry is a no-op');
  assert.throws(()=>reducePaperLedgerKernelEvent(state,{...fillEnvelope,event:{...fillEvent,cashDeltaLamports:'-1'}}),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,{...fillEnvelope,eventSequence:1}),/SEQUENCE_INVALID/);
  assert.equal(state.cashLamports,'800719925474099312344');
  assert.deepEqual(state.tokens['mint-X'],{decimals:6,raw:'42'});
  apply('mark-1',{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-A',sourceSequence:1,policyVersion:'paper-risk-v1',observedAtMs:10,recordedAtMs:10,markMicroUsd:'10000000',proposedStopMicroUsd:'8000000'});
  apply('mark-2',{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-A',sourceSequence:2,policyVersion:'paper-risk-v1',observedAtMs:11,recordedAtMs:11,markMicroUsd:'12000000',proposedStopMicroUsd:'9000000'});
  assert.equal(state.risk['mint-X'].peakMicroUsd,'12000000');
  assert.equal(state.risk['mint-X'].troughMicroUsd,'10000000');
  assert.equal(state.risk['mint-X'].stopMicroUsd,'9000000');
  const sameTime=canonicalPaperLedgerKernelJson(state);
  apply('mark-equal-time-other-source',{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-B',sourceSequence:99,policyVersion:'paper-risk-v1',observedAtMs:11,recordedAtMs:12,markMicroUsd:'70000000',proposedStopMicroUsd:'60000000'});
  assert.deepEqual(state.risk['mint-X'],JSON.parse(sameTime).risk['mint-X'],'equal-time cross-source order is ambiguous and audit-only');
  const beforeStale=canonicalPaperLedgerKernelJson(state); const versionBeforeStale=state.foldVersion;
  apply('mark-old',{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-A',sourceSequence:3,policyVersion:'paper-risk-v1',observedAtMs:9,recordedAtMs:12,markMicroUsd:'50000000',proposedStopMicroUsd:'40000000'});
  assert.deepEqual(state.risk['mint-X'],JSON.parse(beforeStale).risk['mint-X']);
  assert.equal(state.risk['mint-X'].stopMicroUsd,'9000000');
  assert.equal(state.foldVersion,versionBeforeStale+1,'stale event advances the event-fold cursor but leaves risk state unchanged');
  apply('mark-stale',{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-A',sourceSequence:4,policyVersion:'paper-risk-v1',observedAtMs:1,recordedAtMs:100,markMicroUsd:'50000000',proposedStopMicroUsd:'40000000'});
  assert.equal(state.risk['mint-X'].stopMicroUsd,'9000000');
  apply('mark-unknown',{type:'RISK_UNRESOLVED',mint:'mint-X',reasonCode:'COMMIT_UNKNOWN',atMs:101});
  assert.equal(state.risk['mint-X'].unresolved,true);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,{eventId:'mark-after-unknown',eventSequence:sequence+1,ownerEpoch:1,event:{type:'RISK_WATERMARK',mint:'mint-X',sourceId:'feed-A',sourceSequence:5,policyVersion:'paper-risk-v1',observedAtMs:102,recordedAtMs:102,markMicroUsd:'13000000',proposedStopMicroUsd:'10000000'}}),/WATERMARK_UNRESOLVED/);
  const json=canonicalPaperLedgerKernelJson(state);
  assert.equal(paperLedgerKernelStateHash(state),paperLedgerKernelSha256(canonicalPaperLedgerKernelJson(JSON.parse(json))));
});

test('offline kernel requires persisted simulation report before settlement and unresolved commands never replay', () => {
  const genesis={accountId:'a',generationId:'g',openingCashLamports:'100',createdAtMs:0,watermarkFreshnessMs:10,watermarkPolicyVersion:'risk-v1',expectedOwnerEpoch:4};
  const env=(eventSequence,eventId,event,ownerEpoch=4)=>({eventSequence,eventId,ownerEpoch,event});
  let state=createPaperLedgerKernelState(genesis);
  state=reducePaperLedgerKernelEvent(state,env(1,'accepted',{type:'COMMAND_ACCEPTED',commandId:'c',requestFingerprint:'e'.repeat(64),atMs:1}));
  const reportJson='{}', reportFingerprint=paperLedgerKernelSha256(reportJson);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,env(2,'settle-too-early',{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:2,mint:'m',tokenDecimals:6,cashDeltaLamports:'-1',tokenDeltaRaw:'1'})),/COMMAND_NOT_SETTLEABLE/);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,env(2,'wrong-epoch',{type:'COMMAND_UNRESOLVED',commandId:'c',reasonCode:'TEST',atMs:2},3)),/EXPECTED_EPOCH_MISMATCH/);
  state=reducePaperLedgerKernelEvent(state,env(2,'sim',{type:'SIMULATED',commandId:'c',reportFingerprint,reportJson,recordedAtMs:2}));
  assert.throws(()=>reducePaperLedgerKernelEvent(state,env(3,'wrong-report',{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint:'f'.repeat(64),atMs:3,mint:'m',tokenDecimals:6,cashDeltaLamports:'-1',tokenDeltaRaw:'1'})),/REPORT_FINGERPRINT_MISMATCH/);
  state=reducePaperLedgerKernelEvent(state,env(3,'unknown',{type:'COMMAND_UNRESOLVED',commandId:'c',reasonCode:'SIMULATOR_OUTCOME_UNKNOWN',atMs:3}));
  assert.equal(state.commands.c.state,'UNRESOLVED');
  assert.throws(()=>reducePaperLedgerKernelEvent(state,env(4,'replay-sim',{type:'SIMULATED',commandId:'c',reportFingerprint,reportJson,recordedAtMs:4})),/COMMAND_NOT_SIMULATABLE/);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,env(4,'replay-settle',{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:4,mint:'m',tokenDecimals:6,cashDeltaLamports:'-1',tokenDeltaRaw:'1'})),/COMMAND_NOT_SETTLEABLE/);
});

test('offline kernel prototype refuses cash/token underflow and decimals ambiguity', () => {
  const g={accountId:'a',generationId:'g',openingCashLamports:'1',createdAtMs:0,watermarkFreshnessMs:100,watermarkPolicyVersion:'paper-risk-v1',expectedOwnerEpoch:1};
  let state=createPaperLedgerKernelState(g);
  const e=(id,eventSequence,event)=>({eventId:id,eventSequence,ownerEpoch:1,event});
  state=reducePaperLedgerKernelEvent(state,e('c',1,{type:'COMMAND_ACCEPTED',commandId:'c',requestFingerprint:'b'.repeat(64),atMs:1}));
  const reportJson='{}'; const reportFingerprint=paperLedgerKernelSha256(reportJson);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,e('f',2,{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:2,mint:'m',tokenDecimals:9,cashDeltaLamports:'-2',tokenDeltaRaw:'1'})),/COMMAND_NOT_SETTLEABLE/);
  state=reducePaperLedgerKernelEvent(state,e('sim',2,{type:'SIMULATED',commandId:'c',reportFingerprint,reportJson,recordedAtMs:2}));
  assert.throws(()=>reducePaperLedgerKernelEvent(state,e('f',3,{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:3,mint:'m',tokenDecimals:9,cashDeltaLamports:'-2',tokenDeltaRaw:'1'})),/CASH_UNDERFLOW/);
  state=reducePaperLedgerKernelEvent(state,e('f',3,{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:3,mint:'m',tokenDecimals:9,cashDeltaLamports:'0',tokenDeltaRaw:'1'}));
  const second=createPaperLedgerKernelState(g);
  assert.throws(()=>reducePaperLedgerKernelEvent(second,e('bad',1,{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:2,mint:'m',tokenDecimals:8,cashDeltaLamports:'0',tokenDeltaRaw:'1'})),/COMMAND_NOT_FOUND/);
  const accepted=reducePaperLedgerKernelEvent(second,e('c',1,{type:'COMMAND_ACCEPTED',commandId:'c',requestFingerprint:'b'.repeat(64),atMs:1}));
  assert.throws(()=>reducePaperLedgerKernelEvent(accepted,e('bad',2,{type:'SETTLEMENT',commandId:'c',fillId:'f',reportFingerprint,atMs:2,mint:'m',tokenDecimals:256,cashDeltaLamports:'0',tokenDeltaRaw:'1'})),/TOKEN_DECIMALS_INVALID/);
});

test('offline kernel prototype rejects duplicate fill identities and mint-decimal conflicts', () => {
  const genesis={accountId:'a',generationId:'g',openingCashLamports:'100',createdAtMs:0,watermarkFreshnessMs:10,watermarkPolicyVersion:'risk-v1',expectedOwnerEpoch:1};
  let state=createPaperLedgerKernelState(genesis);
  const envelope=(eventSequence,eventId,event)=>({eventSequence,eventId,ownerEpoch:1,event});
  state=reducePaperLedgerKernelEvent(state,envelope(1,'c1',{type:'COMMAND_ACCEPTED',commandId:'c1',requestFingerprint:'c'.repeat(64),atMs:1}));
  const reportJson='{}'; const reportFingerprint=paperLedgerKernelSha256(reportJson);
  state=reducePaperLedgerKernelEvent(state,envelope(2,'sim1',{type:'SIMULATED',commandId:'c1',reportFingerprint,reportJson,recordedAtMs:2}));
  state=reducePaperLedgerKernelEvent(state,envelope(3,'s1',{type:'SETTLEMENT',commandId:'c1',fillId:'fill-unique',reportFingerprint,atMs:3,mint:'mint',tokenDecimals:255,cashDeltaLamports:'-1',tokenDeltaRaw:'1'}));
  state=reducePaperLedgerKernelEvent(state,envelope(4,'c2',{type:'COMMAND_ACCEPTED',commandId:'c2',requestFingerprint:'d'.repeat(64),atMs:3}));
  state=reducePaperLedgerKernelEvent(state,envelope(5,'sim2',{type:'SIMULATED',commandId:'c2',reportFingerprint,reportJson,recordedAtMs:5}));
  assert.throws(()=>reducePaperLedgerKernelEvent(state,envelope(6,'s2',{type:'SETTLEMENT',commandId:'c2',fillId:'fill-unique',reportFingerprint,atMs:6,mint:'other-mint',tokenDecimals:0,cashDeltaLamports:'0',tokenDeltaRaw:'1'})),/FILL_ID_CONFLICT/);
  assert.throws(()=>reducePaperLedgerKernelEvent(state,envelope(6,'s3',{type:'SETTLEMENT',commandId:'c2',fillId:'fill-2',reportFingerprint,atMs:6,mint:'mint',tokenDecimals:9,cashDeltaLamports:'0',tokenDeltaRaw:'1'})),/TOKEN_DECIMALS_CONFLICT/);
});

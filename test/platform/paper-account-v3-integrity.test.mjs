import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {bootstrapPaperAccountV3} from '../../dist/platform/storage/paper-account-v3-bootstrap.js';
import {paperAccountV2EventHash,serializeSylphJcs1} from '../../dist/platform/storage/paper-account-v3-codec.js';
import {initializePaperAccountV3Schema} from '../../dist/platform/storage/paper-account-v3-schema.js';
const testDistRoot=process.env.PAPER_ACCOUNT_V3_TEST_DIST;
const integrityModule=testDistRoot?pathToFileURL(join(testDistRoot,'platform/storage/paper-account-v3-integrity.js')).href:
  new URL('../../dist/platform/storage/paper-account-v3-integrity.js',import.meta.url).href;
const {verifyPaperAccountV3JournalIntegrity,verifyPaperAccountV3JournalIntegrityInSnapshot}=await import(integrityModule);
import {verifyPaperAccountV3JournalIntegrity as verifyMaterializedOracle} from './helpers/paper-account-v3-integrity-materialized-oracle.mjs';
const KNOWN_DIAGNOSTIC_BOUND=42;

async function withDb(t,run) {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-journal-integrity-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const path=join(folder,'journal.sqlite');const db=new DatabaseSync(path,{timeout:5000});
  initializePaperAccountV3Schema(db);
  try {await run(db,path);} finally {db.close();}
}
function genesis(accountId,generationId,priorGenerationId=null,createdAtMs=7) {
  return Buffer.from(serializeSylphJcs1({accountId,accountingPolicyHash:'1'.repeat(64),configHash:'2'.repeat(64),conversionPolicyHash:'3'.repeat(64),createdAtMs,
    createdBy:'operator:creator',generationId,initialCapitalUsdMicro:'123456',initialCashAvailableUsdMicro:'123456',openingCashUsdMicro:'123456',
    origin:'EXPLICIT_OPERATOR_GENESIS',priorGenerationId,reason:`genesis ${generationId}`,riskPolicyHash:'4'.repeat(64),schemaVersion:2,
    simulatorBuildHash:'5'.repeat(64),simulatorReportSchema:'fill-report-v1',tokenMetadataPolicyHash:'6'.repeat(64)}));
}
function makeEvent({accountId='acct',generationId='gen1',eventId,eventType,payloadVersion=1,accountSequence,generationSequence,ownerEpoch=0,occurredAtMs=10,
  recordedAtMs=10,payload,previousEventSha256}) {
  const envelope={accountId,generationId,eventId,eventType,payloadVersion,accountSequence,generationSequence,ownerEpoch,occurredAtMs,recordedAtMs,
    payloadBytes:Buffer.from(serializeSylphJcs1(payload)),previousEventSha256};
  return {...envelope,...paperAccountV2EventHash(envelope)};
}
function insertEvent(db,event) {
  db.prepare(`INSERT INTO pa2_events(account_id,generation_id,event_id,account_sequence,generation_sequence,event_type,payload_version,command_id,owner_epoch,
    occurred_at_ms,recorded_at_ms,payload_bytes,payload_sha256,previous_event_sha256,event_sha256) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)`)
    .run(event.accountId,event.generationId,event.eventId,event.accountSequence,event.generationSequence,event.eventType,event.payloadVersion,event.ownerEpoch,
      event.occurredAtMs,event.recordedAtMs,event.payloadBytes,event.payloadSha256,event.previousEventSha256,event.eventSha256);
}
function enableEventMutation(db,sql) {
  db.exec('DROP TRIGGER pa2_events_no_update');
  try {sql();} finally {db.exec("CREATE TRIGGER pa2_events_no_update BEFORE UPDATE ON pa2_events BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;");}
}
function rewriteStoredEvent(db,sequence,payload,previousEventSha256=null) {
  const row=db.prepare('SELECT * FROM pa2_events WHERE account_sequence=?').get(sequence);
  const event=makeEvent({accountId:row.account_id,generationId:row.generation_id,eventId:row.event_id,eventType:row.event_type,
    accountSequence:row.account_sequence,generationSequence:row.generation_sequence,ownerEpoch:row.owner_epoch,occurredAtMs:row.occurred_at_ms,
    recordedAtMs:row.recorded_at_ms,payload,previousEventSha256:previousEventSha256??row.previous_event_sha256});
  db.prepare('UPDATE pa2_events SET payload_bytes=?,payload_sha256=?,previous_event_sha256=?,event_sha256=? WHERE account_sequence=?')
    .run(event.payloadBytes,event.payloadSha256,event.previousEventSha256,event.eventSha256,sequence);
  return event;
}
function insertGeneration(db,bytes) {
  const g=JSON.parse(bytes.toString('utf8'));
  db.prepare(`INSERT INTO pa2_generations(account_id,generation_id,genesis_json,genesis_sha256,schema_version,created_at_ms,created_by,reason,prior_generation_id,origin,
    initial_capital_usd_micro,opening_cash_usd_micro,initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,
    simulator_build_hash,simulator_report_schema,token_metadata_policy_hash,generation_state)
    VALUES(?,?,?,?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`)
    .run(g.accountId,g.generationId,bytes,createGenesisHash(bytes),g.createdAtMs,g.createdBy,g.reason,g.priorGenerationId,g.origin,g.initialCapitalUsdMicro,
      g.openingCashUsdMicro,g.initialCashAvailableUsdMicro,g.accountingPolicyHash,g.riskPolicyHash,g.configHash,g.conversionPolicyHash,g.simulatorBuildHash,
      g.simulatorReportSchema,g.tokenMetadataPolicyHash);
}
function createGenesisHash(bytes) {
  const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);
  return createHash('sha256').update(Buffer.concat([Buffer.from('SYLPH-PAPER-ACCOUNT-GENESIS-V2\0','ascii'),length,bytes])).digest('hex');
}

function creationPayload(bytes) {
  const g=JSON.parse(bytes.toString('utf8'));
  return {accountingPolicyHash:g.accountingPolicyHash,configHash:g.configHash,conversionPolicyHash:g.conversionPolicyHash,createdBy:g.createdBy,
    genesisSha256:createGenesisHash(bytes),initialCapitalUsdMicro:g.initialCapitalUsdMicro,openingCashUsdMicro:g.openingCashUsdMicro,origin:g.origin,
    priorGenerationId:g.priorGenerationId,reason:g.reason,riskPolicyHash:g.riskPolicyHash,schemaVersion:2,simulatorBuildHash:g.simulatorBuildHash,
    simulatorReportSchema:g.simulatorReportSchema,tokenMetadataPolicyHash:g.tokenMetadataPolicyHash};
}
function seededTwoGenerations(db) {
  const root=genesis('acct','gen1');
  bootstrapPaperAccountV3(db,root,'test-operator',10);
  const firstHash=db.prepare('SELECT event_sha256 FROM pa2_events WHERE account_sequence=2').get().event_sha256;
  const acquired=makeEvent({eventId:'11111111-1111-4111-8111-111111111111',eventType:'OWNER_ACQUIRED',accountSequence:3,generationSequence:3,ownerEpoch:1,
    payload:{reason:'test integrity fixture'},previousEventSha256:firstHash});
  insertEvent(db,acquired);
  const child=genesis('acct','gen2','gen1',8);insertGeneration(db,child);
  const created=makeEvent({generationId:'gen2',eventId:'22222222-2222-4222-8222-222222222222',eventType:'GENERATION_CREATED',accountSequence:4,generationSequence:1,
    ownerEpoch:1,payload:creationPayload(child),previousEventSha256:acquired.eventSha256});
  insertEvent(db,created);
  const future=makeEvent({generationId:'gen2',eventId:'33333333-3333-4333-8333-333333333333',eventType:'FUTURE_UNRECOGNIZED',accountSequence:5,generationSequence:2,
    ownerEpoch:1,payload:{opaque:'held'},previousEventSha256:created.eventSha256});
  insertEvent(db,future);
  return {root,child,acquired,created,future};
}
function resultOf(run) {
  try {return {ok:true,value:run()};} catch(error) {return {ok:false,code:error?.message};}
}
function assertDifferential(db) {
  const oracle=resultOf(()=>verifyMaterializedOracle(db));
  const streamed=resultOf(()=>verifyPaperAccountV3JournalIntegrity(db));
  assert.equal(streamed.ok,oracle.ok,'streamed and materialized verifier outcomes must agree');
  if(!oracle.ok)assert.equal(streamed.code,oracle.code,'streamed verifier must preserve the oracle failure code');
  else {
    assert.equal(streamed.value.accountCount,oracle.value.accountCount);
    assert.equal(streamed.value.eventCount,oracle.value.eventCount);
    assert.deepEqual(streamed.value.accounts,oracle.value.accounts);
    assert.deepEqual(streamed.value.unsupportedEventTypes,oracle.value.unsupportedEventTypes);
  }
}
function instrumentDb(db) {
  const observed={allHistory:[],preflightSeen:false,rawBlobSelects:[],iteratedHistory:[]};
  const history=/\bFROM\s+pa2_(?:accounts|generations|events)\b/i;
  return {observed,db:new Proxy(db,{get(target,property) {
    if(property==='prepare')return sql=>{
      const statement=target.prepare(sql);const isHistory=history.test(sql);
      return new Proxy(statement,{get(inner,method) {
        if(method==='all'&&isHistory)return ()=>{observed.allHistory.push(sql);throw new Error('TEST_HISTORY_ALL_FORBIDDEN');};
        if(method==='get')return (...args)=>{
          if(/octet_length\((?:genesis_json|payload_bytes)\)/i.test(sql))observed.preflightSeen=true;
          if(/SELECT[\s\S]*\b(?:genesis_json|payload_bytes)\b[\s\S]*FROM\s+pa2_(?:generations|events)/i.test(sql)) {
            observed.rawBlobSelects.push(sql);
            if(!observed.preflightSeen)throw new Error('TEST_RAW_BLOB_BEFORE_PREFLIGHT');
          }
          return inner.get(...args);
        };
        if(method==='iterate'&&isHistory)observed.iteratedHistory.push(sql);
        const value=Reflect.get(inner,method,inner);return typeof value==='function'?value.bind(inner):value;
      }});
    };
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }})};
}

test('read-only integrity verifies canonical journal across generation boundary but never claims semantics/readiness',async t=>{
  await withDb(t,db=>{
    const {future}=seededTwoGenerations(db);
    const before=db.prepare('SELECT account_id,generation_id,event_id,account_sequence,generation_sequence,event_sha256 FROM pa2_events ORDER BY account_id,account_sequence').all();
    assertDifferential(db);
    const result=verifyPaperAccountV3JournalIntegrity(db);
    assert.equal(result.integrityVerified,true);
    assert.equal(result.semanticsVerified,false);
    assert.equal(result.admissionEligible,false);
    assert.equal(result.held,true);
    assert.equal(result.accountCount,1);assert.equal(result.eventCount,5);
    assert.deepEqual(result.accounts,[{accountId:'acct',eventCount:5,generationCount:2,firstAccountSequence:1,lastAccountSequence:5,lastEventSha256:future.eventSha256}]);
    assert.deepEqual(result.unsupportedEventTypes,[
      {eventType:'FUTURE_UNRECOGNIZED',payloadVersion:1,classification:'UNKNOWN_UNSUPPORTED'},
      {eventType:'OWNER_ACQUIRED',payloadVersion:1,classification:'KNOWN_SEMANTICS_UNVERIFIED'},
    ]);
    assert.equal(result.unsupportedEventRowCount,2);
    assert.equal(result.knownSemanticsUnverifiedEventRowCount,1);
    assert.equal(result.unknownUnsupportedEventRowCount,1);
    assert.equal(result.unsupportedEventTypesTruncated,false);
    assert.equal(result.accountsTruncated,false);
    assert.match(result.accountSummarySha256,/^[0-9a-f]{64}$/);
    assert.match(result.unsupportedEventRowsSha256,/^[0-9a-f]{64}$/);
    assert.deepEqual(db.prepare('SELECT account_id,generation_id,event_id,account_sequence,generation_sequence,event_sha256 FROM pa2_events ORDER BY account_id,account_sequence').all(),before);
  });
});

test('journal verification uses an owned snapshot; in-snapshot helper neither starts nor closes it',async t=>{
  await withDb(t,db=>{
    seededTwoGenerations(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrityInSnapshot(db),/PAPER_ACCOUNT_V3_JOURNAL_SNAPSHOT_TRANSACTION_REQUIRED/);
    db.exec('BEGIN DEFERRED');
    const result=verifyPaperAccountV3JournalIntegrityInSnapshot(db);
    assert.equal(result.held,true);assert.equal(db.isTransaction,true);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_SNAPSHOT_ALREADY_ACTIVE/);
    db.exec('COMMIT');assert.equal(db.isTransaction,false);
    enableEventMutation(db,()=>db.prepare('UPDATE pa2_events SET account_sequence=10 WHERE account_sequence=3').run());
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP/);
    assert.equal(db.isTransaction,false,'owned snapshot must roll back on verifier error');
  });
});

test('event identity is account-scoped: identical event IDs across accounts remain valid',async t=>{
  await withDb(t,db=>{
    bootstrapPaperAccountV3(db,genesis('acct-a','root'),'test-operator',10);
    const accountA=db.prepare("SELECT event_id FROM pa2_events WHERE account_id='acct-a' ORDER BY account_sequence").all();
    const bytes=genesis('acct-b','root');
    db.prepare(`INSERT INTO pa2_accounts(account_id,active_generation_id,admission_state,owner_id,owner_epoch,lease_id,lease_until_ms,lease_renewed_at_ms,
      state_version,stop_epoch,emergency_stop_id,emergency_stop_sha256) VALUES('acct-b',NULL,'BLOCKED',NULL,0,NULL,NULL,NULL,2,0,NULL,NULL)`).run();
    insertGeneration(db,bytes);
    const g=JSON.parse(bytes.toString('utf8'));const gsha=createGenesisHash(bytes);
    const first=makeEvent({accountId:'acct-b',generationId:'root',eventId:accountA[0].event_id,eventType:'ACCOUNT_BOOTSTRAPPED',accountSequence:1,generationSequence:1,
      ownerEpoch:0,occurredAtMs:g.createdAtMs,recordedAtMs:10,payload:{accountId:'acct-b',bootstrapOrigin:g.origin,generationId:'root',genesisFingerprint:gsha,
        operatorAuthorization:'test-operator'},previousEventSha256:'0'.repeat(64)});
    const second=makeEvent({accountId:'acct-b',generationId:'root',eventId:accountA[1].event_id,eventType:'GENERATION_CREATED',accountSequence:2,generationSequence:2,
      ownerEpoch:0,occurredAtMs:g.createdAtMs,recordedAtMs:11,payload:creationPayload(bytes),previousEventSha256:first.eventSha256});
    insertEvent(db,first);insertEvent(db,second);
    assert.equal(db.prepare('SELECT count(*) AS count FROM pa2_events a JOIN pa2_events b ON a.event_id=b.event_id AND a.account_id<>b.account_id').get().count,4);
    assertDifferential(db);
    assert.equal(verifyPaperAccountV3JournalIntegrity(db).accountCount,2);
  });
});

test('bounded adapter forbids history .all() and rejects an oversized BLOB before raw byte selection',async t=>{
  await withDb(t,db=>{
    seededTwoGenerations(db);
    const observed=instrumentDb(db);
    const result=verifyPaperAccountV3JournalIntegrity(observed.db);
    assert.equal(result.integrityVerified,true);
    assert.deepEqual(observed.observed.allHistory,[]);
    assert.ok(observed.observed.iteratedHistory.some(sql=>/pa2_events/i.test(sql)));
    assert.ok(observed.observed.preflightSeen);
    enableEventMutation(db,()=>db.prepare('UPDATE pa2_events SET payload_bytes=? WHERE account_sequence=3').run(Buffer.alloc(1_048_577,0x61)));
    const oversized=instrumentDb(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(oversized.db),/PAPER_ACCOUNT_V3_JOURNAL_PAYLOAD_BLOB_TOO_LARGE/);
    assert.deepEqual(oversized.observed.rawBlobSelects,[],'oversized payload must be rejected before any event BLOB projection');
    assert.deepEqual(oversized.observed.allHistory,[]);
    assert.equal(db.isTransaction,false);
  });
});

test('unsupported diagnostics stay bounded and an omitted tail future type remains explicitly held',async t=>{
  await withDb(t,db=>{
    const {future}=seededTwoGenerations(db);let previous=future.eventSha256;let accountSequence=6;let generationSequence=3;
    for(let i=0;i<19;i++) {
      const event=makeEvent({generationId:'gen2',eventId:`${String(i+10).padStart(8,'0')}-3333-4333-8333-333333333333`,
        eventType:i===18?'FUTURE_TYPE_AFTER_DIAGNOSTIC_SAMPLE':`FUTURE_TYPE_${String(i).padStart(2,'0')}`,
        accountSequence:accountSequence++,generationSequence:generationSequence++,ownerEpoch:1,payload:{opaque:i},previousEventSha256:previous});
      insertEvent(db,event);previous=event.eventSha256;
    }
    const result=verifyPaperAccountV3JournalIntegrity(db);
    assert.equal(result.unknownUnsupportedEventRowCount,20);
    assert.equal(result.unsupportedEventTypesTruncated,true);
    assert.ok(result.unsupportedEventTypes.length<=KNOWN_DIAGNOSTIC_BOUND);
    assert.ok(!result.unsupportedEventTypes.some(x=>x.eventType==='FUTURE_TYPE_AFTER_DIAGNOSTIC_SAMPLE'));
    assert.equal(result.held,true);assert.equal(result.admissionEligible,false);assert.equal(result.semanticsVerified,false);
  });
});

test('known-family version diagnostics mark truncation for v2→v1 and v1→v2 histories',async t=>{
  await withDb(t,db=>{
    bootstrapPaperAccountV3(db,genesis('acct','root'),'test-operator',10);
    const previous=db.prepare('SELECT event_sha256 FROM pa2_events ORDER BY account_sequence DESC LIMIT 1').get().event_sha256;
    const v2=makeEvent({generationId:'root',eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',eventType:'CAPITAL_ADJUSTED',payloadVersion:2,
      accountSequence:3,generationSequence:3,ownerEpoch:1,payload:{opaque:'v2-first'},previousEventSha256:previous});insertEvent(db,v2);
    const v1=makeEvent({generationId:'root',eventId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',eventType:'CAPITAL_ADJUSTED',payloadVersion:1,
      accountSequence:4,generationSequence:4,ownerEpoch:1,payload:{opaque:'v1-second'},previousEventSha256:v2.eventSha256});insertEvent(db,v1);
    const reverseOrder=verifyPaperAccountV3JournalIntegrity(db);
    assert.equal(reverseOrder.integrityVerified,true,'successful result proves both event hashes and sequence links are valid');
    assert.equal(reverseOrder.unsupportedEventTypesTruncated,true,'v2 followed by v1 is a second known-family version');
    assert.equal(reverseOrder.unknownUnsupportedEventRowCount,1);
    assert.equal(reverseOrder.knownSemanticsUnverifiedEventRowCount,1);
  });
  await withDb(t,db=>{
    const {future}=seededTwoGenerations(db);
    const v2=makeEvent({generationId:'gen2',eventId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',eventType:'OWNER_ACQUIRED',payloadVersion:2,
      accountSequence:6,generationSequence:3,ownerEpoch:1,payload:{opaque:'v2-second'},previousEventSha256:future.eventSha256});insertEvent(db,v2);
    const result=verifyPaperAccountV3JournalIntegrity(db);
    assert.equal(result.integrityVerified,true,'successful result proves both event hashes and sequence links are valid');
    assert.equal(result.unsupportedEventTypesTruncated,true,'v1 followed by v2 is a second known-family version');
    assert.equal(result.unknownUnsupportedEventRowCount,2);
    assert.equal(result.knownSemanticsUnverifiedEventRowCount,1);
  });
});

test('integrity rejects noncanonical payload bytes even before interpreting event semantics',async t=>{
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>db.prepare("UPDATE pa2_events SET payload_bytes=? WHERE account_sequence=3").run(Buffer.from('{ "reason":"test integrity fixture"}')));
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_PAYLOAD_NONCANONICAL/);
  });
});

test('integrity rejects account sequence gaps and reordered rows',async t=>{
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>db.prepare('UPDATE pa2_events SET account_sequence=10 WHERE account_sequence=3').run());
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP/);
  });
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>{
      db.prepare('UPDATE pa2_events SET account_sequence=13 WHERE account_sequence=3').run();
      db.prepare('UPDATE pa2_events SET account_sequence=3 WHERE account_sequence=4').run();
      db.prepare('UPDATE pa2_events SET account_sequence=4 WHERE account_sequence=13').run();
    });
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP/);
  });
});

test('integrity rejects generation sequence gaps, broken cross-generation hash links, and genesis mismatch',async t=>{
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>db.prepare('UPDATE pa2_events SET generation_sequence=3 WHERE account_sequence=4').run());
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_GENERATION_SEQUENCE_GAP/);
  });
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>db.prepare("UPDATE pa2_events SET previous_event_sha256=? WHERE account_sequence=4").run('0'.repeat(64)));
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP/);
  });
  await withDb(t,db=>{
    seededTwoGenerations(db);
    db.exec('DROP TRIGGER pa2_genesis_no_update');
    db.prepare("UPDATE pa2_generations SET genesis_sha256=? WHERE generation_id='gen2'").run('f'.repeat(64));
    db.exec("CREATE TRIGGER pa2_genesis_no_update BEFORE UPDATE OF genesis_json,genesis_sha256,schema_version,created_at_ms,created_by,reason,prior_generation_id,origin,initial_capital_usd_micro,opening_cash_usd_micro,initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,simulator_build_hash,simulator_report_schema,token_metadata_policy_hash ON pa2_generations BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;");
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH/);
  });
  await withDb(t,db=>{
    seededTwoGenerations(db);
    enableEventMutation(db,()=>{
      const original=JSON.parse(Buffer.from(db.prepare('SELECT payload_bytes FROM pa2_events WHERE account_sequence=4').get().payload_bytes).toString('utf8'));
      const changed=rewriteStoredEvent(db,4,{...original,genesisSha256:'f'.repeat(64)});
      const following=JSON.parse(Buffer.from(db.prepare('SELECT payload_bytes FROM pa2_events WHERE account_sequence=5').get().payload_bytes).toString('utf8'));
      rewriteStoredEvent(db,5,following,changed.eventSha256);
    });
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_GENESIS_COMMITMENT_MISMATCH/);
  });
});

test('integrity rejects zero epoch outside the exact two-event bootstrap and incomplete/mismatched genesis prefixes',async t=>{
  await withDb(t,db=>{
    const root=genesis('acct','gen1');bootstrapPaperAccountV3(db,root,'test-operator',10);
    const previous=db.prepare('SELECT event_sha256 FROM pa2_events WHERE account_sequence=2').get().event_sha256;
    insertEvent(db,makeEvent({eventId:'11111111-1111-4111-8111-111111111111',eventType:'OWNER_ACQUIRED',accountSequence:3,generationSequence:3,
      ownerEpoch:0,payload:{reason:'zero epoch tamper'},previousEventSha256:previous}));
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ZERO_OWNER_EPOCH_INVALID/);
  });
  await withDb(t,db=>{
    bootstrapPaperAccountV3(db,genesis('acct','gen1'),'test-operator',10);db.exec('DROP TRIGGER pa2_events_no_delete');
    db.prepare('DELETE FROM pa2_events WHERE account_sequence=2').run();
    db.exec("CREATE TRIGGER pa2_events_no_delete BEFORE DELETE ON pa2_events BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END;");
    assertDifferential(db);
    assert.throws(()=>verifyPaperAccountV3JournalIntegrity(db),/PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_PREFIX_MISSING/);
  });
});

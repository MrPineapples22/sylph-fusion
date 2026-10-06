import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {bootstrapPaperAccountV3} from '../../dist/platform/storage/paper-account-v3-bootstrap.js';
import {paperAccountV2EventHash,serializeSylphJcs1} from '../../dist/platform/storage/paper-account-v3-codec.js';
import {initializePaperAccountV3Schema} from '../../dist/platform/storage/paper-account-v3-schema.js';
const testDistRoot=process.env.PAPER_ACCOUNT_V3_TEST_DIST;
const ownerSpecifier=testDistRoot?pathToFileURL(join(testDistRoot,'platform/storage/paper-account-v3-owner-integrity.js')).href:
  new URL('../../dist/platform/storage/paper-account-v3-owner-integrity.js',import.meta.url).href;
const commandSpecifier=testDistRoot?pathToFileURL(join(testDistRoot,'platform/storage/paper-account-v3-command-integrity.js')).href:
  new URL('../../dist/platform/storage/paper-account-v3-command-integrity.js',import.meta.url).href;
const {verifyPaperAccountV3OwnerEventConsistencyInSnapshot}=await import(ownerSpecifier);
const {verifyPaperAccountV3CommandLifecycleConsistency}=await import(commandSpecifier);

const sha=value=>createHash('sha256').update(value).digest('hex');
const ids={owner:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',lock:'33333333-3333-4333-8333-333333333333',
  command:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fill:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
const H={config:'1'.repeat(64),risk:'2'.repeat(64),evidence:'3'.repeat(64),quote:'4'.repeat(64),build:'5'.repeat(64),token:'6'.repeat(64)};

async function withDb(t,run) {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-command-integrity-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const db=new DatabaseSync(join(folder,'command.sqlite'),{timeout:5000});initializePaperAccountV3Schema(db);
  try {await run(db);} finally {db.close();}
}
function observeRawBlobSelects(db) {
  const blobColumns=['genesis_json','payload_bytes','request_bytes','accepted_evidence_bytes','frozen_quote_bytes','terminal_result_bytes',
    'simulator_request_bytes','report_bytes','telemetry_bytes'];
  const rawBlobSelects=[];const sql=[];const preflightQueries=[];
  return {rawBlobSelects,sql,preflightQueries,get isTransaction(){return db.isTransaction;},exec(statement){sql.push(statement);return db.exec(statement);},prepare(statement){
    sql.push(statement);const selected=/\bselect\b([\s\S]*?)\bfrom\b/i.exec(statement)?.[1]??'';
    const projections=selected.split(',').map(part=>part.trim());
    if(projections.some(part=>blobColumns.some(column=>new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*\\.)?${column}(?:\\s+AS\\s+[A-Za-z_][A-Za-z0-9_]*)?$`,'i').test(part))))rawBlobSelects.push(statement);
    const preflight=/^\s*SELECT\s+1\s+AS\s+oversized\s+FROM\s+pa2_(generations|events|commands|simulation_reports)\b/i.exec(statement);
    const prepared=db.prepare(statement);
    if(!preflight)return prepared;
    const observation={table:preflight[1],statement,getCalls:0,allCalls:0};preflightQueries.push(observation);
    return {get(...args){observation.getCalls++;return prepared.get(...args);},all(...args){observation.allCalls++;return prepared.all(...args);}};
  }};
}
function genesis() {
  return Buffer.from(serializeSylphJcs1({accountId:'acct',accountingPolicyHash:H.config,configHash:H.config,conversionPolicyHash:H.config,createdAtMs:7,
    createdBy:'operator:creator',generationId:'gen1',initialCapitalUsdMicro:'1000000',initialCashAvailableUsdMicro:'1000000',openingCashUsdMicro:'1000000',
    origin:'EXPLICIT_OPERATOR_GENESIS',priorGenerationId:null,reason:'test genesis',riskPolicyHash:H.risk,schemaVersion:2,simulatorBuildHash:H.build,
    simulatorReportSchema:'fill-report-v1',tokenMetadataPolicyHash:H.token}));
}
function event(db,{type,payload,epoch=1,commandId=null,occurredAtMs=20,recordedAtMs=20,payloadVersion=1}) {
  const prior=db.prepare('SELECT account_sequence,generation_sequence,event_sha256 FROM pa2_events WHERE account_id=? ORDER BY account_sequence DESC LIMIT 1').get('acct');
  const accountSequence=Number(prior.account_sequence)+1;
  const generationSequence=Number(db.prepare('SELECT COALESCE(MAX(generation_sequence),0)+1 AS n FROM pa2_events WHERE account_id=? AND generation_id=?').get('acct','gen1').n);
  const value={accountId:'acct',generationId:'gen1',eventId:`${String(accountSequence).padStart(8,'0')}-1111-4111-8111-111111111111`,eventType:type,
    payloadVersion,accountSequence,generationSequence,ownerEpoch:epoch,occurredAtMs,recordedAtMs,payloadBytes:Buffer.from(serializeSylphJcs1(payload)),
    previousEventSha256:prior.event_sha256};
  const hashed={...value,...paperAccountV2EventHash(value)};
  db.prepare(`INSERT INTO pa2_events(account_id,generation_id,event_id,account_sequence,generation_sequence,event_type,payload_version,command_id,owner_epoch,
    occurred_at_ms,recorded_at_ms,payload_bytes,payload_sha256,previous_event_sha256,event_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(hashed.accountId,hashed.generationId,hashed.eventId,hashed.accountSequence,hashed.generationSequence,hashed.eventType,hashed.payloadVersion,commandId,
      hashed.ownerEpoch,hashed.occurredAtMs,hashed.recordedAtMs,hashed.payloadBytes,hashed.payloadSha256,hashed.previousEventSha256,hashed.eventSha256);
  return hashed;
}
function prepareAccount(db) {
  bootstrapPaperAccountV3(db,genesis(),'test-operator',10);
  event(db,{type:'OWNER_ACQUIRED',payload:{acquiredAtMs:10,activationRequestFingerprint:'a'.repeat(64),authorizationId:'44444444-4444-4444-8444-444444444444',
    clockObservation:{bootId:'boot-A',monotonicNanoseconds:'10000000',sourceId:'clock-A',synchronized:true,uncertaintyMs:0,wallUnixMs:10},leaseDurationMs:30000,
    leaseExpiresAtMs:30010,newEpoch:1,newLeaseId:ids.lease,newOwnerId:ids.owner,priorEpoch:0,priorLeaseId:null,priorOwnerId:null,
    processLockIdentity:{hostId:'host-A',lockNonce:ids.lock,pid:42,processStartToken:'start-token-A'},reason:'INITIAL_ACTIVATION'}});
  db.prepare('UPDATE pa2_accounts SET owner_id=?,owner_epoch=1,lease_id=?,lease_until_ms=30010,lease_renewed_at_ms=10 WHERE account_id=?').run(ids.owner,ids.lease,'acct');
  event(db,{type:'ACTIVATION_AUTHORIZATION_RESERVED',payload:{opaque:true},occurredAtMs:11,recordedAtMs:11});
  event(db,{type:'GENERATION_ACTIVATED',payload:{opaque:true},occurredAtMs:12,recordedAtMs:12});
  db.prepare("UPDATE pa2_generations SET generation_state='ACTIVE' WHERE account_id='acct' AND generation_id='gen1'").run();
  db.prepare("UPDATE pa2_accounts SET active_generation_id='gen1' WHERE account_id='acct'").run();
}
function eventPayload(db,type,commandId) {
  const row=db.prepare('SELECT event_sha256 FROM pa2_events WHERE event_type=? AND command_id=?').get(type,commandId);
  assert.ok(row,`expected ${type}`);return row.event_sha256;
}
function commandFields({terminalState='ACCEPTED',terminalBytes=null,terminalHash=null,orderId=undefined,requestOverride=null}={}) {
  const request={mint:'mint-A',poolAddress:'pool-A',side:'BUY'};
  if(orderId!==undefined)request.orderId=orderId;
  const requestBytes=requestOverride??Buffer.from(serializeSylphJcs1(request));
  const parsed=JSON.parse(Buffer.from(requestBytes).toString('utf8'));
  return {requestBytes,requestHash:sha(requestBytes),economicId:typeof parsed.orderId==='string'&&parsed.orderId!==''?parsed.orderId:ids.command,
    terminalState,terminalBytes,terminalHash};
}
const acceptedData=({economicId=ids.command}={})=>({acceptedEvidenceSha256:H.evidence,amountLamports:'1000',amountTokenRaw:'0',amountUsdMicro:'100',commandId:ids.command,
  commandType:'SUBMIT_ORDER',configSha256:H.config,economicOrderId:economicId,frozenQuoteSha256:H.quote,initiator:'operator:test',mint:'mint-A',poolId:'pool-A',
  requestSha256:'0'.repeat(64),reservationCashUsdMicro:'100',reservationFeeBufferLamports:'5',reservationKind:'BUY_CASH',reservationPositionLotId:null,
  reservationTokenQtyRaw:'0',riskPolicySha256:H.risk,seedIdentity:'seed-1',side:'BUY',simulatorBuildHash:H.build,simulatorReportSchema:'fill-report-v1',tokenDecimals:9});
function insertCommand(db,{state='ACCEPTED',orderId=undefined,requestOverride=null,terminalBytes=null,terminalHash=null}={}) {
  const values=commandFields({terminalState:state,terminalBytes,terminalHash,orderId,requestOverride});
  const evidence=Buffer.from(serializeSylphJcs1({evidence:'entry'}));const quote=Buffer.from(serializeSylphJcs1({quote:'frozen'}));
  const next=Number(db.prepare('SELECT COALESCE(MAX(account_sequence),0)+1 AS n FROM pa2_events WHERE account_id=?').get('acct').n);
  const genNext=Number(db.prepare('SELECT COALESCE(MAX(generation_sequence),0)+1 AS n FROM pa2_events WHERE account_id=? AND generation_id=?').get('acct','gen1').n);
  const cols=['account_id','generation_id','command_id','economic_order_id','initiator','command_type','pool_id','mint','side','token_decimals','request_bytes','request_sha256',
    'config_sha256','risk_policy_sha256','accepted_evidence_bytes','accepted_evidence_sha256','frozen_quote_bytes','frozen_quote_sha256','amount_usd_micro','amount_lamports',
    'amount_token_raw','accepted_account_sequence','accepted_generation_sequence','command_state','terminal_result_bytes','terminal_result_sha256'];
  const vals=['acct','gen1',ids.command,values.economicId,'operator:test','SUBMIT_ORDER','pool-A','mint-A','BUY',9,values.requestBytes,values.requestHash,H.config,H.risk,
    evidence,sha(evidence),quote,sha(quote),'100','1000','0',next,genNext,state,terminalBytes,terminalHash];
  db.prepare(`INSERT INTO pa2_commands(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...vals);
  const resCols=['account_id','generation_id','command_id','reservation_kind','cash_usd_micro','position_lot_id','token_qty_raw','fee_buffer_lamports','creating_generation_sequence','reservation_state'];
  db.prepare(`INSERT INTO pa2_reservations(${resCols.join(',')}) VALUES(${resCols.map(()=>'?').join(',')})`).run('acct','gen1',ids.command,'BUY_CASH','100',null,'0','5',genNext,
    state==='SETTLED'?'CONSUMED':state==='REJECTED'?'RELEASED':state==='UNRESOLVED'||state==='MANUALLY_RESOLVED'?'UNRESOLVED_HOLD':'OPEN');
  const p=acceptedData({economicId:values.economicId});p.requestSha256=values.requestHash;p.acceptedEvidenceSha256=sha(evidence);p.frozenQuoteSha256=sha(quote);
  const accepted=event(db,{type:'COMMAND_ACCEPTED',payload:p,commandId:ids.command});
  return {accepted,values};
}
function reportBytes(status,orderId=ids.command) {
  return Buffer.from(serializeSylphJcs1({orderId,status,execPrice:status==='FILLED'?'1.25':'0',inputAmount:'1000',outputAmount:status==='FILLED'?'500':'0',
    priorityFeeLamports:'0',jitoTipLamports:'0',slotLatency:1,...(status==='FILLED'?{currentStage:'SETTLED'}:{failureReason:'STALE_STATE',currentStage:'EXPIRED'})}));
}
function telemetryBytes() {
  return Buffer.from(serializeSylphJcs1({schema:'telemetry-v1',telemetry:{engineMode:'PAPER',simulatedSlotLagMs:'0',priceImpactPct:'0',
    preTradeReserves:{sol:'1000000',token:'2000000'},postTradeReserves:{sol:'1001000',token:'1999000'}}}));
}
function appendSimulation(db,accepted,status='REJECTED',{reportOverride=null,telemetryOverride=null,requestOrderId=ids.command,rowSchemaOverride='fill-report-v1'}={}) {
  const rb=reportOverride??reportBytes(status,requestOrderId);const tb=telemetryOverride??telemetryBytes();const req=Buffer.from(serializeSylphJcs1({orderId:requestOrderId,side:'BUY'}));
  const rowCols=['account_id','generation_id','command_id','simulator_request_bytes','simulator_request_sha256','report_bytes','report_sha256','telemetry_bytes','telemetry_sha256',
    'report_schema','simulator_build_hash','seed_identity','recorded_at_ms'];
  const recordedAt=30;
  db.prepare(`INSERT INTO pa2_simulation_reports(${rowCols.join(',')}) VALUES(${rowCols.map(()=>'?').join(',')})`)
    .run('acct','gen1',ids.command,req,sha(req),rb,sha(rb),tb,sha(tb),rowSchemaOverride,H.build,'seed-1',recordedAt);
  const p={acceptedEventSha256:accepted.eventSha256,commandId:ids.command,commandRequestSha256:db.prepare('SELECT request_sha256 FROM pa2_commands WHERE command_id=?').get(ids.command).request_sha256,reportSchema:'fill-report-v1',
    reportSha256:sha(rb),reportStatus:status,seedIdentity:'seed-1',simulatorBuildHash:H.build,simulatorRequestSha256:sha(req),telemetrySha256:sha(tb)};
  return event(db,{type:'SIMULATED',payload:p,commandId:ids.command,occurredAtMs:recordedAt,recordedAtMs:recordedAt});
}
function terminalBytes() {return Buffer.from(serializeSylphJcs1({commandId:ids.command,success:false,state:'REJECTED'}));}
function finishSimulationRejected(db,simulated,status='REJECTED') {
  const bytes=terminalBytes();db.prepare("UPDATE pa2_commands SET command_state='REJECTED',terminal_result_bytes=?,terminal_result_sha256=? WHERE command_id=?").run(bytes,sha(bytes),ids.command);
  db.prepare("UPDATE pa2_reservations SET reservation_state='RELEASED' WHERE command_id=?").run(ids.command);
  return event(db,{type:'SIMULATION_REJECTED',commandId:ids.command,payload:{commandId:ids.command,rejectionCode:'STALE_STATE',reportSha256:db.prepare('SELECT report_sha256 FROM pa2_simulation_reports WHERE command_id=?').get(ids.command).report_sha256,
    reportStatus:status,simulatedEventSha256:simulated.eventSha256,terminalResultSha256:sha(bytes)}});
}
function resultSnapshot(db) {
  return {events:db.prepare('SELECT event_id,event_sha256,event_type,command_id FROM pa2_events ORDER BY account_sequence').all(),
    commands:db.prepare('SELECT command_id,command_state,terminal_result_sha256 FROM pa2_commands').all(),
    reports:db.prepare('SELECT command_id,report_sha256,telemetry_sha256 FROM pa2_simulation_reports').all(),fills:db.prepare('SELECT fill_id,command_id,fill_ordinal,report_sha256 FROM pa2_fills').all()};
}

test('owner in-snapshot API rejects callers without an active read transaction',async t=>{
  await withDb(t,db=>assert.throws(()=>verifyPaperAccountV3OwnerEventConsistencyInSnapshot(db),/PAPER_ACCOUNT_V3_OWNER_SNAPSHOT_TRANSACTION_REQUIRED/));
});

test('read-only command fold validates accepted lifecycle in one owner/journal snapshot and remains held',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);insertCommand(db);const before=resultSnapshot(db);const result=verifyPaperAccountV3CommandLifecycleConsistency(db);
    assert.equal(result.integrityVerified,true);assert.equal(result.ownerJournalConsistencyVerified,true);assert.equal(result.commandLifecycleConsistencyVerified,true);
    assert.ok(result.unsupportedEventTypes.some(x=>x.eventType==='GENERATION_ACTIVATED'));
    assert.equal(result.lifecycleEventsVerified,1);assert.equal(result.commandsVerified,1);assert.equal(result.reportsVerified,0);assert.equal(result.settlementsVerified,0);
    assert.equal(result.atomicityVerified,false);assert.equal(result.economicsVerified,false);assert.equal(result.semanticsVerified,false);
    assert.equal(result.admissionEligible,false);assert.equal(result.held,true);assert.equal(db.isTransaction,false);assert.deepEqual(resultSnapshot(db),before);
  });
});

test('bounded unknown-event sample cannot make downstream command lifecycle status clean',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);
    for(let i=0;i<20;i++)event(db,{type:`FUTURE_COMMAND_SCOPE_${String(i).padStart(2,'0')}`,payload:{opaque:i}});
    const result=verifyPaperAccountV3CommandLifecycleConsistency(db);
    assert.equal(result.unknownUnsupportedEventRowCount,20);
    assert.equal(result.unsupportedEventTypesTruncated,true);
    assert.ok(result.unsupportedEventTypes.length<20);
    assert.equal(result.commandLifecycleConsistencyVerified,false);
    assert.equal(result.held,true);assert.equal(result.admissionEligible,false);
  });
});

test('report and telemetry bytes are parsed and status is derived before rejection transition',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);const {accepted}=insertCommand(db,{state:'REJECTED'});const simulated=appendSimulation(db,accepted,'REJECTED');finishSimulationRejected(db,simulated);
    const result=verifyPaperAccountV3CommandLifecycleConsistency(db);assert.equal(result.reportsVerified,1);assert.equal(result.settlementsVerified,0);
    assert.equal(result.commandLifecycleConsistencyVerified,true);assert.equal(result.held,true);
  });
});

test('FILLED report settles only with exact contiguous fill references and matching row hashes',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);const terminal=Buffer.from(serializeSylphJcs1({commandId:ids.command,success:true,state:'SETTLED'}));
    const {accepted}=insertCommand(db,{state:'SETTLED',terminalBytes:terminal,terminalHash:sha(terminal)});const simulated=appendSimulation(db,accepted,'FILLED');
    const reportHash=db.prepare('SELECT report_sha256 FROM pa2_simulation_reports WHERE command_id=?').get(ids.command).report_sha256;
    const fillCols=['account_id','generation_id','fill_id','command_id','fill_ordinal','report_sha256','side','pool_id','mint','token_decimals','input_lamports','output_lamports',
      'output_token_raw','filled_at_ms','slot_latency','amm_fee_attribution_lamports','external_priority_fee_lamports','external_tip_lamports','external_base_fee_lamports',
      'quote_sha256','evidence_sha256','cash_delta_usd_micro','token_delta_raw','gross_proceeds_usd_micro','external_fees_usd_micro','closed_basis_usd_micro',
      'realized_pnl_usd_micro','trigger','lot_id','basis_remainder'];
    const fillValues=['acct','gen1',ids.fill,ids.command,0,reportHash,'BUY','pool-A','mint-A',9,'1000','0','500',30,1,'0','0','0','0',H.quote,H.evidence,'-100','500','0','0','0','0','ENTRY',null,'0'];
    db.prepare(`INSERT INTO pa2_fills(${fillCols.join(',')}) VALUES(${fillCols.map(()=>'?').join(',')})`).run(...fillValues);
    db.prepare("UPDATE pa2_reservations SET reservation_state='CONSUMED' WHERE command_id=?").run(ids.command);
    event(db,{type:'SETTLEMENT',commandId:ids.command,payload:{commandId:ids.command,fillRefs:[{fillId:ids.fill,fillOrdinal:0}],reportSha256:reportHash,
      simulatedEventSha256:simulated.eventSha256,terminalResultSha256:sha(terminal)}});
    const result=verifyPaperAccountV3CommandLifecycleConsistency(db);assert.equal(result.settlementsVerified,1);assert.equal(result.economicsVerified,false);assert.equal(result.held,true);
  });
});

test('wrong embedded report status, schema, telemetry or order identity is rejected',async t=>{
  for(const [label,options,pattern] of [
    ['status', {reportOverride:reportBytes('FILLED')},/PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_MISMATCH/],
    ['schema', {rowSchemaOverride:'fill-report-v9'},/PAPER_ACCOUNT_V3_COMMAND_REPORT_CONTEXT_MISMATCH|PAPER_ACCOUNT_V3_COMMAND_REPORT_SCHEMA_UNSUPPORTED/],
    ['telemetry', {telemetryOverride:Buffer.from(serializeSylphJcs1({schema:'telemetry-v9',telemetry:{}}))},/PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID/],
    ['economic id', {requestOrderId:'other-order'},/PAPER_ACCOUNT_V3_COMMAND_REPORT_ORDER_ID_MISMATCH/],
  ]) {
    await withDb(t,db=>{
      prepareAccount(db);const {accepted}=insertCommand(db,{state:'SIMULATED'});appendSimulation(db,accepted,'REJECTED',options);
      assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),pattern,label);
    });
  }
});

test('oversized persisted report BLOB is rejected before verifier selects any raw BLOB column',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);const {accepted}=insertCommand(db,{state:'SIMULATED'});appendSimulation(db,accepted,'REJECTED');
    const oversized=Buffer.alloc(1_048_577,0x20);
    // Corruption fixture only: temporarily bypass and then restore the immutable-row guard.
    db.exec('DROP TRIGGER pa2_reports_no_update');
    db.prepare('UPDATE pa2_simulation_reports SET report_bytes=?,report_sha256=? WHERE command_id=?')
      .run(oversized,sha(oversized),ids.command);
    db.exec("CREATE TRIGGER pa2_reports_no_update BEFORE UPDATE ON pa2_simulation_reports BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END");
    assert.equal(db.prepare('SELECT length(report_bytes) AS n FROM pa2_simulation_reports WHERE command_id=?').get(ids.command).n,1_048_577);
    const observed=observeRawBlobSelects(db);
    assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(observed),/PAPER_ACCOUNT_V3_COMMAND_REPORT_BLOB_TOO_LARGE/);
    assert.deepEqual(observed.preflightQueries.map(query=>query.table),['generations','events','commands','simulation_reports']);
    assert.ok(observed.preflightQueries.every(query=>query.getCalls===1&&query.allCalls===0));
    assert.ok(observed.preflightQueries.every(query=>/octet_length\(/i.test(query.statement)&&/LIMIT\s+1\s*$/i.test(query.statement.trim())));
    assert.ok(observed.preflightQueries.every(query=>/^\s*SELECT\s+1\s+AS\s+oversized/i.test(query.statement)));
    assert.deepEqual(observed.rawBlobSelects,[]);
  });
});

test('scalar event BLOB preflight finds a later oversized row without selecting payload bytes',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);insertCommand(db);
    const oversized=Buffer.alloc(1_048_577,0x20);
    db.exec('DROP TRIGGER pa2_events_no_update');
    db.prepare(`UPDATE pa2_events SET payload_bytes=?,payload_sha256=? WHERE event_id=(
      SELECT event_id FROM pa2_events WHERE account_id='acct' ORDER BY account_sequence DESC LIMIT 1)`)
      .run(oversized,sha(oversized));
    db.exec("CREATE TRIGGER pa2_events_no_update BEFORE UPDATE ON pa2_events BEGIN SELECT RAISE(ABORT,'PAPER_ACCOUNT_V3_APPEND_ONLY'); END");
    const eventCount=db.prepare('SELECT COUNT(*) AS n FROM pa2_events').get().n;
    assert.ok(eventCount>2,'fixture includes multiple earlier small journal rows');
    const observed=observeRawBlobSelects(db);
    assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(observed),/PAPER_ACCOUNT_V3_COMMAND_EVENT_BLOB_TOO_LARGE/);
    assert.deepEqual(observed.preflightQueries.map(query=>query.table),['generations','events']);
    assert.ok(observed.preflightQueries.every(query=>query.getCalls===1&&query.allCalls===0));
    assert.deepEqual(observed.rawBlobSelects,[]);
  });
});

test('request orderId fallback is exact and present null/non-string values fail closed',async t=>{
  for(const [request,expected] of [[{mint:'mint-A',poolAddress:'pool-A',side:'BUY'},ids.command],[{mint:'mint-A',poolAddress:'pool-A',side:'BUY',orderId:''},ids.command],
    [{mint:'mint-A',poolAddress:'pool-A',side:'BUY',orderId:' explicit '},' explicit ']]) {
    await withDb(t,db=>{
      prepareAccount(db);insertCommand(db,{orderId:request.orderId});
      assert.equal(db.prepare('SELECT economic_order_id FROM pa2_commands WHERE command_id=?').get(ids.command).economic_order_id,expected);
      const result=verifyPaperAccountV3CommandLifecycleConsistency(db);assert.equal(result.commandsVerified,1);
    });
  }
  for(const invalid of [null,0,false,42]) {
    await withDb(t,db=>{
      prepareAccount(db);const request=Buffer.from(serializeSylphJcs1({mint:'mint-A',poolAddress:'pool-A',side:'BUY',orderId:invalid}));
      insertCommand(db,{requestOverride:request});
      assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_REQUEST_ORDER_ID_INVALID/);
    });
  }
  for(const request of [{mint:'other-mint',poolAddress:'pool-A',side:'BUY'},{mint:'mint-A',poolAddress:'other-pool',side:'BUY'},{mint:'mint-A',poolAddress:'pool-A',side:'SELL'}]) {
    await withDb(t,db=>{
      prepareAccount(db);const bytes=Buffer.from(serializeSylphJcs1(request));insertCommand(db,{requestOverride:bytes});
      assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_REQUEST_IDENTITY_MISMATCH/);
    });
  }
});

test('illegal skips, wrong command column, terminal result, unresolved transition and orphan rows fail',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);const {accepted}=insertCommand(db);
    event(db,{type:'SETTLEMENT',commandId:ids.command,payload:{commandId:ids.command,fillRefs:[{fillId:ids.fill,fillOrdinal:0}],reportSha256:'a'.repeat(64),
      simulatedEventSha256:'b'.repeat(64),terminalResultSha256:'c'.repeat(64)}});
    assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_TRANSITION_WITHOUT_ACCEPTED|PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION/);
    assert.ok(accepted);
  });
  await withDb(t,db=>{
    prepareAccount(db);insertCommand(db);db.prepare("UPDATE pa2_commands SET terminal_result_bytes=?,terminal_result_sha256=? WHERE command_id=?")
      .run(Buffer.from('{}'),sha(Buffer.from('{}')),ids.command);
    assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_UNEXPECTED_TERMINAL_RESULT/);
  });
  await withDb(t,db=>{
    prepareAccount(db);const {accepted}=insertCommand(db,{state:'UNRESOLVED'});
    const unresolved=event(db,{type:'SIMULATION_OUTCOME_UNRESOLVED',commandId:ids.command,payload:{acceptedEventSha256:accepted.eventSha256,commandId:ids.command,
      errorClass:'Timeout',lastLifecycle:'SIMULATED',processIdentity:'proc',uncertaintyBoundary:'SETTLEMENT_OR_ACCOUNT_PROJECTION_COMMIT_UNKNOWN',workerIdentity:'worker'}});
    assert.ok(unresolved);assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_BOUNDARY_INVALID/);
  });
});

test('unknown journal event remains explicitly unsupported and a future command-event version fails closed',async t=>{
  await withDb(t,db=>{
    prepareAccount(db);insertCommand(db);
    event(db,{type:'FUTURE_EVENT',payload:{opaque:true},commandId:null});
    const result=verifyPaperAccountV3CommandLifecycleConsistency(db);
    assert.equal(result.commandLifecycleConsistencyVerified,false);assert.equal(result.held,true);assert.equal(result.admissionEligible,false);
    assert.ok(result.unsupportedEventTypes.some(x=>x.eventType==='FUTURE_EVENT'));
    assert.equal(result.unsupportedEventTypes.find(x=>x.eventType==='FUTURE_EVENT').classification,'UNKNOWN_UNSUPPORTED');
  });
  await withDb(t,db=>{
    prepareAccount(db);const request=Buffer.from(serializeSylphJcs1({mint:'mint-A',poolAddress:'pool-A',side:'BUY'}));
    // Construct the row at its correct sequence, then append an unsupported ACCEPTED version with otherwise valid bytes.
    const values=commandFields({requestOverride:request});
    const evidence=Buffer.from(serializeSylphJcs1({evidence:'entry'}));const quote=Buffer.from(serializeSylphJcs1({quote:'frozen'}));
    const next=Number(db.prepare('SELECT COALESCE(MAX(account_sequence),0)+1 AS n FROM pa2_events WHERE account_id=?').get('acct').n);
    const genNext=Number(db.prepare('SELECT COALESCE(MAX(generation_sequence),0)+1 AS n FROM pa2_events WHERE account_id=? AND generation_id=?').get('acct','gen1').n);
    const cols=['account_id','generation_id','command_id','economic_order_id','initiator','command_type','pool_id','mint','side','token_decimals','request_bytes','request_sha256',
      'config_sha256','risk_policy_sha256','accepted_evidence_bytes','accepted_evidence_sha256','frozen_quote_bytes','frozen_quote_sha256','amount_usd_micro','amount_lamports',
      'amount_token_raw','accepted_account_sequence','accepted_generation_sequence','command_state','terminal_result_bytes','terminal_result_sha256'];
    const vals=['acct','gen1',ids.command,ids.command,'operator:test','SUBMIT_ORDER','pool-A','mint-A','BUY',9,request,sha(request),H.config,H.risk,evidence,sha(evidence),quote,sha(quote),
      '100','1000','0',next,genNext,'ACCEPTED',null,null];
    db.prepare(`INSERT INTO pa2_commands(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...vals);
    db.prepare(`INSERT INTO pa2_reservations(account_id,generation_id,command_id,reservation_kind,cash_usd_micro,position_lot_id,token_qty_raw,fee_buffer_lamports,
      creating_generation_sequence,reservation_state) VALUES('acct','gen1',?,'BUY_CASH','100',NULL,'0','5',?,'OPEN')`).run(ids.command,genNext);
    const p=acceptedData({economicId:ids.command});p.requestSha256=sha(request);p.acceptedEvidenceSha256=sha(evidence);p.frozenQuoteSha256=sha(quote);
    event(db,{type:'COMMAND_ACCEPTED',payload:p,commandId:ids.command,payloadVersion:2});
    assert.throws(()=>verifyPaperAccountV3CommandLifecycleConsistency(db),/PAPER_ACCOUNT_V3_COMMAND_EVENT_VERSION_UNSUPPORTED/);
    assert.equal(values.economicId,ids.command);
  });
});

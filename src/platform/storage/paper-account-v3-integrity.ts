import {createHash, type Hash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalSylphJcs1Snapshot,paperAccountV2EventHash,serializeSylphJcs1,verifyPaperAccountV2BootstrapPrefix,
  verifyPaperAccountV2GenesisDocument,type PaperAccountV2JournalEvent} from './paper-account-v3-codec.js';
import {verifyPaperAccountV3Schema} from './paper-account-v3-schema.js';

const ZERO_HASH='0'.repeat(64);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PERSISTED_BLOB_BYTES=1_048_576;
const ACCOUNT_DIAGNOSTIC_SAMPLE_LIMIT=16;
const UNKNOWN_TYPE_DIAGNOSTIC_SAMPLE_LIMIT=16;
const KNOWN_EVENT_TYPES=new Set([
  'ACCOUNT_BOOTSTRAPPED','GENERATION_CREATED','ACTIVATION_AUTHORIZATION_RESERVED','GENERATION_ACTIVATED','GENERATION_SEALED',
  'OWNER_ACQUIRED','OWNER_RENEWED','OWNER_RELEASED','OWNER_FENCED','RECOVERY_HOLD','RECOVERY_RELEASED','COMMAND_ACCEPTED',
  'COMMAND_REJECTED','SIMULATED','SIMULATION_OUTCOME_UNRESOLVED','SIMULATION_REJECTED','SETTLEMENT','RISK_WATERMARK_OBSERVED',
  'RISK_WATERMARK_UNRESOLVED','COMMAND_MANUALLY_RESOLVED','CAPITAL_ADJUSTED','EMERGENCY_STOP_LATCHED',
  'EMERGENCY_STOP_CLEAR_INTENT','EMERGENCY_STOP_CLEARED','RISK_REPAIR','COMMAND_CANCELLED_BEFORE_SIMULATION'
]);
const BOOTSTRAP_EVENT_TYPES=new Set(['ACCOUNT_BOOTSTRAPPED','GENERATION_CREATED']);
const fail=(code:string):never=>{throw new Error(code);};

export interface PaperAccountV3UnsupportedEventType {
  readonly eventType:string;
  readonly payloadVersion:number;
  readonly classification:'KNOWN_SEMANTICS_UNVERIFIED'|'UNKNOWN_UNSUPPORTED';
}
export interface PaperAccountV3JournalAccountIntegrity {
  readonly accountId:string;
  readonly eventCount:number;
  readonly generationCount:number;
  readonly firstAccountSequence:1;
  readonly lastAccountSequence:number;
  readonly lastEventSha256:string;
}
export interface PaperAccountV3JournalIntegrity {
  readonly schemaVersion:3;
  readonly integrityVerified:true;
  readonly semanticsVerified:false;
  readonly admissionEligible:false;
  readonly held:true;
  readonly accountCount:number;
  readonly eventCount:number;
  /** First account summaries in account_id order. This is a bounded diagnostic sample. */
  readonly accounts:readonly PaperAccountV3JournalAccountIntegrity[];
  readonly accountsTruncated:boolean;
  readonly accountSummarySha256:string;
  /** Fixed-size known-family + unknown-family diagnostic sample. */
  readonly unsupportedEventTypes:readonly PaperAccountV3UnsupportedEventType[];
  readonly unsupportedEventTypesTruncated:boolean;
  /** Exact event-row counts; these are not distinct type/version counts. */
  readonly unsupportedEventRowCount:number;
  readonly knownSemanticsUnverifiedEventRowCount:number;
  readonly unknownUnsupportedEventRowCount:number;
  /** Hashes every unsupported event row in canonical journal order, including repeats. */
  readonly unsupportedEventRowsSha256:string;
}

type EventRow={account_id:unknown;generation_id:unknown;event_id:unknown;account_sequence_text:unknown;generation_sequence_text:unknown;
  event_type:unknown;payload_version_text:unknown;command_id:unknown;owner_epoch_text:unknown;occurred_at_ms_text:unknown;recorded_at_ms_text:unknown;
  payload_bytes:unknown;payload_sha256:unknown;previous_event_sha256:unknown;event_sha256:unknown};
type GenerationRow={account_id:unknown;generation_id:unknown;genesis_json:unknown;genesis_sha256:unknown;schema_version_text:unknown;created_at_ms_text:unknown;
  created_by:unknown;reason:unknown;prior_generation_id:unknown;origin:unknown;initial_capital_usd_micro:unknown;opening_cash_usd_micro:unknown;
  initial_cash_available_usd_micro:unknown;accounting_policy_hash:unknown;risk_policy_hash:unknown;config_hash:unknown;conversion_policy_hash:unknown;
  simulator_build_hash:unknown;simulator_report_schema:unknown;token_metadata_policy_hash:unknown};
type ValidatedGeneration={accountId:string;generationId:string;genesisBytes:Buffer;genesisSha256:string;priorGenerationId:string|null};

function safeInteger(value:unknown,code:string,min=0):number {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))return fail(code);
  const parsed=BigInt(value);
  if(parsed<BigInt(min)||parsed>BigInt(Number.MAX_SAFE_INTEGER))return fail(code);
  return Number(parsed);
}
function safeCount(value:unknown,code:string):number {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))return fail(code);
  const parsed=BigInt(value);if(parsed>BigInt(Number.MAX_SAFE_INTEGER))return fail(code);return Number(parsed);
}
function text(value:unknown,code:string):string {
  if(typeof value!=='string'||value.length===0)return fail(code);
  return value;
}
function hash(value:unknown,code:string):string {
  if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))return fail(code);
  return value;
}
function bytes(value:unknown,code:string):Buffer {
  if(!(value instanceof Uint8Array))return fail(code);
  try {return canonicalSylphJcs1Snapshot(value).bytes;} catch {return fail(code);}
}
function equalBytes(left:Uint8Array,right:Uint8Array):boolean{return Buffer.from(left).equals(Buffer.from(right));}

function validateGenerationRow(row:GenerationRow):ValidatedGeneration {
  const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
  const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
  const genesisBytes=bytes(row.genesis_json,'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_BYTES_INVALID');
  let verified;
  try {verified=verifyPaperAccountV2GenesisDocument(genesisBytes);} catch {return fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_INVALID');}
  const g=verified.genesis;
  const priorGenerationId=g.priorGenerationId;
  if(g.origin!=='EXPLICIT_OPERATOR_GENESIS'||g.accountId!==accountId||g.generationId!==generationId||
     hash(row.genesis_sha256,'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH')!==verified.genesisSha256||
     safeInteger(row.schema_version_text,'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH')!==g.schemaVersion||
     safeInteger(row.created_at_ms_text,'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH')!==g.createdAtMs||
     row.created_by!==g.createdBy||row.reason!==g.reason||row.prior_generation_id!==priorGenerationId||row.origin!==g.origin||
     row.initial_capital_usd_micro!==g.initialCapitalUsdMicro||row.opening_cash_usd_micro!==g.openingCashUsdMicro||
     row.initial_cash_available_usd_micro!==g.initialCashAvailableUsdMicro||row.accounting_policy_hash!==g.accountingPolicyHash||
     row.risk_policy_hash!==g.riskPolicyHash||row.config_hash!==g.configHash||row.conversion_policy_hash!==g.conversionPolicyHash||
     row.simulator_build_hash!==g.simulatorBuildHash||row.simulator_report_schema!==g.simulatorReportSchema||
     row.token_metadata_policy_hash!==g.tokenMetadataPolicyHash)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH');
  return {accountId,generationId,genesisBytes,genesisSha256:verified.genesisSha256,priorGenerationId};
}

function eventFromRow(row:EventRow):PaperAccountV2JournalEvent {
  const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
  const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
  const eventId=text(row.event_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
  const eventType=text(row.event_type,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
  if(!UUID.test(eventId))fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ID_INVALID');
  if(row.command_id!==null&&typeof row.command_id!=='string')fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
  const payloadBytes=bytes(row.payload_bytes,'PAPER_ACCOUNT_V3_JOURNAL_PAYLOAD_NONCANONICAL');
  return {accountId,generationId,eventId,eventType,payloadVersion:safeInteger(row.payload_version_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID',1),
    accountSequence:safeInteger(row.account_sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID',1),
    generationSequence:safeInteger(row.generation_sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID',1),
    ownerEpoch:safeInteger(row.owner_epoch_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
    occurredAtMs:safeInteger(row.occurred_at_ms_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
    recordedAtMs:safeInteger(row.recorded_at_ms_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),payloadBytes,
    previousEventSha256:hash(row.previous_event_sha256,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
    payloadSha256:hash(row.payload_sha256,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),eventSha256:hash(row.event_sha256,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID')};
}

function generationCreatedPayload(generation:ValidatedGeneration):Buffer {
  const genesis=parseGeneration(generation.genesisBytes);
  return Buffer.from(serializeSylphJcs1({accountingPolicyHash:genesis.accountingPolicyHash,configHash:genesis.configHash,
    conversionPolicyHash:genesis.conversionPolicyHash,createdBy:genesis.createdBy,genesisSha256:generation.genesisSha256,
    initialCapitalUsdMicro:genesis.initialCapitalUsdMicro,openingCashUsdMicro:genesis.openingCashUsdMicro,origin:genesis.origin,
    priorGenerationId:genesis.priorGenerationId,reason:genesis.reason,riskPolicyHash:genesis.riskPolicyHash,schemaVersion:2,
    simulatorBuildHash:genesis.simulatorBuildHash,simulatorReportSchema:genesis.simulatorReportSchema,
    tokenMetadataPolicyHash:genesis.tokenMetadataPolicyHash}));
}
function parseGeneration(genesisBytes:Uint8Array):ReturnType<typeof verifyPaperAccountV2GenesisDocument>['genesis'] {
  return verifyPaperAccountV2GenesisDocument(genesisBytes).genesis;
}

function withRows<T>(db:DatabaseSync,sql:string,visit:(row:T)=>void):void {
  const iterator=db.prepare(sql).iterate() as IterableIterator<T>;
  try {for(const row of iterator)visit(row);} finally {iterator.return?.();}
}
function framed(hashState:Hash,value:unknown):void {
  const bytes=Buffer.from(serializeSylphJcs1(value));
  if(bytes.length>0xffff_ffff)fail('PAPER_ACCOUNT_V3_JOURNAL_DIAGNOSTIC_FRAME_TOO_LARGE');
  const length=Buffer.allocUnsafe(4);length.writeUInt32BE(bytes.length);hashState.update(length);hashState.update(bytes);
}
function generationRowSql(where=''):string {
  return `SELECT account_id,generation_id,genesis_json,genesis_sha256,CAST(schema_version AS TEXT) schema_version_text,
    CAST(created_at_ms AS TEXT) created_at_ms_text,created_by,reason,prior_generation_id,origin,initial_capital_usd_micro,opening_cash_usd_micro,
    initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,simulator_build_hash,
    simulator_report_schema,token_metadata_policy_hash FROM pa2_generations ${where}`;
}

function verifyBlobBounds(db:DatabaseSync):void {
  if(db.prepare('SELECT 1 AS too_large FROM pa2_generations WHERE octet_length(genesis_json)>? LIMIT 1').get(MAX_PERSISTED_BLOB_BYTES))
    fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_BLOB_TOO_LARGE');
  if(db.prepare('SELECT 1 AS too_large FROM pa2_events WHERE octet_length(payload_bytes)>? LIMIT 1').get(MAX_PERSISTED_BLOB_BYTES))
    fail('PAPER_ACCOUNT_V3_JOURNAL_PAYLOAD_BLOB_TOO_LARGE');
}

function validateInventory(db:DatabaseSync):{accountCount:number;generationCount:number} {
  let accountCount=0;
  const accountIterator=db.prepare('SELECT account_id FROM pa2_accounts ORDER BY account_id').iterate() as IterableIterator<{account_id:unknown}>;
  try {
    for(const row of accountIterator) {
      const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_ROW_INVALID');
      const counts=db.prepare(`SELECT
        (SELECT CAST(count(*) AS TEXT) FROM pa2_generations WHERE account_id=?) generation_count_text,
        (SELECT CAST(count(*) AS TEXT) FROM pa2_generations WHERE account_id=? AND prior_generation_id IS NULL) root_count_text,
        (SELECT CAST(count(*) AS TEXT) FROM pa2_events WHERE account_id=?) event_count_text`).get(accountId,accountId,accountId) as Record<string,unknown>;
      const generations=safeCount(counts.generation_count_text,'PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
      const roots=safeCount(counts.root_count_text,'PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
      const events=safeCount(counts.event_count_text,'PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
      if(generations===0||events<2)fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_PREFIX_MISSING');
      if(roots!==1)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
      if(++accountCount>Number.MAX_SAFE_INTEGER)fail('PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
    }
  } finally {accountIterator.return?.();}
  let generationCount=0;let previousAccount:string|null=null;let rootCount=0;
  const hasGenerationEvent=db.prepare('SELECT 1 AS present FROM pa2_events WHERE account_id=? AND generation_id=? LIMIT 1');
  withRows<GenerationRow>(db,generationRowSql('ORDER BY account_id,generation_id'),row=>{
    const generation=validateGenerationRow(row);
    if(db.prepare('SELECT 1 AS present FROM pa2_accounts WHERE account_id=?').get(generation.accountId)===undefined)
      fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_IDENTITY_INVALID');
    if(hasGenerationEvent.get(generation.accountId,generation.generationId)===undefined)
      fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
    if(previousAccount!==generation.accountId) {
      if(previousAccount!==null&&rootCount!==1)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
      previousAccount=generation.accountId;rootCount=0;
    }
    if(generation.priorGenerationId===null)rootCount++;
    if(++generationCount>Number.MAX_SAFE_INTEGER)fail('PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
  });
  if(previousAccount!==null&&rootCount!==1)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
  return {accountCount,generationCount};
}

function diagnosticEntry(eventType:string,payloadVersion:number):PaperAccountV3UnsupportedEventType {
  return {eventType,payloadVersion,classification:KNOWN_EVENT_TYPES.has(eventType)&&payloadVersion===1?
    'KNOWN_SEMANTICS_UNVERIFIED':'UNKNOWN_UNSUPPORTED'};
}

function verifyGenerationSequenceAxis(db:DatabaseSync):void {
  let priorAccount:string|null=null;let priorGeneration:string|null=null;let expected=1;
  withRows<{account_id:unknown;generation_id:unknown;generation_sequence_text:unknown}>(db,
    `SELECT account_id,generation_id,CAST(generation_sequence AS TEXT) generation_sequence_text FROM pa2_events
      ORDER BY account_id,generation_id,generation_sequence`,row=>{
      const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
      const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
      if(accountId!==priorAccount||generationId!==priorGeneration) {priorAccount=accountId;priorGeneration=generationId;expected=1;}
      if(safeInteger(row.generation_sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID',1)!==expected)
        fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_SEQUENCE_GAP');
      expected++;
      if(!Number.isSafeInteger(expected))fail('PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
    });
}

function journalInSnapshot(db:DatabaseSync):PaperAccountV3JournalIntegrity {
  verifyPaperAccountV3Schema(db);
  verifyBlobBounds(db);
  const inventory=validateInventory(db);
  verifyGenerationSequenceAxis(db);
  const accountSummaryHash=createHash('sha256').update('SYLPH-PAPER-V3-ACCOUNT-SUMMARY-1\0','ascii');
  const unsupportedRowsHash=createHash('sha256').update('SYLPH-PAPER-V3-UNSUPPORTED-ROWS-1\0','ascii');
  const accounts:PaperAccountV3JournalAccountIntegrity[]=[];
  const knownUnsupported=new Map<string,PaperAccountV3UnsupportedEventType>();
  const knownTypeObservations=new Map<string,{payloadVersion:number;classification:PaperAccountV3UnsupportedEventType['classification']}>();
  const unknownSamples:PaperAccountV3UnsupportedEventType[]=[];
  const unknownSampleKeys=new Set<string>();
  let accountsTruncated=false;let unsupportedEventTypesTruncated=false;
  let accountCount=0;let eventCount=0;let unsupportedEventRowCount=0;let knownSemanticsUnverifiedEventRowCount=0;let unknownUnsupportedEventRowCount=0;
  let currentAccount:string|null=null;let currentEventCount=0;let currentPrevious=ZERO_HASH;let currentLastSequence=0;let currentLastHash=ZERO_HASH;
  let rootGenerationId:string|null=null;let rootGenesisBytes:Buffer|null=null;let bootstrapEvents:PaperAccountV2JournalEvent[]=[];
  const rootQuery=db.prepare(`${generationRowSql("WHERE account_id=? AND prior_generation_id IS NULL")} LIMIT 2`);
  const accountExists=db.prepare('SELECT 1 AS present FROM pa2_accounts WHERE account_id=?');
  const generationExists=db.prepare('SELECT 1 AS present FROM pa2_generations WHERE account_id=? AND generation_id=?');
  const duplicateEventId=db.prepare('SELECT 1 AS duplicate FROM pa2_events WHERE account_id=? AND event_id=? AND account_sequence<>? LIMIT 1');
  const generationCountForAccount=db.prepare('SELECT CAST(count(*) AS TEXT) AS count_text FROM pa2_generations WHERE account_id=?');
  const generationCreatedRow=db.prepare(generationRowSql('WHERE account_id=? AND generation_id=?'));

  const finishAccount=()=>{
    if(currentAccount===null)return;
    if(currentEventCount<2||bootstrapEvents.length!==2||rootGenesisBytes===null)fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_PREFIX_MISSING');
    const generationCount=safeCount((generationCountForAccount.get(currentAccount) as {count_text:unknown}).count_text,'PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
    const summary:PaperAccountV3JournalAccountIntegrity={accountId:currentAccount,eventCount:currentEventCount,generationCount,firstAccountSequence:1,
      lastAccountSequence:currentLastSequence,lastEventSha256:currentLastHash};
    framed(accountSummaryHash,summary);
    if(accounts.length<ACCOUNT_DIAGNOSTIC_SAMPLE_LIMIT)accounts.push(summary);else accountsTruncated=true;
    accountCount++;
    rootGenerationId=null;rootGenesisBytes=null;bootstrapEvents=[];
  };
  const eventSql=`SELECT account_id,generation_id,event_id,CAST(account_sequence AS TEXT) account_sequence_text,
    CAST(generation_sequence AS TEXT) generation_sequence_text,event_type,CAST(payload_version AS TEXT) payload_version_text,command_id,
    CAST(owner_epoch AS TEXT) owner_epoch_text,CAST(occurred_at_ms AS TEXT) occurred_at_ms_text,CAST(recorded_at_ms AS TEXT) recorded_at_ms_text,
    payload_bytes,payload_sha256,previous_event_sha256,event_sha256 FROM pa2_events ORDER BY account_id,account_sequence`;
  withRows<EventRow>(db,eventSql,row=>{
    const event=eventFromRow(row);
    if(currentAccount!==event.accountId) {
      finishAccount();
      currentAccount=event.accountId;currentEventCount=0;currentPrevious=ZERO_HASH;currentLastSequence=0;currentLastHash=ZERO_HASH;
      if(accountExists.get(currentAccount)===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_SCOPE_INVALID');
      const rootRow=rootQuery.get(currentAccount) as GenerationRow|undefined;
      if(rootRow===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
      const root=validateGenerationRow(rootRow!);rootGenerationId=root.generationId;rootGenesisBytes=root.genesisBytes;
      if(root.priorGenerationId!==null)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
    }
    if(generationExists.get(event.accountId,event.generationId)===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_SCOPE_INVALID');
    if(duplicateEventId.get(event.accountId,event.eventId,event.accountSequence)!==undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ID_DUPLICATE');
    if(event.accountSequence!==currentEventCount+1||event.previousEventSha256!==currentPrevious)
      fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP');
    if(event.ownerEpoch===0&&!BOOTSTRAP_EVENT_TYPES.has(event.eventType))fail('PAPER_ACCOUNT_V3_JOURNAL_ZERO_OWNER_EPOCH_INVALID');
    if(event.eventType==='ACCOUNT_BOOTSTRAPPED'&&event.ownerEpoch!==0)fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_OWNER_EPOCH_INVALID');
    const calculated=paperAccountV2EventHash({accountId:event.accountId,generationId:event.generationId,eventId:event.eventId,eventType:event.eventType,
      payloadVersion:event.payloadVersion,accountSequence:event.accountSequence,generationSequence:event.generationSequence,ownerEpoch:event.ownerEpoch,
      occurredAtMs:event.occurredAtMs,recordedAtMs:event.recordedAtMs,payloadBytes:event.payloadBytes,previousEventSha256:event.previousEventSha256});
    if(calculated.payloadSha256!==row.payload_sha256||calculated.eventSha256!==row.event_sha256)
      fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_HASH_MISMATCH');
    if(currentEventCount===0) {
      if(event.eventType!=='ACCOUNT_BOOTSTRAPPED'||event.accountSequence!==1||event.generationSequence!==1||event.ownerEpoch!==0||row.command_id!==null||
         event.generationId!==rootGenerationId)fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
    } else if(currentEventCount===1) {
      if(event.eventType!=='GENERATION_CREATED'||event.accountSequence!==2||event.generationSequence!==2||event.ownerEpoch!==0||row.command_id!==null||
         event.generationId!==rootGenerationId)fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
    }
    if(event.eventType==='GENERATION_CREATED') {
      if(event.payloadVersion!==1)fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATED_VERSION_UNSUPPORTED');
      const generationRow=generationCreatedRow.get(event.accountId,event.generationId) as GenerationRow|undefined;
      if(generationRow===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_SCOPE_INVALID');
      const generation=validateGenerationRow(generationRow!);
      if(event.ownerEpoch===0) {
        if(event.accountSequence!==2||event.generationSequence!==2||generation.priorGenerationId!==null||row.command_id!==null)
          fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
      } else if(event.generationSequence!==1)fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATED_SEQUENCE_INVALID');
      if(!equalBytes(event.payloadBytes,generationCreatedPayload(generation)))fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_COMMITMENT_MISMATCH');
    }
    if(currentEventCount<2)bootstrapEvents.push(event);
    if(currentEventCount===1) {
      if(rootGenesisBytes===null)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
      try {verifyPaperAccountV2BootstrapPrefix(rootGenesisBytes!,bootstrapEvents);} catch {fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_PREFIX_INVALID');}
    }
    if(!BOOTSTRAP_EVENT_TYPES.has(event.eventType)) {
      unsupportedEventRowCount++;
      const entry=diagnosticEntry(event.eventType,event.payloadVersion);
      const eventKey=`${event.eventType}\0${event.payloadVersion}`;
      framed(unsupportedRowsHash,{accountId:event.accountId,accountSequence:event.accountSequence,eventId:event.eventId,eventType:event.eventType,payloadVersion:event.payloadVersion});
      if(KNOWN_EVENT_TYPES.has(event.eventType)) {
        const observation=knownTypeObservations.get(event.eventType);
        if(observation===undefined)knownTypeObservations.set(event.eventType,{payloadVersion:event.payloadVersion,classification:entry.classification});
        else if(observation.payloadVersion!==event.payloadVersion||observation.classification!==entry.classification)
          unsupportedEventTypesTruncated=true;
      }
      if(entry.classification==='KNOWN_SEMANTICS_UNVERIFIED') {
        knownSemanticsUnverifiedEventRowCount++;
        if(!knownUnsupported.has(event.eventType))knownUnsupported.set(event.eventType,entry);
      } else {
        unknownUnsupportedEventRowCount++;
        if(KNOWN_EVENT_TYPES.has(event.eventType)) {
          knownUnsupported.set(event.eventType,entry);
        } else if(!unknownSampleKeys.has(eventKey)) {
          if(unknownSamples.length<UNKNOWN_TYPE_DIAGNOSTIC_SAMPLE_LIMIT) {unknownSamples.push(entry);unknownSampleKeys.add(eventKey);}
          else unsupportedEventTypesTruncated=true;
        }
      }
    }
    currentEventCount++;eventCount++;
    if(!Number.isSafeInteger(currentEventCount)||!Number.isSafeInteger(eventCount)||!Number.isSafeInteger(unsupportedEventRowCount)||
       !Number.isSafeInteger(knownSemanticsUnverifiedEventRowCount)||!Number.isSafeInteger(unknownUnsupportedEventRowCount))
      fail('PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
    currentPrevious=event.eventSha256;currentLastSequence=event.accountSequence;currentLastHash=event.eventSha256;
  });
  finishAccount();
  const persistedEventCount=safeCount((db.prepare('SELECT CAST(count(*) AS TEXT) AS count_text FROM pa2_events').get() as {count_text:unknown}).count_text,
    'PAPER_ACCOUNT_V3_JOURNAL_COUNT_INVALID');
  if(accountCount!==inventory.accountCount||eventCount!==persistedEventCount)
    fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_PREFIX_MISSING');

  let previousAccount:string|null=null;let previousGeneration:string|null=null;let expectedGenerationSequence=1;let sequenceCount=0;
  let currentGroupIsRoot=false;let sawCreation=false;
  const rootLookup=db.prepare('SELECT generation_id FROM pa2_generations WHERE account_id=? AND prior_generation_id IS NULL');
  const generationEventsSql=`SELECT e.account_id,e.generation_id,e.event_id,CAST(e.account_sequence AS TEXT) account_sequence_text,
    CAST(e.generation_sequence AS TEXT) generation_sequence_text,e.event_type,CAST(e.owner_epoch AS TEXT) owner_epoch_text,e.command_id
    FROM pa2_events e JOIN pa2_generations g ON g.account_id=e.account_id AND g.generation_id=e.generation_id
    ORDER BY e.account_id,e.generation_id,e.generation_sequence`;
  withRows<{
    account_id:unknown;generation_id:unknown;event_id:unknown;account_sequence_text:unknown;generation_sequence_text:unknown;event_type:unknown;owner_epoch_text:unknown;command_id:unknown
  }>(db,generationEventsSql,row=>{
    const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const generationSequence=safeInteger(row.generation_sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID',1);
    const eventType=text(row.event_type,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    if(accountId!==previousAccount||generationId!==previousGeneration) {
      if(previousGeneration!==null&&(!sawCreation||sequenceCount===0))fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
      previousAccount=accountId;previousGeneration=generationId;expectedGenerationSequence=1;sequenceCount=0;sawCreation=false;
      const rootRow=rootLookup.get(accountId) as {generation_id:unknown}|undefined;
      if(rootRow===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
      currentGroupIsRoot=rootRow!.generation_id===generationId;
    }
    if(generationSequence!==expectedGenerationSequence)fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_SEQUENCE_GAP');
    if(expectedGenerationSequence===1) {
      if(currentGroupIsRoot) {
        if(eventType!=='ACCOUNT_BOOTSTRAPPED'||safeInteger(row.owner_epoch_text,'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID')!==0||row.command_id!==null)
          fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
      } else if(eventType!=='GENERATION_CREATED')fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
    }
    if(currentGroupIsRoot&&generationSequence===2&&eventType!=='GENERATION_CREATED')fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
    if(eventType==='GENERATION_CREATED') {
      if(sawCreation)fail('PAPER_ACCOUNT_V3_JOURNAL_DUPLICATE_GENERATION_CREATED');
      sawCreation=true;
    }
    expectedGenerationSequence++;sequenceCount++;
  });
  if(previousGeneration!==null&&(!sawCreation||sequenceCount===0))fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
  if(sequenceCount===0&&inventory.generationCount>0)fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');

  const createdSequence=db.prepare(`SELECT CAST(account_sequence AS TEXT) AS sequence_text FROM pa2_events
    WHERE account_id=? AND generation_id=? AND event_type='GENERATION_CREATED' LIMIT 1`);
  const priorGenerationLookup=db.prepare('SELECT 1 AS present FROM pa2_generations WHERE account_id=? AND generation_id=?');
  withRows<{account_id:unknown;generation_id:unknown;prior_generation_id:unknown}>(db,
    'SELECT account_id,generation_id,prior_generation_id FROM pa2_generations ORDER BY account_id,generation_id',row=>{
      if(row.prior_generation_id===null)return;
      const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
      const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
      const priorGenerationId=text(row.prior_generation_id,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_PARENT_INVALID');
      if(priorGenerationId===generationId||priorGenerationLookup.get(accountId,priorGenerationId)===undefined)
        fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_PARENT_INVALID');
      const child=createdSequence.get(accountId,generationId) as {sequence_text:unknown}|undefined;
      const parent=createdSequence.get(accountId,priorGenerationId) as {sequence_text:unknown}|undefined;
      if(child===undefined||parent===undefined)fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
      if(safeInteger(parent!.sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ORDER_INVALID')>=
         safeInteger(child!.sequence_text,'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ORDER_INVALID'))
        fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ORDER_INVALID');
    });

  const unsupportedEventTypes=[...knownUnsupported.values(),...unknownSamples]
    .sort((a,b)=>a.eventType<b.eventType?-1:a.eventType>b.eventType?1:a.payloadVersion-b.payloadVersion);
  return {schemaVersion:3,integrityVerified:true,semanticsVerified:false,admissionEligible:false,held:true,
    accountCount,eventCount,accounts,accountsTruncated,accountSummarySha256:accountSummaryHash.digest('hex'),unsupportedEventTypes,
    unsupportedEventTypesTruncated,unsupportedEventRowCount,knownSemanticsUnverifiedEventRowCount,unknownUnsupportedEventRowCount,
    unsupportedEventRowsSha256:unsupportedRowsHash.digest('hex')};
}

/** Requires the caller to own an active read transaction; never begins or ends it. */
export function verifyPaperAccountV3JournalIntegrityInSnapshot(db:DatabaseSync):PaperAccountV3JournalIntegrity {
  if(!db.isTransaction)fail('PAPER_ACCOUNT_V3_JOURNAL_SNAPSHOT_TRANSACTION_REQUIRED');
  return journalInSnapshot(db);
}

/** Verifies the journal within one owned read snapshot. Results always remain held/non-admission. */
export function verifyPaperAccountV3JournalIntegrity(db:DatabaseSync):PaperAccountV3JournalIntegrity {
  if(db.isTransaction)fail('PAPER_ACCOUNT_V3_JOURNAL_SNAPSHOT_ALREADY_ACTIVE');
  db.exec('BEGIN DEFERRED');
  try {
    const result=verifyPaperAccountV3JournalIntegrityInSnapshot(db);
    db.exec('COMMIT');
    return result;
  } catch(error) {
    if(db.isTransaction) {
      try {db.exec('ROLLBACK');}
      catch(rollbackError) {throw new Error('PAPER_ACCOUNT_V3_JOURNAL_SNAPSHOT_ROLLBACK_FAILED',{cause:rollbackError});}
    }
    throw error;
  }
}

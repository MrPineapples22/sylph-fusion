import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalSylphJcs1Snapshot,SYLPH_JCS1_MAX_BYTES,verifyPaperAccountV2GenesisDocument} from './paper-account-v3-codec.js';
import {verifyPaperAccountV3OwnerEventConsistencyInSnapshot,type PaperAccountV3OwnerConsistency} from './paper-account-v3-owner-integrity.js';

const HASH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UDEC=/^(0|[1-9][0-9]*)$/;
const COMMAND_TYPES=new Set(['COMMAND_ACCEPTED','COMMAND_REJECTED','SIMULATED','SETTLEMENT','SIMULATION_REJECTED',
  'COMMAND_CANCELLED_BEFORE_SIMULATION','SIMULATION_OUTCOME_UNRESOLVED','COMMAND_MANUALLY_RESOLVED']);
const ACCEPTED_KEYS=['acceptedEvidenceSha256','amountLamports','amountTokenRaw','amountUsdMicro','commandId','commandType','configSha256','economicOrderId',
  'frozenQuoteSha256','initiator','mint','poolId','requestSha256','reservationCashUsdMicro','reservationFeeBufferLamports','reservationKind',
  'reservationPositionLotId','reservationTokenQtyRaw','riskPolicySha256','seedIdentity','side','simulatorBuildHash','simulatorReportSchema','tokenDecimals'];
const REJECTED_KEYS=['acceptedEventSha256','commandId','evidenceBytesB64url','evidenceSha256','rejectionCode','terminalResultSha256'];
const SIMULATED_KEYS=['acceptedEventSha256','commandId','commandRequestSha256','reportSchema','reportSha256','reportStatus','seedIdentity','simulatorBuildHash',
  'simulatorRequestSha256','telemetrySha256'];
const SETTLEMENT_KEYS=['commandId','fillRefs','reportSha256','simulatedEventSha256','terminalResultSha256'];
const SIM_REJECTED_KEYS=['commandId','rejectionCode','reportSha256','reportStatus','simulatedEventSha256','terminalResultSha256'];
const CANCEL_KEYS=['acceptedEventSha256','cancellationId','commandId','proofBytesB64url','proofSha256','terminalResultSha256'];
const UNRESOLVED_KEYS=['acceptedEventSha256','commandId','errorClass','lastLifecycle','processIdentity','uncertaintyBoundary','workerIdentity'];
const MANUAL_KEYS=['commandId','disposition','evidenceBytesB64url','evidenceSha256','operatorId','resolutionId','reviewerId','terminalResultSha256','unresolvedEventSha256'];
const REPORT_KEYS=['orderId','status','execPrice','inputAmount','outputAmount','priorityFeeLamports','jitoTipLamports','slotLatency'];
const TELEMETRY_KEYS=['engineMode','simulatedSlotLagMs','priceImpactPct','preTradeReserves','postTradeReserves'];
const NONNEGATIVE_ENUMS={status:['FILLED','REJECTED','EXPIRED'],failureReason:['SLIPPAGE_EXCEEDED','AUCTION_LOST','STALE_STATE','PRE_TRADE_RISK_REJECTED','CIRCUIT_BREAKER_HALTED'],
  currentStage:['IDLE','VALIDATING','QUOTING','SIGNING','SUBMITTING','SETTLED','REJECTED','EXPIRED','FAILED']};
const fail=(code:string):never=>{throw new Error(code);};

type EventRow={account_id:unknown;generation_id:unknown;event_id:unknown;account_sequence_text:unknown;generation_sequence_text:unknown;
  event_type:unknown;payload_version_text:unknown;command_id:unknown;recorded_at_ms_text:unknown;payload_bytes:unknown;event_sha256:unknown};
type CommandRow={account_id:unknown;generation_id:unknown;command_id:unknown;economic_order_id:unknown;initiator:unknown;command_type:unknown;pool_id:unknown;
  mint:unknown;side:unknown;token_decimals_text:unknown;request_bytes:unknown;request_sha256:unknown;config_sha256:unknown;risk_policy_sha256:unknown;
  accepted_evidence_bytes:unknown;accepted_evidence_sha256:unknown;frozen_quote_bytes:unknown;frozen_quote_sha256:unknown;amount_usd_micro:unknown;
  amount_lamports:unknown;amount_token_raw:unknown;accepted_account_sequence_text:unknown;accepted_generation_sequence_text:unknown;command_state:unknown;
  terminal_result_bytes:unknown;terminal_result_sha256:unknown};
type ReservationRow={account_id:unknown;generation_id:unknown;command_id:unknown;reservation_kind:unknown;cash_usd_micro:unknown;position_lot_id:unknown;
  token_qty_raw:unknown;fee_buffer_lamports:unknown;creating_generation_sequence_text:unknown;reservation_state:unknown};
type ReportRow={account_id:unknown;generation_id:unknown;command_id:unknown;simulator_request_bytes:unknown;simulator_request_sha256:unknown;report_bytes:unknown;
  report_sha256:unknown;telemetry_bytes:unknown;telemetry_sha256:unknown;report_schema:unknown;simulator_build_hash:unknown;seed_identity:unknown;recorded_at_ms_text:unknown};
type FillRow={account_id:unknown;generation_id:unknown;fill_id:unknown;command_id:unknown;fill_ordinal_text:unknown;report_sha256:unknown};
type LifecycleEvent={row:EventRow;type:string;payload:Record<string,unknown>;key:string;hash:string;accountSequence:number;generationSequence:number};
type CommandFold={key:string;accepted:LifecycleEvent;simulated?:LifecycleEvent;unresolved?:LifecycleEvent;terminal?:LifecycleEvent;state:string;status?:string;report?:ReportRow;fills:FillRow[]};

function exactKeys(value:Record<string,unknown>,keys:readonly string[],code:string):void {
  const actual=Object.keys(value).sort();const expected=[...keys].sort();
  if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))fail(code);
}
function object(value:unknown,code:string):Record<string,unknown> {
  if(typeof value!=='object'||value===null||Array.isArray(value))return fail(code);
  return value as Record<string,unknown>;
}
function str(value:unknown,code:string):string {if(typeof value!=='string'||value.length===0)return fail(code);return value;}
function nullableText(value:unknown,code:string):string|null {if(value===null)return null;return str(value,code);}
function sha(value:unknown,code:string):string {const result=str(value,code);if(!HASH.test(result))fail(code);return result;}
function uuid(value:unknown,code:string):string {const result=str(value,code);if(!UUID.test(result))fail(code);return result;}
function uintText(value:unknown,code:string):string {if(typeof value!=='string'||!UDEC.test(value))return fail(code);return value;}
function intText(value:unknown,code:string,min=0):number {
  const raw=uintText(value,code);const parsed=BigInt(raw);if(parsed<BigInt(min)||parsed>BigInt(Number.MAX_SAFE_INTEGER))return fail(code);return Number(parsed);
}
function integer(value:unknown,code:string,min=0):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return fail(code);return value;}
function key(accountId:string,generationId:string,commandId:string):string {return `${accountId}\0${generationId}\0${commandId}`;}
function bytes(value:unknown,code:string):Uint8Array {if(!(value instanceof Uint8Array))return fail(code);return value;}
function parsedBytes(value:unknown,code:string):{bytes:Buffer;value:Record<string,unknown>} {
  try{return canonicalSylphJcs1Snapshot(bytes(value,code));}catch{return fail(code);}
}
function digest(value:Uint8Array):string {return createHash('sha256').update(value).digest('hex');}
function parsedHash(value:unknown,storedHash:unknown,code:string):Buffer {
  const raw=parsedBytes(value,code).bytes;if(digest(raw)!==sha(storedHash,code))fail(code);return raw;
}
function eventPayload(row:EventRow,code:string):Record<string,unknown> {return parsedBytes(row.payload_bytes,code).value;}
function eventString(row:EventRow,field:keyof EventRow,code:string):string {return str(row[field],code);}
function eventNumber(row:EventRow,field:keyof EventRow,code:string,min=0):number {return intText(row[field],code,min);}
function requireEqual(actual:unknown,expected:unknown,code:string):void {if(actual!==expected)fail(code);}
function canonicalEconomicOrderId(requestBytes:Buffer,commandId:string):string {
  const request=parsedBytes(requestBytes,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID').value;
  if(!Object.hasOwn(request,'orderId'))return commandId;
  const orderId=request.orderId;
  if(typeof orderId!=='string')return fail('PAPER_ACCOUNT_V3_COMMAND_REQUEST_ORDER_ID_INVALID');
  return orderId===''?commandId:orderId;
}
function plainDecimalToNumberString(value:unknown,code:string):string {
  if(typeof value!=='string'||!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)||value==='-0')return fail(code);
  const numeric=Number(value);if(!Number.isFinite(numeric)||Object.is(numeric,-0))return fail(code);
  if(numberToPlainDecimal(numeric)!==value)fail(code);
  return value;
}
function numberToPlainDecimal(value:number):string {
  if(!Number.isFinite(value)||Object.is(value,-0))fail('PAPER_ACCOUNT_V3_COMMAND_F64_DECIMAL_INVALID');
  if(value===0)return '0';
  const source=value.toString();const negative=source.startsWith('-');const unsigned=negative?source.slice(1):source;
  const [coefficient,exponentText]=unsigned.split('e');const exponent=exponentText===undefined?0:Number(exponentText);
  if(!Number.isSafeInteger(exponent))fail('PAPER_ACCOUNT_V3_COMMAND_F64_DECIMAL_INVALID');
  const point=coefficient.indexOf('.');const before=point<0?coefficient.length:point;
  let digits=coefficient.replace('.','');let decimalAt=before+exponent;
  const leading=(digits.match(/^0+/)?.[0].length??0);digits=digits.slice(leading);decimalAt-=leading;
  digits=digits.replace(/0+$/,'')||'0';
  let rendered:string;
  if(decimalAt<=0)rendered=`0.${'0'.repeat(-decimalAt)}${digits}`;
  else if(decimalAt>=digits.length)rendered=`${digits}${'0'.repeat(decimalAt-digits.length)}`;
  else rendered=`${digits.slice(0,decimalAt)}.${digits.slice(decimalAt)}`;
  rendered=rendered.includes('.')?rendered.replace(/0+$/,'').replace(/\.$/,''):rendered;
  return `${negative?'-':''}${rendered}`;
}
function validateReport(value:unknown,expectedOrderId:string):{status:string;orderId:string} {
  const report=object(value,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  const keys=Object.keys(report);const optional=['failureReason','currentStage'];
  if(REPORT_KEYS.some(k=>!Object.hasOwn(report,k))||keys.some(k=>!REPORT_KEYS.includes(k)&&!optional.includes(k)))fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_KEYS_INVALID');
  const orderId=str(report.orderId,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');if(orderId!==expectedOrderId)fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORDER_ID_MISMATCH');
  if(typeof report.status!=='string'||!NONNEGATIVE_ENUMS.status.includes(report.status as never))fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_INVALID');
  const status=report.status as string;
  plainDecimalToNumberString(report.execPrice,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  uintText(report.inputAmount,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');if(report.inputAmount==='0')fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  uintText(report.outputAmount,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');uintText(report.priorityFeeLamports,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  uintText(report.jitoTipLamports,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');integer(report.slotLatency,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  if(Object.hasOwn(report,'failureReason')&&(typeof report.failureReason!=='string'||!NONNEGATIVE_ENUMS.failureReason.includes(report.failureReason as never)))
    fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  if(Object.hasOwn(report,'currentStage')&&(typeof report.currentStage!=='string'||!NONNEGATIVE_ENUMS.currentStage.includes(report.currentStage as never)))
    fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID');
  return {status,orderId};
}
function validateTelemetry(value:unknown):void {
  const envelope=object(value,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');exactKeys(envelope,['schema','telemetry'],'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  if(envelope.schema!=='telemetry-v1')fail('PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  const telemetry=object(envelope.telemetry,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');exactKeys(telemetry,TELEMETRY_KEYS,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  if(telemetry.engineMode!=='PAPER'&&telemetry.engineMode!=='LIVE_JITO_QUIC')fail('PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  plainDecimalToNumberString(telemetry.simulatedSlotLagMs,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  plainDecimalToNumberString(telemetry.priceImpactPct,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  if(Number(telemetry.simulatedSlotLagMs)<0||Number(telemetry.priceImpactPct)<0)fail('PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  for(const name of ['preTradeReserves','postTradeReserves']) {
    const reserves=object(telemetry[name],'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');exactKeys(reserves,['sol','token'],'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
    uintText(reserves.sol,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');uintText(reserves.token,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID');
  }
}
function decodedCanonicalEvidence(value:unknown,expectedHash:unknown,code:string):void {
  const encoded=str(value,code);if(!/^[A-Za-z0-9_-]+$/.test(encoded))fail(code);
  const raw=Buffer.from(encoded,'base64url');if(raw.toString('base64url')!==encoded||digest(raw)!==sha(expectedHash,code))fail(code);
  parsedBytes(raw,code);
}
function checkTerminalResult(command:CommandRow,payload:Record<string,unknown>,code:string):void {
  const raw=parsedHash(command.terminal_result_bytes,command.terminal_result_sha256,code);
  requireEqual(payload.terminalResultSha256,digest(raw),code);
}
function checkAccepted(command:CommandRow,reservation:ReservationRow,event:LifecycleEvent,genesis:Record<string,unknown>):void {
  const p=event.payload;exactKeys(p,ACCEPTED_KEYS,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  const commandId=uuid(p.commandId,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');requireEqual(commandId,event.row.command_id,'PAPER_ACCOUNT_V3_COMMAND_IDENTITY_MISMATCH');
  requireEqual(command.command_id,commandId,'PAPER_ACCOUNT_V3_COMMAND_IDENTITY_MISMATCH');
  requireEqual(command.account_id,event.row.account_id,'PAPER_ACCOUNT_V3_COMMAND_SCOPE_MISMATCH');requireEqual(command.generation_id,event.row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_SCOPE_MISMATCH');
  const requestBytes=parsedHash(command.request_bytes,command.request_sha256,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_HASH_MISMATCH');
  const request=parsedBytes(requestBytes,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID').value;
  const economicId=canonicalEconomicOrderId(requestBytes,commandId);
  requireEqual(p.economicOrderId,economicId,'PAPER_ACCOUNT_V3_COMMAND_ECONOMIC_ID_MISMATCH');requireEqual(command.economic_order_id,economicId,'PAPER_ACCOUNT_V3_COMMAND_ECONOMIC_ID_MISMATCH');
  requireEqual(str(request.mint,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID'),p.mint,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_IDENTITY_MISMATCH');
  requireEqual(str(request.poolAddress,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID'),p.poolId,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_IDENTITY_MISMATCH');
  requireEqual(request.side,p.side,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_IDENTITY_MISMATCH');
  if(Object.hasOwn(request,'tokenDecimals'))requireEqual(request.tokenDecimals,p.tokenDecimals,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_IDENTITY_MISMATCH');
  const mappings:Array<[unknown,unknown,string]>=[
    [command.initiator,p.initiator,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.command_type,p.commandType,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.pool_id,p.poolId,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.mint,p.mint,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.side,p.side,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.config_sha256,p.configSha256,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.risk_policy_sha256,p.riskPolicySha256,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.amount_usd_micro,p.amountUsdMicro,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.amount_lamports,p.amountLamports,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.amount_token_raw,p.amountTokenRaw,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.accepted_evidence_sha256,p.acceptedEvidenceSha256,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],[command.frozen_quote_sha256,p.frozenQuoteSha256,'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.token_decimals_text,String(p.tokenDecimals),'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH'],
    [command.accepted_account_sequence_text,String(event.accountSequence),'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_SEQUENCE_MISMATCH'],
    [command.accepted_generation_sequence_text,String(event.generationSequence),'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_SEQUENCE_MISMATCH'],
  ];for(const [a,b,c] of mappings)requireEqual(a,b,c);
  str(p.initiator,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');if(p.commandType!=='SUBMIT_ORDER')fail('PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  str(p.poolId,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');str(p.mint,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  if(p.side!=='BUY'&&p.side!=='SELL')fail('PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  integer(p.tokenDecimals,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');if((p.tokenDecimals as number)>18)fail('PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  for(const n of ['amountLamports','amountTokenRaw','amountUsdMicro','reservationCashUsdMicro','reservationFeeBufferLamports','reservationTokenQtyRaw'])
    uintText(p[n],'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  for(const n of ['acceptedEvidenceSha256','configSha256','frozenQuoteSha256','requestSha256','riskPolicySha256','simulatorBuildHash'])sha(p[n],'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  str(p.seedIdentity,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  requireEqual(p.simulatorBuildHash,genesis.simulatorBuildHash,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_CONTEXT_MISMATCH');
  requireEqual(p.simulatorReportSchema,genesis.simulatorReportSchema,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_CONTEXT_MISMATCH');
  if(p.reservationKind!=='BUY_CASH'&&p.reservationKind!=='SELL_POSITION'&&p.reservationKind!=='FEE_BUFFER')fail('PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  const lot=nullableText(p.reservationPositionLotId,'PAPER_ACCOUNT_V3_COMMAND_ACCEPTED_PAYLOAD_INVALID');
  const evidence=parsedHash(command.accepted_evidence_bytes,command.accepted_evidence_sha256,'PAPER_ACCOUNT_V3_COMMAND_EVIDENCE_HASH_MISMATCH');
  const quote=parsedHash(command.frozen_quote_bytes,command.frozen_quote_sha256,'PAPER_ACCOUNT_V3_COMMAND_QUOTE_HASH_MISMATCH');
  requireEqual(p.acceptedEvidenceSha256,digest(evidence),'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH');requireEqual(p.frozenQuoteSha256,digest(quote),'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH');
  requireEqual(p.requestSha256,digest(requestBytes),'PAPER_ACCOUNT_V3_COMMAND_ROW_MISMATCH');
  const rsvMappings:Array<[unknown,unknown]>=[[reservation.account_id,command.account_id],[reservation.generation_id,command.generation_id],
    [reservation.command_id,command.command_id],[reservation.reservation_kind,p.reservationKind],[reservation.cash_usd_micro,p.reservationCashUsdMicro],
    [reservation.position_lot_id,lot],[reservation.token_qty_raw,p.reservationTokenQtyRaw],[reservation.fee_buffer_lamports,p.reservationFeeBufferLamports],
    [reservation.creating_generation_sequence_text,String(event.generationSequence)]];
  for(const [a,b] of rsvMappings)requireEqual(a,b,'PAPER_ACCOUNT_V3_COMMAND_RESERVATION_MISMATCH');
}

/**
 * Check SQLite's scalar BLOB lengths before any query projects a BLOB into Node memory.
 * The caller has already begun the DEFERRED read transaction, so these preflight reads
 * and the subsequent byte reads observe one SQLite snapshot.
 */
function assertPersistedBlobBounds(db:DatabaseSync):void {
  const checks=[
    [`SELECT 1 AS oversized FROM pa2_generations
      WHERE genesis_json IS NOT NULL AND octet_length(genesis_json)>? LIMIT 1`,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_BLOB_TOO_LARGE',1],
    [`SELECT 1 AS oversized FROM pa2_events
      WHERE payload_bytes IS NOT NULL AND octet_length(payload_bytes)>? LIMIT 1`,'PAPER_ACCOUNT_V3_COMMAND_EVENT_BLOB_TOO_LARGE',1],
    [`SELECT 1 AS oversized FROM pa2_commands WHERE
      (request_bytes IS NOT NULL AND octet_length(request_bytes)>?) OR
      (accepted_evidence_bytes IS NOT NULL AND octet_length(accepted_evidence_bytes)>?) OR
      (frozen_quote_bytes IS NOT NULL AND octet_length(frozen_quote_bytes)>?) OR
      (terminal_result_bytes IS NOT NULL AND octet_length(terminal_result_bytes)>?) LIMIT 1`,'PAPER_ACCOUNT_V3_COMMAND_ROW_BLOB_TOO_LARGE',4],
    [`SELECT 1 AS oversized FROM pa2_simulation_reports WHERE
      (simulator_request_bytes IS NOT NULL AND octet_length(simulator_request_bytes)>?) OR
      (report_bytes IS NOT NULL AND octet_length(report_bytes)>?) OR
      (telemetry_bytes IS NOT NULL AND octet_length(telemetry_bytes)>?) LIMIT 1`,'PAPER_ACCOUNT_V3_COMMAND_REPORT_BLOB_TOO_LARGE',3],
  ] as const;
  for(const [sql,errorCode,parameterCount] of checks) {
    const params=Array.from({length:parameterCount},()=>SYLPH_JCS1_MAX_BYTES);
    if(db.prepare(sql).get(...params)!==undefined)fail(errorCode);
  }
}

export interface PaperAccountV3CommandIntegrity extends PaperAccountV3OwnerConsistency {
  readonly commandLifecycleConsistencyVerified:boolean;
  readonly lifecycleEventsVerified:number;
  readonly commandsVerified:number;
  readonly reportsVerified:number;
  readonly settlementsVerified:number;
  readonly atomicityVerified:false;
  readonly economicsVerified:false;
  readonly semanticsVerified:false;
  readonly admissionEligible:false;
  readonly held:true;
}

/** Read-only structural command fold on a single journal+owner+command SQLite snapshot. */
export function verifyPaperAccountV3CommandLifecycleConsistency(db:DatabaseSync):PaperAccountV3CommandIntegrity {
  if(db.isTransaction)fail('PAPER_ACCOUNT_V3_COMMAND_SNAPSHOT_TRANSACTION_ALREADY_ACTIVE');
  db.exec('BEGIN DEFERRED');let active=true;
  try {
    assertPersistedBlobBounds(db);
    const owner=verifyPaperAccountV3OwnerEventConsistencyInSnapshot(db);
    const genesisRows=db.prepare('SELECT account_id,generation_id,genesis_json FROM pa2_generations').all() as Array<{account_id:unknown;generation_id:unknown;genesis_json:unknown}>;
    const genesisByScope=new Map<string,Record<string,unknown>>();
    for(const row of genesisRows) {
      const verified=verifyPaperAccountV2GenesisDocument(bytes(row.genesis_json,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_INVALID'));
      genesisByScope.set(`${str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_INVALID')}\0${str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_GENESIS_INVALID')}`,verified.genesis as unknown as Record<string,unknown>);
    }
    const eventRows=db.prepare(`SELECT account_id,generation_id,event_id,CAST(account_sequence AS TEXT) account_sequence_text,
      CAST(generation_sequence AS TEXT) generation_sequence_text,event_type,CAST(payload_version AS TEXT) payload_version_text,command_id,
      CAST(recorded_at_ms AS TEXT) recorded_at_ms_text,payload_bytes,event_sha256 FROM pa2_events ORDER BY account_id,account_sequence`).all() as EventRow[];
    const commandRows=db.prepare(`SELECT account_id,generation_id,command_id,economic_order_id,initiator,command_type,pool_id,mint,side,
      CAST(token_decimals AS TEXT) token_decimals_text,request_bytes,request_sha256,config_sha256,risk_policy_sha256,accepted_evidence_bytes,
      accepted_evidence_sha256,frozen_quote_bytes,frozen_quote_sha256,amount_usd_micro,amount_lamports,amount_token_raw,
      CAST(accepted_account_sequence AS TEXT) accepted_account_sequence_text,CAST(accepted_generation_sequence AS TEXT) accepted_generation_sequence_text,
      command_state,terminal_result_bytes,terminal_result_sha256 FROM pa2_commands`).all() as CommandRow[];
    const reservationRows=db.prepare(`SELECT account_id,generation_id,command_id,reservation_kind,cash_usd_micro,position_lot_id,token_qty_raw,fee_buffer_lamports,
      CAST(creating_generation_sequence AS TEXT) creating_generation_sequence_text,reservation_state FROM pa2_reservations`).all() as ReservationRow[];
    const reportRows=db.prepare(`SELECT account_id,generation_id,command_id,simulator_request_bytes,simulator_request_sha256,report_bytes,report_sha256,
      telemetry_bytes,telemetry_sha256,report_schema,simulator_build_hash,seed_identity,CAST(recorded_at_ms AS TEXT) recorded_at_ms_text FROM pa2_simulation_reports`).all() as ReportRow[];
    const fillRows=db.prepare(`SELECT account_id,generation_id,fill_id,command_id,CAST(fill_ordinal AS TEXT) fill_ordinal_text,report_sha256 FROM pa2_fills`).all() as FillRow[];
    const commands=new Map<string,CommandRow>();for(const row of commandRows){const k=key(str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'),str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'),uuid(row.command_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'));if(commands.has(k))fail('PAPER_ACCOUNT_V3_COMMAND_DUPLICATE_ROW');commands.set(k,row);}
    const reservations=new Map<string,ReservationRow>();for(const row of reservationRows){const k=key(str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_RESERVATION_INVALID'),str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_RESERVATION_INVALID'),uuid(row.command_id,'PAPER_ACCOUNT_V3_COMMAND_RESERVATION_INVALID'));if(reservations.has(k))fail('PAPER_ACCOUNT_V3_COMMAND_RESERVATION_ORPHAN');reservations.set(k,row);}
    const reports=new Map<string,ReportRow>();for(const row of reportRows){const k=key(str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID'),str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID'),uuid(row.command_id,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID'));if(reports.has(k))fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORPHAN');reports.set(k,row);}
    const fillsByCommand=new Map<string,FillRow[]>();const fillIdSet=new Set<string>();
    for(const row of fillRows){const k=key(str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),uuid(row.command_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'));
      const fillId=uuid(row.fill_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID');const unique=`${k}\0${fillId}`;if(fillIdSet.has(unique))fail('PAPER_ACCOUNT_V3_COMMAND_FILL_DUPLICATE');fillIdSet.add(unique);
      const list=fillsByCommand.get(k)??[];list.push(row);fillsByCommand.set(k,list);}
    const folds=new Map<string,CommandFold>();let lifecycleEventsVerified=0;let settlementsVerified=0;
    for(const row of eventRows) {
      const type=str(row.event_type,'PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID');const commandId=row.command_id;
      if(!COMMAND_TYPES.has(type)) {if(commandId!==null)fail('PAPER_ACCOUNT_V3_COMMAND_NON_LIFECYCLE_COMMAND_ID');continue;}
      const payloadVersion=eventNumber(row,'payload_version_text','PAPER_ACCOUNT_V3_COMMAND_EVENT_VERSION_INVALID',1);
      if(payloadVersion!==1)fail('PAPER_ACCOUNT_V3_COMMAND_EVENT_VERSION_UNSUPPORTED');
      const accountId=str(row.account_id,'PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID');const generationId=str(row.generation_id,'PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID');
      const payload=eventPayload(row,'PAPER_ACCOUNT_V3_COMMAND_EVENT_PAYLOAD_INVALID');const payloadCommandId=uuid(payload.commandId,'PAPER_ACCOUNT_V3_COMMAND_EVENT_PAYLOAD_INVALID');
      if(commandId!==payloadCommandId)fail('PAPER_ACCOUNT_V3_COMMAND_EVENT_COMMAND_ID_MISMATCH');
      const k=key(accountId,generationId,payloadCommandId);const event:LifecycleEvent={row,type,payload,key:k,hash:sha(row.event_sha256,'PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID'),
        accountSequence:eventNumber(row,'account_sequence_text','PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID',1),generationSequence:eventNumber(row,'generation_sequence_text','PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID',1)};
      lifecycleEventsVerified++;
      let fold=folds.get(k);const command=commands.get(k);if(!command)return fail('PAPER_ACCOUNT_V3_COMMAND_ORPHAN_EVENT');
      if(type==='COMMAND_ACCEPTED') {
        if(fold)fail('PAPER_ACCOUNT_V3_COMMAND_DUPLICATE_ACCEPTED');
        const reservation=reservations.get(k);if(!reservation)return fail('PAPER_ACCOUNT_V3_COMMAND_RESERVATION_ORPHAN');
        const genesis=genesisByScope.get(`${accountId}\0${generationId}`);if(!genesis)return fail('PAPER_ACCOUNT_V3_COMMAND_GENESIS_MISSING');
        checkAccepted(command,reservation,event,genesis);
        fold={key:k,accepted:event,state:'ACCEPTED',fills:fillsByCommand.get(k)??[]};folds.set(k,fold);continue;
      }
      if(!fold)return fail('PAPER_ACCOUNT_V3_COMMAND_TRANSITION_WITHOUT_ACCEPTED');
      const p=payload;
      if(type==='SIMULATED') {
        exactKeys(p,SIMULATED_KEYS,'PAPER_ACCOUNT_V3_COMMAND_SIMULATED_PAYLOAD_INVALID');
        if(fold.state!=='ACCEPTED'||fold.simulated)fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        requireEqual(p.acceptedEventSha256,fold.accepted.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');
        requireEqual(p.commandRequestSha256,command!.request_sha256,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_HASH_MISMATCH');
        const report=reports.get(k);if(!report)return fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORPHAN');
        const reportBytes=parsedHash(report.report_bytes,report.report_sha256,'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH');
        const reportValue=parsedBytes(reportBytes,'PAPER_ACCOUNT_V3_COMMAND_REPORT_INVALID').value;
        const reportProjection=validateReport(reportValue,canonicalEconomicOrderId(parsedBytes(bytes(command!.request_bytes,'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID'),'PAPER_ACCOUNT_V3_COMMAND_REQUEST_INVALID').bytes,fold.accepted.payload.commandId as string));
        requireEqual(p.reportSha256,digest(reportBytes),'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH');requireEqual(p.reportStatus,reportProjection.status,'PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_MISMATCH');
        const accepted=fold.accepted.payload;
        for(const [actual,expected] of [[p.reportSchema,accepted.simulatorReportSchema],[p.simulatorBuildHash,accepted.simulatorBuildHash],[p.seedIdentity,accepted.seedIdentity],
          [report.report_schema,p.reportSchema],[report.simulator_build_hash,p.simulatorBuildHash],[report.seed_identity,p.seedIdentity],
          [report.recorded_at_ms_text,String(eventNumber(row,'recorded_at_ms_text','PAPER_ACCOUNT_V3_COMMAND_EVENT_INVALID'))]] as Array<[unknown,unknown]>)
          requireEqual(actual,expected,'PAPER_ACCOUNT_V3_COMMAND_REPORT_CONTEXT_MISMATCH');
        if(report.report_schema!=='fill-report-v1')fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_SCHEMA_UNSUPPORTED');
        const simReq=parsedHash(report.simulator_request_bytes,report.simulator_request_sha256,'PAPER_ACCOUNT_V3_COMMAND_SIMULATOR_REQUEST_HASH_MISMATCH');
        const simReqValue=parsedBytes(simReq,'PAPER_ACCOUNT_V3_COMMAND_SIMULATOR_REQUEST_INVALID').value;requireEqual(simReqValue.orderId,reportProjection.orderId,'PAPER_ACCOUNT_V3_COMMAND_SIMULATOR_ORDER_ID_MISMATCH');
        requireEqual(p.simulatorRequestSha256,digest(simReq),'PAPER_ACCOUNT_V3_COMMAND_SIMULATOR_REQUEST_HASH_MISMATCH');
        const telemetryBytes=parsedHash(report.telemetry_bytes,report.telemetry_sha256,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_HASH_MISMATCH');
        const telemetry=parsedBytes(telemetryBytes,'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_INVALID').value;validateTelemetry(telemetry);
        requireEqual(p.telemetrySha256,digest(telemetryBytes),'PAPER_ACCOUNT_V3_COMMAND_TELEMETRY_HASH_MISMATCH');
        fold.simulated=event;fold.report=report;fold.status=reportProjection.status;fold.state='SIMULATED';continue;
      }
      if(type==='COMMAND_REJECTED') {
        exactKeys(p,REJECTED_KEYS,'PAPER_ACCOUNT_V3_COMMAND_REJECTED_PAYLOAD_INVALID');if(fold.state!=='ACCEPTED')fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        requireEqual(p.acceptedEventSha256,fold.accepted.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');decodedCanonicalEvidence(p.evidenceBytesB64url,p.evidenceSha256,'PAPER_ACCOUNT_V3_COMMAND_EVIDENCE_INVALID');
        str(p.rejectionCode,'PAPER_ACCOUNT_V3_COMMAND_REJECTED_PAYLOAD_INVALID');
        checkTerminalResult(command!,p,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');if(reports.has(k)||fold.fills.length)fail('PAPER_ACCOUNT_V3_COMMAND_REJECTED_HAS_EFFECT');
        fold.state='REJECTED';fold.terminal=event;continue;
      }
      if(type==='COMMAND_CANCELLED_BEFORE_SIMULATION') {
        exactKeys(p,CANCEL_KEYS,'PAPER_ACCOUNT_V3_COMMAND_CANCEL_PAYLOAD_INVALID');if(fold.state!=='ACCEPTED')fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        requireEqual(p.acceptedEventSha256,fold.accepted.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');uuid(p.cancellationId,'PAPER_ACCOUNT_V3_COMMAND_CANCEL_PAYLOAD_INVALID');
        decodedCanonicalEvidence(p.proofBytesB64url,p.proofSha256,'PAPER_ACCOUNT_V3_COMMAND_CANCEL_PROOF_INVALID');checkTerminalResult(command!,p,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');
        if(reports.has(k)||fold.fills.length)fail('PAPER_ACCOUNT_V3_COMMAND_CANCEL_HAS_EFFECT');fold.state='CANCELLED_BEFORE_SIMULATION';fold.terminal=event;continue;
      }
      if(type==='SIMULATION_OUTCOME_UNRESOLVED') {
        exactKeys(p,UNRESOLVED_KEYS,'PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_PAYLOAD_INVALID');if(fold.state!=='ACCEPTED')fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        requireEqual(p.acceptedEventSha256,fold.accepted.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');
        if(p.lastLifecycle!=='ACCEPTED'||p.uncertaintyBoundary!=='SIMULATOR_INVOCATION_OR_REPORT_COMMIT_UNKNOWN')fail('PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_BOUNDARY_INVALID');
        str(p.errorClass,'PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_PAYLOAD_INVALID');str(p.processIdentity,'PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_PAYLOAD_INVALID');str(p.workerIdentity,'PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_PAYLOAD_INVALID');
        if(reports.has(k)||fold.fills.length)fail('PAPER_ACCOUNT_V3_COMMAND_UNRESOLVED_HAS_EFFECT');fold.state='UNRESOLVED';fold.unresolved=event;continue;
      }
      if(type==='COMMAND_MANUALLY_RESOLVED') {
        exactKeys(p,MANUAL_KEYS,'PAPER_ACCOUNT_V3_COMMAND_MANUAL_PAYLOAD_INVALID');if(fold.state!=='UNRESOLVED'||!fold.unresolved)return fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        if(p.disposition!=='CANCEL_NO_FILL')fail('PAPER_ACCOUNT_V3_COMMAND_MANUAL_DISPOSITION_INVALID');
        const operator=str(p.operatorId,'PAPER_ACCOUNT_V3_COMMAND_MANUAL_PAYLOAD_INVALID');const reviewer=str(p.reviewerId,'PAPER_ACCOUNT_V3_COMMAND_MANUAL_PAYLOAD_INVALID');
        if(operator===reviewer)fail('PAPER_ACCOUNT_V3_COMMAND_MANUAL_ACTORS_MUST_DIFFER');uuid(p.resolutionId,'PAPER_ACCOUNT_V3_COMMAND_MANUAL_PAYLOAD_INVALID');
        requireEqual(p.unresolvedEventSha256,fold.unresolved.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');decodedCanonicalEvidence(p.evidenceBytesB64url,p.evidenceSha256,'PAPER_ACCOUNT_V3_COMMAND_MANUAL_EVIDENCE_INVALID');
        checkTerminalResult(command!,p,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');if(reports.has(k)||fold.fills.length)fail('PAPER_ACCOUNT_V3_COMMAND_MANUAL_HAS_EFFECT');
        fold.state='MANUALLY_RESOLVED';fold.terminal=event;continue;
      }
      if(type==='SIMULATION_REJECTED') {
        exactKeys(p,SIM_REJECTED_KEYS,'PAPER_ACCOUNT_V3_COMMAND_SIMULATION_REJECTED_PAYLOAD_INVALID');if(fold.state!=='SIMULATED'||!fold.simulated||!fold.report)return fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        if(fold.status!=='REJECTED'&&fold.status!=='EXPIRED')fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_MISMATCH');
        requireEqual(p.reportSha256,sha(fold.report.report_sha256,'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH'),'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH');
        requireEqual(p.simulatedEventSha256,fold.simulated.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');requireEqual(p.reportStatus,fold.status,'PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_MISMATCH');
        str(p.rejectionCode,'PAPER_ACCOUNT_V3_COMMAND_SIMULATION_REJECTED_PAYLOAD_INVALID');checkTerminalResult(command!,p,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');
        if(fold.fills.length)fail('PAPER_ACCOUNT_V3_COMMAND_REJECTED_HAS_FILLS');fold.state='REJECTED';fold.terminal=event;continue;
      }
      if(type==='SETTLEMENT') {
        exactKeys(p,SETTLEMENT_KEYS,'PAPER_ACCOUNT_V3_COMMAND_SETTLEMENT_PAYLOAD_INVALID');if(fold.state!=='SIMULATED'||!fold.simulated||!fold.report)return fail('PAPER_ACCOUNT_V3_COMMAND_ILLEGAL_TRANSITION');
        if(fold.status!=='FILLED')fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_STATUS_MISMATCH');
        requireEqual(p.reportSha256,sha(fold.report.report_sha256,'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH'),'PAPER_ACCOUNT_V3_COMMAND_REPORT_HASH_MISMATCH');
        requireEqual(p.simulatedEventSha256,fold.simulated.hash,'PAPER_ACCOUNT_V3_COMMAND_PREDECESSOR_MISMATCH');checkTerminalResult(command!,p,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');
        if(!Array.isArray(p.fillRefs)||p.fillRefs.length===0)fail('PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');
        const refs=p.fillRefs as unknown[];const ids=new Set<string>();const actual: Array<{fillId:string;fillOrdinal:number}>=[];
        for(let i=0;i<refs.length;i++) {const ref=object(refs[i],'PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');exactKeys(ref,['fillId','fillOrdinal'],'PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');
          const fillId=uuid(ref.fillId,'PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');const ordinal=integer(ref.fillOrdinal,'PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');
          if(ids.has(fillId)||ordinal!==i)fail('PAPER_ACCOUNT_V3_COMMAND_FILL_REFS_INVALID');ids.add(fillId);actual.push({fillId,fillOrdinal:ordinal});}
        const rows=[...fold.fills].sort((a,b)=>intText(a.fill_ordinal_text,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID')-intText(b.fill_ordinal_text,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'));
        if(rows.length!==actual.length)fail('PAPER_ACCOUNT_V3_COMMAND_FILL_SET_MISMATCH');
        for(let i=0;i<rows.length;i++) {const f=rows[i];requireEqual(str(f.account_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),str(command!.account_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'),'PAPER_ACCOUNT_V3_COMMAND_FILL_SCOPE_MISMATCH');
          requireEqual(str(f.generation_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),str(command!.generation_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'),'PAPER_ACCOUNT_V3_COMMAND_FILL_SCOPE_MISMATCH');
          requireEqual(uuid(f.command_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),uuid(command!.command_id,'PAPER_ACCOUNT_V3_COMMAND_ROW_INVALID'),'PAPER_ACCOUNT_V3_COMMAND_FILL_SCOPE_MISMATCH');
          requireEqual(uuid(f.fill_id,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),actual[i].fillId,'PAPER_ACCOUNT_V3_COMMAND_FILL_SET_MISMATCH');
          requireEqual(intText(f.fill_ordinal_text,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),actual[i].fillOrdinal,'PAPER_ACCOUNT_V3_COMMAND_FILL_SET_MISMATCH');
          requireEqual(sha(f.report_sha256,'PAPER_ACCOUNT_V3_COMMAND_FILL_INVALID'),p.reportSha256,'PAPER_ACCOUNT_V3_COMMAND_FILL_REPORT_MISMATCH');}
        fold.state='SETTLED';fold.terminal=event;settlementsVerified++;continue;
      }
      fail('PAPER_ACCOUNT_V3_COMMAND_EVENT_UNSUPPORTED');
    }
    if(folds.size!==commands.size)fail('PAPER_ACCOUNT_V3_COMMAND_ORPHAN_ROW');
    if(reservations.size!==commands.size)fail('PAPER_ACCOUNT_V3_COMMAND_RESERVATION_ORPHAN');
    for(const [k,command] of commands) {
      const fold=folds.get(k);if(!fold)return fail('PAPER_ACCOUNT_V3_COMMAND_ORPHAN_ROW');
      if(command.command_state!==fold.state)fail('PAPER_ACCOUNT_V3_COMMAND_STATE_PROJECTION_MISMATCH');
      if(fold.state==='ACCEPTED'||fold.state==='SIMULATED'||fold.state==='UNRESOLVED') {
        if(command.terminal_result_bytes!==null||command.terminal_result_sha256!==null)fail('PAPER_ACCOUNT_V3_COMMAND_UNEXPECTED_TERMINAL_RESULT');
      }
      const reservation=reservations.get(k)!;
      const expectedReservation=fold.state==='SETTLED'?'CONSUMED':fold.state==='REJECTED'||fold.state==='CANCELLED_BEFORE_SIMULATION'?'RELEASED':fold.state==='UNRESOLVED'||fold.state==='MANUALLY_RESOLVED'?'UNRESOLVED_HOLD':'OPEN';
      requireEqual(reservation.reservation_state,expectedReservation,'PAPER_ACCOUNT_V3_COMMAND_RESERVATION_STATE_MISMATCH');
      const report=reports.get(k);if(Boolean(report)!==Boolean(fold.simulated))fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORPHAN');
      if(Boolean(report)!==Boolean(fold.report))fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORPHAN');
      if((fold.state==='ACCEPTED'||fold.state==='SIMULATED'||fold.state==='UNRESOLVED')&&command.terminal_result_bytes!==null) {
        if(command.terminal_result_sha256===null)fail('PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');
        parsedHash(command.terminal_result_bytes,command.terminal_result_sha256,'PAPER_ACCOUNT_V3_COMMAND_TERMINAL_RESULT_MISMATCH');
      }
    }
    for(const k of reports.keys()) {const fold=folds.get(k);if(!fold?.simulated)fail('PAPER_ACCOUNT_V3_COMMAND_REPORT_ORPHAN');}
    for(const k of fillsByCommand.keys()) {const fold=folds.get(k);if(!fold||fold.state!=='SETTLED')fail('PAPER_ACCOUNT_V3_COMMAND_FILL_ORPHAN');}
    // Journal integrity verifies the bootstrap prefix, the owner subfold verifies OWNER_* events,
    // and this fold verifies command lifecycle events. Other event families remain unsupported.
    const unsupportedEventTypes=owner.unsupportedEventTypes.filter(x=>!COMMAND_TYPES.has(x.eventType));
    db.exec('COMMIT');active=false;
    return {...owner,unsupportedEventTypes,commandLifecycleConsistencyVerified:owner.unknownUnsupportedEventRowCount===0,lifecycleEventsVerified,commandsVerified:folds.size,
      reportsVerified:reports.size,settlementsVerified,atomicityVerified:false,economicsVerified:false,semanticsVerified:false,admissionEligible:false,held:true};
  } catch(error) {
    if(active)try{db.exec('ROLLBACK');}catch(rollbackError){throw new Error('PAPER_ACCOUNT_V3_COMMAND_READ_SNAPSHOT_ROLLBACK_FAILED',{cause:rollbackError});}
    throw error;
  }
}

import {createHash} from 'node:crypto';

export type PaperLedgerKernelEvent =
  | {readonly type:'COMMAND_ACCEPTED'; readonly commandId:string; readonly requestFingerprint:string; readonly atMs:number}
  | {readonly type:'SIMULATED'; readonly commandId:string; readonly reportFingerprint:string; readonly reportJson:string; readonly recordedAtMs:number}
  | {readonly type:'SETTLEMENT'; readonly commandId:string; readonly fillId:string; readonly reportFingerprint:string; readonly atMs:number; readonly mint:string; readonly tokenDecimals:number; readonly cashDeltaLamports:string; readonly tokenDeltaRaw:string}
  | {readonly type:'COMMAND_UNRESOLVED'; readonly commandId:string; readonly reasonCode:string; readonly atMs:number}
  | {readonly type:'RISK_WATERMARK'; readonly mint:string; readonly sourceId:string; readonly sourceSequence:number; readonly policyVersion:string; readonly observedAtMs:number; readonly recordedAtMs:number; readonly markMicroUsd:string; readonly proposedStopMicroUsd:string}
  | {readonly type:'RISK_UNRESOLVED'; readonly mint:string; readonly reasonCode:string; readonly atMs:number};

export interface PaperLedgerKernelGenesis {
  readonly accountId:string;
  readonly generationId:string;
  readonly openingCashLamports:string;
  readonly createdAtMs:number;
  readonly watermarkFreshnessMs:number;
  readonly watermarkPolicyVersion:string;
  readonly expectedOwnerEpoch:number;
}
export interface PaperLedgerKernelState {
  readonly accountId:string;
  readonly generationId:string;
  readonly foldVersion:number;
  readonly cashLamports:string;
  readonly tokens:Readonly<Record<string,{readonly decimals:number;readonly raw:string}>>;
  readonly risk:Readonly<Record<string,{readonly markMicroUsd:string|null;readonly markAtMs:number|null;readonly sourceId:string|null;readonly sourceSequence:number|null;readonly peakMicroUsd:string|null;readonly troughMicroUsd:string|null;readonly stopMicroUsd:string;readonly unresolved:boolean}>>;
  readonly commands:Readonly<Record<string,{readonly requestFingerprint:string;readonly state:'ACCEPTED'|'SIMULATED'|'SETTLED'|'UNRESOLVED';readonly fillId:string|null;readonly reportFingerprint:string|null;readonly reportJson:string|null}>>;
  readonly appliedEventCount:number;
  readonly watermarkFreshnessMs:number;
  readonly watermarkPolicyVersion:string;
  readonly expectedOwnerEpoch:number;
  readonly lastEventSequence:number;
  readonly lastEventId:string|null;
  readonly lastEventFingerprint:string|null;
  readonly lastEventHash:string;
}
export interface PaperLedgerKernelEventEnvelope {
  readonly eventId:string;
  readonly eventSequence:number;
  readonly ownerEpoch:number;
  readonly event:PaperLedgerKernelEvent;
}

const integer = /^(?:0|-?[1-9][0-9]*)$/;
const identifier = (value:unknown):value is string => typeof value==='string' && value.length>0 && value.length<=200 && !/[\u0000-\u001f]/.test(value);
export function canonicalPaperLedgerKernelJson(value:unknown, depth=0):string {
  if(depth>32) throw new Error('PAPER_LEDGER_KERNEL_JSON_TOO_DEEP');
  if(value===null || typeof value==='string' || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number') { if(!Number.isSafeInteger(value)) throw new Error('PAPER_LEDGER_KERNEL_JSON_UNSAFE_NUMBER'); return String(value); }
  if(Array.isArray(value)) {
    const parts:string[]=[];
    for(let i=0;i<value.length;i++) { const d=Object.getOwnPropertyDescriptor(value,String(i)); if(!d || !('value' in d) || !d.enumerable) throw new Error('PAPER_LEDGER_KERNEL_JSON_INVALID'); parts.push(canonicalPaperLedgerKernelJson(d.value,depth+1)); }
    if(Reflect.ownKeys(value).some(k=>k!=='length' && (typeof k!=='string' || !/^(0|[1-9][0-9]*)$/.test(k) || Number(k)>=value.length))) throw new Error('PAPER_LEDGER_KERNEL_JSON_INVALID');
    return `[${parts.join(',')}]`;
  }
  if(!value || Object.getPrototypeOf(value)!==Object.prototype) throw new Error('PAPER_LEDGER_KERNEL_JSON_INVALID');
  const keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=='string')) throw new Error('PAPER_LEDGER_KERNEL_JSON_INVALID');
  return `{${(keys as string[]).sort().map(k=>{const d=Object.getOwnPropertyDescriptor(value,k);if(!d||!('value'in d)||!d.enumerable)throw new Error('PAPER_LEDGER_KERNEL_JSON_INVALID');return `${JSON.stringify(k)}:${canonicalPaperLedgerKernelJson(d.value,depth+1)}`;}).join(',')}}`;
}
export const paperLedgerKernelSha256=(value:string):string=>createHash('sha256').update(value).digest('hex');
function amount(value:string, name:string):bigint { if(typeof value!=='string'||!integer.test(value)||value.length>80)throw new Error(`PAPER_LEDGER_KERNEL_${name}_INVALID`); return BigInt(value); }
function validTime(value:number,name:string):void { if(!Number.isSafeInteger(value)||value<0)throw new Error(`PAPER_LEDGER_KERNEL_${name}_INVALID`); }
export function createPaperLedgerKernelState(genesis:PaperLedgerKernelGenesis):PaperLedgerKernelState {
  if(!identifier(genesis.accountId)||!identifier(genesis.generationId))throw new Error('PAPER_LEDGER_KERNEL_SCOPE_INVALID');
  validTime(genesis.createdAtMs,'GENESIS_TIME');
  if(!Number.isSafeInteger(genesis.watermarkFreshnessMs)||genesis.watermarkFreshnessMs<1||genesis.watermarkFreshnessMs>86_400_000)throw new Error('PAPER_LEDGER_KERNEL_FRESHNESS_INVALID');
  if(!identifier(genesis.watermarkPolicyVersion))throw new Error('PAPER_LEDGER_KERNEL_POLICY_VERSION_INVALID');
  if(!Number.isSafeInteger(genesis.expectedOwnerEpoch)||genesis.expectedOwnerEpoch<1)throw new Error('PAPER_LEDGER_KERNEL_EXPECTED_EPOCH_INVALID');
  const opening=amount(genesis.openingCashLamports,'OPENING_CASH'); if(opening<0n)throw new Error('PAPER_LEDGER_KERNEL_OPENING_CASH_INVALID');
  return {accountId:genesis.accountId,generationId:genesis.generationId,foldVersion:0,cashLamports:opening.toString(),tokens:{},risk:{},commands:{},appliedEventCount:0,watermarkFreshnessMs:genesis.watermarkFreshnessMs,watermarkPolicyVersion:genesis.watermarkPolicyVersion,expectedOwnerEpoch:genesis.expectedOwnerEpoch,lastEventSequence:0,lastEventId:null,lastEventFingerprint:null,lastEventHash:'0'.repeat(64)};
}

/**
 * Offline, nonpersistent accounting-kernel prototype. This is not a GatewayStateSnapshot reducer, stored projection,
 * account-recovery facility, ownership lease, or writer/admission API. expectedOwnerEpoch only binds a test fold context;
 * it does not provide cross-process fencing. The cursor supports exact latest-event retry; older replays are rejected.
 */
export function reducePaperLedgerKernelEvent(previous:PaperLedgerKernelState, envelope:PaperLedgerKernelEventEnvelope):PaperLedgerKernelState {
  const envelopeJson=canonicalPaperLedgerKernelJson(envelope);
  const fingerprint=paperLedgerKernelSha256(envelopeJson);
  if(!identifier(envelope.eventId)||!Number.isSafeInteger(envelope.eventSequence)||envelope.eventSequence<1||!Number.isSafeInteger(envelope.ownerEpoch)||envelope.ownerEpoch<1)throw new Error('PAPER_LEDGER_KERNEL_EVENT_ENVELOPE_INVALID');
  if(envelope.ownerEpoch!==previous.expectedOwnerEpoch)throw new Error('PAPER_LEDGER_KERNEL_EXPECTED_EPOCH_MISMATCH');
  if(envelope.eventSequence===previous.lastEventSequence) {
    if(previous.lastEventId===envelope.eventId&&previous.lastEventFingerprint===fingerprint)return previous;
    throw new Error('PAPER_LEDGER_KERNEL_EVENT_IDEMPOTENCY_CONFLICT');
  }
  if(envelope.eventSequence!==previous.lastEventSequence+1)throw new Error('PAPER_LEDGER_KERNEL_EVENT_SEQUENCE_INVALID');
  const event=envelope.event;
  const tokens={...previous.tokens}; const risk={...previous.risk}; const commands={...previous.commands}; let cash=BigInt(previous.cashLamports);
  if(event.type==='COMMAND_ACCEPTED') {
    if(!identifier(event.commandId)||! /^[a-f0-9]{64}$/.test(event.requestFingerprint))throw new Error('PAPER_LEDGER_KERNEL_COMMAND_INVALID'); validTime(event.atMs,'EVENT_TIME');
    const prior=commands[event.commandId]; if(prior) {if(prior.requestFingerprint!==event.requestFingerprint)throw new Error('PAPER_LEDGER_KERNEL_IDEMPOTENCY_CONFLICT');throw new Error('PAPER_LEDGER_KERNEL_COMMAND_EVENT_DUPLICATE');}
    commands[event.commandId]={requestFingerprint:event.requestFingerprint,state:'ACCEPTED',fillId:null,reportFingerprint:null,reportJson:null};
  } else if(event.type==='SIMULATED') {
    if(!identifier(event.commandId)||! /^[a-f0-9]{64}$/.test(event.reportFingerprint)||typeof event.reportJson!=='string')throw new Error('PAPER_LEDGER_KERNEL_REPORT_INVALID'); validTime(event.recordedAtMs,'RECORDED_TIME');
    let parsed:unknown; try { parsed=JSON.parse(event.reportJson); } catch { throw new Error('PAPER_LEDGER_KERNEL_REPORT_INVALID'); }
    if(canonicalPaperLedgerKernelJson(parsed)!==event.reportJson||paperLedgerKernelSha256(event.reportJson)!==event.reportFingerprint)throw new Error('PAPER_LEDGER_KERNEL_REPORT_FINGERPRINT_MISMATCH');
    const command=commands[event.commandId]; if(!command)throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_FOUND'); if(command.state!=='ACCEPTED')throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_SIMULATABLE');
    commands[event.commandId]={...command,state:'SIMULATED',reportFingerprint:event.reportFingerprint,reportJson:event.reportJson};
  } else if(event.type==='SETTLEMENT') {
    if(!identifier(event.commandId)||!identifier(event.fillId)||!identifier(event.mint)||! /^[a-f0-9]{64}$/.test(event.reportFingerprint))throw new Error('PAPER_LEDGER_KERNEL_SETTLEMENT_INVALID'); validTime(event.atMs,'EVENT_TIME');
    if(!Number.isSafeInteger(event.tokenDecimals)||event.tokenDecimals<0||event.tokenDecimals>255)throw new Error('PAPER_LEDGER_KERNEL_TOKEN_DECIMALS_INVALID');
    const command=commands[event.commandId]; if(!command)throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_FOUND'); if(command.state!=='SIMULATED')throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_SETTLEABLE'); if(command.reportFingerprint!==event.reportFingerprint)throw new Error('PAPER_LEDGER_KERNEL_REPORT_FINGERPRINT_MISMATCH');
    if(Object.values(commands).some(item=>item.fillId===event.fillId))throw new Error('PAPER_LEDGER_KERNEL_FILL_ID_CONFLICT');
    const cashDelta=amount(event.cashDeltaLamports,'CASH_DELTA'); const tokenDelta=amount(event.tokenDeltaRaw,'TOKEN_DELTA');
    const nextCash=cash+cashDelta; if(nextCash<0n)throw new Error('PAPER_LEDGER_KERNEL_CASH_UNDERFLOW');
    const prior=tokens[event.mint]; if(prior&&prior.decimals!==event.tokenDecimals)throw new Error('PAPER_LEDGER_KERNEL_TOKEN_DECIMALS_CONFLICT');
    const nextRaw=BigInt(prior?.raw??'0')+tokenDelta; if(nextRaw<0n)throw new Error('PAPER_LEDGER_KERNEL_TOKEN_UNDERFLOW');
    cash=nextCash; tokens[event.mint]={decimals:event.tokenDecimals,raw:nextRaw.toString()}; commands[event.commandId]={...command,state:'SETTLED',fillId:event.fillId};
  } else if(event.type==='COMMAND_UNRESOLVED') {
    if(!identifier(event.commandId)||!identifier(event.reasonCode))throw new Error('PAPER_LEDGER_KERNEL_COMMAND_INVALID'); validTime(event.atMs,'EVENT_TIME');
    const command=commands[event.commandId]; if(!command)throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_FOUND'); if(command.state==='SETTLED'||command.state==='UNRESOLVED')throw new Error('PAPER_LEDGER_KERNEL_COMMAND_NOT_UNRESOLVABLE');
    commands[event.commandId]={...command,state:'UNRESOLVED'};
  } else if(event.type==='RISK_WATERMARK') {
    if(!identifier(event.mint)||!identifier(event.sourceId)||!Number.isSafeInteger(event.sourceSequence)||event.sourceSequence<0)throw new Error('PAPER_LEDGER_KERNEL_WATERMARK_INVALID');
    validTime(event.observedAtMs,'OBSERVED_TIME'); validTime(event.recordedAtMs,'RECORDED_TIME');
    if(!identifier(event.policyVersion)||event.policyVersion!==previous.watermarkPolicyVersion)throw new Error('PAPER_LEDGER_KERNEL_POLICY_VERSION_CONFLICT');
    const mark=amount(event.markMicroUsd,'MARK'); const stop=amount(event.proposedStopMicroUsd,'STOP'); if(mark<=0n||stop<0n||stop>mark)throw new Error('PAPER_LEDGER_KERNEL_WATERMARK_VALUE_INVALID');
    if(!tokens[event.mint]||BigInt(tokens[event.mint]!.raw)<=0n)throw new Error('PAPER_LEDGER_KERNEL_RISK_POSITION_NOT_FOUND');
    const old=risk[event.mint]; if(old?.unresolved)throw new Error('PAPER_LEDGER_KERNEL_WATERMARK_UNRESOLVED');
    const fresh=event.observedAtMs<=event.recordedAtMs && event.recordedAtMs-event.observedAtMs<=previous.watermarkFreshnessMs;
    const ordered=!old || old.markAtMs===null || event.observedAtMs>old.markAtMs ||
      (event.observedAtMs===old.markAtMs && event.sourceId===old.sourceId && event.sourceSequence>(old.sourceSequence??-1));
    if(fresh&&ordered) {
      const peak=old?.peakMicroUsd===null||old?.peakMicroUsd===undefined?mark:BigInt(old.peakMicroUsd)>mark?BigInt(old.peakMicroUsd):mark;
      const trough=old?.troughMicroUsd===null||old?.troughMicroUsd===undefined?mark:BigInt(old.troughMicroUsd)<mark?BigInt(old.troughMicroUsd):mark;
      const oldStop=BigInt(old?.stopMicroUsd??'0'); const nextStop=stop>oldStop?stop:oldStop;
      risk[event.mint]={markMicroUsd:mark.toString(),markAtMs:event.observedAtMs,sourceId:event.sourceId,sourceSequence:event.sourceSequence,peakMicroUsd:peak.toString(),troughMicroUsd:trough.toString(),stopMicroUsd:nextStop.toString(),unresolved:false};
    }
  } else {
    if(!identifier(event.mint)||!identifier(event.reasonCode))throw new Error('PAPER_LEDGER_KERNEL_WATERMARK_INVALID'); validTime(event.atMs,'EVENT_TIME');
    const old=risk[event.mint]; risk[event.mint]={markMicroUsd:old?.markMicroUsd??null,markAtMs:old?.markAtMs??null,sourceId:old?.sourceId??null,sourceSequence:old?.sourceSequence??null,peakMicroUsd:old?.peakMicroUsd??null,troughMicroUsd:old?.troughMicroUsd??null,stopMicroUsd:old?.stopMicroUsd??'0',unresolved:true};
  }
  const eventHash=paperLedgerKernelEventChainHash(previous.lastEventHash,envelopeJson);
  return {accountId:previous.accountId,generationId:previous.generationId,foldVersion:previous.foldVersion+1,cashLamports:cash.toString(),tokens,risk,commands,appliedEventCount:previous.appliedEventCount+1,watermarkFreshnessMs:previous.watermarkFreshnessMs,watermarkPolicyVersion:previous.watermarkPolicyVersion,expectedOwnerEpoch:previous.expectedOwnerEpoch,lastEventSequence:envelope.eventSequence,lastEventId:envelope.eventId,lastEventFingerprint:fingerprint,lastEventHash:eventHash};
}

export function paperLedgerKernelStateHash(state:PaperLedgerKernelState):string { return paperLedgerKernelSha256(canonicalPaperLedgerKernelJson(state)); }
export function paperLedgerKernelEventChainHash(previousHash:string,canonicalEnvelopeJson:string):string {
  if(!/^[a-f0-9]{64}$/.test(previousHash))throw new Error('PAPER_LEDGER_KERNEL_PREVIOUS_HASH_INVALID');
  return paperLedgerKernelSha256(`${previousHash}\n${canonicalEnvelopeJson}`);
}

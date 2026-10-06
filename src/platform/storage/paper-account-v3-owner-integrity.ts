import {DatabaseSync} from 'node:sqlite';
import {canonicalSylphJcs1Snapshot,serializeSylphJcs1} from './paper-account-v3-codec.js';
import {verifyPaperAccountV3JournalIntegrityInSnapshot,type PaperAccountV3JournalIntegrity} from './paper-account-v3-integrity.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const LEASE_MS=30_000;
const MAX_UNCERTAINTY_MS=1_000;
const MAX_WALL_MONOTONIC_SKEW_MS=1_000n;
const fail=(code:string):never=>{throw new Error(code);};

const ACQUIRED_KEYS=['acquiredAtMs','activationRequestFingerprint','authorizationId','clockObservation','leaseDurationMs','leaseExpiresAtMs','newEpoch','newLeaseId',
  'newOwnerId','priorEpoch','priorLeaseId','priorOwnerId','processLockIdentity','reason'];
const RENEWED_KEYS=['clockObservation','leaseDurationMs','priorLeaseExpiresAtMs','newLeaseExpiresAtMs','ownerEpoch','ownerId','leaseId','processLockIdentity','renewedAtMs'];
const RELEASED_KEYS=['clockObservation','leaseExpiresAtMs','ownerEpoch','ownerId','leaseId','processLockIdentity','reason','releasedAtMs'];
const FENCED_KEYS=['clockObservation','fencedAtMs','newEpoch','newLeaseId','newOwnerId','oldEpoch','oldLeaseExpiresAtMs','oldLeaseId','oldOwnerId','processLockIdentity','reason'];
const CLOCK_KEYS=['bootId','monotonicNanoseconds','sourceId','synchronized','uncertaintyMs','wallUnixMs'];
const LOCK_KEYS=['hostId','lockNonce','pid','processStartToken'];
const OWNER_EVENT_NAMES=new Set(['OWNER_ACQUIRED','OWNER_RENEWED','OWNER_RELEASED','OWNER_FENCED']);

type Clock={bootId:string;monotonicNanoseconds:string;sourceId:string;synchronized:true;uncertaintyMs:number;wallUnixMs:number};
type ProcessLock={hostId:string;lockNonce:string;pid:number;processStartToken:string};
type OwnerState={epoch:number;ownerId:string|null;leaseId:string|null;leaseUntilMs:number|null;renewedAtMs:number|null;lock:ProcessLock|null;clock:Clock|null;hostId:string|null;
  activationId:string|null;activationFingerprint:string|null;activationGenerationId:string|null;activationFinalized:boolean;released:boolean;}
type Fence={oldEpoch:number;newEpoch:number;oldOwnerId:string;oldLeaseId:string;oldLeaseUntilMs:number;newOwnerId:string;newLeaseId:string;lock:ProcessLock;
  clock:Clock;fencedAtMs:number;generationId:string;accountSequence:number};
type EventRow={account_id:unknown;generation_id:unknown;event_id:unknown;account_sequence_text:unknown;event_type:unknown;payload_version_text:unknown;
  owner_epoch_text:unknown;payload_bytes:unknown};
type AccountRow={account_id:unknown;owner_id:unknown;owner_epoch_text:unknown;lease_id:unknown;lease_until_ms_text:unknown;lease_renewed_at_ms_text:unknown};

function exactKeys(value:Record<string,unknown>,keys:string[],code:string):void {
  const actual=Object.keys(value).sort();const expected=[...keys].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail(code);
}
function object(value:unknown,code:string):Record<string,unknown> {
  if(typeof value!=='object'||value===null||Array.isArray(value))return fail(code);
  return value as Record<string,unknown>;
}
function text(value:unknown,code:string):string {
  if(typeof value!=='string'||value.length===0)return fail(code);
  return value;
}
function uuid(value:unknown,code:string):string {
  const result=text(value,code);if(!UUID.test(result))fail(code);return result;
}
function sha(value:unknown,code:string):string {
  if(typeof value!=='string'||!HASH.test(value))return fail(code);
  return value;
}
function int(value:unknown,code:string,min=0):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return fail(code);
  return value;
}
function sqlInt(value:unknown,code:string,min=0):number {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))return fail(code);
  const parsed=BigInt(value);if(parsed<BigInt(min)||parsed>BigInt(Number.MAX_SAFE_INTEGER))return fail(code);
  return Number(parsed);
}
function optionalUuid(value:unknown,code:string):string|null{return value===null?null:uuid(value,code);}
function optionalHash(value:unknown,code:string):string|null{return value===null?null:sha(value,code);}
function addLease(time:number,code:string):number {
  const until=time+LEASE_MS;if(!Number.isSafeInteger(until))return fail(code);return until;
}
function parseClock(value:unknown):Clock {
  const record=object(value,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');exactKeys(record,CLOCK_KEYS,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  const bootId=text(record.bootId,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  const sourceId=text(record.sourceId,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  const monotonicNanoseconds=text(record.monotonicNanoseconds,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  if(!/^(0|[1-9][0-9]*)$/.test(monotonicNanoseconds)||record.synchronized!==true)fail('PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  const uncertaintyMs=int(record.uncertaintyMs,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  if(uncertaintyMs>MAX_UNCERTAINTY_MS)fail('PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID');
  return {bootId,sourceId,monotonicNanoseconds,synchronized:true,uncertaintyMs,wallUnixMs:int(record.wallUnixMs,'PAPER_ACCOUNT_V3_OWNER_CLOCK_INVALID')};
}
function parseLock(value:unknown):ProcessLock {
  const record=object(value,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID');exactKeys(record,LOCK_KEYS,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID');
  return {hostId:text(record.hostId,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID'),lockNonce:uuid(record.lockNonce,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID'),
    pid:int(record.pid,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID',1),processStartToken:text(record.processStartToken,'PAPER_ACCOUNT_V3_OWNER_LOCK_INVALID')};
}
function sameLock(left:ProcessLock|null,right:ProcessLock):boolean {
  return left!==null&&Buffer.from(serializeSylphJcs1(left)).equals(Buffer.from(serializeSylphJcs1(right)));
}
function decimalCompare(left:string,right:string):number {
  return left.length===right.length?(left<right?-1:left>right?1:0):(left.length<right.length?-1:1);
}
/** Returns exact later-earlier only when it is <= limit, without parsing attacker-sized BigInts. */
function decimalDifferenceAtMost(later:string,earlier:string,limit:bigint):bigint|null {
  if(decimalCompare(later,earlier)<0)return null;
  const limitText=limit.toString();let borrow=0;let index=0;let output='';
  for(let i=later.length-1,j=earlier.length-1;i>=0;i--,j--,index++) {
    let digit=(later.charCodeAt(i)-48)-(j>=0?earlier.charCodeAt(j)-48:0)-borrow;
    if(digit<0){digit+=10;borrow=1;}else borrow=0;
    if(index>=limitText.length&&digit!==0)return null;
    if(index<limitText.length)output=String.fromCharCode(48+digit)+output;
  }
  if(borrow!==0)return null;
  output=output.replace(/^0+(?=\d)/,'');
  if(decimalCompare(output,limitText)>0)return null;
  return BigInt(output);
}
function compareSameProcessClock(previous:Clock,current:Clock,code:string):void {
  if(previous.bootId!==current.bootId||previous.sourceId!==current.sourceId||current.wallUnixMs<previous.wallUnixMs||
     decimalCompare(current.monotonicNanoseconds,previous.monotonicNanoseconds)<=0)fail(code);
  const wallDelta=BigInt(current.wallUnixMs)-BigInt(previous.wallUnixMs);
  const expectedNanoseconds=wallDelta*1_000_000n;
  const max=expectedNanoseconds+MAX_WALL_MONOTONIC_SKEW_MS*1_000_000n;
  const min=expectedNanoseconds>MAX_WALL_MONOTONIC_SKEW_MS*1_000_000n?expectedNanoseconds-MAX_WALL_MONOTONIC_SKEW_MS*1_000_000n:0n;
  const delta=decimalDifferenceAtMost(current.monotonicNanoseconds,previous.monotonicNanoseconds,max);
  if(delta===null||delta<min)fail(code);
}
function validateAcquired(value:unknown,eventEpoch:number):{
  acquiredAtMs:number;activationFingerprint:string|null;authorizationId:string|null;clock:Clock;leaseUntilMs:number;newEpoch:number;newLeaseId:string;newOwnerId:string;
  priorEpoch:number;priorLeaseId:string|null;priorOwnerId:string|null;lock:ProcessLock;reason:string
} {
  const p=object(value,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');exactKeys(p,ACQUIRED_KEYS,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const clock=parseClock(p.clockObservation);const lock=parseLock(p.processLockIdentity);
  const reason=text(p.reason,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  if(!['INITIAL_ACTIVATION','RECOVERY_AFTER_RELEASE','EXPIRED_LEASE_TAKEOVER','ACTIVATION_RESUME'].includes(reason)||p.leaseDurationMs!==LEASE_MS)
    fail('PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const acquiredAtMs=int(p.acquiredAtMs,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const leaseUntilMs=int(p.leaseExpiresAtMs,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const priorEpoch=int(p.priorEpoch,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');const newEpoch=int(p.newEpoch,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID',1);
  const priorOwnerId=optionalUuid(p.priorOwnerId,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const priorLeaseId=optionalUuid(p.priorLeaseId,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const newOwnerId=uuid(p.newOwnerId,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');const newLeaseId=uuid(p.newLeaseId,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const authorizationId=optionalUuid(p.authorizationId,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const activationFingerprint=optionalHash(p.activationRequestFingerprint,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  if(acquiredAtMs!==clock.wallUnixMs||leaseUntilMs!==addLease(acquiredAtMs,'PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID')||newEpoch!==priorEpoch+1||
     !Number.isSafeInteger(newEpoch)||eventEpoch!==newEpoch)fail('PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  const activationReason=reason==='INITIAL_ACTIVATION'||reason==='ACTIVATION_RESUME';
  if(activationReason?authorizationId===null||activationFingerprint===null:authorizationId!==null||activationFingerprint!==null)
    fail('PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID');
  return {acquiredAtMs,activationFingerprint,authorizationId,clock,leaseUntilMs,newEpoch,newLeaseId,newOwnerId,priorEpoch,priorLeaseId,priorOwnerId,lock,reason};
}
function validateRenewed(value:unknown,eventEpoch:number):{
  clock:Clock;leaseDurationMs:number;priorLeaseUntilMs:number;newLeaseUntilMs:number;ownerEpoch:number;ownerId:string;leaseId:string;lock:ProcessLock;renewedAtMs:number
} {
  const p=object(value,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID');exactKeys(p,RENEWED_KEYS,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID');
  const clock=parseClock(p.clockObservation);const lock=parseLock(p.processLockIdentity);
  if(p.leaseDurationMs!==LEASE_MS)fail('PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID');
  return {clock,leaseDurationMs:LEASE_MS,priorLeaseUntilMs:int(p.priorLeaseExpiresAtMs,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID'),
    newLeaseUntilMs:int(p.newLeaseExpiresAtMs,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID'),ownerEpoch:int(p.ownerEpoch,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID',1),
    ownerId:uuid(p.ownerId,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID'),leaseId:uuid(p.leaseId,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID'),lock,
    renewedAtMs:int(p.renewedAtMs,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID')};
}
function validateReleased(value:unknown,eventEpoch:number):{clock:Clock;leaseUntilMs:number;ownerEpoch:number;ownerId:string;leaseId:string;lock:ProcessLock;reason:string;releasedAtMs:number} {
  const p=object(value,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');exactKeys(p,RELEASED_KEYS,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');
  const clock=parseClock(p.clockObservation);const lock=parseLock(p.processLockIdentity);const reason=text(p.reason,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');
  if(!['GRACEFUL_SHUTDOWN','OPERATOR_HOLD'].includes(reason))fail('PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');
  const releasedAtMs=int(p.releasedAtMs,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');
  const ownerEpoch=int(p.ownerEpoch,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID',1);
  if(releasedAtMs!==clock.wallUnixMs||ownerEpoch!==eventEpoch)fail('PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID');
  return {clock,leaseUntilMs:int(p.leaseExpiresAtMs,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID'),ownerEpoch,
    ownerId:uuid(p.ownerId,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID'),leaseId:uuid(p.leaseId,'PAPER_ACCOUNT_V3_OWNER_RELEASED_INVALID'),lock,reason,releasedAtMs};
}
function validateFenced(value:unknown,eventEpoch:number,eventGenerationId:string,eventSequence:number):Fence {
  const p=object(value,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');exactKeys(p,FENCED_KEYS,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  const clock=parseClock(p.clockObservation);const lock=parseLock(p.processLockIdentity);const reason=text(p.reason,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  if(reason!=='EXPIRED_LEASE_TAKEOVER')fail('PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  const fencedAtMs=int(p.fencedAtMs,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  const oldEpoch=int(p.oldEpoch,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID',1);const newEpoch=int(p.newEpoch,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID',2);
  const oldLeaseUntilMs=int(p.oldLeaseExpiresAtMs,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  if(fencedAtMs!==clock.wallUnixMs||eventEpoch!==oldEpoch||newEpoch!==oldEpoch+1||
     clock.wallUnixMs-clock.uncertaintyMs<oldLeaseUntilMs)fail('PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID');
  return {oldEpoch,newEpoch,oldOwnerId:uuid(p.oldOwnerId,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID'),oldLeaseId:uuid(p.oldLeaseId,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID'),
    oldLeaseUntilMs,newOwnerId:uuid(p.newOwnerId,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID'),newLeaseId:uuid(p.newLeaseId,'PAPER_ACCOUNT_V3_OWNER_FENCED_INVALID'),
    lock,clock,fencedAtMs,generationId:eventGenerationId,accountSequence:eventSequence};
}
function eventPayload(row:EventRow):Record<string,unknown> {
  if(!(row.payload_bytes instanceof Uint8Array))return fail('PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');
  try {return canonicalSylphJcs1Snapshot(row.payload_bytes).value;} catch {return fail('PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');}
}

export interface PaperAccountV3OwnerAccountConsistency {
  readonly accountId:string;
  readonly ownerEpoch:number;
  readonly ownerLeasePresent:boolean;
  readonly lastOwnerEventType:string|null;
}
export interface PaperAccountV3OwnerConsistency extends PaperAccountV3JournalIntegrity {
  readonly ownerJournalConsistencyVerified:true;
  /** Persisted row adjacency cannot prove both rows shared one SQLite COMMIT. */
  readonly atomicityVerified:false;
  readonly semanticsVerified:false;
  readonly admissionEligible:false;
  readonly held:true;
  readonly ownerAccounts:readonly PaperAccountV3OwnerAccountConsistency[];
  readonly ownerEventsVerified:number;
}

/** Read-only owner-event consistency subfold inside a caller-owned stable SQLite snapshot. */
export function verifyPaperAccountV3OwnerEventConsistencyInSnapshot(db:DatabaseSync):PaperAccountV3OwnerConsistency {
  if(!db.isTransaction)fail('PAPER_ACCOUNT_V3_OWNER_SNAPSHOT_TRANSACTION_REQUIRED');
  return verifyPaperAccountV3OwnerEventConsistencySnapshotBody(db);
}

function verifyPaperAccountV3OwnerEventConsistencySnapshotBody(db:DatabaseSync):PaperAccountV3OwnerConsistency {
    const integrity=verifyPaperAccountV3JournalIntegrityInSnapshot(db);
    const accountRows=db.prepare(`SELECT account_id,owner_id,CAST(owner_epoch AS TEXT) owner_epoch_text,lease_id,
      CASE WHEN lease_until_ms IS NULL THEN NULL ELSE CAST(lease_until_ms AS TEXT) END lease_until_ms_text,
      CASE WHEN lease_renewed_at_ms IS NULL THEN NULL ELSE CAST(lease_renewed_at_ms AS TEXT) END lease_renewed_at_ms_text
      FROM pa2_accounts ORDER BY account_id`).all() as AccountRow[];
    const eventRows=db.prepare(`SELECT account_id,generation_id,event_id,CAST(account_sequence AS TEXT) account_sequence_text,event_type,
      CAST(payload_version AS TEXT) payload_version_text,CAST(owner_epoch AS TEXT) owner_epoch_text,payload_bytes
      FROM pa2_events ORDER BY account_id,account_sequence`).all() as EventRow[];
    const rowsByAccount=new Map<string,EventRow[]>();
    for(const row of eventRows) {
      const accountId=text(row.account_id,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');
      const list=rowsByAccount.get(accountId)??[];list.push(row);rowsByAccount.set(accountId,list);
    }
    let ownerEventsVerified=0;
    const ownerAccounts:PaperAccountV3OwnerAccountConsistency[]=[];
    for(const accountRow of accountRows) {
      const accountId=text(accountRow.account_id,'PAPER_ACCOUNT_V3_OWNER_ACCOUNT_INVALID');
      const rows=rowsByAccount.get(accountId)??[];
      const state:OwnerState={epoch:0,ownerId:null,leaseId:null,leaseUntilMs:null,renewedAtMs:null,lock:null,clock:null,hostId:null,
        activationId:null,activationFingerprint:null,activationGenerationId:null,activationFinalized:false,released:false};
      const seenOwnerIds=new Set<string>();const seenLeaseIds=new Set<string>();const seenLockNonces=new Set<string>();
      let pendingFence:Fence|null=null;let lastOwnerEventType:string|null=null;
      for(let index=0;index<rows.length;index++) {
        const row=rows[index];const eventType=text(row.event_type,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');
        const eventEpoch=sqlInt(row.owner_epoch_text,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');
        const generationId=text(row.generation_id,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID');
        const accountSequence=sqlInt(row.account_sequence_text,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID',1);
        if(OWNER_EVENT_NAMES.has(eventType)&&sqlInt(row.payload_version_text,'PAPER_ACCOUNT_V3_OWNER_EVENT_INVALID',1)!==1)
          fail('PAPER_ACCOUNT_V3_OWNER_EVENT_VERSION_UNSUPPORTED');
        if(pendingFence!==null&&eventType!=='OWNER_ACQUIRED')fail('PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_NOT_ADJACENT');
        const payload=eventPayload(row);
        if(eventType==='OWNER_ACQUIRED') {
          const acquired=validateAcquired(payload,eventEpoch);
          if(seenOwnerIds.has(acquired.newOwnerId)||seenLeaseIds.has(acquired.newLeaseId))fail('PAPER_ACCOUNT_V3_OWNER_ID_REUSED');
          if(pendingFence!==null) {
            const fence=pendingFence;
            if(accountSequence!==fence.accountSequence+1||generationId!==fence.generationId||acquired.priorEpoch!==fence.oldEpoch||
               acquired.priorOwnerId!==fence.oldOwnerId||acquired.priorLeaseId!==fence.oldLeaseId||acquired.newEpoch!==fence.newEpoch||
               acquired.newOwnerId!==fence.newOwnerId||acquired.newLeaseId!==fence.newLeaseId||
               !Buffer.from(serializeSylphJcs1(acquired.lock)).equals(Buffer.from(serializeSylphJcs1(fence.lock)))||acquired.acquiredAtMs<fence.fencedAtMs)
              fail('PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_MISMATCH');
            if(fence.lock.hostId!==state.hostId||acquired.lock.hostId!==state.hostId)fail('PAPER_ACCOUNT_V3_OWNER_HOST_ID_MISMATCH');
            if(fence.clock.bootId!==acquired.clock.bootId||fence.clock.sourceId!==acquired.clock.sourceId)
              fail('PAPER_ACCOUNT_V3_OWNER_FENCE_CLOCK_SOURCE_MISMATCH');
            compareSameProcessClock(fence.clock,acquired.clock,'PAPER_ACCOUNT_V3_OWNER_CLOCK_DRIFT');
            if(state.activationId!==null&&!state.activationFinalized) {
              if(acquired.reason!=='ACTIVATION_RESUME'||state.activationFingerprint===null||
                 acquired.authorizationId!==state.activationId||acquired.activationFingerprint!==state.activationFingerprint||
                 generationId!==state.activationGenerationId)fail('PAPER_ACCOUNT_V3_OWNER_ACTIVATION_RESUME_MISMATCH');
            } else if(acquired.reason!=='EXPIRED_LEASE_TAKEOVER'||acquired.authorizationId!==null||acquired.activationFingerprint!==null)
              fail('PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_MISMATCH');
            if(seenLockNonces.has(acquired.lock.lockNonce)||acquired.lock.lockNonce!==fence.lock.lockNonce)fail('PAPER_ACCOUNT_V3_OWNER_LOCK_REUSED');
            pendingFence=null;
          } else {
            if(state.ownerId!==null||state.leaseId!==null||acquired.priorEpoch!==state.epoch||acquired.priorOwnerId!==null||acquired.priorLeaseId!==null||
               seenLockNonces.has(acquired.lock.lockNonce))fail('PAPER_ACCOUNT_V3_OWNER_ACQUIRE_STATE_INVALID');
            if(state.hostId!==null&&acquired.lock.hostId!==state.hostId)fail('PAPER_ACCOUNT_V3_OWNER_HOST_ID_MISMATCH');
            if(acquired.reason==='INITIAL_ACTIVATION') {
              if(state.epoch!==0||state.released||accountSequence!==3)
                fail('PAPER_ACCOUNT_V3_OWNER_INITIAL_ACQUIRE_INVALID');
            } else if(acquired.reason==='RECOVERY_AFTER_RELEASE') {
              if(!state.released||acquired.priorEpoch!==state.epoch||(state.activationId!==null&&!state.activationFinalized))
                fail('PAPER_ACCOUNT_V3_OWNER_RECOVERY_ACQUIRE_INVALID');
            } else fail('PAPER_ACCOUNT_V3_OWNER_ACQUIRE_STATE_INVALID');
            if(acquired.reason==='INITIAL_ACTIVATION') {
              state.activationId=acquired.authorizationId;state.activationFingerprint=acquired.activationFingerprint;
              state.activationGenerationId=generationId;state.activationFinalized=false;
            }
          }
          seenOwnerIds.add(acquired.newOwnerId);seenLeaseIds.add(acquired.newLeaseId);seenLockNonces.add(acquired.lock.lockNonce);
          state.epoch=acquired.newEpoch;state.ownerId=acquired.newOwnerId;state.leaseId=acquired.newLeaseId;state.leaseUntilMs=acquired.leaseUntilMs;
          state.renewedAtMs=acquired.acquiredAtMs;state.lock=acquired.lock;state.clock=acquired.clock;state.hostId??=acquired.lock.hostId;state.released=false;
          lastOwnerEventType=eventType;ownerEventsVerified++;continue;
        }
        if(eventType==='OWNER_FENCED') {
          if(state.ownerId===null||state.leaseId===null||state.leaseUntilMs===null||state.lock===null||state.clock===null||
             eventEpoch!==state.epoch)fail('PAPER_ACCOUNT_V3_OWNER_FENCE_STATE_INVALID');
          const currentLock=state.lock!;
          const fence=validateFenced(payload,eventEpoch,generationId,accountSequence);
          if(fence.oldEpoch!==state.epoch||fence.oldOwnerId!==state.ownerId||fence.oldLeaseId!==state.leaseId||fence.oldLeaseUntilMs!==state.leaseUntilMs||
             fence.newEpoch!==state.epoch+1||seenOwnerIds.has(fence.newOwnerId)||seenLeaseIds.has(fence.newLeaseId)||seenLockNonces.has(fence.lock.lockNonce)||
             fence.lock.lockNonce===currentLock.lockNonce||fence.lock.hostId!==state.hostId)fail('PAPER_ACCOUNT_V3_OWNER_FENCE_STATE_INVALID');
          pendingFence=fence;lastOwnerEventType=eventType;ownerEventsVerified++;continue;
        }
        if(eventType==='OWNER_RENEWED') {
          if(state.ownerId===null||state.leaseId===null||state.leaseUntilMs===null||state.renewedAtMs===null||state.lock===null||state.clock===null||
             eventEpoch!==state.epoch)fail('PAPER_ACCOUNT_V3_OWNER_RENEW_STATE_INVALID');
          const currentLock=state.lock!;const currentClock=state.clock!;const priorRenewedAtMs=state.renewedAtMs!;
          const renewed=validateRenewed(payload,eventEpoch);
          if(renewed.ownerEpoch!==state.epoch||renewed.ownerId!==state.ownerId||renewed.leaseId!==state.leaseId||!sameLock(currentLock,renewed.lock)||
             renewed.priorLeaseUntilMs!==state.leaseUntilMs||renewed.renewedAtMs<=priorRenewedAtMs||renewed.renewedAtMs>=state.leaseUntilMs||
             renewed.newLeaseUntilMs<=state.leaseUntilMs||renewed.newLeaseUntilMs!==addLease(renewed.renewedAtMs,'PAPER_ACCOUNT_V3_OWNER_RENEWED_INVALID'))
            fail('PAPER_ACCOUNT_V3_OWNER_RENEW_STATE_INVALID');
          compareSameProcessClock(currentClock,renewed.clock,'PAPER_ACCOUNT_V3_OWNER_CLOCK_DRIFT');
          state.leaseUntilMs=renewed.newLeaseUntilMs;state.renewedAtMs=renewed.renewedAtMs;state.clock=renewed.clock;
          lastOwnerEventType=eventType;ownerEventsVerified++;continue;
        }
        if(eventType==='OWNER_RELEASED') {
          if(state.ownerId===null||state.leaseId===null||state.leaseUntilMs===null||state.renewedAtMs===null||state.lock===null||state.clock===null||
             eventEpoch!==state.epoch)fail('PAPER_ACCOUNT_V3_OWNER_RELEASE_STATE_INVALID');
          const currentLock=state.lock!;const currentClock=state.clock!;const priorRenewedAtMs=state.renewedAtMs!;
          const released=validateReleased(payload,eventEpoch);
          if(released.ownerEpoch!==state.epoch||released.ownerId!==state.ownerId||released.leaseId!==state.leaseId||!sameLock(currentLock,released.lock)||
             released.leaseUntilMs!==state.leaseUntilMs||released.releasedAtMs<priorRenewedAtMs||released.releasedAtMs>=state.leaseUntilMs)
            fail('PAPER_ACCOUNT_V3_OWNER_RELEASE_STATE_INVALID');
          compareSameProcessClock(currentClock,released.clock,'PAPER_ACCOUNT_V3_OWNER_CLOCK_DRIFT');
          state.ownerId=null;state.leaseId=null;state.leaseUntilMs=null;state.renewedAtMs=null;state.lock=null;state.clock=null;state.released=true;
          lastOwnerEventType=eventType;ownerEventsVerified++;continue;
        }
        if(pendingFence!==null)fail('PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_NOT_ADJACENT');
        if(eventEpoch===0) {
          if(!['ACCOUNT_BOOTSTRAPPED','GENERATION_CREATED'].includes(eventType))fail('PAPER_ACCOUNT_V3_OWNER_ZERO_EPOCH_EVENT_INVALID');
          continue;
        }
        if(state.ownerId===null||state.ownerId.length===0||eventEpoch!==state.epoch)fail('PAPER_ACCOUNT_V3_OWNER_EVENT_WITHOUT_CURRENT_OWNER');
        if(eventType==='GENERATION_ACTIVATED'&&state.activationGenerationId===generationId)state.activationFinalized=true;
      }
      if(pendingFence!==null)fail('PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_INCOMPLETE');
      if(state.epoch!==sqlInt(accountRow.owner_epoch_text,'PAPER_ACCOUNT_V3_OWNER_PROJECTION_MISMATCH')||
         accountRow.owner_id!==state.ownerId||accountRow.lease_id!==state.leaseId||
         (accountRow.lease_until_ms_text===null?null:sqlInt(accountRow.lease_until_ms_text,'PAPER_ACCOUNT_V3_OWNER_PROJECTION_MISMATCH'))!==state.leaseUntilMs||
         (accountRow.lease_renewed_at_ms_text===null?null:sqlInt(accountRow.lease_renewed_at_ms_text,'PAPER_ACCOUNT_V3_OWNER_PROJECTION_MISMATCH'))!==state.renewedAtMs)
        fail('PAPER_ACCOUNT_V3_OWNER_PROJECTION_MISMATCH');
      ownerAccounts.push({accountId,ownerEpoch:state.epoch,ownerLeasePresent:state.ownerId!==null,lastOwnerEventType});
    }
    const unsupportedEventTypes=integrity.unsupportedEventTypes.filter(entry=>!OWNER_EVENT_NAMES.has(entry.eventType));
    return {...integrity,semanticsVerified:false,admissionEligible:false,held:true,unsupportedEventTypes,ownerJournalConsistencyVerified:true,atomicityVerified:false,
      ownerAccounts,ownerEventsVerified};
}

/** Owns one read snapshot for standalone callers; never writes persisted data. */
export function verifyPaperAccountV3OwnerEventConsistency(db:DatabaseSync):PaperAccountV3OwnerConsistency {
  if(db.isTransaction)fail('PAPER_ACCOUNT_V3_OWNER_SNAPSHOT_TRANSACTION_ALREADY_ACTIVE');
  db.exec('BEGIN DEFERRED');let active=true;
  try {
    const result=verifyPaperAccountV3OwnerEventConsistencyInSnapshot(db);
    db.exec('COMMIT');active=false;
    return result;
  } catch(error) {
    if(active) {
      try {db.exec('ROLLBACK');} catch(rollbackError) {throw new Error('PAPER_ACCOUNT_V3_OWNER_READ_SNAPSHOT_ROLLBACK_FAILED',{cause:rollbackError});}
    }
    throw error;
  }
}

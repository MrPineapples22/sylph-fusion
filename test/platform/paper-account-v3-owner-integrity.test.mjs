import test from 'node:test';
import assert from 'node:assert/strict';
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
const {verifyPaperAccountV3OwnerEventConsistency}=await import(ownerSpecifier);

const ids={owner1:'11111111-1111-4111-8111-111111111111',owner2:'22222222-2222-4222-8222-222222222222',
  lease1:'33333333-3333-4333-8333-333333333333',lease2:'44444444-4444-4444-8444-444444444444',
  lock1:'55555555-5555-4555-8555-555555555555',lock2:'66666666-6666-4666-8666-666666666666'};

async function withDb(t,run) {
  const folder=await mkdtemp(join(tmpdir(),'sylph-paper-owner-integrity-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const db=new DatabaseSync(join(folder,'owner.sqlite'),{timeout:5000});initializePaperAccountV3Schema(db);
  try {await run(db);} finally {db.close();}
}
function genesis() {
  return Buffer.from(serializeSylphJcs1({accountId:'acct',accountingPolicyHash:'1'.repeat(64),configHash:'2'.repeat(64),conversionPolicyHash:'3'.repeat(64),createdAtMs:7,
    createdBy:'operator:creator',generationId:'gen1',initialCapitalUsdMicro:'123456',initialCashAvailableUsdMicro:'123456',openingCashUsdMicro:'123456',
    origin:'EXPLICIT_OPERATOR_GENESIS',priorGenerationId:null,reason:'test genesis',riskPolicyHash:'4'.repeat(64),schemaVersion:2,simulatorBuildHash:'5'.repeat(64),
    simulatorReportSchema:'fill-report-v1',tokenMetadataPolicyHash:'6'.repeat(64)}));
}
function clock(wallUnixMs,monotonicNanoseconds) {
  return {bootId:'boot-A',monotonicNanoseconds:String(monotonicNanoseconds),sourceId:'clock-A',synchronized:true,uncertaintyMs:0,wallUnixMs};
}
function lock(hostId,lockNonce,pid=42) {return {hostId,lockNonce,pid,processStartToken:'start-token-A'};}
function acquired({at=10,epoch=1,ownerId=ids.owner1,leaseId=ids.lease1,priorEpoch=0,priorOwnerId=null,priorLeaseId=null,
  reason='INITIAL_ACTIVATION',lockIdentity=lock('host-A',ids.lock1),authorizationId='77777777-7777-4777-8777-777777777777',fingerprint='a'.repeat(64),mono=BigInt(at)*1_000_000n}={}) {
  return {acquiredAtMs:at,activationRequestFingerprint:['INITIAL_ACTIVATION','ACTIVATION_RESUME'].includes(reason)?fingerprint:null,
    authorizationId:['INITIAL_ACTIVATION','ACTIVATION_RESUME'].includes(reason)?authorizationId:null,clockObservation:clock(at,mono),
    leaseDurationMs:30000,leaseExpiresAtMs:at+30000,newEpoch:epoch,newLeaseId:leaseId,newOwnerId:ownerId,priorEpoch,priorLeaseId,priorOwnerId,
    processLockIdentity:lockIdentity,reason};
}
function append(db,{type,payload,epoch,at,generationId='gen1',payloadVersion=1}) {
  const previous=db.prepare('SELECT account_sequence,generation_sequence,event_sha256 FROM pa2_events WHERE account_id=? ORDER BY account_sequence DESC LIMIT 1').get('acct');
  const accountSequence=Number(previous.account_sequence)+1;
  const generationSequence=Number(db.prepare('SELECT COALESCE(MAX(generation_sequence),0)+1 n FROM pa2_events WHERE account_id=? AND generation_id=?').get('acct',generationId).n);
  const event={accountId:'acct',generationId,eventId:`${String(accountSequence).padStart(8,'0')}-1111-4111-8111-111111111111`,eventType:type,
    payloadVersion,accountSequence,generationSequence,ownerEpoch:epoch,occurredAtMs:at,recordedAtMs:at,
    payloadBytes:Buffer.from(serializeSylphJcs1(payload)),previousEventSha256:previous.event_sha256};
  const hashed={...event,...paperAccountV2EventHash(event)};
  db.prepare(`INSERT INTO pa2_events(account_id,generation_id,event_id,account_sequence,generation_sequence,event_type,payload_version,command_id,owner_epoch,
    occurred_at_ms,recorded_at_ms,payload_bytes,payload_sha256,previous_event_sha256,event_sha256) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)`)
    .run(hashed.accountId,hashed.generationId,hashed.eventId,hashed.accountSequence,hashed.generationSequence,hashed.eventType,hashed.payloadVersion,hashed.ownerEpoch,
      hashed.occurredAtMs,hashed.recordedAtMs,hashed.payloadBytes,hashed.payloadSha256,hashed.previousEventSha256,hashed.eventSha256);
  return hashed;
}
function bootstrap(db) {bootstrapPaperAccountV3(db,genesis(),'test-operator',10);}
function setOwner(db,{epoch,ownerId,leaseId,leaseUntil,renewedAt}) {
  db.prepare('UPDATE pa2_accounts SET owner_epoch=?,owner_id=?,lease_id=?,lease_until_ms=?,lease_renewed_at_ms=? WHERE account_id=?')
    .run(epoch,ownerId,leaseId,leaseUntil,renewedAt,'acct');
}
function snapshot(db) {
  return db.prepare('SELECT account_sequence,generation_sequence,event_type,event_sha256 FROM pa2_events ORDER BY account_sequence').all();
}

test('owner subfold verifies acquire, renewal, release and reacquisition while remaining held',async t=>{
  await withDb(t,db=>{
    bootstrap(db);
    append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'ACTIVATION_AUTHORIZATION_RESERVED',epoch:1,at:11,payload:{opaque:true}});
    append(db,{type:'GENERATION_ACTIVATED',epoch:1,at:12,payload:{opaque:true}});
    const renewedAt=20;
    append(db,{type:'OWNER_RENEWED',epoch:1,at:renewedAt,payload:{clockObservation:clock(renewedAt,20_000_000n),leaseDurationMs:30000,
      priorLeaseExpiresAtMs:30010,newLeaseExpiresAtMs:30020,ownerEpoch:1,ownerId:ids.owner1,leaseId:ids.lease1,processLockIdentity:lock('host-A',ids.lock1),renewedAtMs:renewedAt}});
    setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30020,renewedAt:20});
    const releasedAt=30;
    append(db,{type:'OWNER_RELEASED',epoch:1,at:releasedAt,payload:{clockObservation:clock(releasedAt,30_000_000n),leaseExpiresAtMs:30020,
      ownerEpoch:1,ownerId:ids.owner1,leaseId:ids.lease1,processLockIdentity:lock('host-A',ids.lock1),reason:'GRACEFUL_SHUTDOWN',releasedAtMs:releasedAt}});
    setOwner(db,{epoch:1,ownerId:null,leaseId:null,leaseUntil:null,renewedAt:null});
    append(db,{type:'OWNER_ACQUIRED',epoch:2,at:40,payload:acquired({at:40,epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,priorEpoch:1,reason:'RECOVERY_AFTER_RELEASE',
      lockIdentity:lock('host-A','88888888-8888-4888-8888-888888888888'),authorizationId:null,fingerprint:null})});
    setOwner(db,{epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,leaseUntil:30040,renewedAt:40});
    append(db,{type:'COMMAND_ACCEPTED',epoch:2,at:41,payload:{opaque:true}});
    append(db,{type:'SIMULATED',epoch:2,at:42,payload:{opaque:true}});
    append(db,{type:'SETTLED',epoch:2,at:43,payload:{opaque:true}});
    append(db,{type:'OWNER_FUTURE',epoch:2,at:44,payloadVersion:2,payload:{opaque:true}});
    const before=snapshot(db);const result=verifyPaperAccountV3OwnerEventConsistency(db);
    assert.equal(result.integrityVerified,true);assert.equal(result.ownerJournalConsistencyVerified,true);assert.equal(result.ownerEventsVerified,4);
    assert.equal(result.atomicityVerified,false);
    assert.equal(result.held,true);assert.equal(result.semanticsVerified,false);assert.equal(result.admissionEligible,false);
    assert.deepEqual(result.ownerAccounts,[{accountId:'acct',ownerEpoch:2,ownerLeasePresent:true,lastOwnerEventType:'OWNER_ACQUIRED'}]);
    for(const eventType of ['ACTIVATION_AUTHORIZATION_RESERVED','COMMAND_ACCEPTED','SIMULATED','SETTLED','OWNER_FUTURE'])
      assert.ok(result.unsupportedEventTypes.some(x=>x.eventType===eventType),`${eventType} must remain semantically unsupported`);
    assert.deepEqual(snapshot(db),before);
  });
});

test('owner subfold verifies contiguous expired-lease fence/acquire identity but does not infer atomic commit',async t=>{
  await withDb(t,db=>{
    bootstrap(db);
    append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'ACTIVATION_AUTHORIZATION_RESERVED',epoch:1,at:11,payload:{opaque:true}});
    const newLock=lock('host-A',ids.lock2,43);const fencedAt=30011;const takeoverClock=clock(fencedAt,31_000_000_000n);
    append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:takeoverClock,fencedAtMs:fencedAt,newEpoch:2,newLeaseId:ids.lease2,
      newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,processLockIdentity:newLock,reason:'EXPIRED_LEASE_TAKEOVER'}});
    append(db,{type:'OWNER_ACQUIRED',epoch:2,at:fencedAt,payload:acquired({at:fencedAt,epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,priorEpoch:1,
      priorOwnerId:ids.owner1,priorLeaseId:ids.lease1,reason:'ACTIVATION_RESUME',lockIdentity:newLock,mono:31_001_000_000n})});
    setOwner(db,{epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,leaseUntil:fencedAt+30000,renewedAt:fencedAt});
    const result=verifyPaperAccountV3OwnerEventConsistency(db);
    assert.equal(result.ownerJournalConsistencyVerified,true);assert.equal(result.atomicityVerified,false);assert.equal(result.held,true);assert.equal(result.admissionEligible,false);
    assert.equal(result.ownerEventsVerified,3);
  });
});

test('owner subfold rejects malformed payloads, stale renewal, incomplete and mismatched fence pairs',async t=>{
  await withDb(t,db=>{
    bootstrap(db);const extra={...acquired(),rogue:true};append(db,{type:'OWNER_ACQUIRED',payload:extra,epoch:1,at:10});
    setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_ACQUIRED_INVALID/);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'OWNER_RENEWED',epoch:1,at:30010,payload:{clockObservation:clock(30010,30_010_000_000n),leaseDurationMs:30000,
      priorLeaseExpiresAtMs:30010,newLeaseExpiresAtMs:60010,ownerEpoch:1,ownerId:ids.owner1,leaseId:ids.lease1,processLockIdentity:lock('host-A',ids.lock1),renewedAtMs:30010}});
    setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:60010,renewedAt:30010});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_RENEW_STATE_INVALID/);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    const fencedAt=30011;append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:clock(fencedAt,31_000_000_000n),fencedAtMs:fencedAt,newEpoch:2,
      newLeaseId:ids.lease2,newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,
      processLockIdentity:lock('host-A',ids.lock2),reason:'EXPIRED_LEASE_TAKEOVER'}});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_INCOMPLETE/);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'GENERATION_ACTIVATED',epoch:1,at:11,payload:{opaque:true}});
    const fencedAt=30011;const newLock=lock('host-A',ids.lock2,43);
    append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:clock(fencedAt,31_000_000_000n),fencedAtMs:fencedAt,newEpoch:2,
      newLeaseId:ids.lease2,newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,
      processLockIdentity:newLock,reason:'EXPIRED_LEASE_TAKEOVER'}});
    append(db,{type:'OWNER_ACQUIRED',epoch:2,at:fencedAt,payload:acquired({at:fencedAt,epoch:2,ownerId:ids.owner2,leaseId:'99999999-9999-4999-8999-999999999999',priorEpoch:1,
      priorOwnerId:ids.owner1,priorLeaseId:ids.lease1,reason:'EXPIRED_LEASE_TAKEOVER',lockIdentity:newLock,authorizationId:null,fingerprint:null,mono:31_001_000_000n})});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_FENCE_PAIR_MISMATCH/);
  });
  for(const eventType of ['OWNER_ACQUIRED','OWNER_RENEWED','OWNER_RELEASED','OWNER_FENCED']) await withDb(t,db=>{
    bootstrap(db);
    if(eventType!=='OWNER_ACQUIRED') {
      append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});
      setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    }
    append(db,{type:eventType,payload:{},epoch:eventType==='OWNER_ACQUIRED'?1:1,at:20,payloadVersion:2});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_EVENT_VERSION_UNSUPPORTED/,eventType);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'ACTIVATION_AUTHORIZATION_RESERVED',epoch:1,at:11,payload:{opaque:true}});
    const fencedAt=30011;const newLock=lock('host-A',ids.lock2,43);
    append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:clock(fencedAt,31_000_000_000n),fencedAtMs:fencedAt,newEpoch:2,
      newLeaseId:ids.lease2,newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,
      processLockIdentity:newLock,reason:'EXPIRED_LEASE_TAKEOVER'}});
    append(db,{type:'OWNER_ACQUIRED',epoch:2,at:fencedAt,payload:acquired({at:fencedAt,epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,priorEpoch:1,
      priorOwnerId:ids.owner1,priorLeaseId:ids.lease1,reason:'EXPIRED_LEASE_TAKEOVER',lockIdentity:newLock,authorizationId:null,fingerprint:null,mono:31_001_000_000n})});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_ACTIVATION_RESUME_MISMATCH/);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    const fencedAt=30011;
    append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:clock(fencedAt,31_000_000_000n),fencedAtMs:fencedAt,newEpoch:2,
      newLeaseId:ids.lease2,newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,
      processLockIdentity:lock('host-B',ids.lock2),reason:'EXPIRED_LEASE_TAKEOVER'}});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_FENCE_STATE_INVALID/);
  });
  await withDb(t,db=>{
    bootstrap(db);append(db,{type:'OWNER_ACQUIRED',payload:acquired(),epoch:1,at:10});setOwner(db,{epoch:1,ownerId:ids.owner1,leaseId:ids.lease1,leaseUntil:30010,renewedAt:10});
    append(db,{type:'ACTIVATION_AUTHORIZATION_RESERVED',epoch:1,at:11,payload:{opaque:true}});
    const fencedAt=30011;const newLock=lock('host-A',ids.lock2,43);
    append(db,{type:'OWNER_FENCED',epoch:1,at:fencedAt,payload:{clockObservation:clock(fencedAt,31_000_000_000n),fencedAtMs:fencedAt,newEpoch:2,
      newLeaseId:ids.lease2,newOwnerId:ids.owner2,oldEpoch:1,oldLeaseExpiresAtMs:30010,oldLeaseId:ids.lease1,oldOwnerId:ids.owner1,
      processLockIdentity:newLock,reason:'EXPIRED_LEASE_TAKEOVER'}});
    const wrongClock=clock(fencedAt,31_001_000_000n);wrongClock.sourceId='clock-B';
    const resumePayload=acquired({at:fencedAt,epoch:2,ownerId:ids.owner2,leaseId:ids.lease2,priorEpoch:1,priorOwnerId:ids.owner1,priorLeaseId:ids.lease1,
      reason:'ACTIVATION_RESUME',lockIdentity:newLock,mono:31_001_000_000n});resumePayload.clockObservation=wrongClock;
    append(db,{type:'OWNER_ACQUIRED',epoch:2,at:fencedAt,payload:resumePayload});
    assert.throws(()=>verifyPaperAccountV3OwnerEventConsistency(db),/PAPER_ACCOUNT_V3_OWNER_FENCE_CLOCK_SOURCE_MISMATCH/);
  });
});

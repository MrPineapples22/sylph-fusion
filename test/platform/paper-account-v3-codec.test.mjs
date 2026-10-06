import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {serializeSylphJcs1,parseSylphJcs1,paperAccountV2GenesisHash,paperAccountV2EventHash,verifyPaperAccountV2BootstrapPrefix,SYLPH_JCS1_MAX_BYTES} from '../../dist/platform/storage/paper-account-v3-codec.js';

const zero='0'.repeat(64);
const genesisText='{"accountId":"acct-vector","accountingPolicyHash":"'+zero+'","configHash":"'+zero+'","conversionPolicyHash":"'+zero+'","createdAtMs":7,"createdBy":"operator:test","generationId":"gen-1","initialCapitalUsdMicro":"123456","initialCashAvailableUsdMicro":"123456","openingCashUsdMicro":"123456","origin":"EXPLICIT_OPERATOR_GENESIS","priorGenerationId":null,"reason":"fixture","riskPolicyHash":"'+zero+'","schemaVersion":2,"simulatorBuildHash":"'+zero+'","simulatorReportSchema":"fill-report-v1","tokenMetadataPolicyHash":"'+zero+'"}';
const genesisBytes=Buffer.from(genesisText);
const firstPayload=Buffer.from('{"accountId":"acct-vector","bootstrapOrigin":"EXPLICIT_OPERATOR_GENESIS","generationId":"gen-1","genesisFingerprint":"eaead15793ddb9e3390528ace9dee85e82cbae192000163d8d62be8db296ec4c","operatorAuthorization":"operator:test"}');
const secondPayload=Buffer.from('{"accountingPolicyHash":"'+zero+'","configHash":"'+zero+'","conversionPolicyHash":"'+zero+'","createdBy":"operator:test","genesisSha256":"eaead15793ddb9e3390528ace9dee85e82cbae192000163d8d62be8db296ec4c","initialCapitalUsdMicro":"123456","openingCashUsdMicro":"123456","origin":"EXPLICIT_OPERATOR_GENESIS","priorGenerationId":null,"reason":"fixture","riskPolicyHash":"'+zero+'","schemaVersion":2,"simulatorBuildHash":"'+zero+'","simulatorReportSchema":"fill-report-v1","tokenMetadataPolicyHash":"'+zero+'"}');
function event(eventId,eventType,accountSequence,generationSequence,payloadBytes,previousEventSha256,recordedAtMs) {
  const envelope={accountId:'acct-vector',generationId:'gen-1',eventId,eventType,payloadVersion:1,accountSequence,generationSequence,ownerEpoch:0,occurredAtMs:7,recordedAtMs,payloadBytes,previousEventSha256};
  const hashes=paperAccountV2EventHash(envelope);return {...envelope,...hashes};
}
const events=[
  event('00000000-0000-4000-8000-000000000001','ACCOUNT_BOOTSTRAPPED',1,1,firstPayload,zero,8),
  event('00000000-0000-4000-8000-000000000002','GENERATION_CREATED',2,2,secondPayload,'d0d26dc90ae954629c89f86d28925f389606f19acdc7b9144116d5a7a7f92139',9),
];

test('SYLPH-JCS-1 serializer follows key ordering, escaping, UTF-8 and normalization rules',()=>{
  const value=Object.create(Object.prototype);
  Object.defineProperty(value,'😀',{value:'NFD: e\u0301',enumerable:true});
  Object.defineProperty(value,'\ue000',{value:'quote" slash\\ line\n',enumerable:true});
  Object.defineProperty(value,'a',{value:['é','e\u0301',true,null,0,9007199254740991],enumerable:true});
  const bytes=serializeSylphJcs1(value);
  assert.equal(Buffer.from(bytes).toString(),'{"a":["é","é",true,null,0,9007199254740991],"😀":"NFD: é","":"quote\\\" slash\\\\ line\\n"}');
  assert.deepEqual(parseSylphJcs1(bytes),JSON.parse(Buffer.from(bytes).toString()));
  assert.notDeepEqual(serializeSylphJcs1({x:'é'}),serializeSylphJcs1({x:'e\u0301'}));
  assert.equal(Buffer.from(serializeSylphJcs1({x:''})).toString(),'{"x":""}');
});

test('ingress rejects duplicate keys, malformed UTF-8, BOM, noncanonical syntax and invalid scalar/numeric values',()=>{
  for(const bytes of [Buffer.from('{"x":1,"x":1}'),Buffer.from('{"x":1.0}'),Buffer.from('{"x":1e0}'),Buffer.from('{"x":-0}'),Buffer.from('{ "x":1}'),Buffer.from('{"x":"\\u002f"}'),Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]),Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0xc0,0xaf,0x7d]),Buffer.from('{"x":"\\ud800"}')]) {
    assert.throws(()=>parseSylphJcs1(bytes));
  }
  for(const value of [{x:-0},{x:1.5},{x:Number.MAX_SAFE_INTEGER+1},{x:NaN},{x:undefined}]) assert.throws(()=>serializeSylphJcs1(value));
  assert.throws(()=>serializeSylphJcs1({'\ud800':'bad'}),/UNPAIRED_SURROGATE/);
});

test('ingress rejects accessors, symbols, non-enumerables, unusual prototypes, proxies and malformed arrays',()=>{
  let calls=0;const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>serializeSylphJcs1(accessor));assert.equal(calls,0);
  const hidden={};Object.defineProperty(hidden,'x',{value:1,enumerable:false});assert.throws(()=>serializeSylphJcs1(hidden));
  assert.throws(()=>serializeSylphJcs1({[Symbol('s')]:1}));
  assert.throws(()=>serializeSylphJcs1(Object.create(null)));
  assert.throws(()=>serializeSylphJcs1(new Proxy({},{})),/PROXY/);
  const sparse=[];sparse[1]=1;assert.throws(()=>serializeSylphJcs1({sparse}));
  const extra=[];extra.x=1;assert.throws(()=>serializeSylphJcs1({extra}));
  const arr=[];Object.defineProperty(arr,'0',{value:1,enumerable:false});arr.length=1;assert.throws(()=>serializeSylphJcs1({arr}));
  const sym=[];sym[Symbol('s')]=1;assert.throws(()=>serializeSylphJcs1({sym}));
});

test('byte ingress snapshots only bounded fixed ArrayBuffer views and rejects unsafe backing stores',()=>{
  const good=Buffer.from('{"x":1}');assert.deepEqual(parseSylphJcs1(good),{x:1});
  assert.throws(()=>parseSylphJcs1(new Proxy(new Uint8Array(good),{})),/BYTE_VIEW_INVALID/);
  assert.throws(()=>parseSylphJcs1(new Uint8Array(new SharedArrayBuffer(8))),/BYTE_BACKING_INVALID/);
  const resizableBacking=new ArrayBuffer(16,{maxByteLength:32});
  if(resizableBacking.resizable)assert.throws(()=>parseSylphJcs1(new Uint8Array(resizableBacking)),/BYTE_BACKING_INVALID/);
  const changedPrototype=new Uint8Array(good);Object.setPrototypeOf(changedPrototype,Object.create(Uint8Array.prototype));
  assert.throws(()=>parseSylphJcs1(changedPrototype),/BYTE_VIEW_INVALID/);
});

test('depth and byte limits are inclusive at 64 and 1 MiB for parse and serialization',()=>{
  let depth64={};for(let i=1;i<64;i++)depth64={x:depth64};
  assert.doesNotThrow(()=>serializeSylphJcs1(depth64));
  assert.throws(()=>serializeSylphJcs1({x:depth64}),/DEPTH_LIMIT/);
  const exactText='{"x":"'+'a'.repeat(SYLPH_JCS1_MAX_BYTES-8)+'"}';
  assert.equal(Buffer.byteLength(exactText),SYLPH_JCS1_MAX_BYTES);
  const exactBytes=Buffer.from(exactText);assert.equal(serializeSylphJcs1(parseSylphJcs1(exactBytes)).byteLength,SYLPH_JCS1_MAX_BYTES);
  assert.throws(()=>serializeSylphJcs1({x:'a'.repeat(SYLPH_JCS1_MAX_BYTES-7)}),/DOCUMENT_TOO_LARGE/);
  assert.throws(()=>parseSylphJcs1(Buffer.concat([exactBytes,Buffer.from(' ')])),/DOCUMENT_TOO_LARGE/);
});

test('framing, genesis and event hashes match pinned journal-valid bootstrap vectors',()=>{
  assert.equal(genesisBytes.byteLength,864);
  assert.equal(paperAccountV2GenesisHash(genesisBytes),'eaead15793ddb9e3390528ace9dee85e82cbae192000163d8d62be8db296ec4c');
  assert.equal(events[0].payloadSha256,'c9fb8a7872ed993a02a0852f31aa4bcc1b0547b864ea62fed8820341cc48a90c');
  assert.equal(events[0].eventSha256,'d0d26dc90ae954629c89f86d28925f389606f19acdc7b9144116d5a7a7f92139');
  assert.equal(events[1].payloadSha256,'d799dcf87f1ac0223bcf266fe3330370cfb4e3038aa407ab94ac9264b6a519c0');
  assert.equal(events[1].eventSha256,'93f03d2101fa7f9ba5862431c3a333e41cba10cdd267b1ea9591f5929cfe1049');
  assert.deepEqual(verifyPaperAccountV2BootstrapPrefix(genesisBytes,events),{accountId:'acct-vector',generationId:'gen-1',admissionState:'BLOCKED',generationState:'PENDING',ownerEpoch:0,lastAccountSequence:2,lastGenerationSequence:2,lastEventSha256:events[1].eventSha256,genesisSha256:'eaead15793ddb9e3390528ace9dee85e82cbae192000163d8d62be8db296ec4c'});
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,[events[0],{...events[1],ownerEpoch:1}]),/BOOTSTRAP_EVENT_ORDER/);
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,[events[0],{...events[1],previousEventSha256:zero}]),/EVENT_HASH_MISMATCH|BOOTSTRAP_EVENT_ORDER/);
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,[events[0]]),/INCOMPLETE/);
  assert.throws(()=>paperAccountV2EventHash({accountId:'a'.repeat(4097),generationId:events[0].generationId,eventId:events[0].eventId,eventType:events[0].eventType,
    payloadVersion:events[0].payloadVersion,accountSequence:events[0].accountSequence,generationSequence:events[0].generationSequence,ownerEpoch:events[0].ownerEpoch,
    occurredAtMs:events[0].occurredAtMs,recordedAtMs:events[0].recordedAtMs,payloadBytes:events[0].payloadBytes,previousEventSha256:events[0].previousEventSha256}),/FRAME_TOO_LARGE/);
  const multibyte={accountId:'é',generationId:'gen',eventId:'00000000-0000-4000-8000-000000000003',eventType:'TEST',payloadVersion:1,accountSequence:1,generationSequence:1,
    ownerEpoch:0,occurredAtMs:1,recordedAtMs:2,payloadBytes:Buffer.from('{"x":""}'),previousEventSha256:zero};
  const lp=s=>{const b=Buffer.from(s,'utf8'),n=Buffer.alloc(4);n.writeUInt32BE(Buffer.byteLength(s,'utf8'));return Buffer.concat([n,b]);};
  const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b;};
  const payloadHash=createHash('sha256').update(multibyte.payloadBytes).digest();
  const expected=createHash('sha256').update(Buffer.concat([Buffer.from('SYLPH-PAPER-ACCOUNT-EVENT-V2\0','ascii'),lp(multibyte.accountId),lp(multibyte.generationId),lp(multibyte.eventId),lp(multibyte.eventType),
    u64(1),u64(1),u64(1),u64(0),u64(1),u64(2),payloadHash,Buffer.alloc(32)])).digest('hex');
  assert.equal(paperAccountV2EventHash(multibyte).eventSha256,expected);
  assert.doesNotThrow(()=>paperAccountV2EventHash({...multibyte,accountId:'a'.repeat(4096)}));
  assert.doesNotThrow(()=>paperAccountV2EventHash({...multibyte,accountId:'é'.repeat(2048)}));
  assert.throws(()=>paperAccountV2EventHash({...multibyte,accountId:'é'.repeat(2048)+'a'}),/FRAME_TOO_LARGE/);
  assert.throws(()=>paperAccountV2EventHash({...multibyte,accountId:'a'.repeat(1_000_000)}),/FRAME_TOO_LARGE/);
  let reads=0;const hostile={...events[0]};Object.defineProperty(hostile,'accountId',{enumerable:true,get(){reads++;return 'acct-vector';}});
  assert.throws(()=>paperAccountV2EventHash(hostile),/ENVELOPE_INVALID/);assert.equal(reads,0);
  assert.throws(()=>paperAccountV2EventHash(new Proxy(events[0],{})),/ENVELOPE_INVALID/);
  const hostileEvents=[events[0],events[1]];Object.defineProperty(hostileEvents,'1',{enumerable:true,get(){reads++;return events[1];}});
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,hostileEvents),/ENVELOPE_INVALID/);assert.equal(reads,0);
  const payloadAccessor={...events[0]};Object.defineProperty(payloadAccessor,'payloadBytes',{enumerable:true,get(){reads++;return firstPayload;}});
  assert.throws(()=>paperAccountV2EventHash(payloadAccessor),/ENVELOPE_INVALID/);assert.equal(reads,0);
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,[payloadAccessor,events[1]]),/ENVELOPE_INVALID/);assert.equal(reads,0);
  const coercion={get length(){reads++;return 1;},[Symbol.toPrimitive](){reads++;return 'acct-vector';}};
  const badPrimitive={accountId:coercion,generationId:events[0].generationId,eventId:events[0].eventId,eventType:events[0].eventType,payloadVersion:1,
    accountSequence:1,generationSequence:1,ownerEpoch:0,occurredAtMs:7,recordedAtMs:8,payloadBytes:firstPayload,previousEventSha256:zero};
  assert.throws(()=>paperAccountV2EventHash(badPrimitive),/ENVELOPE_INVALID/);assert.equal(reads,0);
  assert.throws(()=>paperAccountV2EventHash({...badPrimitive,accountId:'acct-vector',payloadBytes:Buffer.alloc(SYLPH_JCS1_MAX_BYTES+1)}),/DOCUMENT_TOO_LARGE/);
  const oversizeEvents=[{...events[0],payloadBytes:Buffer.alloc(SYLPH_JCS1_MAX_BYTES+1)},events[1]];
  assert.throws(()=>verifyPaperAccountV2BootstrapPrefix(genesisBytes,oversizeEvents),/DOCUMENT_TOO_LARGE/);
});

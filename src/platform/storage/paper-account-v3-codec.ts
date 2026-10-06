import {createHash} from 'node:crypto';
import {types as utilTypes} from 'node:util';

export const SYLPH_JCS1_MAX_BYTES = 1_048_576;
export const SYLPH_JCS1_MAX_DEPTH = 64;
const MAX_FRAME_BYTES = 4096;
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayGetter=(name:string)=>Object.getOwnPropertyDescriptor(typedArrayPrototype,name)?.get;
const getViewByteLength=typedArrayGetter('byteLength');
const getViewByteOffset=typedArrayGetter('byteOffset');
const getViewBuffer=typedArrayGetter('buffer');
const getArrayBufferByteLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')?.get;
const getArrayBufferResizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const ZERO_HASH = '0'.repeat(64);
const GENESIS_DOMAIN = Buffer.from('SYLPH-PAPER-ACCOUNT-GENESIS-V2\0','ascii');
const EVENT_DOMAIN = Buffer.from('SYLPH-PAPER-ACCOUNT-EVENT-V2\0','ascii');

const fail = (code:string):never=>{throw new Error(code);};
const isRecord = (value:unknown):value is Record<string,unknown> => typeof value==='object'&&value!==null&&!Array.isArray(value);

/** Snapshot only bounded, fixed ArrayBuffer-backed byte views via intrinsic getters. */
function snapshotBytes(input:unknown):Buffer {
  if(typeof input!=='object'||input===null||utilTypes.isProxy(input)||!ArrayBuffer.isView(input)||!(input instanceof Uint8Array))fail('SYLPH_JCS1_BYTE_VIEW_INVALID');
  if(Object.getPrototypeOf(input)!==Uint8Array.prototype&&!Buffer.isBuffer(input))fail('SYLPH_JCS1_BYTE_VIEW_INVALID');
  if(!getViewByteLength||!getViewByteOffset||!getViewBuffer||!getArrayBufferByteLength)fail('SYLPH_JCS1_BYTE_VIEW_INVALID');
  const length=Reflect.apply(getViewByteLength!,input,[]) as number;
  if(length>SYLPH_JCS1_MAX_BYTES)fail('SYLPH_JCS1_DOCUMENT_TOO_LARGE');
  const offset=Reflect.apply(getViewByteOffset!,input,[]) as number;
  const backing=Reflect.apply(getViewBuffer!,input,[]) as unknown;
  if(typeof backing!=='object'||backing===null||utilTypes.isProxy(backing)||!(backing instanceof ArrayBuffer)||Object.getPrototypeOf(backing)!==ArrayBuffer.prototype)fail('SYLPH_JCS1_BYTE_BACKING_INVALID');
  if(getArrayBufferResizable&&Reflect.apply(getArrayBufferResizable,backing,[])===true)fail('SYLPH_JCS1_BYTE_BACKING_INVALID');
  const backingLength=Reflect.apply(getArrayBufferByteLength!,backing,[]) as number;
  if(offset<0||offset+length>backingLength)fail('SYLPH_JCS1_BYTE_VIEW_INVALID');
  const result=Buffer.allocUnsafe(length);
  Uint8Array.prototype.set.call(result,input as Uint8Array);
  return result;
}

function assertScalarString(value:string):void {
  scalarUtf8ByteLength(value);
}
function scalarUtf8ByteLength(value:string):number {
  let bytes=0;
  for(let i=0;i<value.length;i++) {
    const c=value.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff) {
      if(i+1>=value.length) fail('SYLPH_JCS1_UNPAIRED_SURROGATE');
      const next=value.charCodeAt(++i); if(next<0xdc00||next>0xdfff) fail('SYLPH_JCS1_UNPAIRED_SURROGATE');
      bytes+=4;
    } else if(c>=0xdc00&&c<=0xdfff) fail('SYLPH_JCS1_UNPAIRED_SURROGATE');
    else if(c<=0x7f)bytes++;
    else if(c<=0x7ff)bytes+=2;
    else bytes+=3;
  }
  return bytes;
}

function emitBounded(parts:string[],text:string,count:{bytes:number}):void {
  const length=encoder.encode(text).length;
  if(count.bytes+length>SYLPH_JCS1_MAX_BYTES) fail('SYLPH_JCS1_DOCUMENT_TOO_LARGE');
  count.bytes+=length; parts.push(text);
}
function serializedStringBytes(value:string):number {
  let size=2;
  for(let i=0;i<value.length;i++) {
    const c=value.charCodeAt(i);
    if(c===0x22||c===0x5c||c===0x08||c===0x09||c===0x0a||c===0x0c||c===0x0d) size+=2;
    else if(c<0x20) size+=6;
    else if(c>=0xd800&&c<=0xdbff) {size+=4;i++;}
    else if(c<=0x7f) size++;
    else if(c<=0x7ff) size+=2;
    else size+=3;
  }
  return size;
}
function emitString(parts:string[],value:string,count:{bytes:number}):void {
  if(count.bytes+serializedStringBytes(value)>SYLPH_JCS1_MAX_BYTES)fail('SYLPH_JCS1_DOCUMENT_TOO_LARGE');
  emitBounded(parts,JSON.stringify(value),count);
}

/** Validate exact SYLPH-JCS-1 ingress shape and serialize without exceeding the byte bound. */
export function serializeSylphJcs1(value:unknown):Uint8Array {
  if(!isRecord(value)) fail('SYLPH_JCS1_TOP_LEVEL_OBJECT_REQUIRED');
  const parts:string[]=[]; const count={bytes:0};
  const write=(item:unknown,depth:number):void=>{
    if(item===null) {emitBounded(parts,'null',count);return;}
    if(typeof item==='boolean') {emitBounded(parts,item?'true':'false',count);return;}
    if(typeof item==='string') {assertScalarString(item);emitString(parts,item,count);return;}
    if(typeof item==='number') {
      if(!Number.isSafeInteger(item)||Object.is(item,-0)) fail('SYLPH_JCS1_INVALID_NUMBER');
      emitBounded(parts,JSON.stringify(item),count);return;
    }
    if(typeof item!=='object'||item===null) fail('SYLPH_JCS1_INVALID_VALUE');
    if(utilTypes.isProxy(item)) fail('SYLPH_JCS1_PROXY_REJECTED');
    if(depth>SYLPH_JCS1_MAX_DEPTH) fail('SYLPH_JCS1_DEPTH_LIMIT');
    if(Array.isArray(item)) {
      if(Object.getPrototypeOf(item)!==Array.prototype) fail('SYLPH_JCS1_INVALID_ARRAY_PROTOTYPE');
      const keys=Reflect.ownKeys(item); const length=item.length;
      if(keys.length!==length+1||!keys.includes('length')) fail('SYLPH_JCS1_INVALID_ARRAY_KEYS');
      for(let i=0;i<length;i++) {
        if(!Object.hasOwn(item,String(i))) fail('SYLPH_JCS1_SPARSE_ARRAY');
        const descriptor=Object.getOwnPropertyDescriptor(item,String(i));
        if(!descriptor||!descriptor.enumerable||!('value'in descriptor)) fail('SYLPH_JCS1_INVALID_ARRAY_ELEMENT');
      }
      emitBounded(parts,'[',count);
      for(let i=0;i<length;i++) {if(i)emitBounded(parts,',',count);write(item[i],depth+1);}
      emitBounded(parts,']',count);return;
    }
    if(Object.getPrototypeOf(item)!==Object.prototype) fail('SYLPH_JCS1_INVALID_OBJECT_PROTOTYPE');
    const objectValue=item as object;
    const keys=Reflect.ownKeys(objectValue);
    if(keys.some(key=>typeof key!=='string')) fail('SYLPH_JCS1_SYMBOL_KEY');
    const stringKeys=keys as string[];
    for(const key of stringKeys) {
      assertScalarString(key);
      const descriptor=Object.getOwnPropertyDescriptor(objectValue,key);
      if(!descriptor||!descriptor.enumerable||!('value'in descriptor)) fail('SYLPH_JCS1_INVALID_OBJECT_PROPERTY');
    }
    stringKeys.sort((a,b)=>a<b?-1:a>b?1:0);
    emitBounded(parts,'{',count);
    for(let i=0;i<stringKeys.length;i++) {
      if(i)emitBounded(parts,',',count);
      const key=stringKeys[i];
      emitString(parts,key,count);emitBounded(parts,':',count);
      write(Object.getOwnPropertyDescriptor(objectValue,key)!.value,depth+1);
    }
    emitBounded(parts,'}',count);
  };
  write(value,1);
  return encoder.encode(parts.join(''));
}

class StrictParser {
  private i=0;
  constructor(private readonly text:string){}
  parse():unknown {
    this.ws(); const value=this.value(1); this.ws();
    if(this.i!==this.text.length) fail('SYLPH_JCS1_TRAILING_BYTES');
    if(!isRecord(value)) fail('SYLPH_JCS1_TOP_LEVEL_OBJECT_REQUIRED');
    return value as Record<string,unknown>;
  }
  private ws():void {while(this.i<this.text.length&&/[\u0009\u000a\u000d\u0020]/.test(this.text[this.i]))this.i++;}
  private value(depth:number):unknown {
    const c=this.text[this.i];
    if(c==='{') return this.object(depth);
    if(c==='[') return this.array(depth);
    if(c==='"') return this.string();
    if(c==='t'&&this.text.slice(this.i,this.i+4)==='true'){this.i+=4;return true;}
    if(c==='f'&&this.text.slice(this.i,this.i+5)==='false'){this.i+=5;return false;}
    if(c==='n'&&this.text.slice(this.i,this.i+4)==='null'){this.i+=4;return null;}
    if(c==='-'||(c>='0'&&c<='9')) return this.number();
    return fail('SYLPH_JCS1_INVALID_JSON');
  }
  private enter(depth:number):void {if(depth>SYLPH_JCS1_MAX_DEPTH)fail('SYLPH_JCS1_DEPTH_LIMIT');}
  private object(parentDepth:number):Record<string,unknown> {
    const depth=parentDepth; this.enter(depth); this.i++;
    const result:Record<string,unknown>={}; const seen=new Set<string>(); this.ws();
    if(this.text[this.i]==='}'){this.i++;return result;}
    while(true) {
      if(this.text[this.i]!=='"')fail('SYLPH_JCS1_INVALID_OBJECT_KEY');
      const key=this.string(); if(seen.has(key))fail('SYLPH_JCS1_DUPLICATE_KEY'); seen.add(key);
      this.ws(); if(this.text[this.i++]!==':')fail('SYLPH_JCS1_INVALID_JSON'); this.ws();
      const value=this.value(depth+1);
      Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});
      this.ws(); const c=this.text[this.i++]; if(c==='}')return result; if(c!==',')fail('SYLPH_JCS1_INVALID_JSON'); this.ws();
    }
  }
  private array(parentDepth:number):unknown[] {
    const depth=parentDepth; this.enter(depth); this.i++;
    const result:unknown[]=[]; this.ws(); if(this.text[this.i]===']'){this.i++;return result;}
    while(true) {result.push(this.value(depth+1));this.ws();const c=this.text[this.i++];if(c===']')return result;if(c!==',')fail('SYLPH_JCS1_INVALID_JSON');this.ws();}
  }
  private string():string {
    const start=this.i++; let escaped=false;
    while(this.i<this.text.length) {
      const c=this.text.charCodeAt(this.i++);
      if(!escaped&&c===0x22) {
        const value=JSON.parse(this.text.slice(start,this.i)) as string;assertScalarString(value);return value;
      }
      if(!escaped&&c<0x20)fail('SYLPH_JCS1_INVALID_STRING');
      if(escaped) {if(c===0x75){for(let n=0;n<4;n++){const h=this.text.charCodeAt(this.i++);if(!((h>=48&&h<=57)||(h>=65&&h<=70)||(h>=97&&h<=102)))fail('SYLPH_JCS1_INVALID_ESCAPE');}escaped=false;}
        else {if(![0x22,0x5c,0x2f,0x62,0x66,0x6e,0x72,0x74].includes(c))fail('SYLPH_JCS1_INVALID_ESCAPE');escaped=false;}}
      else if(c===0x5c)escaped=true;
    }
    return fail('SYLPH_JCS1_UNTERMINATED_STRING');
  }
  private number():number {
    const rest=this.text.slice(this.i); const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if(!match)return fail('SYLPH_JCS1_INVALID_NUMBER');
    this.i+=match[0].length; const value=Number(match[0]);
    if(!Number.isSafeInteger(value)||Object.is(value,-0))fail('SYLPH_JCS1_INVALID_NUMBER');
    return value;
  }
}

/** Strict duplicate-aware parser; accepts only byte-for-byte canonical stored documents. */
export function canonicalSylphJcs1Snapshot(input:Uint8Array):{bytes:Buffer;value:Record<string,unknown>} {
  const snapshot=snapshotBytes(input);
  let text:string;try{text=fatalDecoder.decode(snapshot);}catch{ return fail('SYLPH_JCS1_INVALID_UTF8'); }
  if(text.charCodeAt(0)===0xfeff)fail('SYLPH_JCS1_BOM_FORBIDDEN');
  const value=new StrictParser(text).parse();
  const canonical=serializeSylphJcs1(value);
  if(!Buffer.from(canonical).equals(snapshot))fail('SYLPH_JCS1_NONCANONICAL_BYTES');
  return {bytes:snapshot,value:value as Record<string,unknown>};
}
export function parseSylphJcs1(input:Uint8Array):Record<string,unknown> {return canonicalSylphJcs1Snapshot(input).value;}

function sha256(data:Uint8Array):string{return createHash('sha256').update(data).digest('hex');}
function frame(value:string):Buffer {
  if(typeof value!=='string')fail('SYLPH_JCS1_INVALID_FRAME_VALUE');
  if(scalarUtf8ByteLength(value)>MAX_FRAME_BYTES)fail('SYLPH_JCS1_FRAME_TOO_LARGE');
  const encoded=Buffer.from(value,'utf8');
  const prefix=Buffer.allocUnsafe(4);prefix.writeUInt32BE(encoded.length);return Buffer.concat([prefix,encoded]);
}
function u64(value:number):Buffer {
  if(!Number.isSafeInteger(value)||value<0)fail('SYLPH_JCS1_U64_OUT_OF_RANGE');
  const out=Buffer.allocUnsafe(8);out.writeBigUInt64BE(BigInt(value));return out;
}
function hashBytes(value:string):Buffer {
  if(!/^[0-9a-f]{64}$/.test(value))fail('SYLPH_JCS1_INVALID_SHA256');return Buffer.from(value,'hex');
}

export function paperAccountV2GenesisHash(genesisBytes:Uint8Array):string {
  const snapshot=snapshotBytes(genesisBytes);parseSylphJcs1(snapshot);
  if(snapshot.byteLength>0xffffffff)fail('SYLPH_JCS1_GENESIS_TOO_LARGE');
  const length=Buffer.allocUnsafe(4);length.writeUInt32BE(snapshot.byteLength);
  return sha256(Buffer.concat([GENESIS_DOMAIN,length,snapshot]));
}

export interface PaperAccountV2EventEnvelope {
  accountId:string;generationId:string;eventId:string;eventType:string;payloadVersion:number;
  accountSequence:number;generationSequence:number;ownerEpoch:number;occurredAtMs:number;recordedAtMs:number;
  payloadBytes:Uint8Array;previousEventSha256:string;
}
const EVENT_ENVELOPE_KEYS=['accountId','generationId','eventId','eventType','payloadVersion','accountSequence','generationSequence','ownerEpoch','occurredAtMs','recordedAtMs','payloadBytes','previousEventSha256'];
function snapshotEventEnvelope(value:unknown):PaperAccountV2EventEnvelope {
  if(typeof value!=='object'||value===null||utilTypes.isProxy(value)||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
  const keys=Reflect.ownKeys(value as object);
  if(keys.some(key=>typeof key!=='string')||JSON.stringify((keys as string[]).sort())!==JSON.stringify([...EVENT_ENVELOPE_KEYS].sort()))fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
  const copy:Record<string,unknown>={};
  for(const key of EVENT_ENVELOPE_KEYS) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!('value'in descriptor))return fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    copy[key]=(descriptor as PropertyDescriptor).value;
  }
  validateEventEnvelopeValues(copy);
  copy.payloadBytes=snapshotBytes(copy.payloadBytes);
  return copy as unknown as PaperAccountV2EventEnvelope;
}
function validateEventEnvelopeValues(value:Record<string,unknown>):void {
  for(const field of ['accountId','generationId','eventId','eventType','previousEventSha256']) {
    const item=value[field];
    if(typeof item!=='string'||item.length===0)fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    const text=item as string;
    if(scalarUtf8ByteLength(text)>MAX_FRAME_BYTES)fail('SYLPH_JCS1_FRAME_TOO_LARGE');
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.eventId as string)||!hashField(value.previousEventSha256))fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
  for(const field of ['payloadVersion','accountSequence','generationSequence','ownerEpoch','occurredAtMs','recordedAtMs']) {
    const item=value[field];
    if(typeof item!=='number'||!Number.isSafeInteger(item)||item<0)fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
  }
  if((value.payloadVersion as number)===0||(value.accountSequence as number)===0||(value.generationSequence as number)===0)fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
}
export function paperAccountV2EventHash(event:PaperAccountV2EventEnvelope):{payloadSha256:string;eventSha256:string} {
  const stable=snapshotEventEnvelope(event);
  if(stable.payloadBytes.byteLength>SYLPH_JCS1_MAX_BYTES)fail('SYLPH_JCS1_DOCUMENT_TOO_LARGE');
  const payloadBytes=stable.payloadBytes;parseSylphJcs1(payloadBytes);
  const payloadSha256=sha256(payloadBytes);
  const preimage=Buffer.concat([EVENT_DOMAIN,frame(stable.accountId),frame(stable.generationId),frame(stable.eventId),frame(stable.eventType),
    u64(stable.payloadVersion),u64(stable.accountSequence),u64(stable.generationSequence),u64(stable.ownerEpoch),u64(stable.occurredAtMs),u64(stable.recordedAtMs),
    hashBytes(payloadSha256),hashBytes(stable.previousEventSha256)]);
  return {payloadSha256,eventSha256:sha256(preimage)};
}

export interface PaperAccountV2Genesis {
  accountId:string;generationId:string;schemaVersion:2;createdAtMs:number;createdBy:string;reason:string;
  priorGenerationId:string|null;origin:'EXPLICIT_OPERATOR_GENESIS'|'ATTESTED_GENESIS';initialCapitalUsdMicro:string;
  openingCashUsdMicro:string;initialCashAvailableUsdMicro:string;accountingPolicyHash:string;riskPolicyHash:string;
  configHash:string;conversionPolicyHash:string;simulatorBuildHash:string;simulatorReportSchema:string;tokenMetadataPolicyHash:string;
}
export interface PaperAccountV2JournalEvent extends PaperAccountV2EventEnvelope {payloadSha256:string;eventSha256:string}
export interface PaperAccountV2BootstrapProjection {accountId:string;generationId:string;admissionState:'BLOCKED';generationState:'PENDING';ownerEpoch:0;lastAccountSequence:2;lastGenerationSequence:2;lastEventSha256:string;genesisSha256:string}

function exactKeys(value:Record<string,unknown>,keys:string[]):void {
  const actual=Object.keys(value).sort();const expected=[...keys].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail('PAPER_ACCOUNT_V3_BOOTSTRAP_SHAPE_INVALID');
}
function textField(value:unknown):value is string{return typeof value==='string'&&value.length>0;}
function hashField(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
function canonicalUnsigned(value:unknown):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);}

/** Validates the immutable v2 genesis document and exact bytes, without claiming account recovery. */
export function verifyPaperAccountV2GenesisDocument(genesisBytes:Uint8Array):{bytes:Buffer;genesis:PaperAccountV2Genesis;genesisSha256:string} {
  const stable=canonicalSylphJcs1Snapshot(genesisBytes);
  const genesisKeys=['accountId','accountingPolicyHash','configHash','conversionPolicyHash','createdAtMs','createdBy','generationId','initialCapitalUsdMicro','initialCashAvailableUsdMicro','openingCashUsdMicro','origin','priorGenerationId','reason','riskPolicyHash','schemaVersion','simulatorBuildHash','simulatorReportSchema','tokenMetadataPolicyHash'];
  exactKeys(stable.value,genesisKeys);
  const genesis=stable.value as unknown as PaperAccountV2Genesis;
  if(genesis.schemaVersion!==2||!textField(genesis.accountId)||!textField(genesis.generationId)||!Number.isSafeInteger(genesis.createdAtMs)||genesis.createdAtMs<0||
     !textField(genesis.createdBy)||!textField(genesis.reason)||(genesis.priorGenerationId!==null&&!textField(genesis.priorGenerationId))||!['EXPLICIT_OPERATOR_GENESIS','ATTESTED_GENESIS'].includes(genesis.origin)||
     !canonicalUnsigned(genesis.initialCapitalUsdMicro)||!canonicalUnsigned(genesis.openingCashUsdMicro)||!canonicalUnsigned(genesis.initialCashAvailableUsdMicro)||
     ![genesis.accountingPolicyHash,genesis.configHash,genesis.conversionPolicyHash,genesis.riskPolicyHash,genesis.simulatorBuildHash,genesis.tokenMetadataPolicyHash].every(hashField)||
     !textField(genesis.simulatorReportSchema))fail('PAPER_ACCOUNT_V3_GENESIS_INVALID');
  return {bytes:stable.bytes,genesis,genesisSha256:paperAccountV2GenesisHash(stable.bytes)};
}

/** Verifies only the exact inert two-event bootstrap prefix; this is not account recovery or admission. */
export function verifyPaperAccountV2BootstrapPrefix(genesisBytes:Uint8Array,events:readonly PaperAccountV2JournalEvent[]):PaperAccountV2BootstrapProjection {
  if(!Array.isArray(events)||utilTypes.isProxy(events)||Object.getPrototypeOf(events)!==Array.prototype||events.length!==2||Reflect.ownKeys(events).length!==3||
     !Object.hasOwn(events,'0')||!Object.hasOwn(events,'1'))fail('PAPER_ACCOUNT_V3_BOOTSTRAP_PREFIX_INCOMPLETE');
  const eventSnapshots:PaperAccountV2JournalEvent[]=[];
  for(let i=0;i<2;i++) {
    const descriptor=Object.getOwnPropertyDescriptor(events,String(i));
    if(!descriptor||!descriptor.enumerable||!('value'in descriptor))return fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    const value=(descriptor as PropertyDescriptor).value as object;
    if(typeof value!=='object'||value===null||utilTypes.isProxy(value)||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    const keys=Reflect.ownKeys(value);
    const expected=[...EVENT_ENVELOPE_KEYS,'payloadSha256','eventSha256'].sort();
    if(keys.some(key=>typeof key!=='string')||JSON.stringify((keys as string[]).sort())!==JSON.stringify(expected))fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    const copy:Record<string,unknown>={};
    for(const key of [...EVENT_ENVELOPE_KEYS,'payloadSha256','eventSha256']) {
      const property=Object.getOwnPropertyDescriptor(value,key);
      if(!property||!property.enumerable||!('value'in property))return fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
      copy[key]=(property as PropertyDescriptor).value;
    }
    const envelopeInput:Record<string,unknown>={};
    for(const key of EVENT_ENVELOPE_KEYS)envelopeInput[key]=copy[key];
    const envelope=snapshotEventEnvelope(envelopeInput);
    if(!hashField(copy.payloadSha256)||!hashField(copy.eventSha256))return fail('PAPER_ACCOUNT_V3_EVENT_ENVELOPE_INVALID');
    eventSnapshots.push({...envelope,payloadSha256:copy.payloadSha256,eventSha256:copy.eventSha256});
  }
  const verifiedGenesis=verifyPaperAccountV2GenesisDocument(genesisBytes);const g=verifiedGenesis.genesis;const genesisSha256=verifiedGenesis.genesisSha256;
  if(g.priorGenerationId!==null)fail('PAPER_ACCOUNT_V3_GENESIS_INVALID');
  const [first,second]=eventSnapshots;
  const verifyOne=(event:PaperAccountV2JournalEvent,accountSequence:number,generationSequence:number,eventType:string,previous:string):Record<string,unknown>=>{
    if(event.accountId!==g.accountId||event.generationId!==g.generationId||event.accountSequence!==accountSequence||event.generationSequence!==generationSequence||
       event.eventType!==eventType||event.payloadVersion!==1||event.ownerEpoch!==0||event.occurredAtMs<0||event.recordedAtMs<0||event.previousEventSha256!==previous||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(event.eventId)) fail('PAPER_ACCOUNT_V3_BOOTSTRAP_EVENT_ORDER_INVALID');
    const envelope:PaperAccountV2EventEnvelope={accountId:event.accountId,generationId:event.generationId,eventId:event.eventId,eventType:event.eventType,
      payloadVersion:event.payloadVersion,accountSequence:event.accountSequence,generationSequence:event.generationSequence,ownerEpoch:event.ownerEpoch,
      occurredAtMs:event.occurredAtMs,recordedAtMs:event.recordedAtMs,payloadBytes:event.payloadBytes,previousEventSha256:event.previousEventSha256};
    const actual=paperAccountV2EventHash(envelope);
    if(actual.payloadSha256!==event.payloadSha256||actual.eventSha256!==event.eventSha256)fail('PAPER_ACCOUNT_V3_EVENT_HASH_MISMATCH');
    return parseSylphJcs1(event.payloadBytes);
  };
  const firstPayload=verifyOne(first,1,1,'ACCOUNT_BOOTSTRAPPED',ZERO_HASH);
  if(first.eventId===second.eventId)fail('PAPER_ACCOUNT_V3_DUPLICATE_EVENT_ID');
  exactKeys(firstPayload,['accountId','bootstrapOrigin','generationId','genesisFingerprint','operatorAuthorization']);
  if(firstPayload.accountId!==g.accountId||firstPayload.generationId!==g.generationId||firstPayload.bootstrapOrigin!==g.origin||firstPayload.genesisFingerprint!==genesisSha256||
     !textField(firstPayload.operatorAuthorization))fail('PAPER_ACCOUNT_V3_BOOTSTRAP_EVENT_INVALID');
  const secondPayload=verifyOne(second,2,2,'GENERATION_CREATED',first.eventSha256);
  exactKeys(secondPayload,['accountingPolicyHash','configHash','conversionPolicyHash','createdBy','genesisSha256','initialCapitalUsdMicro','openingCashUsdMicro','origin','priorGenerationId','reason','riskPolicyHash','schemaVersion','simulatorBuildHash','simulatorReportSchema','tokenMetadataPolicyHash']);
  const expected={accountingPolicyHash:g.accountingPolicyHash,configHash:g.configHash,conversionPolicyHash:g.conversionPolicyHash,createdBy:g.createdBy,
    genesisSha256,initialCapitalUsdMicro:g.initialCapitalUsdMicro,openingCashUsdMicro:g.openingCashUsdMicro,origin:g.origin,priorGenerationId:null,reason:g.reason,
    riskPolicyHash:g.riskPolicyHash,schemaVersion:2,simulatorBuildHash:g.simulatorBuildHash,simulatorReportSchema:g.simulatorReportSchema,tokenMetadataPolicyHash:g.tokenMetadataPolicyHash};
  if(!Buffer.from(serializeSylphJcs1(secondPayload)).equals(Buffer.from(serializeSylphJcs1(expected))))fail('PAPER_ACCOUNT_V3_GENERATION_EVENT_GENESIS_MISMATCH');
  return {accountId:g.accountId,generationId:g.generationId,admissionState:'BLOCKED',generationState:'PENDING',ownerEpoch:0,lastAccountSequence:2,lastGenerationSequence:2,lastEventSha256:second.eventSha256,genesisSha256};
}

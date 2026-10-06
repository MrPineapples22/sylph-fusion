import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { CertifiedLiveExecutionCoordinator } from '../../dist/platform/execution/certified-live-coordinator.js';
import { assembleVerifiedTransaction } from '../../dist/platform/execution/transaction-artifact.js';
const key = Keypair.fromSeed(new Uint8Array(32).fill(42));
function message(version=0, extra=false) {
  const instructions=[SystemProgram.transfer({fromPubkey:key.publicKey,toPubkey:PublicKey.default,lamports:1})];
  if(extra) instructions.push(SystemProgram.transfer({fromPubkey:Keypair.fromSeed(new Uint8Array(32).fill(43)).publicKey,toPubkey:PublicKey.default,lamports:1}));
  const m=new TransactionMessage({payerKey:key.publicKey,recentBlockhash:PublicKey.default.toBase58(),instructions});
  return (version===0?m.compileToV0Message():m.compileToLegacyMessage()).serialize();
}
function sign(bytes,k=key){const tx=new VersionedTransaction(VersionedMessage.deserialize(bytes));tx.sign([k]);return tx.signatures[0];}
function harness(signFn=async b=>sign(b), sendFn=async w=>bs58.encode(VersionedTransaction.deserialize(w).signatures[0])) {
  let signCalls=0,sendCalls=0;
  const gateway={publicKey:key.publicKey,signTransactionMessage:async b=>{signCalls++;return signFn(b);}};
  const coordinator=new CertifiedLiveExecutionCoordinator({MODE:'live'},{endpoints:[{rpcEndpoint:'offline'}],connection:{sendRawTransaction:async w=>{sendCalls++;return sendFn(w);}}},{},gateway);
  const seal=(bytes=message())=>coordinator.sealExecutionAuthorizationRoot({intentId:'i',generation:1,reservationId:'r',candidateTransactionBytes:bytes,simulationComputeUnits:1,estimatedNetSolDelta:0n,expiresAtBlockHeight:10});
  return {coordinator,seal,gateway,calls:()=>({signCalls,sendCalls})};
}
test('single signer legacy/v0 artifacts have verified signatures and immutable string identities',()=>{for(const v of ['legacy',0]){const b=message(v);const a=assembleVerifiedTransaction(b,sign(b),key.publicKey);assert.ok(Object.isFrozen(a));assert.equal(a.signature,bs58.encode(VersionedTransaction.deserialize(Buffer.from(a.wireBase64,'base64')).signatures[0]));}});
test('malformed, trailing, unsupported and multisigner messages are rejected before signer invocation',()=>{for(const bytes of [new Uint8Array([1]),new Uint8Array([...message(),0]),new Uint8Array([0x81,...message().slice(1)]),message(0,true)]){const h=harness();assert.throws(()=>h.seal(bytes));assert.equal(h.calls().signCalls,0);}});
test('v1 and unknown versioned message prefixes fail with an explicit compatibility error before signing',()=>{
 for(const prefix of [0x81,0x82]){const h=harness();const bytes=new Uint8Array([prefix,...message().slice(1)]);
  assert.throws(()=>h.seal(bytes),/TRANSACTION_VERSION_UNSUPPORTED/);assert.equal(h.calls().signCalls,0);}
});
test('wrong or malformed signatures never become offline signed artifacts',()=>{for(const bad of [new Uint8Array(63),new Uint8Array(64)]){assert.throws(()=>assembleVerifiedTransaction(message(),bad,key.publicKey),/SIGNATURE_INVALID/);}});
test('sealing snapshots caller bytes and getter returns defensive copies without signing authority',async()=>{const h=harness();const b=message();const original=Uint8Array.from(b);const root=h.seal(b);b.fill(0);root.candidateTransactionBytes.fill(0);assert.deepEqual(root.candidateTransactionBytes,original);await assert.rejects(h.coordinator.invokeCertifiedSigning(root),/QUARANTINED_COORDINATOR_SIGNING/);assert.deepEqual(h.calls(),{signCalls:0,sendCalls:0});});
test('valid signature for another message or key is rejected',()=>{const b=message();const other=message('legacy');assert.throws(()=>assembleVerifiedTransaction(b,sign(other),key.publicKey),/SIGNATURE_INVALID/);const wrongKey=Keypair.fromSeed(new Uint8Array(32).fill(44));const wrongMessage=new TransactionMessage({payerKey:wrongKey.publicKey,recentBlockhash:PublicKey.default.toBase58(),instructions:[]}).compileToV0Message().serialize();assert.throws(()=>assembleVerifiedTransaction(b,sign(wrongMessage,wrongKey),key.publicKey),/SIGNATURE_INVALID/);});

test('legacy and v0 header/index corruption is rejected before signing',()=>{for(const version of ['legacy',0])for(const mutate of [m=>m.header.numReadonlySignedAccounts=1,m=>m.header.numReadonlySignedAccounts=2,m=>m.header.numReadonlyUnsignedAccounts=250,m=>m.compiledInstructions[0].programIdIndex=0,m=>m.compiledInstructions[0].programIdIndex=250,m=>m.compiledInstructions[0].accountKeyIndexes[0]=250]){const m=VersionedMessage.deserialize(message(version));if(version==='legacy'){// Legacy getters allocate compiled instruction views; mutate its wire-native fields instead below.
if(mutate.toString().includes('programIdIndex=0'))m.instructions[0].programIdIndex=0;
else if(mutate.toString().includes('programIdIndex=250'))m.instructions[0].programIdIndex=250;
else if(mutate.toString().includes('accountKeyIndexes'))m.instructions[0].accounts[0]=250;
else mutate(m);
}else mutate(m);const h=harness();assert.throws(()=>h.seal(m.serialize()),/HEADER_INVALID|INDEX_INVALID/);assert.equal(h.calls().signCalls,0);}});
test('wire size checked before signature and exact packet boundary accepted',()=>{for(const length of [1167,1168]){const m=VersionedMessage.deserialize(message());const overhead=m.serialize().length-m.compiledInstructions[0].data.length; m.compiledInstructions[0].data=new Uint8Array(length-overhead-1);const bytes=m.serialize();assert.equal(bytes.length,length);const h=harness();if(length===1167)assert.doesNotThrow(()=>h.seal(bytes));else assert.throws(()=>h.seal(bytes),/PACKET_TOO_LARGE/);assert.equal(h.calls().signCalls,0);}});
test('v0 lookup index cardinality is checked while ALT contents remain unverified',()=>{const m=VersionedMessage.deserialize(message());m.addressTableLookups=[{accountKey:PublicKey.default,writableIndexes:[0],readonlyIndexes:[1]}];m.compiledInstructions[0].accountKeyIndexes=[m.staticAccountKeys.length+1];const h=harness();assert.doesNotThrow(()=>h.seal(m.serialize()));m.compiledInstructions[0].accountKeyIndexes=[m.staticAccountKeys.length+2];assert.throws(()=>h.seal(m.serialize()),/INDEX_INVALID/);m.compiledInstructions[0].accountKeyIndexes=[0];m.addressTableLookups[0].writableIndexes=Array(254).fill(0);assert.throws(()=>h.seal(m.serialize()),/ACCOUNT_COUNT_INVALID/);assert.equal(h.calls().signCalls,0);});

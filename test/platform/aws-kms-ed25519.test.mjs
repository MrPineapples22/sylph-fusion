import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { AwsKmsEd25519 } from '../../dist/platform/signing/aws-kms-ed25519.js';

const arn = 'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555';
const pair = generateKeyPairSync('ed25519');
const wallet = new PublicKey(Buffer.from(pair.publicKey.export({format:'jwk'}).x, 'base64url')).toBase58();
const metadata = { KeyId: arn, KeySpec:'ECC_NIST_EDWARDS25519', KeyUsage:'SIGN_VERIFY',
  SigningAlgorithms:['ED25519_SHA_512'], PublicKey:pair.publicKey.export({format:'der',type:'spki'}) };
const transport = () => ({ getPublicKey:async () => metadata, sign:async input => {
  assert.equal(input.KeyId, arn); assert.equal(input.MessageType, 'RAW');
  assert.equal(input.SigningAlgorithm, 'ED25519_SHA_512');
  return {KeyId:arn,SigningAlgorithm:'ED25519_SHA_512',Signature:sign(null,input.Message,pair.privateKey)};
} });

test('KMS backend pins wallet and uses RAW Ed25519 compatible signatures', async () => {
  const backend = await AwsKmsEd25519.connect(transport(), arn, wallet);
  const message = Buffer.from('staging fixture: no chain submission');
  const signature = await backend.signAuthorizedMessage(message);
  assert.equal(signature.length,64);
  assert.equal(verify(null,message,pair.publicKey,signature),true);
});

test('KMS aliases, different wallets and unsupported key metadata fail closed', async () => {
  await assert.rejects(AwsKmsEd25519.connect(transport(), 'alias/staging', wallet), /concrete/);
  await assert.rejects(AwsKmsEd25519.connect(transport(), arn, PublicKey.default.toBase58()), /pinned/);
  for (const override of [{KeySpec:'ECC_NIST_P256'},{KeyUsage:'ENCRYPT_DECRYPT'},
    {SigningAlgorithms:['ED25519_PH_SHA_512']},{KeyId:'another-key'}, {PublicKey:undefined}]) {
    await assert.rejects(AwsKmsEd25519.connect({...transport(),getPublicKey:async()=>({...metadata,...override})},arn,wallet));
  }
});

test('KMS response corruption and signing-key drift cannot escape verification', async () => {
  for (const override of [{Signature:new Uint8Array(64)},{KeyId:'different-key'},
    {SigningAlgorithm:'ED25519_PH_SHA_512'},{Signature:new Uint8Array(63)}]) {
    const base = transport();
    const backend = await AwsKmsEd25519.connect({...base,sign:async i=>({...await base.sign(i),...override})},arn,wallet);
    await assert.rejects(backend.signAuthorizedMessage(new Uint8Array([1,2,3])), /invalid or mismatched/);
  }
});

test('message mutation during KMS request is detected and malformed requests never reach KMS', async () => {
  let calls=0;
  const base=transport();
  const backend=await AwsKmsEd25519.connect({...base,sign:async i=>{calls++; i.Message[0]^=255; return base.sign(i);}},arn,wallet);
  await assert.rejects(backend.signAuthorizedMessage(new Uint8Array(0)), /length/);
  await assert.rejects(backend.signAuthorizedMessage(new Uint8Array(4097)), /length/);
  assert.equal(calls,0);
  await assert.rejects(backend.signAuthorizedMessage(new Uint8Array([1,2,3])), /invalid/);
});

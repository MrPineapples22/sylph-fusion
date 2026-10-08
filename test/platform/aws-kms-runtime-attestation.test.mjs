import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { AwsKmsRuntimeAttestationSigner } from '../../dist/platform/ingress/aws-kms-runtime-attestation.js';

const arn = 'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555';
const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const pin = pair.publicKey.export({ format: 'pem', type: 'spki' });
const root = createHash('sha256').update('runtime evidence fixture, no production authority').digest('hex');
const metadata = () => ({ KeyId: arn, KeySpec: 'ECC_NIST_EDWARDS25519', KeyUsage: 'SIGN_VERIFY',
  SigningAlgorithms: ['ED25519_SHA_512'], PublicKey: pair.publicKey.export({ format: 'der', type: 'spki' }) });
const response = message => ({ KeyId: arn, SigningAlgorithm: 'ED25519_SHA_512', Signature: sign(null, message, pair.privateKey) });
const transport = () => ({ getPublicKey: async input => { assert.deepEqual(input, { KeyId: arn }); return metadata(); },
  sign: async input => {
    assert.equal(input.KeyId, arn);
    assert.equal(input.MessageType, 'RAW');
    assert.equal(input.SigningAlgorithm, 'ED25519_SHA_512');
    assert.equal(input.Message.byteLength, 32);
    assert.deepEqual(input.Message, Buffer.from(root, 'hex'));
    return response(input.Message);
  } });
const connect = overrides => AwsKmsRuntimeAttestationSigner.connect({ ...transport(), ...overrides }, arn, pin);

test('emitted JavaScript rejects direct construction and forged seals before granting signer capability', async () => {
  let metadataCalls = 0, signCalls = 0;
  const base = transport();
  const countingTransport = {
    getPublicKey: async input => { metadataCalls++; return base.getPublicKey(input); },
    sign: async input => { signCalls++; return base.sign(input); },
  };
  assert.throws(() => new AwsKmsRuntimeAttestationSigner(countingTransport, 'alias/unreviewed', pair.privateKey), /VALIDATED_CONNECTION_REQUIRED/);
  for (const seal of [undefined, null, {}, Symbol('runtime-attestation-validated-connection'), Symbol.for('runtime-attestation-validated-connection')]) {
    assert.throws(() => Reflect.construct(AwsKmsRuntimeAttestationSigner, [countingTransport, arn, pair.publicKey, seal]), /VALIDATED_CONNECTION_REQUIRED/);
  }
  assert.equal(metadataCalls, 0);
  assert.equal(signCalls, 0);
  const signer = await AwsKmsRuntimeAttestationSigner.connect(countingTransport, arn, pin);
  const signature = await signer.signRuntimeTelemetryRoot(root);
  assert.equal(metadataCalls, 1);
  assert.equal(signCalls, 1);
  assert.equal(verify(null, Buffer.from(root, 'hex'), pair.publicKey, Buffer.from(signature, 'base64')), true);
});

test('runtime KMS adapter signs exactly root bytes with pure Ed25519 and exposes no wallet API', async () => {
  const signer = await connect();
  const encoded = await signer.signRuntimeTelemetryRoot(root);
  assert.match(encoded, /^[A-Za-z0-9+/]{86}==$/);
  assert.equal(Buffer.from(encoded, 'base64').toString('base64'), encoded);
  assert.equal(verify(null, Buffer.from(root, 'hex'), pair.publicKey, Buffer.from(encoded, 'base64')), true);
  assert.equal(signer.signAuthorizedMessage, undefined);
  assert.equal(signer.wallet, undefined);
  assert.equal(signer.publicKey, undefined);
  assert.deepEqual(Object.keys(signer), []);
});

test('runtime KMS adapter rejects aliases and malformed key ARNs before contacting transport', async () => {
  let calls = 0;
  for (const keyArn of ['alias/evidence', arn.replace(':key/', ':alias/'), arn.replace('11111111-', '1111111-'),
    arn.replace('key/11111111-2222-3333-4444-555555555555', 'key/------------------------------------'), '', null]) {
    await assert.rejects(AwsKmsRuntimeAttestationSigner.connect({ ...transport(), getPublicKey: async () => { calls++; return metadata(); } }, keyArn, pin), /CONCRETE_KEY_ARN/);
  }
  assert.equal(calls, 0);
});

test('runtime KMS adapter rejects invalid, non-Ed25519 and private-key pins before transport', async () => {
  let calls = 0;
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (const badPin of ['', null, 'not a key', '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----',
    ec.publicKey.export({ format: 'pem', type: 'spki' }), pair.privateKey.export({ format: 'pem', type: 'pkcs8' })]) {
    await assert.rejects(AwsKmsRuntimeAttestationSigner.connect({ ...transport(), getPublicKey: async () => { calls++; return metadata(); } }, arn, badPin), /PUBLIC_PIN_INVALID/);
  }
  assert.equal(calls, 0);
});

test('runtime KMS metadata must describe the pinned concrete Ed25519 signing key', async () => {
  for (const override of [{ KeyId: undefined }, { KeyId: arn.replace('11111111', 'aaaaaaaa') },
    { KeySpec: 'ECC_NIST_P256' }, { KeyUsage: 'ENCRYPT_DECRYPT' }, { SigningAlgorithms: [] },
    { SigningAlgorithms: ['ED25519_PH_SHA_512'] }, { SigningAlgorithms: 'ED25519_SHA_512' },
    { PublicKey: undefined }, { PublicKey: metadata().PublicKey.toString('base64') }]) {
    await assert.rejects(connect({ getPublicKey: async () => ({ ...metadata(), ...override }) }), /KEY_METADATA_INVALID/);
  }
  await assert.rejects(connect({ getPublicKey: async () => null }), /KEY_METADATA_INVALID/);
});

test('runtime KMS rejects malformed, noncanonical, non-Ed25519 and unpinned public bytes', async () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  for (const publicKey of [new Uint8Array(0), Buffer.from('bad DER'),
    Buffer.concat([metadata().PublicKey, Buffer.from([0])]), ec.publicKey.export({ format: 'der', type: 'spki' })]) {
    await assert.rejects(connect({ getPublicKey: async () => ({ ...metadata(), PublicKey: publicKey }) }), /PUBLIC_KEY_INVALID/);
  }
  await assert.rejects(connect({ getPublicKey: async () => ({ ...metadata(), PublicKey: other.publicKey.export({ format: 'der', type: 'spki' }) }) }), /PUBLIC_PIN_MISMATCH/);
});

test('invalid runtime roots cannot reach KMS signing', async () => {
  let calls = 0;
  const signer = await connect({ sign: async () => { calls++; throw new Error('must not sign'); } });
  for (const invalid of ['', root.toUpperCase(), root.slice(1), `${root}0`, ` ${root}`, `${root}\n`, 'g'.repeat(64), null, Buffer.from(root, 'hex')]) {
    await assert.rejects(signer.signRuntimeTelemetryRoot(invalid), /ROOT_INVALID/);
  }
  assert.equal(calls, 0);
});

test('runtime KMS detects signing of UTF-8 hex, double hash or mutated request bytes', async () => {
  for (const wrongMessage of [() => Buffer.from(root, 'utf8'), () => createHash('sha256').update(Buffer.from(root, 'hex')).digest(),
    input => { input.Message[0] ^= 255; return input.Message; }]) {
    const signer = await connect({ sign: async input => response(wrongMessage(input)) });
    await assert.rejects(signer.signRuntimeTelemetryRoot(root), /SIGNATURE_INVALID/);
  }
});

test('runtime KMS rejects wrong response identity, algorithm, type, length and signature', async () => {
  for (const override of [{ KeyId: undefined }, { KeyId: 'other-key' }, { SigningAlgorithm: undefined },
    { SigningAlgorithm: 'ED25519_PH_SHA_512' }, { Signature: undefined }, { Signature: new Uint8Array(63) },
    { Signature: new Uint8Array(65) }, { Signature: new Uint8Array(64) }, { Signature: response(Buffer.from(root, 'hex')).Signature.toString('base64') },
    { Signature: sign(null, Buffer.from(root, 'hex'), other.privateKey) }]) {
    const signer = await connect({ sign: async input => ({ ...response(input.Message), ...override }) });
    await assert.rejects(signer.signRuntimeTelemetryRoot(root), /SIGNATURE_INVALID/);
  }
  const signer = await connect({ sign: async () => null });
  await assert.rejects(signer.signRuntimeTelemetryRoot(root), /SIGNATURE_INVALID/);
});

test('public metadata and returned signature buffers cannot mutate retained verification or evidence', async () => {
  const keyMetadata = metadata();
  let signature;
  const signer = await connect({ getPublicKey: async () => keyMetadata,
    sign: async input => { const result = response(input.Message); signature = result.Signature; return result; } });
  keyMetadata.PublicKey.fill(0);
  keyMetadata.KeyId = 'changed';
  const encoded = await signer.signRuntimeTelemetryRoot(root);
  signature.fill(0);
  assert.equal(verify(null, Buffer.from(root, 'hex'), pair.publicKey, Buffer.from(encoded, 'base64')), true);
});

test('runtime KMS propagates transport denial without producing a signature or falling back', async () => {
  await assert.rejects(connect({ getPublicKey: async () => { throw new Error('metadata denied'); } }), /metadata denied/);
  let calls = 0;
  const signer = await connect({ sign: async () => { calls++; throw new Error('sign denied'); } });
  await assert.rejects(signer.signRuntimeTelemetryRoot(root), /sign denied/);
  assert.equal(calls, 1);
});

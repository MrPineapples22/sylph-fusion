import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../../dist/store.js';
import {DurableLiveSigner, signingMessageHash} from '../../dist/platform/signing/durable-live-signer.js';

const message = Buffer.from('canonical Solana message fixture');
const grant = now => ({grantId:'grant-1',economicIntentId:'intent-1',wallet:'wallet-1',
  messageSha256:signingMessageHash(message),issuedAtMs:now-1,expiresAtMs:now+10_000,controlEpoch:7});

test('durable identity commits before signer invocation and duplicate/crash recovery fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-sign-'));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  let signerCalls = 0;
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async()=>{signerCalls++;throw new Error('simulated signer crash');}};
  const now = Date.now();
  try {
    const coordinator = new DurableLiveSigner(signer, store, () => 7, () => now);
    await assert.rejects(coordinator.sign(grant(now), message), /simulated signer crash/);
    assert.equal(signerCalls, 1);
    await store.close();

    // Restart sees the durable PREPARED identity and never calls the signer again.
    store = new Store(path);
    const recovered = new DurableLiveSigner(signer, store, () => 7, () => now);
    await assert.rejects(recovered.sign(grant(now), message), /UNIQUE constraint failed/);
    assert.equal(signerCalls, 1);
  } finally {
    await store.close().catch(()=>{});
    await rm(dir, {recursive:true,force:true});
  }
});

test('altered messages and stale or revoked grants never reach durability or signer', async () => {
  let prepared = 0, signerCalls = 0;
  const journal = {prepareSigningIntent:async()=>{prepared++;},markSigningIntentSigned:async()=>{}};
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async()=>{signerCalls++;return new Uint8Array(64);}};
  const now = Date.now();
  const coordinator = new DurableLiveSigner(signer, journal, () => 7, () => now);

  await assert.rejects(coordinator.sign(grant(now), Buffer.from('altered')), /MESSAGE_ALTERED/);
  await assert.rejects(coordinator.sign({...grant(now),expiresAtMs:now}, message), /GRANT_STALE/);
  await assert.rejects(coordinator.sign({...grant(now),controlEpoch:6}, message), /EPOCH_STALE/);
  assert.equal(prepared, 0);
  assert.equal(signerCalls, 0);
});

test('revocation racing the durable commit blocks the isolated signer call', async () => {
  const now = Date.now();
  let epoch = 7, signerCalls = 0;
  const journal = {prepareSigningIntent:async()=>{epoch=8;},markSigningIntentSigned:async()=>{}};
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async()=>{signerCalls++;return new Uint8Array(64);}};
  const coordinator = new DurableLiveSigner(signer, journal, () => epoch, () => now);
  await assert.rejects(coordinator.sign(grant(now), message), /REVOKED_AFTER_PREPARE/);
  assert.equal(signerCalls, 0);
});

test('valid grant persists the exact message identity before signing', async () => {
  const now = Date.now();
  const calls = [];
  const journal = {
    prepareSigningIntent: async intent => calls.push(['prepare', intent.messageSha256]),
    markSigningIntentSigned: async (intent, hash) => calls.push(['signed', intent, hash]),
  };
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async signed => {
    calls.push(['sign', Buffer.from(signed).toString()]);
    return new Uint8Array(64).fill(9);
  }};
  const coordinator = new DurableLiveSigner(signer, journal, () => 7, () => now);
  const signature = await coordinator.sign(grant(now), message);
  assert.equal(signature.byteLength, 64);
  assert.deepEqual(calls.map(row => row[0]), ['prepare', 'sign', 'signed']);
  assert.equal(calls[0][1], signingMessageHash(message));
  assert.equal(calls[2][2], signingMessageHash(message));
});

test('caller mutation during durable prepare cannot change authorized bytes or grant identity', async () => {
  const now = Date.now();
  const input = Buffer.from(message);
  const authorization = grant(now);
  const recorded = [];
  const journal = {
    prepareSigningIntent: async intent => {
      recorded.push(['prepare', {...intent}]);
      await Promise.resolve();
      input.fill(0);
      authorization.economicIntentId = 'different-intent';
      authorization.wallet = 'different-wallet';
      authorization.messageSha256 = signingMessageHash(input);
    },
    markSigningIntentSigned: async (...args) => recorded.push(['signed', ...args]),
  };
  const signer = {wallet:'wallet-1', signAuthorizedMessage: async bytes => {
    recorded.push(['sign', Buffer.from(bytes)]);
    return new Uint8Array(64).fill(9);
  }};
  await new DurableLiveSigner(signer, journal, () => 7, () => now).sign(authorization, input);
  assert.deepEqual(recorded[1][1], message);
  assert.equal(recorded[2][1], 'intent-1');
  assert.equal(recorded[2][2], recorded[0][1].messageSha256);
});

test('caller cannot extend an expiring grant while durable prepare is pending', async () => {
  let now = Date.now();
  const authorization = grant(now);
  let calls = 0;
  const journal = {prepareSigningIntent: async () => {
    now = authorization.expiresAtMs;
    authorization.expiresAtMs = now + 10_000;
  }, markSigningIntentSigned: async () => {}};
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async()=>{calls++;return new Uint8Array(64);}};
  await assert.rejects(new DurableLiveSigner(signer,journal,()=>7,()=>now).sign(authorization,message), /REVOKED_AFTER_PREPARE/);
  assert.equal(calls,0);
});

test('returned signature retains the bytes committed to the journal', async () => {
  const now = Date.now();
  const response = new Uint8Array(64).fill(9);
  let recorded;
  const journal = {prepareSigningIntent:async()=>{},markSigningIntentSigned:async(_id,_hash,signature)=>{
    recorded = signature;
    response.fill(0);
  }};
  const signer = {wallet:'wallet-1',signAuthorizedMessage:async()=>response};
  const signature = await new DurableLiveSigner(signer,journal,()=>7,()=>now).sign(grant(now),message);
  assert.equal(Buffer.from(signature).toString('base64'),recorded);
});

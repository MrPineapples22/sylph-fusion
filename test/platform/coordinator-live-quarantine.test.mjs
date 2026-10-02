import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, TransactionMessage, VersionedMessage, VersionedTransaction } from '@solana/web3.js';
import { CertifiedLiveExecutionCoordinator } from '../../dist/platform/execution/certified-live-coordinator.js';
import { assembleVerifiedTransaction } from '../../dist/platform/execution/transaction-artifact.js';

const fixtureKey = Keypair.fromSeed(new Uint8Array(32).fill(71));
const message = new TransactionMessage({
  payerKey: fixtureKey.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [],
}).compileToV0Message().serialize();

function harness() {
  const calls = [];
  let locked = false;
  const trap = name => { calls.push(name); throw new Error(`UNEXPECTED_${name}`); };
  const dependency = (name, allowed = {}) => new Proxy(allowed, {
    get(target, key) {
      if (!locked && Object.hasOwn(target, key)) return target[key];
      return trap(`${name}.${String(key)}`);
    },
  });
  const cfg = { MODE: 'live' };
  const coordinator = new CertifiedLiveExecutionCoordinator(
    cfg,
    dependency('rpc', { endpoints: [{}] }),
    dependency('market'),
    dependency('signer', { publicKey: fixtureKey.publicKey }),
    dependency('reservations'), dependency('generations'),
    dependency('sideEffectFence'), dependency('firewall'),
  );
  const root = coordinator.sealExecutionAuthorizationRoot({
    intentId: 'quarantined', generation: 1, reservationId: 'caller-claimed',
    candidateTransactionBytes: message, simulationComputeUnits: 1,
    estimatedNetSolDelta: 0n, expiresAtBlockHeight: Number.MAX_SAFE_INTEGER,
  });
  locked = true;
  return { coordinator, root, calls, cfg };
}

test('coordinator signing denies sealed, mutated, malformed and concurrent attempts before any dependency or input read', async () => {
  const { coordinator, root, calls, cfg } = harness();
  const before = Object.getOwnPropertyDescriptors(coordinator);
  const mutable = { ...root, candidateTransactionBytes: Uint8Array.from(message) };
  const poisoned = new Proxy({}, { get() { assert.fail('root must not be inspected'); } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const mode of ['live', 'paper', undefined]) {
    cfg.MODE = mode;
    for (const input of [root, mutable, {}, null, undefined, poisoned, revoked.proxy]) {
      await Promise.all(Array.from({ length: 3 }, () =>
        assert.rejects(coordinator.invokeCertifiedSigning(input), /^Error: QUARANTINED_COORDINATOR_SIGNING:/)));
    }
    mutable.generation++;
    mutable.simulationComputeUnits = NaN;
    mutable.reservationId = 'another-claimed-reservation';
    mutable.candidateTransactionBytes.fill(0);
    root.candidateTransactionBytes.fill(0);
  }
  assert.deepEqual(calls, [], 'no signer, RPC, fence, reservation, generation or firewall access');
  assert.deepEqual(Object.getOwnPropertyDescriptors(coordinator), before);
  assert.deepEqual(root.candidateTransactionBytes, message);
});

test('coordinator submission denies even valid offline wire, tampering and repeated direct calls without reading inputs or changing state', async () => {
  const { coordinator, calls, cfg } = harness();
  const before = Object.getOwnPropertyDescriptors(coordinator);
  // Deterministic offline fixture only; the injected signer gateway is trapped.
  const tx = new VersionedTransaction(VersionedMessage.deserialize(message));
  tx.sign([fixtureKey]);
  const artifact = assembleVerifiedTransaction(message, tx.signatures[0], fixtureKey.publicKey);
  const wire = Uint8Array.from(Buffer.from(artifact.wireBase64, 'base64'));
  const tampered = Uint8Array.from(wire);
  tampered[tampered.length - 1] ^= 1;
  const poisoned = new Proxy({}, { get() { assert.fail('submission arguments must not be inspected'); } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const inputs = [
    ['quarantined', 1, wire, artifact.signature],
    ['quarantined', 2, wire, artifact.signature],
    ['quarantined', 1, tampered, 'wrong'],
    [null, NaN, null, undefined],
    [poisoned, poisoned, poisoned, poisoned],
    [revoked.proxy, revoked.proxy, revoked.proxy, revoked.proxy],
  ];
  for (const mode of ['live', 'paper', undefined]) {
    cfg.MODE = mode;
    for (const args of inputs) {
      await Promise.all(Array.from({ length: 3 }, () =>
        assert.rejects(coordinator.submitExactBytes(...args), /^Error: QUARANTINED_COORDINATOR_SUBMISSION:/)));
    }
  }
  assert.deepEqual(calls, [], 'no signer, RPC, fence, reservation, generation or firewall access');
  assert.deepEqual(Object.getOwnPropertyDescriptors(coordinator), before);
  assert.deepEqual(wire, Uint8Array.from(Buffer.from(artifact.wireBase64, 'base64')));
});

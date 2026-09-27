import assert from 'node:assert/strict';
import test from 'node:test';
import { KmsSigningStateMachine } from '../../dist/platform/signing/durable-live-signer.js';

test('KmsSigningStateMachine: advances PREPARED -> SIGNING_IN_FLIGHT -> SIGNED', () => {
  let activeEpoch = 10;
  const fence = {
    getCurrentFenceEpoch: () => activeEpoch,
    isFenceValid: (epoch) => epoch === activeEpoch,
  };

  const sm = new KmsSigningStateMachine(fence);
  const intentId = 'intent-kms-1';

  // 1. Prepare
  const record = sm.prepareIntent({
    economicIntentId: intentId,
    messageSha256: 'sha256-dummy-msg',
    wallet: 'Wallet111111111111111111111111111111111111',
    fenceEpoch: 10,
  });
  assert.equal(record.stage, 'PREPARED');

  // 2. Mark in-flight
  sm.markInFlight(intentId, 10);
  assert.equal(record.stage, 'SIGNING_IN_FLIGHT');

  // 3. Mark signed
  sm.markSigned(intentId, 'base64-signature-committed');
  assert.equal(record.stage, 'SIGNED');
  assert.equal(record.signatureBase64, 'base64-signature-committed');
});

test('KmsSigningStateMachine: stale fence epoch blocks signing immediately (Invariant 4)', () => {
  let activeEpoch = 20;
  const fence = {
    getCurrentFenceEpoch: () => activeEpoch,
    isFenceValid: (epoch) => epoch === activeEpoch,
  };

  const sm = new KmsSigningStateMachine(fence);

  // Attempting to prepare with old epoch 19 throws
  assert.throws(
    () => sm.prepareIntent({
      economicIntentId: 'intent-stale-epoch',
      messageSha256: 'sha256-dummy-msg',
      wallet: 'Wallet111111111111111111111111111111111111',
      fenceEpoch: 19,
    }),
    /FENCEGRID_STALE_EPOCH/
  );
});

test('KmsSigningStateMachine: recovery protocol forbids retry on ambiguous in-flight crash', () => {
  let activeEpoch = 10;
  const fence = {
    getCurrentFenceEpoch: () => activeEpoch,
    isFenceValid: (epoch) => epoch === activeEpoch,
  };

  const sm = new KmsSigningStateMachine(fence);
  const intentId = 'intent-crash-in-flight';

  sm.prepareIntent({
    economicIntentId: intentId,
    messageSha256: 'sha256-dummy-msg',
    wallet: 'Wallet111111111111111111111111111111111111',
    fenceEpoch: 10,
  });
  sm.markInFlight(intentId, 10);

  // Simulated node crash and restart during KMS call
  const analysis = sm.analyzeRecoveryState(intentId);
  assert.equal(analysis.stage, 'RECOVERY_AMBIGUOUS');
  assert.equal(analysis.canSafeRetry, false);
  assert.equal(analysis.requiresOnChainReconciliation, true);
  assert.match(analysis.reason, /Must reconcile whole wallet/);
});

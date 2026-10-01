import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { JitoLifecycleCoordinator } from '../../dist/platform/execution/jito-lifecycle-coordinator.js';
import { NoLandVerificationAuthority } from '../../dist/platform/execution/no-land-certificate.js';

test('DurableGenerationFenceAuthority: enforces single active generation per intent and requires terminal proof to advance', async () => {
  const testStorage = resolve('data', 'test-generation-fences.json');
  try {
    await rm(testStorage, { force: true });
    const authority = new DurableGenerationFenceAuthority(testStorage);

    const intentId = 'intent-alpha-123';
    const gen1 = await authority.acquireInitialGeneration(intentId, 'sig-111', 1000);
    assert.equal(gen1.generation, 1);
    assert.equal(gen1.state, 'ACTIVE');

    // Attempting to acquire again fails closed
    await assert.rejects(
      () => authority.acquireInitialGeneration(intentId, 'sig-222', 1050),
      /GENERATION_ALREADY_ACTIVE/
    );

    // Advancing with raw block height or missing certificate is rejected
    await assert.rejects(
      () => authority.advanceGeneration(intentId, 'sig-333', 1100, 1001),
      /TERMINAL_PROOF_REQUIRED/
    );

    // Cannot advance if certificate indicates block height <= lastValidBlockHeight
    const prematureCert = {
      certificateType: 'NO_LAND_CERTIFICATE',
      intentId,
      generation: 1,
      signature: 'sig-111',
      lastValidBlockHeight: 1000,
      observedBlockHeight: 999,
      finalizedSlot: 1050,
      verifiedAt: Date.now(),
      rpcEndpoint: 'https://rpc.test',
      proofDigest: NoLandVerificationAuthority.computeNoLandDigest({
        intentId,
        generation: 1,
        signature: 'sig-111',
        lastValidBlockHeight: 1000,
        observedBlockHeight: 999,
        finalizedSlot: 1050,
        rpcEndpoint: 'https://rpc.test',
      }),
    };

    await assert.rejects(
      () => authority.advanceGeneration(intentId, 'sig-333', 1100, prematureCert),
      /FENCE_BREACH_PREVENTED/
    );

    // Advancing once proven terminated via verified NoLandCertificate succeeds
    const validCert = NoLandVerificationAuthority.certifyNoLand({
      intentId,
      generation: 1,
      signature: 'sig-111',
      lastValidBlockHeight: 1000,
      observedBlockHeight: 1001,
      finalizedSlot: 1050,
      rpcEndpoint: 'https://rpc.test',
      searchHistoryConfirmedNotFound: true,
    });

    const gen2 = await authority.advanceGeneration(intentId, 'sig-333', 1100, validCert);
    assert.equal(gen2.generation, 2);
    assert.equal(gen2.signature, 'sig-333');

    // Confirming generation transitions state
    await authority.confirmGeneration(intentId, 2);
    const active = await authority.getActiveGeneration(intentId);
    assert.equal(active, undefined);
  } finally {
    await rm(testStorage, { force: true });
  }
});

test('JitoLifecycleCoordinator: polls inflight bundle statuses and maps results', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          context: { slot: 300000 },
          value: [
            {
              bundle_id: 'bundle-test-1',
              transactions: ['sig-test-1'],
              status: 'Landed',
              landed_slot: 300001,
            },
          ],
        },
      }),
    };
  };

  const coordinator = new JitoLifecycleCoordinator('https://test-jito.mock/api/v1/bundles', undefined, 2000, mockFetch);
  const result = await coordinator.checkInflightStatus('bundle-test-1', 'sig-test-1');

  assert.equal(result.status, 'BUNDLE_LANDED');
  assert.equal(result.terminal, true);
  assert.equal(result.landedSlot, 300001);
  assert.equal(callCount, 1);
});

test('JitoLifecycleCoordinator: inverts Invalid status to non-terminal RELAY_UNAVAILABLE', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      result: {
        context: { slot: 300000 },
        value: [
          {
            bundle_id: 'bundle-invalid-1',
            status: 'Invalid',
          },
        ],
      },
    }),
  });

  const coordinator = new JitoLifecycleCoordinator('https://test-jito.mock/api/v1/bundles', undefined, 2000, mockFetch);
  const result = await coordinator.checkInflightStatus('bundle-invalid-1', 'sig-invalid-1');

  assert.equal(result.status, 'RELAY_UNAVAILABLE');
  assert.equal(result.terminal, false);
  assert.match(result.failureReason, /NON_TERMINAL/);
});

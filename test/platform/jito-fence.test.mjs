import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { JitoLifecycleCoordinator } from '../../dist/platform/execution/jito-lifecycle-coordinator.js';

test('DurableGenerationFenceAuthority: enforces single active generation per intent', async () => {
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

    // Cannot advance while block height <= lastValidBlockHeight
    await assert.rejects(
      () => authority.advanceGeneration(intentId, 'sig-333', 1100, 999),
      /FENCE_BREACH_PREVENTED/
    );

    // Advancing once proven expired succeeds
    const gen2 = await authority.advanceGeneration(intentId, 'sig-333', 1100, 1001);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { Executor } from '../dist/execution.js';

test('absent or malformed chain observations cannot expire an unknown execution', async () => {
  const order = { signature: 'unknown', lastValidBlockHeight: 100 };
  for (const endpoints of [[], [{ getTransaction: async () => null, getBlockHeight: async () => Infinity }],
    [{ getTransaction: async () => { throw new Error('offline'); } }]]) {
    const executor = new Executor({}, { endpoints }, {}, {});
    assert.deepEqual(await executor.reconcile(order), { status: 'pending' });
  }
});

test('valid finalized expiry observations release an expired execution', async () => {
  const endpoints = [1, 2].map(() => ({ getTransaction: async () => null, getBlockHeight: async () => 133 }));
  const executor = new Executor({}, { endpoints }, {}, {});
  assert.deepEqual(await executor.reconcile({ signature: 'expired', lastValidBlockHeight: 100 }), { status: 'expired' });
});

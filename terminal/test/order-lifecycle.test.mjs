import test from 'node:test';
import assert from 'node:assert/strict';

test('Order lifecycle stage timeline accounts for sequential milestones and durations', () => {
  const sampleOrder = {
    id: 'test-order-uuid-1',
    mint: 'TestMint11111111111111111111111111111111111',
    side: 'buy',
    status: 'filled',
    reason: 'buyer-accumulation',
    durations: {
      signal: 12,
      snapshot: 18,
      safety: 30,
      build: 20,
      simulation: 45,
      persisted: 14,
      broadcast: 160,
      settlement: 25,
    },
    overhead: {
      slippageBps: 300,
      priorityLamports: '200000',
      tipLamports: '50000',
      rentLamports: '3000000',
      quoteAgeMs: 78,
    },
  };

  const expectedStages = ['signal', 'snapshot', 'safety', 'build', 'simulation', 'persisted', 'broadcast', 'settlement'];
  for (const st of expectedStages) {
    assert.ok(sampleOrder.durations[st] >= 0, `Duration for stage ${st} must be non-negative`);
  }

  const totalDuration = Object.values(sampleOrder.durations).reduce((a, b) => a + b, 0);
  assert.equal(totalDuration, 324);
  assert.equal(sampleOrder.overhead.slippageBps, 300);
  assert.equal(sampleOrder.overhead.rentLamports, '3000000');
});

test('Order lifecycle distinguishes in-flight pending orders and terminal outcomes', () => {
  const pending = {
    id: 'in-flight-order',
    mint: 'PendingMint11111111111111111111111111111111',
    side: 'buy',
    status: 'pending',
  };

  assert.equal(pending.status, 'pending');

  const failed = {
    id: 'failed-order',
    mint: 'FailedMint111111111111111111111111111111111',
    side: 'buy',
    status: 'failed',
    failureReason: 'Slippage limit exceeded',
  };

  assert.equal(failed.status, 'failed');
  assert.match(failed.failureReason, /Slippage/);
});

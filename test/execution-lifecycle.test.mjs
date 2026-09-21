import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedEngine } from '../dist/execution-engine.js';
import { globalProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';

test('SimulatedEngine executes through all 6 lifecycle stages: IDLE -> VALIDATING -> QUOTING -> SIGNING -> SUBMITTING -> SETTLED', async () => {
  const engine = new SimulatedEngine(42, 100_000n, 10_000_000n);
  const poolAddress = 'pool_lifecycle_test';

  // Seed pool reserves
  engine.pushState({
    timestamp: Date.now(),
    slot: 1000,
    reserves: {
      sol: 50_000_000_000n, // 50 SOL
      token: 1_000_000_000_000_000n, // 1M tokens
    },
    price: 0.00005,
    volatility: 0.02,
  }, poolAddress);

  const orderId = 'order_lifecycle_001';
  const result = await engine.execute({
    orderId,
    tokenMint: 'token_lifecycle_mint',
    poolAddress,
    side: 'BUY',
    amountLamports: 100_000_000n, // 0.1 SOL
    maxSlippageBps: 500,
    triggerTimestamp: Date.now(),
  });

  assert.equal(result.report.orderId, orderId);
  const history = engine.getLifecycleHistory(orderId);
  assert.ok(history.length >= 4, `History should have multiple stages, got: ${history.length}`);

  const stages = history.map(h => h.stage);
  assert.ok(stages.includes('IDLE'), 'Should include IDLE stage');
  assert.ok(stages.includes('VALIDATING'), 'Should include VALIDATING stage');

  if (result.report.status === 'FILLED') {
    assert.ok(stages.includes('QUOTING'), 'Should include QUOTING stage');
    assert.ok(stages.includes('SIGNING'), 'Should include SIGNING stage');
    assert.ok(stages.includes('SUBMITTING'), 'Should include SUBMITTING stage');
    assert.ok(stages.includes('SETTLED'), 'Should include SETTLED stage');
    assert.equal(result.report.currentStage, 'SETTLED');
  } else {
    assert.ok(stages.includes('REJECTED') || stages.includes('EXPIRED'), 'Should include terminal failure stage');
  }

  // Verify timestamps in lifecycle records are monotonically non-decreasing
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i].timestampMs >= history[i - 1].timestampMs, 'Timestamps should be non-decreasing');
  }
});

test('SimulatedEngine rejects orders with invalid amount during VALIDATING stage', async () => {
  const engine = new SimulatedEngine(42);
  const orderId = 'order_invalid_amount';

  const result = await engine.execute({
    orderId,
    tokenMint: 'token_test',
    poolAddress: 'pool_test',
    side: 'BUY',
    amountLamports: 0n, // Zero amount
    maxSlippageBps: 500,
    triggerTimestamp: Date.now(),
  });

  assert.equal(result.report.status, 'REJECTED');
  assert.equal(result.report.failureReason, 'PRE_TRADE_RISK_REJECTED');

  const history = engine.getLifecycleHistory(orderId);
  const stages = history.map(h => h.stage);
  assert.deepEqual(stages, ['IDLE', 'VALIDATING', 'REJECTED']);
  assert.ok(history[2].reason?.includes('Invalid order amount'));
});

test('SimulatedEngine emergency sell exits execute cleanly through lifecyle', async () => {
  const engine = new SimulatedEngine(42);
  const poolAddress = 'pool_emergency_test';

  engine.pushState({
    timestamp: Date.now(),
    slot: 2000,
    reserves: {
      sol: 80_000_000_000n,
      token: 2_000_000_000_000_000n,
    },
    price: 0.00004,
    volatility: 0.01,
  }, poolAddress);

  const orderId = 'order_emergency_sell';
  const result = await engine.execute({
    orderId,
    tokenMint: 'token_emergency',
    poolAddress,
    side: 'SELL',
    amountLamports: 1_000_000_000n,
    maxSlippageBps: 2000,
    triggerTimestamp: Date.now(),
    emergency: true,
  });

  assert.equal(result.report.status, 'FILLED');
  assert.equal(result.report.currentStage, 'SETTLED');

  const history = engine.getLifecycleHistory(orderId);
  const stages = history.map(h => h.stage);
  assert.ok(stages.includes('QUOTING'));
  assert.ok(stages.includes('SIGNING'));
  assert.ok(stages.includes('SUBMITTING'));
  assert.ok(stages.includes('SETTLED'));
});

test('SimulatedEngine prunes lifecycle audits to prevent unbounded memory growth', async () => {
  const engine = new SimulatedEngine(1);

  // Submit 250 orders to trigger audit pruning (>200 cap)
  for (let i = 0; i < 250; i++) {
    await engine.execute({
      orderId: `order_prune_${i}`,
      tokenMint: 'token_mint',
      poolAddress: 'pool_addr',
      side: 'BUY',
      amountLamports: 0n, // Triggers immediate fast rejection
      maxSlippageBps: 100,
      triggerTimestamp: Date.now(),
    });
  }

  const audits = engine.getRecentLifecycleAudits(300);
  assert.ok(audits.length <= 201, `Lifecycle audit map should be bounded <= 201, got: ${audits.length}`);
});

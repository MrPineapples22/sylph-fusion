import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderHealthTracker, globalProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';
import { SimulatedEngine } from '../dist/execution-engine.js';

test('ProviderHealthTracker transitions to RATE_LIMITED on HTTP 429 and computes backoff', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true);

  // Initially healthy after a success
  tracker.recordSuccess('SOLANA_RPC', 20);
  let report = tracker.getReport();
  assert.equal(report.providers['SOLANA_RPC']?.state, 'OPTIMAL');

  // Record rate limit with 2000ms backoff
  tracker.recordRateLimit('SOLANA_RPC', 2000);
  report = tracker.getReport();
  assert.equal(report.providers['SOLANA_RPC']?.state, 'RATE_LIMITED');
  assert.ok(report.providers['SOLANA_RPC']?.rateLimitedUntilMs && report.providers['SOLANA_RPC'].rateLimitedUntilMs > Date.now());
});

test('ProviderHealthTracker reports isMarketFeedStale when authoritative feed exceeds 10s', (t) => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, true);
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true);
  let fakeTime = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => fakeTime);

  tracker.recordSuccess('PUMPPORTAL_WS', 15);
  tracker.recordSuccess('SOLANA_RPC', 20);
  assert.equal(tracker.isMarketFeedStale(fakeTime), false);

  // Advance time by 11 seconds (exceeding 10s authoritative stale threshold)
  fakeTime += 11_000;
  assert.equal(tracker.isMarketFeedStale(fakeTime), true, 'Should be stale when PUMPPORTAL_WS has not updated in >10s');

  // New heartbeat restores freshness
  tracker.recordSuccess('PUMPPORTAL_WS', 15);
  tracker.recordSuccess('SOLANA_RPC', 20);
  assert.equal(tracker.isMarketFeedStale(fakeTime), false, 'Heartbeat should restore freshness');
});

test('ProviderHealthTracker reports isMarketFeedStale when authoritative provider is RATE_LIMITED', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, true);
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true);
  tracker.recordSuccess('PUMPPORTAL_WS', 15);
  tracker.recordSuccess('SOLANA_RPC', 20);

  // Rate-limiting SOLANA_RPC trips market feed staleness
  tracker.recordRateLimit('SOLANA_RPC', 5000);
  assert.equal(tracker.isMarketFeedStale(), true, 'Rate-limited authoritative feed must trip staleness');
});

test('SimulatedEngine fails closed and rejects BUY orders when market feed is stale', async (t) => {
  const engine = new SimulatedEngine(42);
  const poolAddress = 'pool_stale_test';

  engine.pushState({
    timestamp: Date.now(),
    slot: 100,
    reserves: { sol: 10_000_000_000n, token: 1_000_000_000n },
    price: 10,
    volatility: 0.05,
  }, poolAddress);

  // Mock globalProviderHealthTracker.isMarketFeedStale to return true
  t.mock.method(globalProviderHealthTracker, 'isMarketFeedStale', () => true);
  engine.setEnforceLiveFeedFreshness(true);

  const orderId = 'order_stale_rejection';
  const result = await engine.execute({
    orderId,
    tokenMint: 'token_stale',
    poolAddress,
    side: 'BUY',
    amountLamports: 100_000_000n,
    maxSlippageBps: 500,
    triggerTimestamp: Date.now(),
  });

  assert.equal(result.report.status, 'EXPIRED');
  assert.equal(result.report.failureReason, 'STALE_STATE');

  const history = engine.getLifecycleHistory(orderId);
  const stages = history.map(h => h.stage);
  assert.ok(stages.includes('EXPIRED'));
  assert.ok(history.find(h => h.stage === 'EXPIRED')?.reason?.includes('Market feed stale'));
});

test('SimulatedEngine allows EMERGENCY SELL exits even when market feed is stale', async (t) => {
  const engine = new SimulatedEngine(42);
  const poolAddress = 'pool_emergency_stale';

  engine.pushState({
    timestamp: Date.now(),
    slot: 100,
    reserves: { sol: 10_000_000_000n, token: 1_000_000_000n },
    price: 10,
    volatility: 0.05,
  }, poolAddress);

  t.mock.method(globalProviderHealthTracker, 'isMarketFeedStale', () => true);

  const orderId = 'order_emergency_stale_exit';
  const result = await engine.execute({
    orderId,
    tokenMint: 'token_stale',
    poolAddress,
    side: 'SELL',
    amountLamports: 50_000_000n,
    maxSlippageBps: 2000,
    triggerTimestamp: Date.now(),
    emergency: true,
  });

  assert.equal(result.report.status, 'FILLED', 'Emergency exits must succeed even under stale feed');
  assert.equal(result.report.currentStage, 'SETTLED');
});

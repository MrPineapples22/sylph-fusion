import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderHealthTracker, globalProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';
import { globalProjectionService } from '../dist/projection-service.js';

test('startup cannot invent provider success, latency, or slot lag', () => {
  const tracker = new ProviderHealthTracker();
  const report = tracker.getReport();
  assert.equal(report.isMarketFeedStale, true);
  for (const provider of Object.values(report.providers)) {
    assert.equal(provider.state, 'OFFLINE');
    assert.equal(provider.lastSuccessTimestampMs, 0);
    assert.equal(provider.totalRequestsCount, 0);
    assert.equal(provider.slotLag, null);
    assert.equal(provider.failoverActive, false);
  }
});

test('RPC freshness enforcement agrees with displayed stale state', (t) => {
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true, 'REQUIRED');
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, true, 'REQUIRED');
  tracker.recordSuccess('SOLANA_RPC', 20);
  now += 10_001;
  tracker.recordSuccess('PUMPPORTAL_WS', 20);
  const report = tracker.getReport();
  assert.equal(report.providers.SOLANA_RPC.state, 'STALE');
  assert.equal(report.isMarketFeedStale, true);
});

test('invalid latency cannot establish a healthy provider observation', () => {
  const tracker = new ProviderHealthTracker();
  for (const latency of [NaN, Infinity, -1]) tracker.recordSuccess('SOLANA_RPC', latency);
  assert.equal(tracker.getReport().providers.SOLANA_RPC.state, 'OFFLINE');
});

test('circuit recovery is not evidence of an endpoint failover', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true, 'REQUIRED');
  for (let i = 0; i < 6; i++) tracker.recordFailure('SOLANA_RPC');
  assert.equal(tracker.getReport().providers.SOLANA_RPC.circuitBreakerTripped, true);
  tracker.recordSuccess('SOLANA_RPC', 20);
  assert.equal(tracker.getReport().providers.SOLANA_RPC.failoverActive, false);
});

test('projection exposes rate limiting and cannot certify unverified operation', (t) => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true, 'REQUIRED');
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, true, 'REQUIRED');
  tracker.recordSuccess('SOLANA_RPC', 20);
  tracker.recordSuccess('PUMPPORTAL_WS', 20);
  tracker.recordRateLimit('SOLANA_RPC', 5000);
  t.mock.method(globalProviderHealthTracker, 'getReport', () => tracker.getReport());
  const strip = globalProjectionService.getSystemStrip();
  assert.equal(strip.rpc, 'DEGRADED');
  assert.equal(strip.data, 'STALE');
  assert.notEqual(strip.execution, 'READY');
  assert.equal(strip.certification, 'BLOCKED');
});

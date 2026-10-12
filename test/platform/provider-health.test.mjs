import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderHealthTracker } from '../../dist/platform/ingestion/provider-health.js';
import { SourceHealthEngine } from '../../dist/intelligence/evidence/source-health.js';

test('REQ-004: Unobserved provider sources fail closed with DISCONNECTED status and zero reliability', () => {
  const engine = new SourceHealthEngine();

  // All default registered sources have 0 observations
  const metrics = engine.getAllMetrics();
  assert.ok(metrics.length >= 6);

  for (const m of metrics) {
    assert.equal(m.totalRequests, 0, `Source ${m.sourceId} should have 0 total requests before observation`);
    assert.equal(m.historicalReliability, 0.0, `Source ${m.sourceId} must NOT have optimistic 1.0 reliability`);
    assert.equal(m.lastSeenMs, 0, `Source ${m.sourceId} lastSeenMs must be 0`);
    assert.equal(engine.getHealthStatus(m.sourceId), 'DISCONNECTED', `Source ${m.sourceId} must be DISCONNECTED`);
  }

  // Independent confirmation score for unobserved sources must be 0
  const score = engine.getIndependentConfirmationScore(['solana_rpc_primary', 'dexscreener_api']);
  assert.equal(score, 0.0, 'Unobserved sources cannot produce positive confirmation score');
});

test('REQ-004: ProviderHealthTracker serves as single consolidated health authority for SourceHealthEngine', () => {
  const tracker = new ProviderHealthTracker();
  const engine = new SourceHealthEngine(tracker);

  assert.equal(engine.getProviderHealthTracker(), tracker);

  // Configure SOLANA_RPC as reachable and healthy
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true, 'NOT_REQUIRED');
  tracker.recordTransportReachable('SOLANA_RPC', true);
  tracker.recordValidatedObservation('SOLANA_RPC', 55, 0);
  tracker.recordValidatedObservation('SOLANA_RPC', 50, 0);
  tracker.recordValidatedObservation('SOLANA_RPC', 45, 0);

  // Synchronize from tracker
  engine.syncFromProviderHealthTracker();

  // Now solana_rpc_primary reflects the observed health
  const rpcStatus = engine.getHealthStatus('solana_rpc_primary');
  assert.equal(rpcStatus, 'HEALTHY');

  // Trigger rate limiting on upstream tracker
  tracker.recordRateLimit('SOLANA_RPC', 60_000);
  assert.equal(engine.getHealthStatus('solana_rpc_primary'), 'UNHEALTHY', 'Upstream rate limit must propagate to source health');

  // Mark transport unreachable on upstream tracker
  tracker.recordTransportReachable('SOLANA_RPC', false);
  assert.equal(engine.getHealthStatus('solana_rpc_primary'), 'DISCONNECTED', 'Unreachable transport must propagate as DISCONNECTED');
});

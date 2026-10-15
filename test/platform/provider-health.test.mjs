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

test('Raydium pool lookup is tracked as supplemental market research, never authoritative chain truth', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('RAYDIUM_API_V3', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('RAYDIUM_API_V3', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.RAYDIUM_API_V3;
  assert.equal(provider.role, 'MARKET_RESEARCH');
  assert.equal(provider.isAuthoritative, false);
  assert.equal(provider.capabilityAvailable, true);
});

test('Jupiter Swap V2 is classified as quote research, not transaction execution', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('JUPITER_QUOTE', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('JUPITER_QUOTE', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.JUPITER_QUOTE;
  assert.equal(provider.role, 'QUOTE_RESEARCH');
  assert.equal(provider.isAuthoritative, false);
  assert.equal(provider.capabilityAvailable, true);
});

test('Meteora DLMM lookup is tracked as supplemental market research, never authoritative chain truth', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('METEORA_DLMM_API', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('METEORA_DLMM_API', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.METEORA_DLMM_API;
  assert.equal(provider.role, 'MARKET_RESEARCH');
  assert.equal(provider.isAuthoritative, false);
  assert.equal(provider.capabilityAvailable, true);
});

test('GeckoTerminal pool lookup is tracked as supplemental market research, never authoritative chain truth', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('GECKOTERMINAL_API_V2', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('GECKOTERMINAL_API_V2', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.GECKOTERMINAL_API_V2;
  assert.equal(provider.role, 'MARKET_RESEARCH'); assert.equal(provider.isAuthoritative, false); assert.equal(provider.capabilityAvailable, true);
});

test('GoPlus Solana security stays supplemental and cannot become authoritative chain truth', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('GOPLUS_SOLANA_SECURITY', true, true, true, 'REQUIRED');
  tracker.recordValidatedObservation('GOPLUS_SOLANA_SECURITY', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.GOPLUS_SOLANA_SECURITY;
  assert.equal(provider.role, 'SECURITY_RISK'); assert.equal(provider.isAuthoritative, false); assert.equal(provider.capabilityAvailable, true);
});

test('Shyft token metadata is supplemental market research and requires authentication', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('SHYFT_TOKEN_INFO', true, true, true, 'REQUIRED');
  tracker.recordValidatedObservation('SHYFT_TOKEN_INFO', 120, undefined, 1_000);
  const provider = tracker.getReport(1_001).providers.SHYFT_TOKEN_INFO;
  assert.equal(provider.role, 'MARKET_RESEARCH'); assert.equal(provider.isAuthoritative, false); assert.equal(provider.capabilityAvailable, true);
});

test('Jupiter V2 keyless quotes remain unauthenticated while providing validated quote capability', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('JUPITER_QUOTE', false, false, false, 'NOT_REQUIRED');
  const missingKey = tracker.getReport().providers.JUPITER_QUOTE;
  assert.equal(missingKey.configured, false);
  assert.equal(missingKey.enabled, false);
  assert.equal(missingKey.authenticationRequirement, 'UNKNOWN', 'Unconfigured providers intentionally expose no active auth contract');
  assert.equal(missingKey.capabilityAvailable, false);
  assert.equal(missingKey.failureReason, 'PROVIDER_NOT_CONFIGURED');

  tracker.setProviderConfiguration('JUPITER_QUOTE', true, true, false, 'NOT_REQUIRED');
  const configured = tracker.getReport().providers.JUPITER_QUOTE;
  assert.equal(configured.configured, true);
  assert.equal(configured.enabled, true);
  assert.equal(configured.authenticationRequirement, 'NOT_REQUIRED');
  assert.equal(configured.authenticated, false);
  assert.equal(configured.observationValidated, false);
  assert.equal(configured.endpointUrlSanitized, 'https://api.jup.ag/swap/v2/order');

  tracker.setProviderConfiguration('JUPITER_QUOTE', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('JUPITER_QUOTE', 85);
  const observed = tracker.getReport().providers.JUPITER_QUOTE;
  assert.equal(observed.authenticated, false);
  assert.equal(observed.transportReachable, true);
  assert.equal(observed.observationValidated, true);
  assert.equal(observed.totalRequestsCount, 1);
});

test('Mayan, Birdeye, and Streamflow research adapters have distinct shared health identities', () => {
  const tracker = new ProviderHealthTracker();
  const providers = tracker.getReport().providers;
  assert.equal(providers.MAYAN_QUOTE.role, 'CROSS_CHAIN_QUOTE');
  assert.equal(providers.BIRDEYE_API.role, 'MARKET_RESEARCH');
  assert.equal(providers.STREAMFLOW_RPC.role, 'LOCKUP_RESEARCH');
  for (const id of ['MAYAN_QUOTE', 'BIRDEYE_API', 'STREAMFLOW_RPC']) {
    assert.equal(providers[id].configured, false);
    assert.equal(providers[id].capabilityAvailable, false);
    assert.equal(providers[id].observationValidated, false);
  }

  tracker.setProviderConfiguration('MAYAN_QUOTE', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('MAYAN_QUOTE', 80, undefined, 1_000);
  assert.equal(tracker.getReport(1_001).providers.MAYAN_QUOTE.capabilityAvailable, true);

  tracker.setProviderConfiguration('BIRDEYE_API', true, true, false, 'REQUIRED');
  tracker.recordValidatedObservation('BIRDEYE_API', 90, undefined, 1_000);
  assert.equal(tracker.getReport(1_001).providers.BIRDEYE_API.capabilityAvailable, false,
    'a response cannot silently satisfy an unmet authentication requirement');
  tracker.setProviderConfiguration('BIRDEYE_API', true, true, true, 'REQUIRED');
  assert.equal(tracker.getReport(1_001).providers.BIRDEYE_API.capabilityAvailable, true);

  tracker.setProviderConfiguration('STREAMFLOW_RPC', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('STREAMFLOW_RPC', 100, undefined, 1_000);
  assert.equal(tracker.getReport(1_001).providers.STREAMFLOW_RPC.capabilityAvailable, true);
});

test('a previously observed Yellowstone stream reports reconnecting after transport disconnects', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('YELLOWSTONE_GRPC', true, true, false, 'UNKNOWN');
  tracker.recordValidatedObservation('YELLOWSTONE_GRPC', 0, undefined, 10_000);
  tracker.recordTransportReachable('YELLOWSTONE_GRPC', false);

  const report = tracker.getReport(10_001);
  assert.equal(report.providers.YELLOWSTONE_GRPC.lastValidatedObservation, 10_000);
  assert.equal(report.providers.YELLOWSTONE_GRPC.observationValidated, false,
    'a disconnect invalidates the current observation capability while preserving its last validated timestamp');
  assert.equal(report.providers.YELLOWSTONE_GRPC.transportReachable, false);
  assert.equal(report.providers.YELLOWSTONE_GRPC.state, 'RECONNECTING');
});

test('global criticality follows the feed gate, not stale PumpPortal or RugCheck authority labels', () => {
  const tracker = new ProviderHealthTracker();
  const now = 1_800_000_000_000;
  for (const id of ['PUMPPORTAL_WS', 'SOLANA_WSS', 'SOLANA_RPC', 'RUGCHECK_API']) {
    tracker.setProviderConfiguration(id, true, true, false, 'NOT_REQUIRED');
  }
  tracker.recordValidatedObservation('PUMPPORTAL_WS', 20, undefined, now - 20_000);
  tracker.recordValidatedObservation('SOLANA_WSS', 20, undefined, now);
  tracker.recordValidatedObservation('SOLANA_RPC', 20, undefined, now);
  tracker.recordValidatedObservation('RUGCHECK_API', 20, undefined, now - 20_000);

  const report = tracker.getReport(now);
  assert.equal(tracker.isMarketFeedStale(now), false, 'fresh WSS and RPC satisfy the unchanged feed gate');
  assert.notEqual(report.overallSystemState, 'CRITICAL');
  assert.equal(report.providers.PUMPPORTAL_WS.isAuthoritative, true, 'canonical-source label is preserved');
  assert.equal(report.providers.PUMPPORTAL_WS.state, 'STALE');
  assert.equal(report.providers.RUGCHECK_API.state, 'STALE');
  assert.ok(report.activeAlerts.some(alert => alert.source === 'PUMPPORTAL_WS' && alert.severity === 'WARNING'));
  assert.ok(report.activeAlerts.some(alert => alert.source === 'RUGCHECK_API' && alert.severity === 'WARNING'));
});

test('configured-but-unobserved optional sources are visible without false alerts until attempted', () => {
  const tracker = new ProviderHealthTracker();
  for (const id of ['PUMPPORTAL_WS', 'SOLANA_RPC']) {
    tracker.setProviderConfiguration(id, true, true, false, 'NOT_REQUIRED');
    tracker.recordValidatedObservation(id, 20, undefined, 1_000);
  }
  tracker.setProviderConfiguration('STREAMFLOW_RPC', true, true, false, 'NOT_REQUIRED');
  let report = tracker.getReport(1_000);
  assert.equal(report.providers.STREAMFLOW_RPC.configured, true);
  assert.equal(report.providers.STREAMFLOW_RPC.enabled, true);
  assert.equal(report.providers.STREAMFLOW_RPC.attempted, false);
  assert.equal(report.providers.STREAMFLOW_RPC.failureReason, 'NOT_YET_OBSERVED');
  assert.ok(report.activeAlerts.every(alert => alert.source !== 'STREAMFLOW_RPC'));

  tracker.recordFailure('STREAMFLOW_RPC', 'TEST_REQUEST_FAILED', 1_000);
  report = tracker.getReport(1_001);
  assert.equal(report.providers.STREAMFLOW_RPC.attempted, true);
  assert.ok(report.activeAlerts.some(alert => alert.source === 'STREAMFLOW_RPC' && alert.severity === 'WARNING'));
  assert.equal(report.isMarketFeedStale, false);
  assert.notEqual(report.overallSystemState, 'CRITICAL');
});

test('required SOLANA_RPC and discovery failures remain critical through the unchanged feed gate', () => {
  const tracker = new ProviderHealthTracker();
  const now = 1_800_000_000_000;
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, false, 'NOT_REQUIRED');
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, false, 'NOT_REQUIRED');
  tracker.recordValidatedObservation('PUMPPORTAL_WS', 20, undefined, now);
  tracker.recordValidatedObservation('SOLANA_RPC', 20, undefined, now - 20_000);

  const report = tracker.getReport(now);
  assert.equal(tracker.isMarketFeedStale(now), true);
  assert.equal(report.overallSystemState, 'CRITICAL');
  assert.ok(report.activeAlerts.some(alert => alert.source === 'MARKET_FEED_GATE' && alert.severity === 'CRITICAL'));
});

test('connectivity-only checks do not validate a named provider capability', () => {
  const tracker = new ProviderHealthTracker();
  tracker.setProviderConfiguration('JITO_BLOCK_ENGINE', true, true, false, 'NOT_REQUIRED');
  tracker.recordConnectivityObservation('JITO_BLOCK_ENGINE', 15, 1_000);
  const provider = tracker.getReport(1_001).providers.JITO_BLOCK_ENGINE;
  assert.equal(provider.transportReachable, true);
  assert.equal(provider.observationValidated, true);
  assert.equal(provider.capabilityValidated, false);
  assert.equal(provider.capabilityAvailable, false);
});

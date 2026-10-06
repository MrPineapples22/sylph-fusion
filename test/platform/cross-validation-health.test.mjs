import test from 'node:test';
import assert from 'node:assert/strict';

import { MultiSourceCrossValidator } from '../../dist/platform/ingestion/cross-validator.js';
import { ProviderHealthTracker } from '../../dist/platform/ingestion/provider-health.js';

test('MultiSourceCrossValidator: Reconciles concordant observations into VERIFIED snapshot', () => {
  const validator = new MultiSourceCrossValidator();
  const now = Date.now();

  const snapshot = validator.evaluateToken({
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    decimals: 9,
    priceObservations: [
      { provider: 'DEXSCREENER_API', value: 111.50, timestampMs: now - 2000, latencyMs: 80, confidence: 0.85 },
      { provider: 'JUPITER_QUOTE', value: 111.45, timestampMs: now - 1500, latencyMs: 45, confidence: 0.90 },
      { provider: 'PUMPPORTAL_WS', value: 111.60, timestampMs: now - 500, latencyMs: 12, confidence: 0.88 },
    ],
    liquidityObservations: [
      { provider: 'DEXSCREENER_API', value: 12_000_000, timestampMs: now - 2000, latencyMs: 80, confidence: 0.85 },
    ],
    now,
  });

  assert.equal(snapshot.symbol, 'SOL');
  assert.equal(snapshot.status, 'VERIFIED');
  assert.ok(snapshot.priceUsd !== null && snapshot.priceUsd > 110);
  assert.ok(snapshot.realSolReserve !== null && snapshot.realSolReserve > 0);
  assert.ok(snapshot.confidence >= 0.90, 'Confidence should be boosted by multi-provider concordance');
  assert.ok(snapshot.supportingSources.length >= 1);
  assert.ok(snapshot.provenanceDigest.startsWith('0x'));
  assert.equal(snapshot.disagreementFlags.length, 0);
});

test('MultiSourceCrossValidator: Detects CONFLICTING state on material price divergence', () => {
  const validator = new MultiSourceCrossValidator();
  const now = Date.now();

  const snapshot = validator.evaluateToken({
    mint: 'Conflict11111111111111111111111111111111111',
    symbol: 'CNF',
    priceObservations: [
      { provider: 'DEXSCREENER_API', value: 1.00, timestampMs: now - 1000, latencyMs: 50, confidence: 0.80 },
      { provider: 'PUMPPORTAL_WS', value: 1.45, timestampMs: now - 500, latencyMs: 10, confidence: 0.85 }, // 45% divergence!
    ],
    now,
  });

  assert.equal(snapshot.status, 'CONFLICTING');
  assert.ok(snapshot.disagreementFlags.some(f => f.includes('PRICE_CONFLICT')));
  assert.ok(snapshot.confidence <= 0.40, 'Confidence should degrade on conflicting signals');
});

test('MultiSourceCrossValidator: Flags STALE data when observations exceed threshold', () => {
  const validator = new MultiSourceCrossValidator({ staleThresholdMs: 30_000 });
  const now = Date.now();

  const snapshot = validator.evaluateToken({
    mint: 'Stale111111111111111111111111111111111111111',
    symbol: 'STL',
    priceObservations: [
      { provider: 'DEXSCREENER_API', value: 0.50, timestampMs: now - 45_000, latencyMs: 60, confidence: 0.80 },
    ],
    now,
  });

  assert.equal(snapshot.status, 'STALE');
  assert.ok(snapshot.disagreementFlags.some(f => f.includes('STALE_DATA_AGE')));
});

test('MultiSourceCrossValidator: rejects future-dated observations and derives freshness from its selected primary', () => {
  const validator = new MultiSourceCrossValidator();
  const now = 1_700_000_000_000;
  const snapshot = validator.evaluateToken({
    mint: 'Future11111111111111111111111111111111111111',
    symbol: 'FTR',
    priceObservations: [
      { provider: 'DEXSCREENER_API', value: 100, timestampMs: now - 44_000, latencyMs: 30, confidence: 0.1 },
      { provider: 'JUPITER_QUOTE', value: 101, timestampMs: now - 1_000, latencyMs: 30, confidence: 0.9 },
      { provider: 'PUMPPORTAL_WS', value: 999, timestampMs: now + 1, latencyMs: 1, confidence: 1 },
    ],
    now,
  });
  assert.equal(snapshot.status, 'VERIFIED');
  assert.equal(snapshot.priceUsd, 101);
  assert.equal(snapshot.freshnessMs, 1_000);
});

test('MultiSourceCrossValidator: ignores stale or future non-price observations', () => {
  const validator = new MultiSourceCrossValidator({ staleThresholdMs: 30_000 });
  const now = 1_700_000_000_000;
  const snapshot = validator.evaluateToken({
    mint: 'Evidence111111111111111111111111111111111111',
    symbol: 'EVD',
    priceObservations: [{ provider: 'JUPITER_QUOTE', value: 1, timestampMs: now - 100, latencyMs: 10, confidence: 0.9 }],
    liquidityObservations: [{ provider: 'DEXSCREENER_API', value: 2_000_000, timestampMs: now - 30_001, latencyMs: 10, confidence: 0.9 }],
    marketCapObservations: [{ provider: 'PUMPPORTAL_WS', value: 3_000_000, timestampMs: now + 1, latencyMs: 10, confidence: 0.9 }],
    now,
  });
  assert.equal(snapshot.liquidityUsd, null);
  assert.equal(snapshot.marketCapUsd, null);
  assert.ok(snapshot.disagreementFlags.includes('NO_CURRENT_LIQUIDITY_OBSERVATIONS'));
  assert.ok(snapshot.disagreementFlags.includes('NO_CURRENT_MARKET_CAP_OBSERVATIONS'));
});

test('ProviderHealthTracker: Tracks latency, error rates, circuit breaker, and system state', () => {
  const tracker = new ProviderHealthTracker();
  const now = Date.now();
  tracker.setProviderConfiguration('PUMPPORTAL_WS', true, true, true, 'REQUIRED');
  tracker.setProviderConfiguration('SOLANA_RPC', true, true, true, 'REQUIRED');
  tracker.setProviderConfiguration('DEXSCREENER_API', true, true, true, 'REQUIRED');

  // 1. Startup has no observations and must remain unverified.
  let report = tracker.getReport(now);
  assert.equal(report.overallSystemState, 'CRITICAL');
  assert.equal(report.providers.PUMPPORTAL_WS.state, 'OFFLINE');
  assert.ok(report.providers.PUMPPORTAL_WS !== undefined);
  assert.ok(report.providers.DEXSCREENER_API !== undefined);
  assert.ok(report.providers.SOLANA_RPC !== undefined);
  assert.ok(report.providers.HELIOS_DIRECT_TPU !== undefined);

  // 2. Record success with low latency
  tracker.recordSuccess('PUMPPORTAL_WS', 8);
  tracker.recordSuccess('SOLANA_RPC', 45, 250_000);
  report = tracker.getReport(now);
  assert.equal(report.providers.PUMPPORTAL_WS.state, 'OPTIMAL');

  // 3. Inject failures to trip circuit breaker
  for (let i = 0; i < 10; i++) {
    tracker.recordFailure('DEXSCREENER_API');
  }

  report = tracker.getReport(now);
  assert.equal(report.providers.DEXSCREENER_API.circuitBreakerTripped, true);
  assert.equal(report.providers.DEXSCREENER_API.state, 'CIRCUIT_OPEN');
  assert.ok(report.activeAlerts.some(a => a.source === 'DEXSCREENER_API' && a.severity === 'CRITICAL'));
});

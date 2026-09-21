import test from 'node:test';
import assert from 'node:assert/strict';
import { PointInTimeStateEngine } from '../../dist/intelligence/truth/point-in-time-state.js';
import { BirthFingerprintProfiler } from '../../dist/intelligence/truth/birth-fingerprint.js';
import { TemporalFirewall } from '../../dist/intelligence/truth/temporal-firewall.js';

test('PointInTimeStateEngine enforces temporal queries and prevents future leakage', () => {
  const engine = new PointInTimeStateEngine();
  const mint = 'So11111111111111111111111111111111111111112';

  // Ingest events at t=1000, t=2000, t=3000
  engine.ingestEvent({
    eventId: 'evt_1',
    eventType: 'TRADE_SWAP',
    mint,
    wallet: 'wallet_alpha',
    slot: 100,
    sourceTimestampMs: 1000,
    receivedTimestampMs: 1005,
    commitment: 'confirmed',
    payload: { amountSol: 2.0, priceSol: 0.001 },
  });

  engine.ingestEvent({
    eventId: 'evt_2',
    eventType: 'TRADE_SWAP',
    mint,
    wallet: 'wallet_beta',
    slot: 102,
    sourceTimestampMs: 2000,
    receivedTimestampMs: 2005,
    commitment: 'confirmed',
    payload: { amountSol: 3.5, priceSol: 0.0015 },
  });

  engine.ingestEvent({
    eventId: 'evt_3',
    eventType: 'TRADE_SWAP',
    mint,
    wallet: 'wallet_gamma',
    slot: 105,
    sourceTimestampMs: 3000,
    receivedTimestampMs: 3005,
    commitment: 'confirmed',
    payload: { amountSol: 5.0, priceSol: 0.0025 },
  });

  // Query state strictly as of t=2500, slot=103
  const stateAt2500 = engine.get_token_state(mint, 2500, 103);
  assert.equal(stateAt2500.totalTxCount, 2, 'Should only observe evt_1 and evt_2');
  assert.equal(stateAt2500.uniqueWalletsCount, 2);
  assert.equal(stateAt2500.buyVolumeSol, 5.5);

  // Query state as of t=3500, slot=110
  const stateAt3500 = engine.get_token_state(mint, 3500, 110);
  assert.equal(stateAt3500.totalTxCount, 3, 'Should observe all 3 events');
  assert.equal(stateAt3500.buyVolumeSol, 10.5);

  // Assert TemporalFirewall rejects lookahead
  assert.throws(() => {
    TemporalFirewall.assertAvailableBeforeDecision(
      { artifactId: 'future_event', availableTimestampMs: 4000, availableSlot: 110 },
      { decisionTimestampMs: 3000, decisionSlot: 105 }
    );
  }, /TEMPORAL_FIREWALL_VIOLATION/);
});

test('BirthFingerprintProfiler profiles trajectory across 8 discrete windows', () => {
  const profiler = new BirthFingerprintProfiler();
  const mint = 'BirthToken1111111111111111111111111111111111';
  const birthTime = 1_000_000;

  const trades = [
    { timestampMs: birthTime + 1000, wallet: 'w1', isBuy: true, amountSol: 1.0, priceSol: 0.001, poolLiquiditySol: 20 },
    { timestampMs: birthTime + 1500, wallet: 'w2', isBuy: true, amountSol: 1.5, priceSol: 0.0011, poolLiquiditySol: 21 },
    { timestampMs: birthTime + 3000, wallet: 'w3', isBuy: true, amountSol: 2.0, priceSol: 0.0013, poolLiquiditySol: 23 },
    { timestampMs: birthTime + 8000, wallet: 'w4', isBuy: true, amountSol: 3.0, priceSol: 0.0018, poolLiquiditySol: 26 },
    { timestampMs: birthTime + 15000, wallet: 'w5', isBuy: true, amountSol: 4.0, priceSol: 0.0022, poolLiquiditySol: 30 },
  ];

  const trajectory = profiler.computeFingerprint({
    mint,
    birthTimestampMs: birthTime,
    trades,
    effectiveDispersalRatio: 0.9,
  });

  assert.equal(trajectory.mint, mint);
  assert.ok(trajectory.aggregateOrganicScore >= 65);
  assert.equal(trajectory.isOrganicLaunch, true);

  // Check window 0-2s
  const w0_2 = trajectory.windows['0-2s'];
  assert.equal(w0_2.buyersCount, 2);
  assert.equal(w0_2.buyVolumeSol, 2.5);
  assert.equal(w0_2.isBundleActivityDetected, false);

  // Check window 5-10s
  const w5_10 = trajectory.windows['5-10s'];
  assert.equal(w5_10.buyersCount, 1);
  assert.equal(w5_10.buyVolumeSol, 3.0);
});

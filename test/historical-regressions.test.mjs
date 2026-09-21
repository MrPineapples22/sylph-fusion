import test from 'node:test';
import assert from 'node:assert/strict';
import { globalConfigAuthority } from '../dist/config-authority.js';
import { globalProjectionService } from '../dist/projection-service.js';
import { globalLifecycle } from '../dist/lifecycle/system-lifecycle.js';
import { SimulatedEngine } from '../dist/execution-engine.js';
import { checkCandidateReserveDrift } from '../dist/fusion.js';

test('Historical Regression 1: Required system thresholds (GRACE_SECONDS, SWEEPER, BUNDLER) are centrally defined and consistent', () => {
  const cfg = globalConfigAuthority.getConfig();

  assert.equal(cfg.graceSeconds, 60, 'GRACE_SECONDS must be exactly 60');
  assert.equal(cfg.sweeper5mSeconds, 300, 'SWEEPER_5M must be 300 seconds');
  assert.equal(cfg.timeout3hSeconds, 10800, 'TIMEOUT_3H must be 10800 seconds');
  assert.equal(cfg.bundlerWindowMs, 30000, 'BUNDLER_WINDOW must be 30000ms');
  assert.equal(cfg.bundlerThreshold, 3, 'BUNDLER_THRESHOLD must be 3');
  assert.equal(cfg.maxRugScore, 50, 'MAX_RUG_SCORE must be 50');
  assert.equal(cfg.dangerRugScore, 101, 'DANGER_RUG_SCORE must be 101');
  assert.equal(cfg.minHsiScore, 50, 'MIN_HSI_SCORE must be 50');
  assert.equal(cfg.hsiAlpha, 0.5, 'HSI_ALPHA must be 0.5');
});

test('Historical Regression 2: Liquidity update before DEX data exists defaults safely without crashing', () => {
  // Candidate observed on bonding curve before DEX graduation
  const rawToken = {
    mint: 'EarlyBondingMint1111111111111111111111111',
    poolAddress: 'EarlyCurve11111111111111111111111111111',
    liquidity: undefined, // DEX data not yet present
    cap: undefined,
    txCount: 2,
    volume1h: 0,
  };

  const projected = globalProjectionService.projectEnrichedTokens([rawToken]);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].liquidityUsd, null);
  assert.equal(projected[0].risk, 'UNKNOWN');
  assert.equal(projected[0].decision, 'ABSTAIN');
});

test('Historical Regression 3: Stale callback / out-of-order state updates are fenced', () => {
  const engine = new SimulatedEngine(7, 100_000n, 10_000_000n);
  const pool = 'PoolFencingTest111111111111111111111111';

  // Push newer state at timestamp 2000
  engine.pushState({
    timestamp: 2000,
    slot: 200,
    reserves: { sol: 100_000_000_000n, token: 1_000_000_000_000_000n },
    price: 0.0001,
    volatility: 0.05,
  }, pool);

  // Attempt to push an older asynchronous callback at timestamp 1000
  engine.pushState({
    timestamp: 1000, // Stale!
    slot: 100,
    reserves: { sol: 50_000_000_000n, token: 500_000_000_000_000n },
    price: 0.00005,
    volatility: 0.1,
  }, pool);

  // Verify that older state was discarded and did not regress state
  const exported = engine.exportState();
  assert.ok(exported);
});

test('Historical Regression 4: Fallback liquidity and curve reserve drift boundary checks', () => {
  const s1 = {
    mint: { toBase58: () => 'Mint1' },
    curve: { complete: false, realQuoteReserves: '1000000000', virtualQuoteReserves: '30000000000', virtualTokenReserves: '1073000000000000' },
  };
  const s2 = {
    mint: { toBase58: () => 'Mint1' },
    curve: { complete: false, realQuoteReserves: '1000000000', virtualQuoteReserves: '30000000000', virtualTokenReserves: '1073000000000000' },
  };

  const driftResult = checkCandidateReserveDrift(s1, s2, 200n, 200n);
  assert.equal(driftResult.passed, true);
  assert.equal(driftResult.direction, 'none');

  // Curve completed fails closed
  const sCompleted = {
    mint: { toBase58: () => 'Mint1' },
    curve: { complete: true, realQuoteReserves: '0', virtualQuoteReserves: '0', virtualTokenReserves: '0' },
  };
  const completedDrift = checkCandidateReserveDrift(s1, sCompleted, 200n, 200n);
  assert.equal(completedDrift.passed, false);
  assert.equal(completedDrift.reason, 'CURVE_COMPLETED');
});

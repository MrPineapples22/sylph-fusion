import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTokenDecision, MAX_PRICE_DRIFT_BPS, MAX_LIQUIDITY_DROP_BPS } from '../src/token-decision-eval.js';

test('evaluateTokenDecision uses real candidate curve reserves and drift when available', () => {
  const asset = {
    id: 'POOL_1',
    symbol: 'REAL',
    price: 0.05,
    liquidity: 500000,
    mintAuthority: false,
    freezeAuthority: false,
  };

  const candidate = {
    mint: 'MINT_REAL',
    buyers: 14,
    devSold: false,
    age: 45000,
    curve: {
      complete: false,
      realQuoteReserves: '2500000000', // 2.5 SOL
      virtualTokenReserves: '800000000000',
      virtualQuoteReserves: '30000000000',
    },
    drift: {
      passed: true,
      priceDriftBps: 75,
      liquidityDropBps: 0,
      driftBps: 75,
      direction: 'up',
    },
  };

  const res = evaluateTokenDecision({ asset, candidate, solPriceUsd: 150 });

  assert.equal(res.realSolReserve, 2.5);
  assert.equal(res.realReserveSource, 'candidate_curve_snapshot');
  assert.equal(res.virtualTokenReserve, 800000000000);
  assert.equal(res.isCurveComplete, false);
  assert.equal(res.isCurveKnown, true);
  assert.equal(res.driftPct, 0.75);
  assert.equal(res.driftBps, 75);
  assert.equal(res.isDriftSafe, true);
  assert.equal(res.actualBuyers, 14);
  assert.equal(res.isDevSold, false);
  assert.equal(res.blocked, false);
  assert.equal(res.isTelemetryPending, false);
  assert.equal(res.decisionBadge, 'DECISION: ELIGIBLE');
  assert.equal(res.decisionTone, 'decision-eligible');
});

test('evaluateTokenDecision enforces dual drift thresholds from real engine drift', () => {
  const asset = { id: 'POOL_1', symbol: 'DRIFT_TEST', price: 0.05 };

  // 1. Upward price drift breach (> +200 BPS / +2.0%)
  const priceBreached = evaluateTokenDecision({
    asset,
    candidate: {
      curve: { complete: false, realQuoteReserves: '3000000000' },
      drift: { passed: false, priceDriftBps: 220, liquidityDropBps: 0, driftBps: 220, direction: 'up', reason: 'EXCESSIVE_PRICE_DRIFT' },
    },
  });
  assert.equal(priceBreached.blocked, true);
  assert.equal(priceBreached.isExcessivePriceDrift, true);
  assert.equal(priceBreached.decisionBadge, 'DECISION: BLOCKED');
  assert.match(priceBreached.blockedExplanation, /EXCESSIVE_PRICE_DRIFT/);

  // 2. Downward liquidity drainage breach (> -200 BPS / -2.0%)
  const dropBreached = evaluateTokenDecision({
    asset,
    candidate: {
      curve: { complete: false, realQuoteReserves: '3000000000' },
      drift: { passed: false, priceDriftBps: 0, liquidityDropBps: 250, driftBps: 250, direction: 'down', reason: 'EXCESSIVE_LIQUIDITY_DROP' },
    },
  });
  assert.equal(dropBreached.blocked, true);
  assert.equal(dropBreached.isExcessiveLiquidityDrop, true);
  assert.equal(dropBreached.decisionBadge, 'DECISION: BLOCKED');
  assert.match(dropBreached.blockedExplanation, /EXCESSIVE_LIQUIDITY_DROP/);
});

test('evaluateTokenDecision fails safe to pending and avoids inferred values when telemetry is unavailable', () => {
  // Asset with general pool liquidity and price history, but NO candidate curve/drift telemetry
  const asset = {
    id: 'POOL_RAW',
    symbol: 'RAW',
    price: 0.08,
    start: 0.04, // 100% price change in history
    history: [{ time: 100, value: 0.04 }, { time: 105, value: 0.08 }],
    liquidity: 600000, // $600k USD pool liquidity
  };

  const res = evaluateTokenDecision({ asset, candidate: null, driftTelemetry: null, solPriceUsd: 150 });

  // MUST NOT infer real SOL reserve from liquidity / 2 / solPrice
  assert.equal(res.realSolReserve, null);
  assert.equal(res.realReserveSource, 'none');

  // MUST NOT infer drift from price change history
  assert.equal(res.driftPct, null);
  assert.equal(res.driftBps, null);
  assert.equal(res.driftSource, 'none');

  // Curve complete status is unknown without candidate / on-chain curve snapshot
  assert.equal(res.isCurveKnown, false);

  // Pending safety checks
  assert.equal(res.isReserveSufficient, null);
  assert.equal(res.isCurveActive, null);

  // Verdict correctly reflects pending verification rather than claiming eligibility or blocking
  assert.equal(res.blocked, false);
  assert.equal(res.isTelemetryPending, true);
  assert.equal(res.decisionBadge, 'DECISION: PENDING TELEMETRY');
  assert.equal(res.decisionTone, 'decision-pending');
  assert.match(res.blockedExplanation, /Awaiting verified mint\/freeze authority, candidate curve and dual-snapshot drift telemetry/);
});

test('historical rejection logs cannot become current token authority', () => {
  const asset = { id: 'POOL_REJ', symbol: 'REJ' };

  const res = evaluateTokenDecision({
    asset,
    rejectionReason: 'all RPC endpoints failed',
  });

  assert.equal(res.blocked, false);
  assert.equal(res.isTelemetryPending, true);
  assert.equal(res.decisionBadge, 'DECISION: PENDING TELEMETRY');
  assert.doesNotMatch(res.blockedExplanation, /all RPC endpoints failed/);
});

test('evaluateTokenDecision identifies migrated AMM pools and surfaces pool reserves', () => {
  const asset = {
    id: 'POOL_RAYDIUM',
    symbol: 'RAY_PAIR',
    dex: 'raydium',
    price: 0.00005,
    liquidity: 10000,
    reserves: {
      sol: 20000000000n, // 20 SOL
      token: 400000000000000n,
    },
  };

  const res = evaluateTokenDecision({
    asset,
    solPriceUsd: 150,
  });

  assert.equal(res.realSolReserve, 20);
  assert.equal(res.realReserveSource, 'amm_pool_reserves');
  assert.equal(res.isCurveKnown, true);
  assert.equal(res.isCurveComplete, true);
  // An observed Raydium pool is a post-graduation venue, not an automatic
  // curve-complete rejection.  Missing authority/drift evidence still keeps
  // it pending rather than eligible.
  assert.equal(res.blocked, false);
  assert.equal(res.isRaydiumActive, true);
  assert.equal(res.isTelemetryPending, true);
});

test('PumpSwap is an observed AMM venue and never waits specifically for Raydium', () => {
  const res = evaluateTokenDecision({ asset: {
    id: 'POOL_PUMPSWAP', symbol: 'PUMP_PAIR', dex: 'pumpswap',
    reserves: { sol: 20_000_000_000n, token: 400_000_000_000_000n },
  }});
  assert.equal(res.isCurveComplete, true);
  assert.equal(res.isRaydiumActive, true);
  assert.equal(res.isMigrationPending, false);
});

import { evaluateDualSnapshotDrift, assetToPoolState, syncAssetsToEngine } from '../src/pool-sync.js';

test('evaluateDualSnapshotDrift requires at least 2 consecutive valid snapshots', () => {
  assert.equal(evaluateDualSnapshotDrift(null), null);
  assert.equal(evaluateDualSnapshotDrift([]), null);
  assert.equal(evaluateDualSnapshotDrift([{ reserves: { sol: 100n, token: 100n } }]), null);
});

test('evaluateDualSnapshotDrift computes real price drift and liquidity drop between consecutive snapshots', () => {
  // Snapshot 1: 10 SOL, 1,000,000 tokens => p1 = 10 / 1e6 = 1e-5
  const s1 = { slot: 100, reserves: { sol: 10_000_000_000n, token: 1_000_000_000_000_000n } };
  // Snapshot 2: 10.1 SOL, 1,000,000 tokens => p2 = 10.1 / 1e6 = 1.01e-5 => +1.0% (+100 BPS)
  const s2 = { slot: 101, reserves: { sol: 10_100_000_000n, token: 1_000_000_000_000_000n } };

  const drift = evaluateDualSnapshotDrift([s1, s2]);
  assert.ok(drift);
  assert.equal(drift.priceDriftBps, 100);
  assert.equal(drift.driftBps, 100);
  assert.equal(drift.direction, 'up');
  assert.equal(drift.passed, true);
  assert.equal(drift.reason, null);

  // When supplied to evaluateTokenDecision on an active curve
  const asset = {
    id: 'POOL_ACTIVE',
    mintAuthority: false,
    freezeAuthority: false,
    symbol: 'ACT',
    price: 0.000015,
    reserves: s2.reserves,
    complete: false,
    migrated: false,
  };

  const decision = evaluateTokenDecision({
    asset,
    driftTelemetry: drift,
    solPriceUsd: 150,
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.isTelemetryPending, false);
  assert.equal(decision.driftBps, 100);
  assert.equal(decision.isDriftSafe, true);
  assert.equal(decision.decisionBadge, 'DECISION: ELIGIBLE');
});

test('syncAssetsToEngine pre-seeds consecutive snapshots from asset history', () => {
  const mockEngine = {
    states: [],
    statesByPool: new Map(),
    pushState(st, pool) {
      const arr = this.statesByPool.get(pool) || [];
      arr.push(st);
      this.statesByPool.set(pool, arr);
    },
  };

  const asset = {
    id: 'POOL_HIST',
    price: 0.05,
    liquidity: 300_000,
    observedAt: 10000,
    history: [
      { time: 8, value: 0.0495 },
      { time: 10, value: 0.05 },
    ],
  };

  const synced = syncAssetsToEngine(mockEngine, [asset], 150, 10000);
  assert.equal(synced, 1);
  const poolStates = mockEngine.statesByPool.get('POOL_HIST');
  assert.equal(poolStates.length, 2);
  assert.equal(poolStates[0].timestamp, 8000);
  assert.equal(poolStates[1].timestamp, 10000);

  const drift = evaluateDualSnapshotDrift(poolStates);
  assert.ok(drift);
  assert.equal(drift.passed, true);
  assert.ok(drift.priceDriftBps <= 200);
});

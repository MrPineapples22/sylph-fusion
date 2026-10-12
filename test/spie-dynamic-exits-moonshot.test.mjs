import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicExitEngine } from '../dist/intelligence/spie/dynamic-exits.js';

test('SPIE DynamicExitEngine — Moonshot Ratchets, Breakeven Protection & Competing Hazards', async (t) => {
  const engine = new DynamicExitEngine();

  const basePosition = {
    mint: 'MoonshotTestMint111111111111111111111111111',
    entryPriceUsd: 1.0,
    currentPriceUsd: 1.0,
    highestPriceUsd: 1.0,
    lowestPriceUsd: 1.0,
    unrealizedPnlPct: 0.0,
    realSolReserve: 50.0,
    priorBlockSolReserve: 50.0,
    consecutiveSellBlocks: 0,
    currentSellPressureRatio: 0.2,
    isDevSold: false,
    stagesCompleted: 0,
    holdingTimeSeconds: 60,
  };

  await t.test('1. BREAKEVEN_PROTECT: Trades reaching +8% peak cannot decay below entry', () => {
    // Peak reached +8% (1.08), current price drops to 1.007 (<= 1.008)
    const pos = {
      ...basePosition,
      highestPriceUsd: 1.08,
      currentPriceUsd: 1.007,
      unrealizedPnlPct: 0.007,
    };

    const result = engine.evaluateGodTierExits(pos);
    assert.equal(result.action, 'BREAKEVEN_PROTECT');
    assert.equal(result.fractionPct, 1.0);
    assert.ok(result.protectiveStopUsd >= 1.005, 'Protective stop locks in at least entry * 1.005');
  });

  await t.test('2. Multi-Stage Moonshot Ratchets scale to 10x, 20x, and 100x (+10,000% PnL)', () => {
    // 10x Runner (Peak = 11.0x / +1,000% gain)
    const pos10x = {
      ...basePosition,
      highestPriceUsd: 11.0,
      currentPriceUsd: 10.0,
      unrealizedPnlPct: 9.0,
    };
    const res10x = engine.evaluateGodTierExits(pos10x);
    assert.equal(res10x.action, 'HOLD');
    assert.ok(res10x.protectiveStopUsd >= 7.5, '10x runner stop floor must be at least 7.5x');

    // 20x Runner (Peak = 21.0x / +2,000% gain)
    const pos20x = {
      ...basePosition,
      highestPriceUsd: 21.0,
      currentPriceUsd: 19.0,
      unrealizedPnlPct: 18.0,
    };
    const res20x = engine.evaluateGodTierExits(pos20x);
    assert.equal(res20x.action, 'HOLD');
    assert.ok(res20x.protectiveStopUsd >= 14.7, '20x runner stop floor must be at least 14.7x');

    // 100x Runner (Peak = 101.0x / +10,000% gain)
    const pos100x = {
      ...basePosition,
      highestPriceUsd: 101.0,
      currentPriceUsd: 95.0,
      unrealizedPnlPct: 94.0,
    };
    const res100x = engine.evaluateGodTierExits(pos100x);
    assert.equal(res100x.action, 'HOLD');
    assert.ok(res100x.protectiveStopUsd >= 70.0, '100x runner stop floor must lock in at least 70.0x (+6,900% locked PnL)');

    // Breaching the 100x floor triggers profit realization
    const pos100xBreached = {
      ...pos100x,
      currentPriceUsd: 69.5, // dropped below 70.0 floor
    };
    const res100xBreached = engine.evaluateGodTierExits(pos100xBreached);
    assert.equal(res100xBreached.action, 'EXIT_100_PROFIT');
    assert.equal(res100xBreached.fractionPct, 1.0);
  });

  await t.test('3. evaluateHazardRunnerExit: PYRAMID_ADD on strong convex expansion hazard', () => {
    const posRunner = {
      ...basePosition,
      currentPriceUsd: 3.5,
      highestPriceUsd: 3.5,
      unrealizedPnlPct: 2.5,
      holdingTimeSeconds: 60,
    };

    const hazardResult = engine.evaluateHazardRunnerExit(posRunner, {
      walletEntropy: 1.8,
      independentCapitalAcceleration: 0.5,
      exitDepthLamports: 100_000_000_000n,
      poolQuoteReservesLamports: 200_000_000_000n,
      coordinationDecayRate: 0.02,
      sellerAbsorptionRate: 0.85,
      recentPriceVelocityBps: 150,
    });

    assert.equal(hazardResult.action, 'PYRAMID_ADD');
    assert.equal(hazardResult.reduceFraction, 0.0);
    assert.ok(hazardResult.hazardState);
    assert.ok(hazardResult.hazardState.netConvexHazardRatio > 2.5);
  });

  await t.test('4. evaluateHazardRunnerExit: FULL_EXIT_HAZARD on liquidity collapse / unexitability', () => {
    const posTrapped = {
      ...basePosition,
      currentPriceUsd: 1.2,
      highestPriceUsd: 1.5,
      unrealizedPnlPct: 0.2,
      holdingTimeSeconds: 120,
    };

    const trappedResult = engine.evaluateHazardRunnerExit(posTrapped, {
      walletEntropy: 0.2, // severe sybil / low entropy
      exitDepthLamports: 1_000_000_000n, // very thin exit depth (1 SOL)
      poolQuoteReservesLamports: 100_000_000_000n, // pool 100 SOL -> ratio 0.01 (< 0.05 unexitability threshold)
      coordinationDecayRate: -0.1,
      sellerAbsorptionRate: 0.1,
      recentPriceVelocityBps: -80,
    });

    assert.equal(trappedResult.action, 'EXIT_100_LIQUIDITY_SHOCK');
    assert.equal(trappedResult.reduceFraction, 1.0);
    assert.ok(trappedResult.hazardState);
    assert.ok(trappedResult.hazardState.hUnexitability >= 0.7 || trappedResult.hazardState.hLiquidityCollapse >= 0.7);
  });

  await t.test('5. evaluateHazardRunnerExit: PARTIAL_DERISK when downside hazard compresses convex ratio < 0.3', () => {
    const posDerisk = {
      ...basePosition,
      currentPriceUsd: 1.8,
      highestPriceUsd: 2.1,
      unrealizedPnlPct: 0.8,
      holdingTimeSeconds: 150,
    };

    const deriskResult = engine.evaluateHazardRunnerExit(posDerisk, {
      walletEntropy: 0.7,
      independentCapitalAcceleration: -0.2,
      exitDepthLamports: 15_000_000_000n,
      poolQuoteReservesLamports: 100_000_000_000n,
      coordinationDecayRate: 0.0,
      sellerAbsorptionRate: 0.4,
      recentPriceVelocityBps: -10,
    });

    assert.equal(deriskResult.action, 'REDUCE_50');
    assert.equal(deriskResult.reduceFraction, 0.5);
    assert.ok(deriskResult.hazardState);
    assert.ok(deriskResult.hazardState.netConvexHazardRatio < 0.3);
  });
});

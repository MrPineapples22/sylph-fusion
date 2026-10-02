import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidityFractureDetector } from '../../dist/intelligence/risk/liquidity-fracture.js';
import { calculateOptimalBuyPositionValue } from '../../dist/intelligence/execution/position-sizer.js';

test('LiquidityFractureDetector: fails closed when pool liquidity is zero or unobserved', () => {
  const evalResult = LiquidityFractureDetector.evaluatePool({
    solReserve: 0,
    tokenReserve: 0,
    solPriceUsd: 150,
    poolLiquidityUsd: 0,
  });

  assert.equal(evalResult.isFractured, true);
  assert.equal(evalResult.hardPositionCeilingUsd, 0);
  assert.equal(evalResult.brittlenessIndex, 1.0);
  assert.match(evalResult.rationale, /FRACTURED_LIQUIDITY/);
});

test('LiquidityFractureDetector: calculates fracture point Q* and stressed exit capacity', () => {
  // Pool with $20,000 liquidity (100 SOL reserve @ $150 = $15,000, 50/50 AMM or bonding curve)
  const evalResult = LiquidityFractureDetector.evaluatePool({
    solReserve: 66.67,
    tokenReserve: 10_000_000,
    solPriceUsd: 150,
    poolLiquidityUsd: 20_000,
  });

  assert.equal(evalResult.isFractured, false);
  assert.ok(evalResult.fracturePointUsd > 0);
  assert.ok(evalResult.stressedExitCapacity25Usd > 0);
  assert.ok(evalResult.stressedExitCapacity50Usd > 0);

  // Stressed capacity at -50% must be strictly smaller than at -25%
  assert.ok(evalResult.stressedExitCapacity50Usd < evalResult.stressedExitCapacity25Usd);

  // Hard position ceiling is bounded by stressed exit capacity
  assert.ok(evalResult.hardPositionCeilingUsd <= evalResult.stressedExitCapacity25Usd);
  assert.ok(evalResult.brittlenessIndex >= 0 && evalResult.brittlenessIndex <= 1.0);
});

test('Position Sizer: enforces stressed exit ceiling when enabled (Roadmap #260)', () => {
  // Shallow pool with only $400 liquidity ($200 SOL reserve)
  const resultWithoutCeiling = calculateOptimalBuyPositionValue(
    { mint: 'ShallowPoolMint', symbol: 'SHAL', liquidity: 400, highSignalIndex: 90, tier: 'PRIME', pod: 'UP' },
    {
      cashUsd: 500.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 50.0,
      activePositionsCount: 0,
      maxPositions: 2,
      enforceStressedExitCeiling: false,
    }
  );

  const resultWithCeiling = calculateOptimalBuyPositionValue(
    { mint: 'ShallowPoolMint', symbol: 'SHAL', liquidity: 400, highSignalIndex: 90, tier: 'PRIME', pod: 'UP' },
    {
      cashUsd: 500.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 50.0,
      activePositionsCount: 0,
      maxPositions: 2,
      enforceStressedExitCeiling: true,
    }
  );

  assert.ok(resultWithCeiling.fractureEvaluation);
  assert.ok(
    resultWithCeiling.optimalUsd <= resultWithoutCeiling.optimalUsd,
    `Ceiling-enforced size (${resultWithCeiling.optimalUsd}) must not exceed unconstrained size (${resultWithoutCeiling.optimalUsd})`
  );
  assert.ok(resultWithCeiling.optimalUsd <= resultWithCeiling.fractureEvaluation.hardPositionCeilingUsd + 0.01);
});

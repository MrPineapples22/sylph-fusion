import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptimalBuyPositionValue } from '../../dist/intelligence/execution/position-sizer.js';

test('Position Sizer: 100% locked reserve blocks buy allocation', () => {
  const result = calculateOptimalBuyPositionValue(
    { mint: 'TestMint111', symbol: 'TEST', liquidity: 50000, highSignalIndex: 95 },
    {
      cashUsd: 20.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 20.0, // 100% locked in reserve
      activePositionsCount: 0,
      maxPositions: 2,
    }
  );

  assert.equal(result.optimalUsd, 0);
  assert.equal(result.confidenceGrade, 'BLOCKED_RESERVE');
  assert.match(result.rationale, /Zone 0 Emergency Reserve/);
});

test('Position Sizer: AMM liquidity depth limits buy size to <= 2.5% pool depth', () => {
  // Pool with only $1,200 liquidity (e.g. 8 SOL pool): 2.5% is $30.00
  const result = calculateOptimalBuyPositionValue(
    { mint: 'ThinPoolMint', symbol: 'THIN', liquidity: 1200, highSignalIndex: 90, tier: 'PRIME', pod: 'UP' },
    {
      cashUsd: 500.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 100.0,
      activePositionsCount: 0,
      maxPositions: 2,
    }
  );

  assert.ok(result.optimalUsd <= 30.0, `Expected optimalUsd <= 30.0, got ${result.optimalUsd}`);
  assert.equal(result.liquidityCapUsd, 30.0);
  assert.ok(result.estimatedPriceImpactPct <= 2.5);
  assert.match(result.rationale, /2\.5% pool.*depth/);
});

test('Position Sizer: High conviction (PRIME tier, HSI 95, UP) scales via Half-Kelly', () => {
  const result = calculateOptimalBuyPositionValue(
    { mint: 'PrimeRunner', symbol: 'PRIME', liquidity: 50000, highSignalIndex: 95, tier: 'PRIME', pod: 'UP' },
    {
      cashUsd: 200.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 40.0, // $160 unreserved across 2 slots = $80 base
      activePositionsCount: 0,
      maxPositions: 2,
    }
  );

  assert.ok(result.convictionMultiplier >= 1.20, `Expected Kelly >= 1.20, got ${result.convictionMultiplier}`);
  assert.equal(result.confidenceGrade, 'PRIME_AGGRESSIVE');
  assert.ok(result.optimalUsd >= 50.0 && result.optimalUsd <= 100.0);
  assert.match(result.rationale, /Prime tier, HSI 95, UP momentum/);
});

test('Position Sizer: Defensive probe trade for lower HSI or elevated risk', () => {
  const result = calculateOptimalBuyPositionValue(
    { mint: 'RiskyToken', symbol: 'RISK', liquidity: 20000, highSignalIndex: 65, tier: 'WATCH', pod: 'DOWN', riskScore: 50 },
    {
      cashUsd: 200.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 40.0,
      activePositionsCount: 0,
      maxPositions: 2,
    }
  );

  assert.ok(result.convictionMultiplier <= 0.60, `Expected Kelly <= 0.60, got ${result.convictionMultiplier}`);
  assert.equal(result.confidenceGrade, 'DEFENSIVE_PROBE');
  assert.ok(result.optimalUsd <= 30.0);
  assert.match(result.rationale, /Defensive/);
});

test('Position Sizer: Allocates remaining capacity when 1 position is already open', () => {
  const result = calculateOptimalBuyPositionValue(
    { mint: 'SecondPos', symbol: 'SEC', liquidity: 40000, highSignalIndex: 85, tier: 'DEVELOPING', pod: 'UP' },
    {
      cashUsd: 150.0,
      reservedCashUsd: 0.0,
      emergencyReserveUsd: 30.0, // $120 unreserved with 1 slot remaining = $120 slot base
      activePositionsCount: 1,
      maxPositions: 2,
    }
  );

  assert.equal(result.baseSlotUsd, 120.0);
  assert.equal(result.optimalUsd, 90.0);
  assert.ok(result.optimalUsd >= 40.0 && result.optimalUsd <= 100.0);
});

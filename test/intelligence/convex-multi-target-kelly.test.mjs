import test from 'node:test';
import assert from 'node:assert/strict';
import { KellyAllocator } from '../../dist/intelligence/spie/kelly-allocator.js';

test('SPIE KellyAllocator — Convex Multi-Target Power-Law Sizing & Tail Invariants', async (t) => {
  const allocator = new KellyAllocator();

  const baseInput = {
    pTarget: 0.55,
    targetUpsideBps: 2500, // +25% base
    structuralStopBps: 1200, // -12%
    poolReserveSol: 50.0,
    totalPortfolioCapitalSol: 100.0,
    mandateLimitSol: 2.0,
    regime: 'TRENDING',
    epistemicUncertainty: 0.15,
  };

  const powerLawTail = {
    p2x: 0.50,
    p5x: 0.30,
    p10x: 0.15,
    p20x: 0.08,
    p50x: 0.03,
    p100x: 0.01,
  };

  await t.test('1. Multi-barrier power-law tail expands growth-optimal sizing', () => {
    const standardAlloc = allocator.calculateAllocation(baseInput);
    const convexAlloc = allocator.calculateConvexMultiTargetKelly({
      ...baseInput,
      multiplierDistribution: powerLawTail,
    });

    assert.ok(convexAlloc.recommendedAllocationSol > 0, 'Must allocate positive capital');
    assert.ok(
      convexAlloc.unconstrainedKellyFraction > standardAlloc.unconstrainedKellyFraction,
      'Tail lattice probability mass across 10x and 100x must expand unconstrained Kelly fraction'
    );
  });

  await t.test('2. Convex hazard bonus safely increases sizing when expansion hazard dominates failure', () => {
    const neutralHazard = allocator.calculateConvexMultiTargetKelly({
      ...baseInput,
      multiplierDistribution: powerLawTail,
      convexHazardRatio: 1.0,
    });

    const strongConvexHazard = allocator.calculateConvexMultiTargetKelly({
      ...baseInput,
      multiplierDistribution: powerLawTail,
      convexHazardRatio: 3.5, // Strong upside hazard (ratio > 2.0)
    });

    assert.ok(
      strongConvexHazard.recommendedAllocationSol >= neutralHazard.recommendedAllocationSol,
      'High convex hazard ratio must increase or maintain allocation toward growth optimum'
    );
  });

  await t.test('3. Hard Invariant: 5% pool liquidity cap strictly enforced under extreme convexity', () => {
    const thinPoolInput = {
      ...baseInput,
      poolReserveSol: 10.0, // 5% cap = 0.5 SOL
      mandateLimitSol: 5.0,
      totalPortfolioCapitalSol: 100.0,
      multiplierDistribution: {
        p2x: 0.90,
        p5x: 0.80,
        p10x: 0.60,
        p20x: 0.40,
        p50x: 0.20,
        p100x: 0.10, // Massive 100x probability
      },
      convexHazardRatio: 5.0,
    };

    const cappedAlloc = allocator.calculateConvexMultiTargetKelly(thinPoolInput);
    assert.ok(cappedAlloc.recommendedAllocationSol <= 0.5, 'Must not exceed 5% of 10 SOL pool (0.5 SOL max)');
    assert.equal(cappedAlloc.bindingConstraint, 'LIQUIDITY_CAP');
    assert.ok(cappedAlloc.rationale.includes('LIQUIDITY_CAP'));
  });

  await t.test('4. Hard Invariant: Mandate ceiling strictly enforced against mega portfolios', () => {
    const megaPortfolioInput = {
      ...baseInput,
      poolReserveSol: 200.0, // 5% cap = 10.0 SOL
      mandateLimitSol: 1.5,  // Risk mandate cap = 1.5 SOL
      totalPortfolioCapitalSol: 1000.0,
      multiplierDistribution: powerLawTail,
    };

    const mandateCapped = allocator.calculateConvexMultiTargetKelly(megaPortfolioInput);
    assert.ok(mandateCapped.recommendedAllocationSol <= 1.5, 'Must not exceed mandate limit of 1.5 SOL');
    assert.equal(mandateCapped.bindingConstraint, 'MANDATE_CEILING');
  });

  await t.test('5. Hard Invariant: DEGRADED regime freezes all capital allocations', () => {
    const frozen = allocator.calculateConvexMultiTargetKelly({
      ...baseInput,
      regime: 'DEGRADED',
      multiplierDistribution: powerLawTail,
      convexHazardRatio: 4.0,
    });

    assert.equal(frozen.recommendedAllocationSol, 0);
    assert.equal(frozen.bindingConstraint, 'RISK_FREEZE');
    assert.ok(frozen.rationale.includes('DEGRADED'));
  });

  await t.test('6. Fallback parity: Missing multiplierDistribution delegates cleanly to calculateAllocation', () => {
    const fallback = allocator.calculateConvexMultiTargetKelly(baseInput);
    const standard = allocator.calculateAllocation(baseInput);

    assert.equal(fallback.recommendedAllocationSol, standard.recommendedAllocationSol);
    assert.equal(fallback.unconstrainedKellyFraction, standard.unconstrainedKellyFraction);
    assert.equal(fallback.bindingConstraint, standard.bindingConstraint);
  });
});

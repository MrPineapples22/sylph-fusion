import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AlphaHalfLifeEngine,
  AlphaBurnLedger,
} from '../../dist/intelligence/timing/alpha-half-life.js';

test('AlphaHalfLifeEngine: lifecycle stages have strictly differentiated baseline half-lives', () => {
  const early = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_EARLY',
    initialEdgeBps: 500,
    competitorDensity: 0.0,
    opportunityJerk: 0.0,
  });

  const late = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_LATE',
    initialEdgeBps: 500,
    competitorDensity: 0.0,
    opportunityJerk: 0.0,
  });

  const amm = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'POST_MIGRATION_AMM',
    initialEdgeBps: 500,
    competitorDensity: 0.0,
    opportunityJerk: 0.0,
  });

  assert.ok(early.halfLifeMs < late.halfLifeMs, `Early half-life (${early.halfLifeMs}ms) should be shorter than late (${late.halfLifeMs}ms)`);
  assert.ok(late.halfLifeMs < amm.halfLifeMs, `Late half-life (${late.halfLifeMs}ms) should be shorter than AMM (${amm.halfLifeMs}ms)`);
});

test('AlphaHalfLifeEngine: high competitor density and negative jerk trigger catastrophic decay curvature', () => {
  const tranquil = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'POST_MIGRATION_AMM',
    initialEdgeBps: 400,
    competitorDensity: 0.1,
    opportunityJerk: 0.2,
  });
  assert.equal(tranquil.curvature, 'LINEAR');

  const adversarial = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_EARLY',
    initialEdgeBps: 400,
    competitorDensity: 0.9,
    opportunityJerk: -0.6,
  });
  assert.equal(adversarial.curvature, 'CATASTROPHIC');
  assert.ok(adversarial.halfLifeMs <= 300, `Expected compressed half-life, got ${adversarial.halfLifeMs}`);
});

test('AlphaHalfLifeEngine: calculates accurate Economic Event Horizon', () => {
  const estimate = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_MID',
    initialEdgeBps: 600,
    hurdleBps: 100,
    competitorDensity: 0.2,
    opportunityJerk: 0.0,
    frictionBps: 50,
  });

  assert.ok(estimate.economicEventHorizonMs > 0);
  assert.ok(estimate.burnRateBpsPerMs > 0);

  // At t = 0, edge is 600
  const edgeT0 = AlphaHalfLifeEngine.calculateRemainingEdge(600, 0, estimate);
  assert.equal(edgeT0, 600);

  // At horizon, remaining edge drops to 0 or below hurdle
  const edgeAtHorizon = AlphaHalfLifeEngine.calculateRemainingEdge(600, estimate.economicEventHorizonMs + 10, estimate);
  assert.equal(edgeAtHorizon, 0);
});

test('AlphaBurnLedger: attributes edge destruction across 6 pipeline subsystems', () => {
  const estimate = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_MID',
    initialEdgeBps: 500,
    hurdleBps: 100,
  });

  const breakdown = {
    discoveryMs: 40,
    modelEvaluationMs: 60,
    quoteMs: 80,
    simulationMs: 90,
    signingMs: 30,
    networkTransmissionMs: 70,
  };

  const audit = AlphaBurnLedger.auditBurn(500, estimate, breakdown);

  assert.equal(audit.initialEdgeBps, 500);
  assert.equal(audit.totalElapsedMs, 370);
  assert.equal(audit.phases.length, 6);
  assert.ok(audit.totalBurnedBps > 0);
  assert.ok(audit.remainingEdgeBps < 500);

  // Sum of fractional burns should equal 1.0 (or 0 if zero burn)
  const sumFractions = audit.phases.reduce((sum, p) => sum + p.fractionOfTotalBurn, 0);
  assert.ok(Math.abs(sumFractions - 1.0) < 0.02, `Expected fractions sum ~1.0, got ${sumFractions}`);
});

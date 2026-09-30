import test from 'node:test';
import assert from 'node:assert/strict';
import { ExitDecisionService } from '../dist/intelligence/spie/exit-decision-service.js';

const now = 1_000_000;
const snapshot = { tradeId: 'trade-1', mint: 'mint-1', positionGeneration: 3, evidenceAsOfMs: now - 50, remainingQuantity: 10, entryPriceUsd: 10, markPriceUsd: 15, peakPriceUsd: 20, troughPriceUsd: 9, confidence: .8, uncertaintyBps: 25, marketRegime: 'TRENDING', lifecycleRegime: 'PRE_MIGRATION' };
const quote = { fractionBps: 10000, expectedNetProceedsUsd: 145, expectedSlippageBps: 40, priceImpactBps: 30, priorityFeeBps: 10, jitoTipBps: 10, landingProbability: .95, confirmationProbability: .98, receivedAtMs: now - 20, validUntilMs: now + 100, routeId: 'route-a' };
const input = { snapshot, quotes: [quote], nowMs: now, probabilityUpside: .6, upsideBps: 2000, probabilityReversal: .2, reversalBps: 1000, probabilityRug: .01, rugLossBps: 8000, holdCostBps: 10, policyVersion: 'test', modelVersions: ['none'] };
test('certificate fences state and chooses hold when hold EV dominates', () => {
  const d = new ExitDecisionService().decide(input);
  assert.equal(d.chosenAction, 'HOLD'); assert.equal(d.positionGeneration, 3); assert.equal(d.requestedQuantity, 0); assert.equal(d.validUntilMs, now + 100);
});
test('P0 requires a fresh full quote and produces an emergency close certificate', () => {
  const d = new ExitDecisionService().decide({ ...input, snapshot: { ...snapshot, hardSurvivalReason: 'LIQUIDITY_COLLAPSE' } });
  assert.equal(d.chosenAction, 'EMERGENCY_CLOSE'); assert.equal(d.priority, 'P0_SURVIVAL'); assert.equal(d.requestedQuantity, 10);
});
test('expired quotes cannot generate an executable exit', () => {
  const d = new ExitDecisionService().decide({ ...input, quotes: [{ ...quote, validUntilMs: now - 1 }] });
  assert.equal(d.chosenAction, 'HOLD'); assert.match(d.reasons[0], /NO_FRESH/);
});
test('multiple quotes select maximum EV quote, not the lowest', () => {
  // Bearish scenario where CLOSE dominates HOLD (evHoldBps will be negative)
  const bearInput = {
    ...input,
    probabilityUpside: 0.05,
    upsideBps: 100,
    probabilityReversal: 0.6,
    reversalBps: 3000,
    probabilityRug: 0.1,
    rugLossBps: 9000,
    quotes: [
      { ...quote, routeId: 'worse-route-high-cost', expectedSlippageBps: 500, priceImpactBps: 200, priorityFeeBps: 100, jitoTipBps: 100 },
      { ...quote, routeId: 'best-route-low-cost', expectedSlippageBps: 30, priceImpactBps: 20, priorityFeeBps: 10, jitoTipBps: 10 }
    ]
  };
  const d = new ExitDecisionService().decide(bearInput);
  assert.equal(d.chosenAction, 'CLOSE');
  assert.equal(d.selectedRouteId, 'best-route-low-cost', 'Should select route with highest EV, not worst');
});


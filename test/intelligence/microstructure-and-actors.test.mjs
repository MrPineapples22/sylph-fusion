import test from 'node:test';
import assert from 'node:assert/strict';

import { ActorKnowledgeGraph } from '../../dist/intelligence/adversarial/actor-graph.js';
import { CoordinationScoreEngine } from '../../dist/intelligence/adversarial/coordination-score.js';
import { LiquidityDepthEngine } from '../../dist/intelligence/microstructure/depth-engine.js';
import { FlowToxicityEngine } from '../../dist/intelligence/microstructure/flow-toxicity.js';

test('ActorKnowledgeGraph links funding ancestors, tracks launch survival, and detects serial ruggers', () => {
  const graph = new ActorKnowledgeGraph();

  // Register 3 launches by same creator/funding ancestor
  graph.registerLaunch({
    mint: 'Mint_1',
    creatorAddress: 'creator_bad',
    fundingAncestor: 'ancestor_bad',
    launchTimestampMs: 1_000_000,
    mfePct: 15,
    maePct: 85,
    survivedMigration: false,
    rapidLiquidityLoss: true, // Rugged
  });

  graph.registerLaunch({
    mint: 'Mint_2',
    creatorAddress: 'creator_bad',
    fundingAncestor: 'ancestor_bad',
    launchTimestampMs: 1_100_000,
    mfePct: 10,
    maePct: 90,
    survivedMigration: false,
    rapidLiquidityLoss: true, // Rugged again
  });

  const recurrence = graph.evaluateRecurrenceRisk('creator_bad', 'ancestor_bad');
  assert.equal(recurrence.isSerialRugger, true);
  assert.equal(recurrence.launchesCount, 2);
  assert.equal(recurrence.rugRatePct, 100);
  assert.equal(recurrence.reputationScore, 10);

  // Unknown clean address
  const cleanRecurrence = graph.evaluateRecurrenceRisk('creator_clean');
  assert.equal(cleanRecurrence.isSerialRugger, false);
  assert.equal(cleanRecurrence.launchesCount, 0);
  assert.equal(cleanRecurrence.reputationScore, 50);
});

test('CoordinationScoreEngine distinguishes synthetic wash clusters from organic buyers', () => {
  const engine = new CoordinationScoreEngine();

  // Synthetic cluster: all within 100ms, identical 0.50 SOL size, shared funding ancestor
  const syntheticTrades = [
    { buyerAddress: 'w1', timestampMs: 1_000_050, amountSol: 0.50, parentFundingAddress: 'shared_funder' },
    { buyerAddress: 'w2', timestampMs: 1_000_080, amountSol: 0.50, parentFundingAddress: 'shared_funder' },
    { buyerAddress: 'w3', timestampMs: 1_000_100, amountSol: 0.50, parentFundingAddress: 'shared_funder' },
    { buyerAddress: 'w4', timestampMs: 1_000_120, amountSol: 0.50, parentFundingAddress: 'shared_funder' },
  ];

  const evalSynthetic = engine.evaluateCoordination(syntheticTrades);
  assert.ok(evalSynthetic.coordinationScore >= 0.75, `Expected high coordination score (got ${evalSynthetic.coordinationScore})`);
  assert.equal(evalSynthetic.isSyntheticClusterLikely, true);
  assert.ok(evalSynthetic.timingSpreadMs < 500);
  assert.equal(evalSynthetic.sizeVariance, 0);

  // Organic trades: dispersed times, varying sizes, distinct funders
  const organicTrades = [
    { buyerAddress: 'o1', timestampMs: 1_000_000, amountSol: 1.25, parentFundingAddress: 'binance' },
    { buyerAddress: 'o2', timestampMs: 1_005_000, amountSol: 0.35, parentFundingAddress: 'coinbase' },
    { buyerAddress: 'o3', timestampMs: 1_012_000, amountSol: 4.50, parentFundingAddress: 'kraken' },
  ];

  const evalOrganic = engine.evaluateCoordination(organicTrades);
  assert.ok(evalOrganic.coordinationScore < 0.40);
  assert.equal(evalOrganic.isSyntheticClusterLikely, false);
});

test('LiquidityDepthEngine computes non-linear price impact and capacity limits', () => {
  const depthEngine = new LiquidityDepthEngine();
  const poolSol = 30.0;

  const profile = depthEngine.calculateDepth(poolSol, 1_000_000_000_000n, [0.5, 1.0, 5.0, 15.0]);
  assert.equal(profile.tranches.length, 4);

  const t05 = profile.tranches.find((t) => t.sizeSol === 0.5);
  const t15 = profile.tranches.find((t) => t.sizeSol === 15.0);
  assert.ok(t05);
  assert.ok(t15);

  // Price impact increases non-linearly with size
  assert.ok(t05.priceImpactBps < t15.priceImpactBps);
  // Max safe position must be positive
  assert.ok(profile.maxSafePositionSol > 0);
});

test('FlowToxicityEngine detects toxic selling vs balanced flow', () => {
  const toxicityEngine = new FlowToxicityEngine();
  const now = 100_000;

  // Toxic selling burst in last 1000ms
  const toxicTrades = [
    { timestampMs: now - 800, isBuy: false, amountSol: 5.0 },
    { timestampMs: now - 600, isBuy: false, amountSol: 8.0 },
    { timestampMs: now - 200, isBuy: false, amountSol: 6.0 },
  ];

  const toxicMetrics = toxicityEngine.evaluateFlow(toxicTrades, now, [1_000, 5_000]);
  assert.ok(toxicMetrics[1_000].toxicityScore >= 0.8, 'Heavy sell flow with fast arrivals must flag high toxicity');
  assert.ok(toxicMetrics[1_000].netFlowSol < 0);

  // Balanced retail flow
  const balancedTrades = [
    { timestampMs: now - 800, isBuy: true, amountSol: 2.0 },
    { timestampMs: now - 600, isBuy: false, amountSol: 1.0 },
    { timestampMs: now - 200, isBuy: true, amountSol: 1.5 },
  ];

  const balancedMetrics = toxicityEngine.evaluateFlow(balancedTrades, now, [1_000, 5_000]);
  assert.equal(balancedMetrics[1_000].toxicityScore, 0.0);
  assert.ok(balancedMetrics[1_000].netFlowSol > 0);
});

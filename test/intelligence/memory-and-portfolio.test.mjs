import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EpisodicMemoryEngine } from '../../dist/intelligence/memory/episode.js';
import { PortfolioOpportunityEngine } from '../../dist/intelligence/portfolio/opportunity-board.js';

test('EpisodicMemoryEngine: retrieves point-in-time analogues and identifies recurring failure families', () => {
  const memory = new EpisodicMemoryEngine();

  // Populate historical memory
  memory.recordEpisode({
    episodeId: 'ep-1',
    mint: 'MintPastRunner111111111111111111111111111',
    launchTimestampMs: 1_000_000,
    terminalSlot: 500,
    finalOutcomeLabel: 'RUNNER',
    realizedRoiPct: 250,
    maxFavorableExcursionPct: 300,
    maxAdverseExcursionPct: 15,
    timeToPeakSeconds: 600,
    hsiAtEntry: 20,
    pumpScoreAtEntry: 80,
    clusterDispersalAtEntry: 0.85,
    strategyVersion: '1.0.0',
  });

  memory.recordEpisode({
    episodeId: 'ep-2',
    mint: 'MintPastTrap11111111111111111111111111111',
    launchTimestampMs: 1_200_000,
    terminalSlot: 600,
    finalOutcomeLabel: 'HARD_DUMP',
    realizedRoiPct: -65,
    maxFavorableExcursionPct: 10,
    maxAdverseExcursionPct: 70,
    timeToPeakSeconds: 30,
    hsiAtEntry: 75,
    pumpScoreAtEntry: 85,
    clusterDispersalAtEntry: 0.15,
    failureFamily: 'insider_distribution_trap',
    strategyVersion: '1.0.0',
  });

  // Query matching past runner setup
  const matchesRunner = memory.retrieveAnalogues({
    currentHsi: 22,
    currentPumpScore: 78,
    currentDispersal: 0.80,
    tokenAgeSeconds: 40,
    regime: 'RISK_ON',
  });

  assert.ok(matchesRunner.length >= 1);
  assert.equal(matchesRunner[0].episodeId, 'ep-1');
  assert.equal(matchesRunner[0].historicalOutcome, 'RUNNER');

  // Query matching failure family
  const failureStats = memory.findFailureAnalogueRate({
    currentHsi: 72,
    currentPumpScore: 82,
    currentDispersal: 0.20,
    tokenAgeSeconds: 40,
    regime: 'RISK_ON',
  });

  assert.ok(failureStats.totalAnalogues >= 1);
  assert.equal(failureStats.historicalFailureRatePct, 100);
  assert.equal(failureStats.predominantFailureFamily, 'insider_distribution_trap');
});

test('PortfolioOpportunityEngine: uncovers hidden concentration and enforces cash preference', () => {
  const engine = new PortfolioOpportunityEngine();

  // 1. Multiple tokens sharing single funding cluster (hidden concentration)
  const sharedCluster = 'WhaleClusterAlpha11111111111111111111';
  const candidates = [
    {
      mint: 'Token1111111111111111111111111111111111111',
      expectedReturnBps: 800,
      maxDrawdownBps: 400,
      collapseProbability: 0.15,
      liquiditySol: 5.0,
      exitFeasibilityScore: 85,
      fundingClusterId: sharedCluster,
    },
    {
      mint: 'Token2222222222222222222222222222222222222',
      expectedReturnBps: 600,
      maxDrawdownBps: 350,
      collapseProbability: 0.20,
      liquiditySol: 4.5,
      exitFeasibilityScore: 80,
      fundingClusterId: sharedCluster, // Hidden concentration!
    },
  ];

  const res = engine.evaluateBoard(candidates, 10.0, 1.0);
  assert.equal(res.effectiveIndependentExposuresCount, 1, '2 tokens from 1 cluster must count as 1 independent exposure');
  assert.equal(res.preferCashNoTrade, false);
  assert.equal(res.topSelectedMint, 'Token1111111111111111111111111111111111111');
  assert.ok(res.portfolioTailRisk.es95Bps > 0);

  // 2. Toxic market conditions -> Cash preference invariant
  const toxicCandidates = [
    {
      mint: 'Toxic111111111111111111111111111111111111',
      expectedReturnBps: 200,
      maxDrawdownBps: 2000,
      collapseProbability: 0.65, // Expected loss outweighs gain
      liquiditySol: 0.5,
      exitFeasibilityScore: 30,
      fundingClusterId: 'ClusterB',
    },
  ];

  const toxicRes = engine.evaluateBoard(toxicCandidates, 10.0, 0.5);
  assert.equal(toxicRes.preferCashNoTrade, true);
  assert.equal(toxicRes.topSelectedMint, undefined);
  assert.match(toxicRes.cashAdvantageReason, /below cash threshold/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiModelSuite } from '../../dist/intelligence/science/multi-model-suite.js';
import {
  ResearchTrialLedger,
  FalsificationEngine,
  FeatureGraveyard,
  SignalInteractionGraph,
} from '../../dist/intelligence/science/scientific-ledger.js';

test('MultiModelSuite evaluates decoupled prediction models and detects contradictions', () => {
  const suite = new MultiModelSuite();

  // Test healthy organic token
  const healthyBundle = suite.evaluate({
    mint: 'HealthyMint111111111111111111111111111111111',
    timestampMs: 1_000_000,
    organicScore: 0.85,
    buyVolumeSol: 25.0,
    buyVelocity: 3.5,
    hsiScore: 0.85,
    pumpScore: 65,
    podScore: 15,
    washTradingPct: 5,
    clusterConcentration: 0.15,
    liquiditySol: 60.0,
    mcapSol: 120.0,
    devHoldingPct: 1.5,
    txAcceleration: 1.2,
    ageSec: 45,
    networkCongestion: 1.0,
    featureNovelty: 0.1,
    memorySampleCount: 95,
    dataHealthConfidence: 0.98,
  });

  assert.equal(healthyBundle.contradictionDetected, false);
  assert.ok(healthyBundle.alpha.pPlus25 > 0.5);
  assert.ok(healthyBundle.failure.pRug < 0.2);
  assert.equal(healthyBundle.uncertainty.uncertaintyClass, 'LOW');
  assert.ok(healthyBundle.execution.pTransactionLands >= 0.8);

  // Test contradictory token: very high PumpScore but high rug and wash trading
  const contradictoryBundle = suite.evaluate({
    mint: 'ContradictoryMint222222222222222222222222222',
    timestampMs: 1_000_000,
    organicScore: 0.1, // low organic
    buyVolumeSol: 100.0,
    buyVelocity: 5.0,
    hsiScore: 0.2,
    pumpScore: 92, // extremely high pump score
    podScore: 85, // high dump risk
    washTradingPct: 75,
    clusterConcentration: 0.8,
    liquiditySol: 10.0,
    mcapSol: 50.0,
    devHoldingPct: 25.0,
    txAcceleration: 2.5,
    ageSec: 20,
    networkCongestion: 1.0,
    featureNovelty: 0.2,
    memorySampleCount: 50,
    dataHealthConfidence: 0.9,
  });

  assert.equal(contradictoryBundle.contradictionDetected, true);
  assert.ok(contradictoryBundle.failure.pRug > 0.4);
});

test('ScientificLedger: multiple-testing correction, falsification, and graveyard', () => {
  const ledger = new ResearchTrialLedger();

  // Register multiple hypotheses to verify Holm-Bonferroni correction
  const trial1 = ledger.registerTrial({
    experimentId: 'exp_001',
    hypothesis: 'HSI improves runner prediction',
    featureVersion: 'v1.0',
    modelVersion: 'v2.0',
    labelVersion: 'v1.0',
    datasetVersion: 'ds_solana_2026',
    policyVersion: 'pol_early',
    executionVersion: 'jito_v1',
    trainPeriod: [100, 200],
    validationPeriod: [201, 250],
    testPeriod: [251, 300],
    seed: 42,
    codeCommit: 'commit_abc',
    nominalPValue: 0.01,
    sharpeRatio: 2.1,
    brierScore: 0.11,
    maxDrawdownPct: 12.0,
    netEdgeBps: 240,
    verdict: 'ROBUST',
    timestamp: Date.now(),
  });

  assert.equal(trial1.correctedPValue, 0.01);

  // Second hypothesis will face adjustment multiplier >= 2
  const trial2 = ledger.registerTrial({
    experimentId: 'exp_002',
    hypothesis: 'Second indicator threshold',
    featureVersion: 'v1.0',
    modelVersion: 'v2.0',
    labelVersion: 'v1.0',
    datasetVersion: 'ds_solana_2026',
    policyVersion: 'pol_early',
    executionVersion: 'jito_v1',
    trainPeriod: [100, 200],
    validationPeriod: [201, 250],
    testPeriod: [251, 300],
    seed: 42,
    codeCommit: 'commit_abc',
    nominalPValue: 0.03,
    sharpeRatio: 1.2,
    brierScore: 0.16,
    maxDrawdownPct: 18.0,
    netEdgeBps: 110,
    verdict: 'FRAGILE',
    timestamp: Date.now(),
  });

  assert.ok(trial2.correctedPValue >= 0.06, 'P-value adjusted upwards to guard against multiple-testing p-hacking');

  // FalsificationEngine stress testing
  const falsifier = new FalsificationEngine();
  const trades = [
    { pnlBps: 1500, latencyMs: 250, slippageBps: 40, regime: 'RISK_ON' }, // outlier winner
    { pnlBps: 80, latencyMs: 300, slippageBps: 50, regime: 'RISK_ON' },
    { pnlBps: 60, latencyMs: 280, slippageBps: 45, regime: 'RISK_ON' },
    { pnlBps: 90, latencyMs: 290, slippageBps: 40, regime: 'NEUTRAL' },
  ];

  const report = falsifier.stressTest({
    experimentId: 'exp_001',
    baselineNetEdgeBps: 240,
    trades,
  });

  assert.equal(report.experimentId, 'exp_001');
  assert.ok(report.stressTests.doubleLatencyEdgeBps > 0);

  // FeatureGraveyard
  const graveyard = new FeatureGraveyard();
  assert.equal(graveyard.isFeatureRetired('raw_social_mention_count'), true);
  assert.equal(graveyard.isFeatureRetired('valid_clean_feature'), false);

  // SignalInteractionGraph
  const interactionGraph = new SignalInteractionGraph();
  const interaction = interactionGraph.analyzeInteraction(
    'HSI',
    'OrganicFlow',
    [0.1, 0.4, 0.6, 0.8, 0.9],
    [0.12, 0.42, 0.58, 0.79, 0.88],
    [0, 0, 1, 1, 1]
  );
  assert.ok(interaction.correlation > 0.85);
  assert.equal(interaction.relationship, 'REDUNDANT');
});

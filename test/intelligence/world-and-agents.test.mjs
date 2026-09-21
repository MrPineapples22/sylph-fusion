import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldModelEngine } from '../../dist/intelligence/world/world-model.js';
import { Skeptic } from '../../dist/intelligence/agents/skeptic.js';
import { EvidenceDependencyGraph, EvidenceCouncil } from '../../dist/intelligence/agents/evidence-council.js';

test('WorldModelEngine: forecasts multi-horizon distributions and detects phase shifts', () => {
  const world = new WorldModelEngine();
  const mint = 'TokenTest111111111111111111111111111111111';

  // 1. Accelerating breakout scenario
  const bullishForecast = world.forecast({
    mint,
    tokenAgeSeconds: 45,
    pumpScore: 80,
    compositeHsi: 20,
    cleanRoomDeceptionSevere: false,
    regimeMultiplier: 1.0,
  });

  assert.equal(bullishForecast.marketPhase, 'ACCELERATION');
  assert.ok(bullishForecast.horizons['1m'].expectedReturnBps > 0);
  assert.ok(bullishForecast.horizons['1m'].survivalProbability > 0.8);

  // 2. Severe deception / dump scenario
  const dumpForecast = world.forecast({
    mint,
    tokenAgeSeconds: 45,
    pumpScore: 80,
    compositeHsi: 85,
    cleanRoomDeceptionSevere: true, // Artificial wash volume!
    regimeMultiplier: 1.0,
  });

  assert.equal(dumpForecast.marketPhase, 'DUMP');
  assert.ok(dumpForecast.horizons['1m'].expectedReturnBps < 0);
  assert.ok(dumpForecast.horizons['1m'].collapseProbability > 0.7);
});

test('Skeptic: attacks trade thesis and flags fatal flaws', () => {
  const skeptic = new Skeptic();

  // Vulnerable thesis: heavy bundling and severe clean-room deception
  const attackReport = skeptic.challenge({
    thesis: 'Organic pump breakout',
    compositeHsi: 35,
    clusterDispersalRatio: 0.08, // 92% bundled!
    cleanRoomDeceptionSevere: true,
    poolLiquiditySol: 0.8, // Shallow pool!
    decisionManipulabilityCostSol: 0.05,
    assumptions: ['buyers represent independent demand'],
  });

  assert.equal(attackReport.thesisVulnerable, true);
  assert.ok(attackReport.fatalFlawsDetected.length >= 2);
  assert.equal(attackReport.recommendedAction, 'ABSTAIN');

  // Robust thesis
  const cleanReport = skeptic.challenge({
    thesis: 'Liquid continuation',
    compositeHsi: 20,
    clusterDispersalRatio: 0.85,
    cleanRoomDeceptionSevere: false,
    poolLiquiditySol: 15.0,
    decisionManipulabilityCostSol: 2.5,
    assumptions: ['independent retail demand'],
  });

  assert.equal(cleanReport.thesisVulnerable, false);
  assert.equal(cleanReport.recommendedAction, 'PROCEED');
});

test('EvidenceDependencyGraph & EvidenceCouncil: discounts dependent agents and halts on contradiction', () => {
  const depGraph = new EvidenceDependencyGraph();

  // Register 3 agents sharing the same raw data feed
  depGraph.registerAgentProfile({
    agentId: 'agent-1',
    primaryDataSources: ['pump_portal_ws'],
    featureFamiliesUsed: ['buyer_count'],
  });
  depGraph.registerAgentProfile({
    agentId: 'agent-2',
    primaryDataSources: ['pump_portal_ws'], // Shared source
    featureFamiliesUsed: ['buyer_count'],   // Shared feature
  });
  depGraph.registerAgentProfile({
    agentId: 'agent-3',
    primaryDataSources: ['pump_portal_ws'], // Shared source
    featureFamiliesUsed: ['buyer_count'],
  });

  // Effective count for 3 identical agents should be severely discounted (< 2.0)
  const discountedCount = depGraph.calculateEffectiveEvidenceCount(['agent-1', 'agent-2', 'agent-3']);
  assert.ok(discountedCount < 2.0, `Expected discounted count < 2.0 (got ${discountedCount})`);

  // Register independent chain agent
  depGraph.registerAgentProfile({
    agentId: 'chain-agent',
    primaryDataSources: ['solana_rpc_nodes'],
    featureFamiliesUsed: ['block_finality', 'sol_reserves'],
  });

  const independentCount = depGraph.calculateEffectiveEvidenceCount(['agent-1', 'chain-agent']);
  assert.ok(independentCount >= 2.0);

  // Evidence Council Evaluation
  const council = new EvidenceCouncil(depGraph);

  // Contradiction scenario: Agent claiming high confidence while OOD
  const assessmentsContradictory = [
    {
      agentId: 'agent-1',
      agentVersion: '1.0.0',
      claims: ['bullish'],
      evidence: ['volume'],
      counterEvidence: [],
      bullishProbability: 0.9,
      confidence: 0.95,
      uncertainty: 0.05,
      assumptions: [],
      violatedAssumptions: [],
      freshnessMs: 20,
      isOod: true, // Logical contradiction: high confidence in novel/OOD environment!
      latencyMs: 5,
      inputHash: 'in-1',
      outputHash: 'out-1',
    },
    {
      agentId: 'chain-agent',
      agentVersion: '1.0.0',
      claims: ['neutral'],
      evidence: ['reserves'],
      counterEvidence: [],
      bullishProbability: 0.3, // Spread > 0.5
      confidence: 0.8,
      uncertainty: 0.2,
      assumptions: [],
      violatedAssumptions: [],
      freshnessMs: 20,
      isOod: false,
      latencyMs: 5,
      inputHash: 'in-2',
      outputHash: 'out-2',
    },
  ];

  const verdict = council.evaluate(assessmentsContradictory, false);
  assert.equal(verdict.contradictionDetected, true);
  assert.equal(verdict.state, 'CONFLICTED');
  assert.equal(verdict.authorizedToProceed, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AutomaticFalsificationAgent,
  AdversarialScenarioGenerator,
} from '../../dist/platform/adversarial/automatic-falsification-agent.js';

test('AdversarialScenarioGenerator: generates 5 distinct stress attack vectors', () => {
  const attacks = AdversarialScenarioGenerator.generateAttacks({
    poolSolReserve: 50,
    latentInventoryFraction: 0.20,
    expectedNetEvBps: 300,
    alphaHalfLifeMs: 1200,
    maxSlippageBps: 150,
    washTradingProbability: 0.15,
  });

  assert.equal(attacks.length, 5);
  const types = attacks.map(a => a.attackVector);
  assert.ok(types.includes('CREATOR_STEALTH_DUMP'));
  assert.ok(types.includes('JITO_BUNDLE_SANDWICH'));
  assert.ok(types.includes('LIQUIDITY_CLIFF_DRAIN'));
  assert.ok(types.includes('SCHEDULER_LOCK_STARVATION'));
  assert.ok(types.includes('SYBIL_ORGANIC_EVAPORATION'));
});

test('AutomaticFalsificationAgent: falsifies brittle thesis with high latent inventory (#400)', () => {
  const report = AutomaticFalsificationAgent.falsifyOpportunity({
    mint: 'MINT_BRITTLE_THESIS',
    slot: 250_000,
    poolSolReserve: 30,
    latentInventoryFraction: 0.40, // 40% latent insider supply! Lethal dump
    expectedNetEvBps: 200,
    alphaHalfLifeMs: 800,
    maxSlippageBps: 250, // Higher than net EV!
    washTradingProbability: 0.50,
  });

  assert.equal(report.isThesisFalsified, true);
  assert.equal(report.isVetoRecommended, true);
  assert.ok(report.survivabilityIndex < 0.60);
  assert.ok(report.minimumPlausibleBreakCapitalSol <= 30);
  assert.match(report.rationale, /THESIS_FALSIFIED/);
});

test('AutomaticFalsificationAgent: confirms thesis resilience on low insider control and deep liquidity', () => {
  const report = AutomaticFalsificationAgent.falsifyOpportunity({
    mint: 'MINT_ROBUST_THESIS',
    slot: 250_100,
    poolSolReserve: 250, // Deep pool
    latentInventoryFraction: 0.05, // Only 5% insider holding
    expectedNetEvBps: 500, // Strong edge
    alphaHalfLifeMs: 3500, // Slow decay
    maxSlippageBps: 80, // Low allowable slippage
    washTradingProbability: 0.05, // Almost pure organic volume
  });

  assert.equal(report.isThesisFalsified, false);
  assert.equal(report.isVetoRecommended, false);
  assert.equal(report.lethalAttackVector, 'NONE');
  assert.ok(report.survivabilityIndex > 0.70);
  assert.ok(report.minimumPlausibleBreakCapitalSol > 100);
  assert.match(report.rationale, /Thesis survived/);
});

test('falsification lineage labels synthetic outputs and keeps heuristic confidence uncalibrated', () => {
  const input = {
    mint: 'MINT_LINEAGE', slot: 250_200, poolSolReserve: 30,
    latentInventoryFraction: 0.40, expectedNetEvBps: 200,
    alphaHalfLifeMs: 800, maxSlippageBps: 250, washTradingProbability: 0.50,
  };
  const unlabelled = AutomaticFalsificationAgent.falsifyOpportunity(input);
  const labelled = AutomaticFalsificationAgent.falsifyOpportunity({
    ...input,
    inputFieldClasses: {
      poolSolReserve: 'OBSERVED_CHAIN_STATE_WITH_HEURISTIC_FLOOR',
      latentInventoryFraction: 'HEURISTIC_PROXY',
      expectedNetEvBps: 'FIXED_ASSUMPTION',
      alphaHalfLifeMs: 'FIXED_ASSUMPTION',
      maxSlippageBps: 'CONFIGURED_POLICY_INPUT',
      washTradingProbability: 'HEURISTIC_PROXY',
    },
  });

  assert.equal(labelled.evidenceLineage.artifactClass, 'HEURISTIC_FALSIFICATION_REPORT');
  assert.equal(labelled.evidenceLineage.provenanceAuthority, 'CALLER_DECLARED');
  assert.equal(labelled.evidenceLineage.falsificationConfidence.calibrationStatus, 'UNVALIDATED_HEURISTIC_SCORE');
  assert.equal(labelled.evidenceLineage.falsificationConfidence.isCalibratedProbability, false);
  assert.equal(labelled.evidenceLineage.inputFieldClasses.latentInventoryFraction, 'HEURISTIC_PROXY');
  assert.equal(labelled.evidenceLineage.inputFieldClasses.expectedNetEvBps, 'FIXED_ASSUMPTION');
  assert.ok(labelled.evidenceLineage.modelledOutputFields.includes('isVetoRecommended'));
  assert.ok(labelled.stressScenariosTested.every(s => s.evidenceClass === 'MODELLED_STRESS_SCENARIO'));
  // Provenance is descriptive only; it does not change scores, veto recommendation, or scenarios.
  assert.equal(labelled.isThesisFalsified, unlabelled.isThesisFalsified);
  assert.equal(labelled.isVetoRecommended, unlabelled.isVetoRecommended);
  assert.equal(labelled.falsificationConfidence, unlabelled.falsificationConfidence);
  assert.deepEqual(labelled.stressScenariosTested, unlabelled.stressScenariosTested);
});

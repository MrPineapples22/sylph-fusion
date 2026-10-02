import test from 'node:test';
import assert from 'node:assert/strict';
import { ValueOfInformationEngine } from '../../dist/intelligence/decision/value-of-information.js';
import { AlphaHalfLifeEngine } from '../../dist/intelligence/timing/alpha-half-life.js';
import { UnifiedDecisionEngine } from '../../dist/intelligence/decision/unified-decision.js';

test('ValueOfInformationEngine: outputs ACT when net edge is strong and uncertainty is bounded', () => {
  const halfLifeEstimate = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_MID',
    initialEdgeBps: 450,
    hurdleBps: 100,
  });

  const evaluation = ValueOfInformationEngine.evaluatePolicy({
    confidence: 0.82,
    uncertainty: 0.10,
    netEvBps: 350,
    elapsedMs: 60,
    halfLifeEstimate,
  });

  assert.equal(evaluation.action, 'ACT');
  assert.equal(evaluation.waitBudgetMs, 0);
  assert.match(evaluation.rationale, /Actionable edge/);
});

test('ValueOfInformationEngine: outputs WAIT with budget when ambiguous boundary has high VOI', () => {
  const halfLifeEstimate = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'POST_MIGRATION_AMM',
    initialEdgeBps: 400,
    hurdleBps: 100,
    competitorDensity: 0.1,
  });

  const evaluation = ValueOfInformationEngine.evaluatePolicy({
    confidence: 0.54, // Near decision boundary
    uncertainty: 0.35, // High epistemic uncertainty
    netEvBps: 180,
    elapsedMs: 80,
    halfLifeEstimate,
    candidateObservationWindowMs: 150,
  });

  assert.equal(evaluation.action, 'WAIT');
  assert.equal(evaluation.waitBudgetMs, 150);
  assert.ok(evaluation.netBenefitOfWaitingBps > 15);
  assert.match(evaluation.rationale, /Ambiguous boundary.*waiting 150ms/);
});

test('ValueOfInformationEngine: outputs ABSTAIN when elapsed time crosses event horizon', () => {
  const halfLifeEstimate = AlphaHalfLifeEngine.estimateHalfLife({
    stage: 'BONDING_CURVE_EARLY',
    initialEdgeBps: 300,
    hurdleBps: 100,
    competitorDensity: 0.8,
  });

  const evaluation = ValueOfInformationEngine.evaluatePolicy({
    confidence: 0.65,
    uncertainty: 0.15,
    netEvBps: 200,
    elapsedMs: halfLifeEstimate.economicEventHorizonMs + 50,
    halfLifeEstimate,
  });

  assert.equal(evaluation.action, 'ABSTAIN');
  assert.equal(evaluation.waitBudgetMs, 0);
  assert.match(evaluation.rationale, /Economic event horizon reached/);
});

test('UnifiedDecisionEngine integrates VOI policy and dynamic half-life', () => {
  const engine = new UnifiedDecisionEngine();

  // Evaluates a candidate that trips VOI wait condition
  const decision = engine.reconcile({
    tokenId: 'MintVoiWaitingCandidate1111111111111111111',
    symbol: 'WAITC',
    slot: 28492020,
    spieEvaluation: {
      mint: 'MintVoiWaitingCandidate1111111111111111111',
      symbol: 'WAITC',
      pTarget: 0.54, // Ambiguous
      pStop: 0.46,
      grossExpectedUpsideBps: 1800,
      modeledDownsideBps: 1200,
      grossAlphaBps: 600,
      executionFrictionBps: 150,
      tailRiskPenaltyBps: 100,
      netExpectedEvBps: 220,
      opportunityScore: 78,
      opportunityStage: 'WATCH',
      actionRecommendation: 'FAST_BUY',
      factors: {
        tokenQuality: 0.8,
        momentum: 0.8,
        liquidityDepth: 0.8,
        participation: 0.8,
        walletQuality: 0.8,
        safety: 0.85,
        executionFeasibility: 0.85,
        regimeCompatibility: 0.8,
        timing: 0.7,
      },
      dominantPositiveFactor: 'momentum',
      dominantNegativeConstraint: 'timing',
      frictionToGrossRatio: 0.25,
      timestamp: Date.now(),
    },
    elapsedMs: 30,
  });

  assert.ok(decision.alphaHalfLifeMs && decision.alphaHalfLifeMs > 0);
  assert.ok(decision.alphaBurnRateBpsPerMs && decision.alphaBurnRateBpsPerMs > 0);
  assert.ok(decision.voiEvaluation);
  assert.equal(decision.stage, 'WATCH');
  assert.equal(decision.actionRecommendation, 'WAIT');
  assert.match(decision.reasonsForRejection[0], /VOI_WAIT/);
});

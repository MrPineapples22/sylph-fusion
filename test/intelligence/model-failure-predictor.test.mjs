import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelFailurePredictor } from '../../dist/intelligence/science/model-failure-predictor.js';
import { UnifiedDecisionEngine } from '../../dist/intelligence/decision/unified-decision.js';

test('ModelFailurePredictor: flags model failure veto on momentum vs safety contradiction', () => {
  const evalResult = ModelFailurePredictor.evaluateFailureProbability({
    factors: {
      momentum: 0.95,
      safety: 0.20,          // Severe contradiction: high momentum but treacherous safety
      liquidityDepth: 0.60,
      walletQuality: 0.25,   // Also Sybil deception
      executionFeasibility: 0.70,
    },
    confidence: 0.65,
    conformalUncertainty: 0.40,
    netEvBps: 250,
  });

  assert.equal(evalResult.isModelFailureVeto, true);
  assert.ok(evalResult.failureProbability > 0.45);
  assert.match(evalResult.dominantConflictDimension, /MOMENTUM_VS_SAFETY/);
  assert.match(evalResult.rationale, /MODEL_FAILURE_VETO/);
});

test('ModelFailurePredictor: confirms stability when specialist factors are harmonious', () => {
  const evalResult = ModelFailurePredictor.evaluateFailureProbability({
    factors: {
      momentum: 0.85,
      safety: 0.85,
      liquidityDepth: 0.80,
      walletQuality: 0.80,
      executionFeasibility: 0.85,
    },
    confidence: 0.80,
    conformalUncertainty: 0.10,
    netEvBps: 350,
  });

  assert.equal(evalResult.isModelFailureVeto, false);
  assert.ok(evalResult.failureProbability < 0.30);
  assert.ok(evalResult.specialistDisagreementSpread < 0.15);
  assert.ok(evalResult.decisionStabilityRadius > 0.20);
  assert.match(evalResult.rationale, /Model stability confirmed/);
});

test('ModelFailurePredictor: sensitivity increases when net EV is close to hurdle rate', () => {
  // Candidate barely clearing the 100 bps hurdle
  const marginal = ModelFailurePredictor.evaluateFailureProbability({
    factors: {
      momentum: 0.60,
      safety: 0.60,
      liquidityDepth: 0.60,
      walletQuality: 0.60,
      executionFeasibility: 0.60,
    },
    confidence: 0.58,
    conformalUncertainty: 0.30,
    netEvBps: 110, // 10 bps above 100 bps hurdle
  });

  // Candidate with wide margin above hurdle
  const robust = ModelFailurePredictor.evaluateFailureProbability({
    factors: {
      momentum: 0.60,
      safety: 0.60,
      liquidityDepth: 0.60,
      walletQuality: 0.60,
      executionFeasibility: 0.60,
    },
    confidence: 0.58,
    conformalUncertainty: 0.30,
    netEvBps: 600, // 500 bps above hurdle
  });

  assert.ok(marginal.predictionFragility > robust.predictionFragility);
});

test('UnifiedDecisionEngine: model failure veto overrides FAST_BUY to ABSTAIN', () => {
  const engine = new UnifiedDecisionEngine();
  const decision = engine.reconcile({
    tokenId: 'MINT_MODEL_FAILURE_VETO',
    symbol: 'FAILTEST',
    slot: 280_000,
    spieEvaluation: {
      actionRecommendation: 'FAST_BUY',
      pTarget: 0.62,
      grossAlphaBps: 500,
      executionFrictionBps: 120,
      netExpectedEvBps: 380,
      grossExpectedUpsideBps: 2000,
      modeledDownsideBps: 800,
      opportunityStage: 'DEVELOPING',
      dominantPositiveFactor: 'momentum',
      dominantNegativeConstraint: 'none',
      confidenceTier: 'HIGH',
      factors: {
        momentum: 0.95,
        safety: 0.20, // Causes severe contradiction in ModelFailurePredictor
        liquidityDepth: 0.70,
        walletQuality: 0.30,
        executionFeasibility: 0.75,
      },
    },
  });

  // Must veto to ABSTAIN due to model failure prediction
  assert.equal(decision.actionRecommendation, 'ABSTAIN');
  assert.ok(decision.modelFailureEvaluation);
  assert.equal(decision.modelFailureEvaluation.isModelFailureVeto, true);
  assert.ok(decision.conflicts.some(c => c.includes('Model-Failure Predictor vetoed')));
  assert.ok(decision.reasonsForRejection.some(r => r.includes('MODEL_FAILURE_VETO')));
});

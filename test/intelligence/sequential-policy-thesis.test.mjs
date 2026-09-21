import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptivePolicyRouter,
  PositionThesisEngine,
  ValueOfInformationCalculator,
} from '../../dist/intelligence/policies/adaptive-router.js';

test('PositionThesisEngine and ValueOfInformationCalculator manage sequential policy lifecycle', () => {
  const router = new AdaptivePolicyRouter();
  const thesisEngine = new PositionThesisEngine();
  const voiCalc = new ValueOfInformationCalculator();

  // 1. Healthy Position Thesis
  const validThesis = thesisEngine.evaluatePosition({
    mint: 'MintValid111111111111111111111111111111111',
    entryTimeMs: Date.now() - 60_000,
    holdingSeconds: 60,
    currentPnlPct: 18.5,
    liquidityRemainingPct: 98,
    clusterDistributionPct: 5,
    organicFlowPersistent: true,
  });

  assert.equal(validThesis.status, 'VALID');
  assert.equal(validThesis.recommendedAction, 'HOLD');

  // 2. Weakening Position Thesis (one violation: liquidity drops to 70%)
  const weakeningThesis = thesisEngine.evaluatePosition({
    mint: 'MintWeakening22222222222222222222222222222',
    entryTimeMs: Date.now() - 120_000,
    holdingSeconds: 120,
    currentPnlPct: 5.0,
    liquidityRemainingPct: 70, // triggered pull
    clusterDistributionPct: 10,
    organicFlowPersistent: true,
  });

  assert.equal(weakeningThesis.status, 'WEAKENING');
  assert.equal(weakeningThesis.recommendedAction, 'REDUCE');

  // 3. Broken Position Thesis (liquidity collapse & insider dump)
  const brokenThesis = thesisEngine.evaluatePosition({
    mint: 'MintBroken33333333333333333333333333333333',
    entryTimeMs: Date.now() - 90_000,
    holdingSeconds: 90,
    currentPnlPct: -25.0,
    liquidityRemainingPct: 40,
    clusterDistributionPct: 50,
    organicFlowPersistent: false,
  });

  assert.equal(brokenThesis.status, 'BROKEN');
  assert.equal(brokenThesis.recommendedAction, 'EMERGENCY_EXIT');

  // 4. Value of Information trade-off
  const waitResult = voiCalc.evaluate({
    uncertainty: 0.8, // high uncertainty
    edgeHalfLifeMs: 3000, // slow decay
    expectedGrossEdgeBps: 200,
  });
  assert.equal(waitResult.action, 'WAIT_FOR_EVIDENCE');

  const actResult = voiCalc.evaluate({
    uncertainty: 0.1, // low uncertainty
    edgeHalfLifeMs: 500, // very rapid decay
    expectedGrossEdgeBps: 350,
  });
  assert.equal(actResult.action, 'ACT_NOW');

  // 5. AdaptivePolicyRouter routes with active position thesis
  const decision = router.route({
    tokenAgeSeconds: 150,
    isPostMigration: false,
    compositeHsi: 35,
    pumpScore: 65,
    clusterDispersalRatio: 0.85,
    deceptionGap: 5,
    actorReputationScore: 85,
    macroRegime: 'RISK_ON',
    oodState: 'KNOWN',
    activePosition: {
      currentPnlPct: 22.0,
      holdingSeconds: 90,
    },
  });

  assert.equal(decision.policyName, 'SequentialThesisPolicy');
  assert.equal(decision.action, 'HOLD');
});

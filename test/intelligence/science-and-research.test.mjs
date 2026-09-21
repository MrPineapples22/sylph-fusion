import test from 'node:test';
import assert from 'node:assert/strict';

import { OutcomeTruthEngine } from '../../dist/intelligence/science/outcome-truth.js';
import { CounterfactualEngine } from '../../dist/intelligence/science/counterfactual.js';
import { ScientificValidationEngine } from '../../dist/intelligence/science/evidence-ladder.js';
import { NegativeKnowledgeDB } from '../../dist/intelligence/research/negative-db.js';
import { AutonomousResearchLab, ResearchComputeGovernor } from '../../dist/intelligence/research/autonomous-lab.js';

test('OutcomeTruthEngine evaluates multi-horizon checkpoints, excursions, and labels', () => {
  const engine = new OutcomeTruthEngine();
  const entryTime = 1_000_000;
  const entryPrice = 1.0;
  const initialLiq = 50_000;

  // Trajectory of a runner
  const runnerTrajectory = [
    { timestampMs: entryTime + 5_000, priceUsd: 1.2, liquidityUsd: 55_000 },
    { timestampMs: entryTime + 10_000, priceUsd: 1.5, liquidityUsd: 60_000 },
    { timestampMs: entryTime + 30_000, priceUsd: 2.2, liquidityUsd: 75_000 },
    { timestampMs: entryTime + 60_000, priceUsd: 3.5, liquidityUsd: 100_000 },
  ];

  const runnerOutcome = engine.evaluateOutcome('mint_runner', entryPrice, initialLiq, entryTime, runnerTrajectory);
  assert.equal(runnerOutcome.primaryLabel, 'RUNNER');
  assert.ok(runnerOutcome.mfePct >= 200);
  assert.equal(runnerOutcome.checkpoints['5s']?.recordedPriceUsd, 1.2);
  assert.equal(runnerOutcome.checkpoints['1m']?.recordedPriceUsd, 3.5);

  // Trajectory of a rug
  const rugTrajectory = [
    { timestampMs: entryTime + 5_000, priceUsd: 1.05, liquidityUsd: 50_000 },
    { timestampMs: entryTime + 10_000, priceUsd: 0.05, liquidityUsd: 2_000 }, // Rugged
  ];

  const rugOutcome = engine.evaluateOutcome('mint_rug', entryPrice, initialLiq, entryTime, rugTrajectory);
  assert.equal(rugOutcome.primaryLabel, 'RUG');
  assert.ok(rugOutcome.timeToFailureMs !== undefined);
});

test('CounterfactualEngine evaluates filter efficacy and alternative timing', () => {
  const truthEngine = new OutcomeTruthEngine();
  const counterfactualEngine = new CounterfactualEngine();
  const entryTime = 1_000_000;

  // Scenario 1: Model rejected a token that ended up rugged -> TRUE NEGATIVE (positive filter value)
  const rugOutcome = truthEngine.evaluateOutcome(
    'mint_rug_test',
    1.0,
    50_000,
    entryTime,
    [
      { timestampMs: entryTime + 5_000, priceUsd: 1.0, liquidityUsd: 50_000 },
      { timestampMs: entryTime + 15_000, priceUsd: 0.05, liquidityUsd: 1_000 },
    ]
  );

  const evalReject = counterfactualEngine.evaluateDecision('mint_rug_test', 'REJECT', rugOutcome);
  assert.equal(evalReject.filterAssessment.isTrueNegative, true);
  assert.ok(evalReject.filterAssessment.filterValueScore > 0, 'Rejecting a rug must yield positive filter value');

  // Scenario 2: Model entered a runner -> TRUE POSITIVE
  const runnerOutcome = truthEngine.evaluateOutcome(
    'mint_run_test',
    1.0,
    50_000,
    entryTime,
    [
      { timestampMs: entryTime + 5_000, priceUsd: 1.2, liquidityUsd: 55_000 },
      { timestampMs: entryTime + 60_000, priceUsd: 2.5, liquidityUsd: 90_000 },
    ]
  );

  const evalEnter = counterfactualEngine.evaluateDecision('mint_run_test', 'ENTER', runnerOutcome);
  assert.equal(evalEnter.filterAssessment.isTruePositive, true);
  assert.ok(evalEnter.counterfactualReturns.enterNowPct > 0);
});

test('ScientificValidationEngine validates Evidence Ladder, falsification, and walk-forward', () => {
  const engine = new ScientificValidationEngine();

  // 1. Evidence Ladder
  const tierObserved = engine.determineLadderTier({
    hasCorrelation: false,
    hasOutOfSamplePrediction: false,
    hasIncrementalInformationOverBaselines: false,
    survivesWalkForwardAcrossWindows: false,
    survivesMultipleMarketRegimes: false,
    demonstratesCounterfactualSuperiority: false,
    isInterventionallyValidated: false,
  });
  assert.equal(tierObserved, '0_OBSERVED');

  const tierRegime = engine.determineLadderTier({
    hasCorrelation: true,
    hasOutOfSamplePrediction: true,
    hasIncrementalInformationOverBaselines: true,
    survivesWalkForwardAcrossWindows: true,
    survivesMultipleMarketRegimes: true,
    demonstratesCounterfactualSuperiority: false,
    isInterventionallyValidated: false,
  });
  assert.equal(tierRegime, '5_REGIME_ROBUST');

  // 2. Falsification suite
  const falsification = engine.runFalsificationSuite(0.35, 0.01, 0.02, 0.32);
  assert.equal(falsification.allPassed, true);

  // 3. Walk-forward
  const wf = engine.evaluateWalkForward([
    { trainStartMs: 0, trainEndMs: 100, embargoEndMs: 110, testStartMs: 110, testEndMs: 150, inSampleScore: 0.4, outOfSampleScore: 0.35 },
    { trainStartMs: 50, trainEndMs: 150, embargoEndMs: 160, testStartMs: 160, testEndMs: 200, inSampleScore: 0.42, outOfSampleScore: 0.38 },
  ]);
  assert.equal(wf.isTemporallyRobust, true);
});

test('AutonomousResearchLab and NegativeKnowledgeDB protect against failed and unthrottled research', () => {
  const negativeDb = new NegativeKnowledgeDB();
  const computeGovernor = new ResearchComputeGovernor();
  const lab = new AutonomousResearchLab(negativeDb, computeGovernor);

  // 1. Record known historical failure in negative DB
  negativeDb.recordFailure({
    recordId: 'neg_001',
    hypothesis: 'Simple moving average crossover on 5-second tick candles predicts runner breakouts',
    failureReason: 'ADVERSARIALLY_MANIPULABLE',
    testedRegimes: ['RISK_ON', 'NEUTRAL'],
    sampleCount: 500,
    recordedAtMs: Date.now(),
    notes: 'Easily manipulated by single-wallet volume spoofing',
  });

  assert.equal(negativeDb.getRecordCount(), 1);

  // 2. Try proposing similar hypothesis -> must be rejected by Negative DB
  const duplicateResult = lab.evaluateHypothesis({
    hypothesisId: 'hyp_dup',
    statement: 'Crossover moving average signals predict token breakouts',
    targetFeatureFamily: 'MOMENTUM',
    expectedInformationGain: 0.15,
    keywords: ['crossover', 'breakouts'],
  });
  assert.equal(duplicateResult.acceptedForResearch, false);
  assert.ok(duplicateResult.rejectionReason?.includes('NEGATIVE_KNOWLEDGE_MATCH'));

  // 3. Throttle research when system P0-P2 load is high
  computeGovernor.setSystemLoad(0.85); // 85% system load
  const loadThrottledResult = lab.evaluateHypothesis({
    hypothesisId: 'hyp_valid',
    statement: 'Orderbook replenishment velocity indicates institutional absorption',
    targetFeatureFamily: 'MICROSTRUCTURE',
    expectedInformationGain: 0.25,
    keywords: ['replenishment', 'absorption'],
  });
  assert.equal(loadThrottledResult.acceptedForResearch, false);
  assert.ok(loadThrottledResult.rejectionReason?.includes('COMPUTE_GOVERNOR_THROTTLED'));

  // 4. Clean system conditions -> generates proposal with invariant isApprovedForLiveDeployment === false
  computeGovernor.setSystemLoad(0.3);
  const cleanResult = lab.evaluateHypothesis({
    hypothesisId: 'hyp_clean',
    statement: 'Funding cluster entropy detects coordinated Sybil deployments',
    targetFeatureFamily: 'WALLET',
    expectedInformationGain: 0.35,
    keywords: ['entropy', 'sybil'],
  });
  assert.equal(cleanResult.acceptedForResearch, true);
  assert.ok(cleanResult.proposal);
  assert.equal(cleanResult.proposal?.isApprovedForLiveDeployment, false, 'Invariant: Research proposals can never be live approved directly');
});

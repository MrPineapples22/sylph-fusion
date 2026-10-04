import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DigitalTwinEnvironment,
  LiveReplayEquivalenceHarness,
  EpistemicIdeaClassifier,
} from '../../dist/platform/pipeline/index.js';

test('DIGITAL TWIN: executes counterfactual scenario with strict INFER authority boundary', () => {
  const twin = new DigitalTwinEnvironment();

  const scenario = {
    scenarioId: 'scen_shadow_001',
    kind: 'SHADOW_PORTFOLIO',
    baseSlot: 1000n,
    inputEvidenceRoots: ['0000000000000000000000000000000000000000000000000000000000000001'],
    assumptions: { slippageBps: 20, fillLatencyMs: 150 },
    simulatedPriceTrajectoryBps: [50, 120, 200, 350],
    simulatedLandingLatencyMs: 250,
  };

  const result = twin.simulateScenario(scenario);

  assert.equal(result.scenarioId, 'scen_shadow_001');
  assert.equal(result.authority, 'INFER'); // Strictly INFER
  assert.equal(result.simulatedLanding, true);
  assert.equal(result.counterfactualMfePct, 3.5);
  assert.ok(result.disclaimer.includes('COUNTERFACTUAL_RESEARCH_ONLY'));
  assert.equal(typeof result.simulationOutputRoot, 'string');
  assert.equal(result.simulationOutputRoot.length, 64);
});

test('LIVE/REPLAY EQUIVALENCE: identical roots pass equivalence; divergence fails closed', () => {
  const harness = new LiveReplayEquivalenceHarness();
  const liveRoot = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Case 1: Equivalent replay
  const passCheck = harness.verifyEquivalence(liveRoot, () => liveRoot);
  assert.equal(passCheck.isEquivalent, true);
  assert.equal(passCheck.divergenceReason, undefined);

  // Case 2: Divergent replay
  const failCheck = harness.verifyEquivalence(liveRoot, () => 'divergent_root_hash_999999999');
  assert.equal(failCheck.isEquivalent, false);
  assert.ok(failCheck.divergenceReason?.includes('STATE_ROOT_DIVERGENCE'));
});

test('EPISTEMIC CLASSIFIER: enforces strict 4-category taxonomy with required fields', () => {
  const classifier = new EpistemicIdeaClassifier();

  // Valid Fact
  const fact = classifier.registerIdea(
    'fact_solana_block_time',
    'Solana Target Block Time is 400ms',
    'VERIFIED_EXTERNAL_FACT',
    { verifiedSource: 'https://docs.solanalabs.com/consensus/leader-schedule' },
    '2026-10-03T20:00:00.000Z'
  );
  assert.equal(fact.category, 'VERIFIED_EXTERNAL_FACT');
  assert.equal(fact.proposalHash.length, 64);

  // Missing source for Fact -> throws EPISTEMIC_VIOLATION
  assert.throws(() => {
    classifier.registerIdea(
      'fact_invalid',
      'Unverified claim',
      'VERIFIED_EXTERNAL_FACT',
      {} // Missing source!
    );
  }, /EPISTEMIC_VIOLATION/);

  // Valid Hypothesis
  const hypothesis = classifier.registerIdea(
    'hypo_leader_landing',
    'Jito Bundles Land 35% Faster When Target Leader is Within 4 Slots',
    'TESTABLE_FUSION_HYPOTHESIS',
    { empiricalPrediction: 'Latency reduction >= 35% on slot distance <= 4' }
  );
  assert.equal(hypothesis.category, 'TESTABLE_FUSION_HYPOTHESIS');

  // Valid Promotion/Falsification Gate
  const gate = classifier.registerIdea(
    'gate_multiplier_x',
    'Promotion Gate for MULTIPLIER-X from RESEARCH to SHADOW',
    'PROMOTION_FALSIFICATION_GATE',
    { killCriteria: 'Reject if out-of-sample Brier score > 0.25 or drawdown > 500 bps' }
  );
  assert.equal(gate.category, 'PROMOTION_FALSIFICATION_GATE');
});

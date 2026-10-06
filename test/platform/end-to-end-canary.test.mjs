import assert from 'node:assert/strict';
import test from 'node:test';
import { MasterEndToEndCanary } from '../../dist/platform/testing/end-to-end-canary.js';

test('END-TO-END CANARY: executes all 15 stages with strict provenance, identity, and conservation', async () => {
  const result = await MasterEndToEndCanary.runEndToEndCanary();

  assert.equal(result.totalStages, 15);
  assert.equal(result.passedStages, 15);
  assert.equal(result.isComplete, true);
  assert.equal(result.stages.length, 15);

  // Validate every single stage passed
  for (const stage of result.stages) {
    assert.equal(stage.passed, true, `Stage ${stage.stage} failed: ${JSON.stringify(stage.details)}`);
    assert.ok(stage.stageId, `Stage ${stage.stage} missing stageId`);
    assert.ok(stage.provenanceReference, `Stage ${stage.stage} missing provenanceReference`);
  }
  const authorityStage = result.stages.find((stage) => stage.stage === '11_EXECUTION_AUTHORITY');
  assert.equal(authorityStage.details.authorityMode, 'A0_OBSERVE_ONLY');
  assert.equal(authorityStage.details.exposureIncreaseDenied, true);
  assert.match(authorityStage.provenanceReference, /INV_8_REDUCE_ONLY_NO_INCREASE/);

  // Validate sequence of stages
  const stageNames = result.stages.map((s) => s.stage);
  assert.deepEqual(stageNames, [
    '1_SYNTHETIC_CANDIDATE',
    '2_CANONICAL_EVENT',
    '3_FUSION_ENVELOPE',
    '4_JOURNAL',
    '5_REDUCER',
    '6_FEATURES',
    '7_SIGNALS',
    '8_ASTRA',
    '9_DECISION',
    '10_RISK',
    '11_EXECUTION_AUTHORITY',
    '12_PAPER_EXECUTION',
    '13_RECONCILIATION',
    '14_CERTIFICATE',
    '15_OUTCOME_TELEMETRY',
  ]);
});

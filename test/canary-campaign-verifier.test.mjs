import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCanaryCampaign, loadMandatoryEdgeConfig } from '../scripts/canary-campaign-verifier.mjs';
import { hashCanonicalV10, EMPTY_SHA256_HEX } from '../scripts/canonicalization-v10.mjs';

function buildMockCampaign(options = {}) {
  const mandatoryEdges = loadMandatoryEdgeConfig();
  const campaignId = options.campaignId ?? 'camp_canary_001';
  const traceId = options.traceId ?? 'trace_canary_001';
  const repositoryCommitSha = options.repositoryCommitSha ?? '373143a10d05327149cc5d3cbd0cfb44bff9cc18';
  const configHash = '8c1d4c759bcfa8cdebc3124dd1b5aa760347efe1d47273ce49335cbd4aa32624';
  const knowledgeCutId = 'cut_slot_312000000';
  const provenanceClass = options.provenanceClass ?? 'TEST_FIXTURE';

  let currentArtifactHash = '1111111111111111111111111111111111111111111111111111111111111111';
  let currentStateRoot = 'aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000aaaa0000';

  const edges = [];
  for (let i = 0; i < mandatoryEdges.length; i++) {
    const edgeDef = mandatoryEdges[i];
    const inputHash = currentArtifactHash;
    const outputHash = hashCanonicalV10({ edgeId: edgeDef.edgeId, step: i, inputHash });
    currentArtifactHash = outputHash;

    const stateBefore = currentStateRoot;
    const stateAfter = hashCanonicalV10({ stateBefore, step: i });
    currentStateRoot = stateAfter;

    edges.push({
      edgeIndex: edgeDef.edgeIndex,
      edgeId: edgeDef.edgeId,
      campaignId,
      traceId,
      repositoryCommitSha,
      configHash,
      knowledgeCutId,
      producerComponentId: edgeDef.producerComponent,
      consumerComponentId: edgeDef.consumerComponent,
      inputArtifactHash: inputHash,
      outputArtifactHash: outputHash,
      stateRootBefore: stateBefore,
      stateRootAfter: stateAfter,
      provenanceClass,
      observedAtLogicalTime: 1000 + i * 50,
    });
  }

  return {
    campaignId,
    traceId,
    repositoryCommitSha,
    configHash,
    knowledgeCutId,
    edges,
  };
}

test('Step 5 Canary Verifier: Valid 18-edge campaign passes in TEST mode', () => {
  const campaign = buildMockCampaign({ provenanceClass: 'TEST_FIXTURE' });
  const result = verifyCanaryCampaign(campaign, { mode: 'test' });
  assert.equal(result.valid, true);
  assert.equal(result.edgesVerified, 18);
  assert.equal(result.mode, 'test');
});

test('Step 5 Canary Verifier: Ineligible TEST_FIXTURE rejected in CERTIFY mode', () => {
  const campaign = buildMockCampaign({ provenanceClass: 'TEST_FIXTURE' });
  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'certify' }),
    /PROVENANCE_REJECTED/
  );
});

test('Step 5 Canary Verifier: Ineligible SYNTHETIC rejected in CERTIFY mode', () => {
  const campaign = buildMockCampaign({ provenanceClass: 'SYNTHETIC' });
  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'certify' }),
    /PROVENANCE_REJECTED/
  );
});

test('Step 5 Canary Verifier: Valid REAL_CANARY passes in CERTIFY mode', () => {
  const campaign = buildMockCampaign({ provenanceClass: 'REAL_CANARY' });
  const result = verifyCanaryCampaign(campaign, { mode: 'certify' });
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'certify');
  assert.equal(result.provenanceClass, 'REAL_CANARY');
});

test('Step 5 Canary Verifier: Missing edge fails closed', () => {
  const campaign = buildMockCampaign();
  campaign.edges.pop(); // Remove 18th edge
  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /EDGE_COUNT_MISMATCH/
  );
});

test('Step 5 Canary Verifier: Reordered edges fail closed', () => {
  const campaign = buildMockCampaign();
  // Swap edge 2 and 3
  const tmp = campaign.edges[1];
  campaign.edges[1] = campaign.edges[2];
  campaign.edges[2] = tmp;

  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /SEQUENCE_MISMATCH/
  );
});

test('Step 5 Canary Verifier: Duplicate edge fails closed', () => {
  const campaign = buildMockCampaign();
  campaign.edges[1] = campaign.edges[0]; // Duplicate edge 0

  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /DUPLICATE_EDGE/
  );
});

test('Step 5 Canary Verifier: C6 Cryptographic hash continuity break fails closed', () => {
  const campaign = buildMockCampaign();
  // Tamper with output hash of edge 5
  campaign.edges[4].outputArtifactHash = '9999999999999999999999999999999999999999999999999999999999999999';

  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /C6_CONTINUITY_BREAK/
  );
});

test('Step 5 Canary Verifier: State root continuity break fails closed', () => {
  const campaign = buildMockCampaign();
  // Tamper with stateRootAfter of edge 3
  campaign.edges[2].stateRootAfter = 'bbbb0000bbbb0000bbbb0000bbbb0000bbbb0000bbbb0000bbbb0000bbbb0000';

  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /STATE_ROOT_CONTINUITY_BREAK/
  );
});

test('Step 5 Canary Verifier: Empty artifact hash strictly rejected', () => {
  const campaign = buildMockCampaign();
  campaign.edges[0].inputArtifactHash = EMPTY_SHA256_HEX;

  assert.throws(
    () => verifyCanaryCampaign(campaign, { mode: 'test' }),
    /EMPTY_INPUT_HASH/
  );
});

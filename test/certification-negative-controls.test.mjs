/**
 * SYLPH FUSION — NEGATIVE-CONTROL AND ADVERSARIAL AUDIT SUITE (STEP 8)
 * Specifications: Blueprint Sections 4, 15, 17, 28, 29, 30
 *
 * Proves fail-closed behavior across all attack surfaces:
 * 1. Empty Payload Attack (Empty SHA-256 rejection)
 * 2. Bit-Flip / Byte Tamper Mutation Attack
 * 3. Artifact Hash Continuity Tamper Attack (C6 break)
 * 4. Deterministic Replay Divergence Attack (C8 break)
 * 5. Fault Containment Escape Attack (C9 break)
 * 6. Canary Campaign Edge Omission Attack (C10 break)
 * 7. Canary Campaign Edge Reordering Attack (C10 break)
 * 8. Synthetic / Test Fixture Provenance Poisoning in CERTIFY Mode
 * 9. Level-Skipping Attack (C10 supplied without lower ladder steps)
 * 10. Forged / Arbitrary Claimed Root Attack
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  canonicalJsonV10,
  hashCanonicalV10,
  EMPTY_SHA256_HEX,
} from '../scripts/canonicalization-v10.mjs';
import { verifySystemIntegrationCertificate } from '../scripts/verify-system-integration-certificate.mjs';
import { verifyCanaryCampaign, loadMandatoryEdgeConfig } from '../scripts/canary-campaign-verifier.mjs';
import { evaluateRuntimeConvergence } from '../scripts/connectivity-runtime-convergence.mjs';
import { generateSystemIntegrationCertificate } from '../scripts/generate-system-integration-certificate.mjs';

const TEST_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), `sylph-negative-controls-${randomUUID()}-`));
const TEST_CONVERGENCE_REPORT = resolve(TEST_ARTIFACT_DIR, 'RUNTIME_CONVERGENCE_REPORT.json');
const evaluateTestConvergence = (evidence = {}, options = {}) =>
  evaluateRuntimeConvergence(evidence, { ...options, outputPath: TEST_CONVERGENCE_REPORT });
after(() => rmSync(TEST_ARTIFACT_DIR, { recursive: true, force: true }));

function buildMockValidCanary(provenanceClass = 'TEST_FIXTURE') {
  const mandatoryEdges = loadMandatoryEdgeConfig();
  const campaignId = 'adversarial_camp_01';
  const traceId = 'trace_adv_01';
  const repositoryCommitSha = '373143a10d05327149cc5d3cbd0cfb44bff9cc18';
  const configHash = '8c1d4c759bcfa8cdebc3124dd1b5aa760347efe1d47273ce49335cbd4aa32624';
  const knowledgeCutId = 'cut_adv_001';

  let curHash = '1'.repeat(64);
  let curRoot = 'a'.repeat(64);
  const edges = [];

  for (let i = 0; i < mandatoryEdges.length; i++) {
    const e = mandatoryEdges[i];
    const inputHash = curHash;
    const outputHash = hashCanonicalV10({ e: e.edgeId, i, inputHash });
    curHash = outputHash;

    const before = curRoot;
    const after = hashCanonicalV10({ before, i });
    curRoot = after;

    edges.push({
      edgeIndex: e.edgeIndex,
      edgeId: e.edgeId,
      campaignId,
      traceId,
      repositoryCommitSha,
      configHash,
      knowledgeCutId,
      producerComponentId: e.producerComponent,
      consumerComponentId: e.consumerComponent,
      inputArtifactHash: inputHash,
      outputArtifactHash: outputHash,
      stateRootBefore: before,
      stateRootAfter: after,
      provenanceClass,
      observedAtLogicalTime: 1000 + i,
    });
  }

  return { campaignId, traceId, repositoryCommitSha, configHash, knowledgeCutId, edges };
}

// 1. Empty Payload Attack
test('Negative Control 1: Empty payload is strictly rejected', () => {
  assert.throws(
    () => {
      hashCanonicalV10(undefined);
    },
    /CANONICAL_V10_ERROR: Cannot serialize undefined payload/
  );

  const emptyCert = {
    schemaVersion: '1.0.0',
    certificateRoot: EMPTY_SHA256_HEX,
    certifiedPayload: {},
  };
  // Empty payload gives empty object "{}" which has a specific non-empty SHA256,
  // but if payload produces empty SHA-256 it must be rejected.
  assert.throws(
    () => {
      verifySystemIntegrationCertificate(emptyCert);
    },
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE|VERIFICATION_FAILURE/
  );
});

// 2. Bit-Flip / Byte Tamper Mutation Attack
test('Negative Control 2: Single byte mutation in certificate fails verifier closed', () => {
  const { certificate } = generateSystemIntegrationCertificate({ dryRun: true });
  const tampered = JSON.parse(JSON.stringify(certificate));
  tampered.certifiedPayload.systemId = 'TAMPERED_SYLPH_SYSTEM';

  assert.throws(
    () => {
      verifySystemIntegrationCertificate(tampered);
    },
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE/
  );
});

// 3. Artifact Hash Continuity Tamper Attack
test('Negative Control 3: Corrupted intermediate artifact hash breaks C6 cryptographic continuity', () => {
  const report = evaluateTestConvergence(
    {
      runtimeTelemetry: {
        spans: [{ id: 's1' }],
        provenanceClass: 'TEST_FIXTURE',
      },
      artifactContinuity: {
        pairs: [
          {
            producer: 'CompA',
            consumer: 'CompB',
            outputHash: 'a'.repeat(64),
            inputHash: 'b'.repeat(64), // Mismatch
          },
        ],
      },
    },
    { mode: 'test', baselineLevel: 'C4' }
  );

  assert.equal(report.certifiedPayload.highestProvenLevel, 'C5');
  assert.equal(report.certifiedPayload.ladder.C6.awarded, false);
  assert.match(report.certifiedPayload.ladder.C6.reason, /Hash continuity break/);
});

// 4. Deterministic Replay Divergence Attack
test('Negative Control 4: Replay state divergence halts at C7 and denies C8', () => {
  const report = evaluateTestConvergence(
    {
      runtimeTelemetry: { spans: [{ id: 's1' }], provenanceClass: 'TEST_FIXTURE' },
      artifactContinuity: { pairs: [{ producer: 'A', consumer: 'B', outputHash: 'a'.repeat(64), inputHash: 'a'.repeat(64) }] },
      authoritativeEffect: {
        stateRootBefore: '1'.repeat(64),
        stateRootAfter: '2'.repeat(64),
        journalRecordHash: '3'.repeat(64),
      },
      deterministicReplay: {
        originalRoot: '4'.repeat(64),
        replayedRoot: '5'.repeat(64), // Divergence
      },
    },
    { mode: 'test', baselineLevel: 'C4' }
  );

  assert.equal(report.certifiedPayload.highestProvenLevel, 'C7');
  assert.equal(report.certifiedPayload.ladder.C8.awarded, false);
  assert.match(report.certifiedPayload.ladder.C8.reason, /Replay divergence detected/);
});

// 5. Fault Containment Escape Attack
test('Negative Control 5: Escaped fault containment halts at C8 and denies C9', () => {
  const report = evaluateTestConvergence(
    {
      runtimeTelemetry: { spans: [{ id: 's1' }], provenanceClass: 'TEST_FIXTURE' },
      artifactContinuity: { pairs: [{ producer: 'A', consumer: 'B', outputHash: 'a'.repeat(64), inputHash: 'a'.repeat(64) }] },
      authoritativeEffect: {
        stateRootBefore: '1'.repeat(64),
        stateRootAfter: '2'.repeat(64),
        journalRecordHash: '3'.repeat(64),
      },
      deterministicReplay: {
        originalRoot: '4'.repeat(64),
        replayedRoot: '4'.repeat(64),
      },
      faultContainment: {
        faults: [
          { faultType: 'CORRUPTED_EVENT', failClosedObserved: false, escapedContainment: true },
        ],
      },
    },
    { mode: 'test', baselineLevel: 'C4' }
  );

  assert.equal(report.certifiedPayload.highestProvenLevel, 'C8');
  assert.equal(report.certifiedPayload.ladder.C9.awarded, false);
  assert.match(report.certifiedPayload.ladder.C9.reason, /escaped containment/);
});

// 6. Canary Campaign Edge Omission Attack
test('Negative Control 6: Omitting a mandatory edge in canary campaign strictly halts verifier', () => {
  const canary = buildMockValidCanary('REAL_CANARY');
  canary.edges.pop(); // Remove edge 18

  assert.throws(
    () => {
      verifyCanaryCampaign(canary, { mode: 'certify' });
    },
    /CANARY_VERIFICATION_FAILED.*MISSING_MANDATORY_EDGE/s
  );
});

// 7. Canary Campaign Edge Reordering Attack
test('Negative Control 7: Reordering mandatory edges in canary campaign strictly halts verifier', () => {
  const canary = buildMockValidCanary('REAL_CANARY');
  // Swap edge 0 and edge 1
  const tmp = canary.edges[0];
  canary.edges[0] = canary.edges[1];
  canary.edges[1] = tmp;

  assert.throws(
    () => {
      verifyCanaryCampaign(canary, { mode: 'certify' });
    },
    /CANARY_VERIFICATION_FAILED.*SEQUENCE_MISMATCH/s
  );
});

// 8. Synthetic / Test Fixture Provenance Poisoning in CERTIFY Mode
test('Negative Control 8: Mock / fixture provenance in CERTIFY mode halts immediately', () => {
  const canary = buildMockValidCanary('TEST_FIXTURE');
  assert.throws(
    () => {
      verifyCanaryCampaign(canary, { mode: 'certify' });
    },
    /CANARY_VERIFICATION_FAILED.*PROVENANCE_REJECTED/s
  );
});

// 9. Level-Skipping Attack
test('Negative Control 9: Level skipping is strictly blocked', () => {
  const canary = buildMockValidCanary('TEST_FIXTURE');
  // Provide only canary without preceding ladder evidence
  const report = evaluateTestConvergence({ canaryCampaign: canary }, { mode: 'test', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.equal(report.certifiedPayload.ladder.C10.awarded, false);
});

// 10. Forged Claimed Root Attack
test('Negative Control 10: Forged certificate root fails closed', () => {
  const { certificate } = generateSystemIntegrationCertificate({ dryRun: true });
  const forged = {
    ...certificate,
    certificateRoot: 'f'.repeat(64), // Forged root
  };

  assert.throws(
    () => {
      verifySystemIntegrationCertificate(forged);
    },
    /CRYPTOGRAPHIC_INTEGRITY_FAILURE: Certificate root mismatch/
  );
});

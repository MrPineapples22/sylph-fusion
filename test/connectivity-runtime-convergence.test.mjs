import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuntimeConvergence } from '../scripts/connectivity-runtime-convergence.mjs';
import { loadMandatoryEdgeConfig } from '../scripts/canary-campaign-verifier.mjs';
import { hashCanonicalV10 } from '../scripts/canonicalization-v10.mjs';
import { verifyRuntimeTelemetryEvidence } from '../scripts/runtime-telemetry-evidence.mjs';

function buildValidCanary(provenanceClass = 'TEST_FIXTURE') {
  const mandatoryEdges = loadMandatoryEdgeConfig();
  const campaignId = 'camp_001';
  const traceId = 'trace_001';
  const repositoryCommitSha = '373143a10d05327149cc5d3cbd0cfb44bff9cc18';
  const configHash = '8c1d4c759bcfa8cdebc3124dd1b5aa760347efe1d47273ce49335cbd4aa32624';
  const knowledgeCutId = 'cut_312000000';

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

test('Step 6 Convergence: Static baseline below C4 halts with C4_GATE_HALT', () => {
  const report = evaluateRuntimeConvergence({}, { mode: 'test', baselineLevel: 'C1' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C1');
  assert.equal(report.certifiedPayload.ladder.C4.awarded, false);
  assert.match(report.certifiedPayload.ladder.C4.reason, /C4_GATE_HALT|UNPROVEN/);
  assert.match(report.certifiedPayload.stopReason, /C4_GATE_HALT/);
});

test('Step 6 Convergence: Absence of runtime telemetry strictly halts at C4', () => {
  const report = evaluateRuntimeConvergence({}, { mode: 'test', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.equal(report.certifiedPayload.ladder.C4.awarded, true);
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.match(report.certifiedPayload.ladder.C5.reason, /C5_HALT/);
});

test('Step 6 Convergence: Level-skipping attack is blocked (providing C10 without C5 stops at C4)', () => {
  const canary = buildValidCanary('REAL_CANARY');
  // Provide canary (C10) without telemetry (C5)
  const report = evaluateRuntimeConvergence({ canaryCampaign: canary }, { mode: 'certify', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.equal(report.certifiedPayload.ladder.C10.awarded, false);
});

test('Step 6 Convergence: Ineligible provenance in CERTIFY mode halts at C4', () => {
  const report = evaluateRuntimeConvergence(
    {
      runtimeTelemetry: {
        spans: [{ id: 'span_1', component: 'fusion' }],
        provenanceClass: 'TEST_FIXTURE', // Ineligible for certify
      },
    },
    { mode: 'certify', baselineLevel: 'C4' }
  );
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.match(report.certifiedPayload.ladder.C5.reason, /C5_DURABLE_RUNTIME_EVIDENCE_MISSING/);
});

test('Step 6 Convergence: CERTIFY mode ignores caller-asserted REAL_RUNTIME spans', () => {
  const report = evaluateRuntimeConvergence({
    runtimeTelemetry: { spans: [{ id: 'forged' }], provenanceClass: 'REAL_RUNTIME' },
  }, { mode: 'certify', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.equal(report.certifiedPayload.runtimeTelemetryRoot, null);
});

test('Step 6 Convergence: Sequential C5 award with eligible TEST telemetry', () => {
  const report = evaluateRuntimeConvergence(
    {
      runtimeTelemetry: {
        spans: [{ id: 'span_1', component: 'fusion' }],
        provenanceClass: 'TEST_FIXTURE',
      },
    },
    { mode: 'test', baselineLevel: 'C4' }
  );
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C5');
  assert.equal(report.certifiedPayload.ladder.C5.awarded, true);
  assert.equal(report.certifiedPayload.ladder.C6.awarded, false);
});

test('Step 6 Convergence: Sequential C6 break halts at C5', () => {
  const report = evaluateRuntimeConvergence(
    {
      runtimeTelemetry: {
        spans: [{ id: 'span_1' }],
        provenanceClass: 'TEST_FIXTURE',
      },
      artifactContinuity: {
        pairs: [
          { producer: 'A', consumer: 'B', outputHash: '1'.repeat(64), inputHash: '2'.repeat(64) }, // Mismatch
        ],
      },
    },
    { mode: 'test', baselineLevel: 'C4' }
  );
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C5');
  assert.match(report.certifiedPayload.ladder.C6.reason, /C6_HALT/);
});

test('C5 runtime evidence requires a complete durable schema and detects byte-level edits', () => {
  const evidence = {
    schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_V1',
    provenanceClass: 'REAL_RUNTIME',
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    runtimeInstanceId: '3'.repeat(32),
    processId: 10,
    nodeVersion: 'v24.1.0',
    processStartedAtMs: 100,
    captureStartedAtMs: 101,
    captureEndedAtMs: 110,
    durability: { barrier: 'FSYNC_COMMITTED', storeEventId: 'runtime:trace-1', storeAuditId: 9, storeEventHash: '4'.repeat(64) },
    spans: [{ spanId: '5'.repeat(16), traceId: '6'.repeat(32), parentSpanId: null, name: 'ingress.commit',
      startedAtNs: '1000', endedAtNs: '1200', status: 'OK' }],
  };
  evidence.evidenceHash = hashCanonicalV10(evidence);
  assert.equal(verifyRuntimeTelemetryEvidence(evidence).valid, true);
  const altered = { ...evidence, spans: [{ ...evidence.spans[0], status: 'ERROR' }] };
  assert.deepEqual(verifyRuntimeTelemetryEvidence(altered), { valid: false, reason: 'C5_EVIDENCE_HASH_MISMATCH' });
  assert.deepEqual(verifyRuntimeTelemetryEvidence({ ...evidence, spans: [{ id: 'span_1' }] }), { valid: false, reason: 'C5_SPAN_INVALID' });
});

test('Step 6 Convergence: Full ladder progression in TEST mode with valid mock evidence', () => {
  const fullEvidence = {
    runtimeTelemetry: {
      spans: [{ id: 'span_1' }],
      provenanceClass: 'TEST_FIXTURE',
    },
    artifactContinuity: {
      pairs: [
        { producer: 'A', consumer: 'B', outputHash: '1'.repeat(64), inputHash: '1'.repeat(64) },
      ],
    },
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
        { faultType: 'CORRUPT_HASH', failClosedObserved: true, escapedContainment: false },
      ],
    },
    canaryCampaign: buildValidCanary('TEST_FIXTURE'),
  };

  const report = evaluateRuntimeConvergence(fullEvidence, { mode: 'test', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C10');
  assert.equal(report.certifiedPayload.ladder.C10.awarded, true);
});

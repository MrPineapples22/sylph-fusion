import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, statSync, utimesSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { evaluateRuntimeConvergence } from '../scripts/connectivity-runtime-convergence.mjs';
import { loadMandatoryEdgeConfig } from '../scripts/canary-campaign-verifier.mjs';
import { runConnectivityCompiler } from '../scripts/connectivity-compiler.mjs';
import { hashCanonicalV10 } from '../scripts/canonicalization-v10.mjs';
import { verifyRuntimeTelemetryEvidence, verifyRuntimeTelemetryStoreBinding,
  verifyRuntimeTelemetryCertificationBinding, verifyGitWorkingTreeAgainstHead,
  verifyCurrentCertificationCheckoutIdentity, verifyRuntimeTelemetryAfterSourceResolution,
  appraiseRuntimeTelemetryBindings,
  resolveGitBinary, RUNTIME_EVIDENCE_MAX_AGE_MS } from '../scripts/runtime-telemetry-evidence.mjs';

const TEST_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), `sylph-convergence-test-${randomUUID()}-`));
const TEST_REPORT_PATH = resolve(TEST_ARTIFACT_DIR, 'RUNTIME_CONVERGENCE_REPORT.json');
const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PRODUCTION_REPORT_PATH = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'RUNTIME_CONVERGENCE_REPORT.json');
const productionReportExisted = existsSync(PRODUCTION_REPORT_PATH);
const productionReportHash = productionReportExisted
  ? createHash('sha256').update(readFileSync(PRODUCTION_REPORT_PATH)).digest('hex')
  : null;
const evaluateTestConvergence = (evidence = {}, options = {}) =>
  evaluateRuntimeConvergence(evidence, { ...options, outputPath: TEST_REPORT_PATH });
function recomputeStaticBaseline() {
  const before = verifyCurrentCertificationCheckoutIdentity();
  if (!before.valid) return 'C0';
  const outputDir = join(TEST_ARTIFACT_DIR, `static-${randomUUID()}`);
  const result = runConnectivityCompiler({ outputDir });
  const after = verifyCurrentCertificationCheckoutIdentity();
  return after.valid && after.commitSha === before.commitSha && after.treeSha === before.treeSha
    ? result.highestProvenLevel : 'C0';
}
after(() => rmSync(TEST_ARTIFACT_DIR, { recursive: true, force: true }));

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
  const report = evaluateTestConvergence({}, { mode: 'test', baselineLevel: 'C1' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C1');
  assert.equal(report.certifiedPayload.ladder.C4.awarded, false);
  assert.match(report.certifiedPayload.ladder.C4.reason, /C4_GATE_HALT|UNPROVEN/);
  assert.match(report.certifiedPayload.stopReason, /C4_GATE_HALT/);
});

test('Step 6 Convergence: Absence of runtime telemetry strictly halts at C4', () => {
  const report = evaluateTestConvergence({}, { mode: 'test', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C4');
  assert.equal(report.certifiedPayload.ladder.C4.awarded, true);
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.match(report.certifiedPayload.ladder.C5.reason, /C5_HALT/);
});

test('Step 6 Convergence: Level-skipping attack cannot elevate a fresh certify baseline', () => {
  const canary = buildValidCanary('REAL_CANARY');
  const currentBaseline = recomputeStaticBaseline();
  // Provide canary (C10) without telemetry (C5)
  const report = evaluateTestConvergence({ canaryCampaign: canary }, {
    mode: 'certify', baselineLevel: 'C4', staticScorecard: { systemScore: { highestProvenLevel: 'C4' } },
  });
  assert.equal(report.certifiedPayload.highestProvenLevel, currentBaseline);
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.equal(report.certifiedPayload.ladder.C10.awarded, false);
});

test('Step 6 Convergence: Ineligible provenance cannot override the fresh certify baseline', () => {
  const currentBaseline = recomputeStaticBaseline();
  const report = evaluateTestConvergence(
    {
      runtimeTelemetry: {
        spans: [{ id: 'span_1', component: 'fusion' }],
        provenanceClass: 'TEST_FIXTURE', // Ineligible for certify
      },
    },
    { mode: 'certify', baselineLevel: 'C4', staticScorecard: { systemScore: { highestProvenLevel: 'C4' } } }
  );
  assert.equal(report.certifiedPayload.highestProvenLevel, currentBaseline);
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.match(report.certifiedPayload.stopReason, /C4_GATE_HALT|C5_HALT/);
});

test('Step 6 Convergence: CERTIFY mode ignores caller runtime claims and saved baseline override', () => {
  const currentBaseline = recomputeStaticBaseline();
  const report = evaluateTestConvergence({
    runtimeTelemetry: { spans: [{ id: 'forged' }], provenanceClass: 'REAL_RUNTIME' },
  }, { mode: 'certify', baselineLevel: 'C4', staticScorecard: { systemScore: { highestProvenLevel: 'C4' } } });
  assert.equal(report.certifiedPayload.highestProvenLevel, currentBaseline);
  assert.equal(report.certifiedPayload.ladder.C5.awarded, false);
  assert.equal(report.certifiedPayload.runtimeTelemetryRoot, null);
});

test('Step 6 Convergence: Sequential C5 award with eligible TEST telemetry', () => {
  const report = evaluateTestConvergence(
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
  const report = evaluateTestConvergence(
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
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
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
  const attestedRoot = hashCanonicalV10(evidence);
  evidence.attestation = { algorithm: 'Ed25519', signatureBase64: sign(null, Buffer.from(attestedRoot, 'hex'), privateKey).toString('base64') };
  evidence.evidenceHash = hashCanonicalV10(evidence);
  const trustRoot = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(verifyRuntimeTelemetryEvidence(evidence, { trustedPublicKeyPem: trustRoot }).valid, true);
  assert.deepEqual(verifyRuntimeTelemetryEvidence(evidence), { valid: false, reason: 'C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING' });
  const altered = { ...evidence, spans: [{ ...evidence.spans[0], status: 'ERROR' }] };
  assert.deepEqual(verifyRuntimeTelemetryEvidence(altered, { trustedPublicKeyPem: trustRoot }), { valid: false, reason: 'C5_ATTESTATION_SIGNATURE_INVALID' });
  assert.deepEqual(verifyRuntimeTelemetryEvidence({ ...evidence, spans: [{ id: 'span_1' }] }, { trustedPublicKeyPem: trustRoot }), { valid: false, reason: 'C5_SPAN_INVALID' });
});

test('C5 certification binding rejects replay, future timestamps, dirty checkout, and source commit/tree splices', () => {
  const expectedCommitSha = '1'.repeat(40);
  const expectedTreeSha = '2'.repeat(40);
  const evidence = { sourceCommitSha: expectedCommitSha, sourceTreeSha: expectedTreeSha,
    captureEndedAtMs: 1_000 };
  const expected = { expectedCommitSha, expectedTreeSha, worktreeClean: true, nowMs: 1_000 };
  assert.deepEqual(verifyRuntimeTelemetryCertificationBinding(evidence, expected), {
    valid: true, sourceCommitSha: expectedCommitSha, sourceTreeSha: expectedTreeSha,
  });
  assert.equal(verifyRuntimeTelemetryCertificationBinding({ ...evidence, sourceCommitSha: '3'.repeat(40) }, expected).reason,
    'C5_SOURCE_IDENTITY_MISMATCH');
  assert.equal(verifyRuntimeTelemetryCertificationBinding({ ...evidence, sourceTreeSha: '4'.repeat(40) }, expected).reason,
    'C5_SOURCE_IDENTITY_MISMATCH');
  assert.equal(verifyRuntimeTelemetryCertificationBinding(evidence, { ...expected, worktreeClean: false }).reason,
    'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE');
  assert.equal(verifyRuntimeTelemetryCertificationBinding({ ...evidence, captureEndedAtMs: 1_001 }, expected).reason,
    'C5_EVIDENCE_TIMESTAMP_FUTURE_OR_INVALID');
  assert.equal(verifyRuntimeTelemetryCertificationBinding({ ...evidence,
    captureEndedAtMs: 1_000 - RUNTIME_EVIDENCE_MAX_AGE_MS - 1 }, expected).reason, 'C5_EVIDENCE_STALE');
});

test('C5 freshness clock is sampled after source audit completion and cannot be extended by audit duration', () => {
  const source = { valid: true, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40) };
  const evidence = { sourceCommitSha: source.commitSha, sourceTreeSha: source.treeSha, captureEndedAtMs: 1_000 };
  let appraisalTime = 1_000 + RUNTIME_EVIDENCE_MAX_AGE_MS - 1;
  const clock = () => appraisalTime;
  // Model source/audit work consuming the remaining freshness window.
  appraisalTime += 2;
  assert.equal(verifyRuntimeTelemetryAfterSourceResolution(evidence, source, clock).reason, 'C5_EVIDENCE_STALE');
  appraisalTime = 1_000;
  assert.equal(verifyRuntimeTelemetryAfterSourceResolution(evidence, source, clock).valid, true);
});

test('C5 loader orchestration samples freshness after source audit and durable-store binding', () => {
  const source = { valid: true, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), physicalAuditRoot: 'a'.repeat(64) };
  const evidence = { sourceCommitSha: source.commitSha, sourceTreeSha: source.treeSha, captureEndedAtMs: 1_000 };
  const events = [];
  let verifierTime = 1_000;
  const appraisal = appraiseRuntimeTelemetryBindings(evidence, {
    resolveSource: () => {
      events.push('audit-start');
      verifierTime += RUNTIME_EVIDENCE_MAX_AGE_MS - 1;
      events.push('audit-complete');
      return source;
    },
    clock: () => { events.push('clock'); return verifierTime; },
    verifyStore: () => {
      events.push('store-start');
      verifierTime += 2;
      events.push('store-complete');
      return { valid: true, storeAuditId: 7 };
    },
  });
  assert.equal(appraisal.reason, 'C5_EVIDENCE_STALE', 'store-read duration crossing expiry must reject');
  assert.deepEqual(events, ['audit-start', 'audit-complete', 'clock', 'store-start', 'store-complete', 'clock']);
});

test('C5 source identity detects assume-unchanged, skip-worktree, and same-size preserved-mtime edits in an isolated Git repo', t => {
  const container = mkdtempSync(join(tmpdir(), `sylph-c5-git-${randomUUID()}-`));
  const directory = join(container, 'repo');
  mkdirSync(directory);
  t.after(() => rmSync(container, { recursive: true, force: true }));
  const globalConfig = join(container, 'empty-global-config');
  writeFileSync(globalConfig, '');
  const git = args => execFileSync(resolveGitBinary(), args, { cwd: directory, stdio: 'ignore', env: {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig,
  } });
  git(['-c', 'init.defaultBranch=main', 'init', '-q']);
  git(['config', 'user.name', 'C5 Test']);
  git(['config', 'user.email', 'c5-test@example.invalid']);
  const sourcePath = join(directory, 'source.txt');
  writeFileSync(sourcePath, 'source-v1');
  if (process.platform !== 'win32') chmodSync(sourcePath, 0o755);
  git(['add', 'source.txt']);
  git(['commit', '-qm', 'fixture']);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), true);

  if (process.platform !== 'win32') {
    chmodSync(sourcePath, 0o644);
    assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'executable mode mismatch must fail closed');
    chmodSync(sourcePath, 0o755);
  }

  const originalStat = statSync(sourcePath);
  writeFileSync(sourcePath, 'source-v2'); // same byte length as committed content
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'byte comparison must detect preserved-mtime edits');

  writeFileSync(sourcePath, 'source-v1');
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  git(['update-index', '--assume-unchanged', 'source.txt']);
  writeFileSync(sourcePath, 'source-v2');
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'assume-unchanged flag must fail closed');

  git(['update-index', '--no-assume-unchanged', 'source.txt']);
  writeFileSync(sourcePath, 'source-v1');
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  git(['update-index', '--skip-worktree', 'source.txt']);
  writeFileSync(sourcePath, 'source-v2');
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'skip-worktree flag must fail closed');

  git(['update-index', '--no-skip-worktree', 'source.txt']);
  writeFileSync(sourcePath, 'source-v1');
  utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
  writeFileSync(join(directory, '.gitattributes'), 'source.txt working-tree-encoding=UTF-8\n');
  git(['add', '.gitattributes']);
  git(['commit', '-qm', 'encoding attribute fixture']);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'working-tree-encoding attribute must fail closed');

  writeFileSync(join(directory, '.gitattributes'), 'source.txt ident\n');
  git(['add', '.gitattributes']);
  git(['commit', '-qm', 'ident attribute fixture']);
  assert.equal(verifyGitWorkingTreeAgainstHead(directory), false, 'ident attribute must fail closed');
});

test('C5 signed runtime receipt must resolve to the exact unpruned SQLite audit row and matching content', t => {
  const directory = mkdtempSync(join(tmpdir(), 'sylph-c5-store-'));
  const databasePath = join(directory, 'runtime.sqlite');
  let db = new DatabaseSync(databasePath);
  t.after(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
  db.exec(`CREATE TABLE audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,event TEXT,body TEXT);
    CREATE TABLE audit_event_dedupe(event_id TEXT PRIMARY KEY,event_hash TEXT NOT NULL,audit_id INTEGER,created_at_ms INTEGER NOT NULL);`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const evidence = {
    schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_V1', provenanceClass: 'REAL_RUNTIME',
    sourceCommitSha: '1'.repeat(40), sourceTreeSha: '2'.repeat(40), runtimeInstanceId: '3'.repeat(32),
    processId: 10, nodeVersion: 'v24.1.0', processStartedAtMs: 100, captureStartedAtMs: 101, captureEndedAtMs: 110,
    durability: { barrier: 'FSYNC_COMMITTED', storeEventId: 'runtime:trace-1', storeAuditId: 9, storeEventHash: '0'.repeat(64) },
    spans: [{ spanId: '5'.repeat(16), traceId: '6'.repeat(32), parentSpanId: null, name: 'ingress.commit',
      startedAtNs: '1000', endedAtNs: '1200', status: 'OK' }],
  };
  const storeBody = {
    schemaVersion: 'SYLPH_RUNTIME_TELEMETRY_STORE_V1', runtimeInstanceId: evidence.runtimeInstanceId,
    sourceCommitSha: evidence.sourceCommitSha, sourceTreeSha: evidence.sourceTreeSha, processId: evidence.processId,
    processStartedAtMs: evidence.processStartedAtMs, captureStartedAtMs: evidence.captureStartedAtMs,
    captureEndedAtMs: evidence.captureEndedAtMs, spans: evidence.spans,
  };
  const body = JSON.stringify(storeBody);
  const event = 'runtime_telemetry_observed_v1';
  const storeEventHash = createHash('sha256').update(`${event}:${body}`).digest('hex');
  evidence.durability.storeEventHash = storeEventHash;
  db.prepare('INSERT INTO audit(id,at,event,body) VALUES(9,110,?,?)').run(event, body);
  db.prepare('INSERT INTO audit_event_dedupe(event_id,event_hash,audit_id,created_at_ms) VALUES(?,?,9,110)')
    .run(evidence.durability.storeEventId, storeEventHash);
  db.close();
  db = undefined;
  const attestedRoot = hashCanonicalV10(evidence);
  evidence.attestation = { algorithm: 'Ed25519', signatureBase64: sign(null, Buffer.from(attestedRoot, 'hex'), privateKey).toString('base64') };
  evidence.evidenceHash = hashCanonicalV10(evidence);
  const trustRoot = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(verifyRuntimeTelemetryEvidence(evidence, { trustedPublicKeyPem: trustRoot }).valid, true);
  assert.equal(verifyRuntimeTelemetryStoreBinding(evidence, { databasePath }).valid, true);
  assert.equal(verifyRuntimeTelemetryStoreBinding({ ...evidence, durability: { ...evidence.durability, storeAuditId: 8 } }, { databasePath }).reason,
    'C5_DURABLE_STORE_RECORD_MISMATCH');
  const wrongDatabasePath = join(directory, 'wrong.sqlite');
  new DatabaseSync(wrongDatabasePath).close();
  assert.equal(verifyRuntimeTelemetryStoreBinding(evidence, { databasePath: wrongDatabasePath }).reason,
    'C5_DURABLE_STORE_RECORD_MISSING');
  const alteredHashEvidence = { ...evidence, durability: { ...evidence.durability, storeEventHash: 'f'.repeat(64) } };
  assert.equal(verifyRuntimeTelemetryStoreBinding(alteredHashEvidence, { databasePath }).reason, 'C5_DURABLE_STORE_RECORD_MISMATCH');
  db = new DatabaseSync(databasePath);
  db.prepare('UPDATE audit SET body=? WHERE id=9').run('{}');
  db.close();
  db = undefined;
  assert.equal(verifyRuntimeTelemetryStoreBinding(evidence, { databasePath }).reason, 'C5_DURABLE_STORE_RECORD_MISMATCH');
  db = new DatabaseSync(databasePath);
  const changedBody = JSON.stringify({ ...storeBody, spans: [] });
  const changedHash = createHash('sha256').update(`${event}:${changedBody}`).digest('hex');
  db.prepare('UPDATE audit SET body=? WHERE id=9').run(changedBody);
  db.prepare('UPDATE audit_event_dedupe SET event_hash=? WHERE event_id=?').run(changedHash, evidence.durability.storeEventId);
  db.close();
  db = undefined;
  assert.equal(verifyRuntimeTelemetryStoreBinding({ ...evidence, durability: { ...evidence.durability, storeEventHash: changedHash } }, { databasePath }).reason,
    'C5_DURABLE_STORE_CONTENT_MISMATCH');
  db = new DatabaseSync(databasePath);
  db.prepare('DELETE FROM audit WHERE id=9').run();
  db.close();
  db = undefined;
  assert.equal(verifyRuntimeTelemetryStoreBinding(evidence, { databasePath }).reason, 'C5_DURABLE_STORE_RECORD_PRUNED');
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

  const report = evaluateTestConvergence(fullEvidence, { mode: 'test', baselineLevel: 'C4' });
  assert.equal(report.certifiedPayload.highestProvenLevel, 'C10');
  assert.equal(report.certifiedPayload.ladder.C10.awarded, true);
  assert.equal(existsSync(PRODUCTION_REPORT_PATH), productionReportExisted,
    'convergence test output must not create or remove the production certification report');
  if (productionReportExisted) {
    assert.equal(createHash('sha256').update(readFileSync(PRODUCTION_REPORT_PATH)).digest('hex'), productionReportHash,
      'convergence test output must not overwrite the production certification report');
  }
});

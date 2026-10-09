import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EVIDENCE_PATHS, checkEvidenceBundleContents, verifyCertificateEvidenceBundle, readEvidenceArtifactBytes, compareRegeneratedEvidence } from '../scripts/verify-certificate-evidence-bundle.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCanonicalV10 as hash } from '../scripts/canonicalization-v10.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const source = { valid: true, commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), sourceInventoryRoot: 'c'.repeat(64) };
  const manifest = { schemaVersion: '1.0.0', certifiedPayload: { repositoryCommitSha: source.commitSha,
    nodeVersion: 'v24.0.0', npmVersion: '11.0.0', mandatoryEdgesCount: 18,
    mandatoryEdgeSetHash: 'd'.repeat(64), lockfileHash: 'e'.repeat(64), tsConfigHash: 'f'.repeat(64) } };
  manifest.manifestRoot = hash(manifest.certifiedPayload);
  const roles = ['canonicalStateWriter', 'economicStateWriter', 'decisionIssuer', 'terminalityIssuer'];
  const assignments = Object.fromEntries(roles.map(role => [role, `src/${role}.ts`]));
  const authority = { ceiling: 'C4', authorityCollisions: [], detectedAuthorities: Object.fromEntries(roles.map(role => [role, [assignments[role]]])) };
  const graph = { ceiling: 'C4', sourceInventoryRoot: source.sourceInventoryRoot };
  const score = { metadata: { enforcedCeiling: 'C4', sourceInventoryRoot: source.sourceInventoryRoot },
    systemScore: { highestProvenLevel: 'C4', C0_exists: true, C1_compiles: true, C2_unit_tested: true, C3_declared_connection: true, C4_static_integration: true } };
  const ladder = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`C${i}`, { awarded: i <= 4 }]));
  const cp = { highestProvenLevel: 'C4', mode: 'certify', isFullyCertified: false, ladder, stopReason: 'C5 unavailable', staticBaselineRoot: hash(score), runtimeTelemetryRoot: null, physicalAuditRoot: null };
  const convergence = { schemaVersion: '1.0.0', certifiedPayload: cp, convergenceRoot: hash(cp) };
  const body = { commitSha: source.commitSha, treeSha: source.treeSha, auditorVersion: '4.0.0-c1-c4',
    gateStatuses: { C1: 'PASS', C2: 'PASS', C3: 'PASS', C4: 'PASS', LIVE_CAPITAL_AUTHORITY: 'BLOCKED', UNIFIED_PIPELINE_CERTIFIED: 'FALSE' },
    blockers: [], runtimeTestResults: [{ passed: true }], metrics: { violations: 0 } };
  const physical = { ...body, manifestHash: sha(Buffer.from(JSON.stringify(body))) };
  const payload = { systemId: 'SYLPH_FUSION', highestProvenLevel: 'C4', isFullyCertified: false, certificationStatus: 'PROVISIONALLY_INTEGRATED', evaluationMode: 'certify', boundaryReason: cp.stopReason,
    ladder, manifestSummary: manifest.certifiedPayload, authorityStatus: { collisionCount: 0, exclusiveAuthorities: assignments },
    roots: { certificationManifestRoot: manifest.manifestRoot, staticManifestRoot: source.sourceInventoryRoot, physicalAuthorityAuditRoot: physical.manifestHash, authorityGraphRoot: hash(authority), staticGraphRoot: hash(graph), convergenceRoot: convergence.convergenceRoot } };
  const artifacts = [manifest, authority, graph, score, convergence, physical, physical, physical, physical];
  const bytes = Object.fromEntries(EVIDENCE_PATHS.map((path, i) => [path, Buffer.from(JSON.stringify(artifacts[i]))]));
  const bundle = { schemaVersion: 'SYLPH_CERTIFICATE_EVIDENCE_BUNDLE_V2', sourceIdentity: { commitSha: source.commitSha, treeSha: source.treeSha },
    certificate: { schemaVersion: '1.0.0', certifiedPayload: payload, certificateRoot: hash(payload) },
    artifacts: EVIDENCE_PATHS.map((path, i) => ({ path, byteLength: bytes[path].length, sha256: sha(bytes[path]), canonicalRoot: hash(artifacts[i]) })) };
  return { bundle, bytes, source };
}
const check = f => checkEvidenceBundleContents(f.bundle, f.bytes, f.source);
function mutateArtifact(f, index, mutate) {
  const path = EVIDENCE_PATHS[index]; const artifact = JSON.parse(f.bytes[path]); mutate(artifact);
  f.bytes[path] = Buffer.from(JSON.stringify(artifact));
  f.bundle.artifacts[index] = { path, byteLength: f.bytes[path].length, sha256: sha(f.bytes[path]), canonicalRoot: hash(artifact) };
}
test('consistent synthetic bundle proves local binding only, never authenticity or certification', () => {
  const report = check(fixture());
  assert.equal(report.valid, true); assert.equal(report.certificateIssuerAuthenticated, false);
  assert.equal(report.certificationGranted, false); assert.equal(report.runtimeAuthority, false);
  assert.equal(report.currentSourceIndependentlyResolved, false);
  assert.equal(report.sourceSemanticsReconstructed, false);
});
test('every artifact byte change and canonical root change fails', () => {
  for (let i = 0; i < EVIDENCE_PATHS.length; i++) {
    const f = fixture(); f.bytes[EVIDENCE_PATHS[i]] = Buffer.concat([f.bytes[EVIDENCE_PATHS[i]], Buffer.from(' ')]);
    assert.throws(() => check(f), /RAW_BYTES/);
    const g = fixture(); g.bundle.artifacts[i].canonicalRoot = 'd'.repeat(64);
    assert.throws(() => check(g), /CANONICAL_ROOT/);
  }
});
test('missing extra duplicate and unsafe paths fail', () => {
  for (const mutation of [f => f.bundle.artifacts.pop(), f => f.bundle.artifacts.push(f.bundle.artifacts[0]),
    f => { f.bundle.artifacts[1] = f.bundle.artifacts[0]; }, f => { f.bundle.artifacts[0].path = '../outside'; },
    f => { f.bytes.extra = Buffer.from('{}'); }, f => { delete f.bytes[EVIDENCE_PATHS[0]]; }]) {
    const f = fixture(); mutation(f); assert.throws(() => check(f), /EVIDENCE_BUNDLE_REJECTED/);
  }
});
test('self-rehashed arbitrary child roots, C5 claims, and stale source fail', () => {
  for (const mutation of [p => { p.roots.authorityGraphRoot = 'd'.repeat(64); }, p => { p.highestProvenLevel = 'C5'; },
    p => { p.manifestSummary.repositoryCommitSha = 'd'.repeat(40); }]) {
    const f = fixture(); mutation(f.bundle.certificate.certifiedPayload);
    f.bundle.certificate.certificateRoot = hash(f.bundle.certificate.certifiedPayload);
    assert.throws(() => check(f), /EVIDENCE_BUNDLE_REJECTED/);
  }
});
test('coherently rehashed child artifacts cannot contradict source or parent semantics', () => {
  for (const [index, mutation] of [[0, a => { a.certifiedPayload.repositoryCommitSha = 'd'.repeat(40); }],
    [1, a => { a.authorityCollisions.push('collision'); }], [2, a => { a.sourceInventoryRoot = 'd'.repeat(64); }],
    [3, a => { a.metadata.enforcedCeiling = 'C10'; }], [4, a => { a.certifiedPayload.staticBaselineRoot = null; a.convergenceRoot = hash(a.certifiedPayload); }],
    [5, a => { a.treeSha = 'd'.repeat(40); const { manifestHash, ...body } = a; a.manifestHash = sha(Buffer.from(JSON.stringify(body))); }]]) {
    const f = fixture(); mutateArtifact(f, index, mutation); assert.throws(() => check(f), /EVIDENCE_BUNDLE_REJECTED/);
  }
});
test('strict entry never accepts fixture source identities or bypass options', () => {
  assert.throws(() => verifyCertificateEvidenceBundle(fixture().bundle), /EVIDENCE_BUNDLE_REJECTED/);
  let touched = false;
  const proxy = new Proxy({}, { get() { touched = true; throw new Error('getter executed'); } });
  assert.throws(() => verifyCertificateEvidenceBundle(proxy), /BUNDLE_PATH_REQUIRED/);
  assert.equal(touched, false);
});
test('strict path input bounds parsing and denies the synthetic fixture without changing artifacts', t => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'bundle.json');
  writeFileSync(path, Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => verifyCertificateEvidenceBundle(path), /BUNDLE_FILE_INVALID/);
  writeFileSync(path, Buffer.from([0xff]));
  assert.throws(() => verifyCertificateEvidenceBundle(path));
  writeFileSync(path, JSON.stringify(fixture().bundle));
  assert.throws(() => verifyCertificateEvidenceBundle(path), /EVIDENCE_BUNDLE_REJECTED/);
});
test('source validity is exact, descriptor digests and lengths are bounded, bundle schema is closed', () => {
  for (const mutation of [f => { f.source.valid = 'true'; }, f => { f.source.sourceInventoryRoot = 'bad'; },
    f => { f.bundle.artifacts[0].byteLength = Infinity; }, f => { f.bundle.artifacts[0].byteLength = 33 * 1024 * 1024; },
    f => { f.bundle.artifacts[0].sha256 = 'ABC'; }, f => { f.bundle.fixtureBypass = true; },
    f => { f.bundle.schemaVersion = '1.0.0'; }]) {
    const f = fixture(); mutation(f); assert.throws(() => check(f), /EVIDENCE_BUNDLE_REJECTED/);
  }
});
test('filesystem rejects hardlinks, junctions and non-allowlisted paths', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bundle-paths-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'artifacts', 'connectivity'), { recursive: true });
  const target = join(root, EVIDENCE_PATHS[0]); writeFileSync(target, '{}');
  assert.equal(readEvidenceArtifactBytes(root, EVIDENCE_PATHS[0]).toString(), '{}');
  linkSync(target, join(root, 'alias.json'));
  assert.throws(() => readEvidenceArtifactBytes(root, EVIDENCE_PATHS[0]), /HARDLINK_PATH/);
  assert.throws(() => readEvidenceArtifactBytes(root, '../outside'), /UNEXPECTED_PATH/);
  mkdirSync(join(root, 'alternate')); symlinkSync(join(root, 'artifacts'), join(root, 'alternate', 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readEvidenceArtifactBytes(join(root, 'alternate'), EVIDENCE_PATHS[0]), /REPARSE_PATH/);
});
test('malformed UTF-8, JSON and non-object artifacts fail despite matching raw digest', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), Buffer.from('null'), Buffer.from('[]')]) {
    const f = fixture(); f.bytes[EVIDENCE_PATHS[0]] = bytes;
    Object.assign(f.bundle.artifacts[0], { byteLength: bytes.length, sha256: sha(bytes) });
    assert.throws(() => check(f));
  }
});
function recomputationFixture() {
  const f = fixture();
  const artifacts = Object.fromEntries(Object.entries(f.bytes).map(([path, bytes]) => [path, JSON.parse(bytes)]));
  for (const path of EVIDENCE_PATHS.slice(5)) {
    const report = artifacts[path];
    report.timestamp = '2026-10-09T00:00:00.000Z';
    report.workingTreeState = ''; report.workingTreeFileHashes = {};
    report.auditedFiles = { 'src/writer.ts': 'a'.repeat(64) };
    report.runtimeTestResults = [{ name: 'Required physical runtime test', passed: true }];
    const { manifestHash, ...body } = report; report.manifestHash = sha(Buffer.from(JSON.stringify(body)));
  }
  artifacts[EVIDENCE_PATHS[3]].metadata.generatedAt = '2026-10-09T00:00:00.000Z';
  return artifacts;
}
test('fresh comparison permits only valid generation timestamps to differ', () => {
  const fresh = recomputationFixture(); const stored = structuredClone(fresh);
  for (const path of EVIDENCE_PATHS.slice(5)) {
    stored[path].timestamp = '2026-10-08T00:00:00.000Z';
    const { manifestHash, ...body } = stored[path]; stored[path].manifestHash = sha(Buffer.from(JSON.stringify(body)));
  }
  stored[EVIDENCE_PATHS[3]].metadata.generatedAt = '2026-10-08T00:00:00.000Z';
  compareRegeneratedEvidence(stored, fresh, Date.parse('2026-10-09T01:00:00.000Z'));
});
test('rehashed missing metrics, named tests, audited hashes, working tree data and fake times fail fresh comparison', () => {
  for (const mutate of [a => { a.metrics = {}; }, a => { a.metrics = { arbitrary: 0 }; },
    a => { a.runtimeTestResults = [{ passed: true }]; }, a => { a.auditedFiles = {}; },
    a => { a.auditedFiles['src/writer.ts'] = 'b'.repeat(64); }, a => { delete a.workingTreeState; },
    a => { a.timestamp = 'not a time'; }, a => { a.timestamp = '2099-01-01T00:00:00.000Z'; }]) {
    const fresh = recomputationFixture(); const stored = structuredClone(fresh); const report = stored[EVIDENCE_PATHS[5]];
    mutate(report); const { manifestHash, ...body } = report; report.manifestHash = sha(Buffer.from(JSON.stringify(body)));
    assert.throws(() => compareRegeneratedEvidence(stored, fresh, Date.parse('2026-10-09T01:00:00.000Z')), /EVIDENCE_BUNDLE_REJECTED/);
  }
});
test('coherently rehashed graph and scorecard claims cannot replace independently regenerated semantics', () => {
  for (const index of [1, 2, 3]) {
    const fresh = recomputationFixture(); const stored = structuredClone(fresh);
    stored[EVIDENCE_PATHS[index]].forgedC4Claim = true;
    assert.throws(() => compareRegeneratedEvidence(stored, fresh), /STATIC_RECOMPUTATION_MISMATCH/);
  }
});
test('rehashing cannot omit or forge manifest summary fields or authority roles', () => {
  for (const mutation of [p => { delete p.manifestSummary.nodeVersion; }, p => { p.manifestSummary.lockfileHash = '0'.repeat(64); },
    p => { p.authorityStatus.exclusiveAuthorities = {}; }, p => { delete p.authorityStatus.exclusiveAuthorities.terminalityIssuer; }]) {
    const f = fixture(); mutation(f.bundle.certificate.certifiedPayload);
    f.bundle.certificate.certificateRoot = hash(f.bundle.certificate.certifiedPayload);
    assert.throws(() => check(f), /MANIFEST_SUMMARY|AUTHORITY_ROLE_SET/);
  }
});
test('a genuine lower scorecard cannot support self-rehashed C4 convergence and certificate', () => {
  const f = fixture();
  mutateArtifact(f, 3, score => { score.systemScore.highestProvenLevel = 'C2'; score.systemScore.C3_declared_connection = false; score.systemScore.C4_static_integration = false; });
  mutateArtifact(f, 4, convergence => {
    convergence.certifiedPayload.staticBaselineRoot = hash(JSON.parse(f.bytes[EVIDENCE_PATHS[3]]));
    convergence.convergenceRoot = hash(convergence.certifiedPayload);
  });
  const certificate = f.bundle.certificate;
  certificate.certifiedPayload.roots.convergenceRoot = JSON.parse(f.bytes[EVIDENCE_PATHS[4]]).convergenceRoot;
  certificate.certificateRoot = hash(certificate.certifiedPayload);
  assert.throws(() => check(f), /STATIC_LEVEL_MISMATCH/);
});

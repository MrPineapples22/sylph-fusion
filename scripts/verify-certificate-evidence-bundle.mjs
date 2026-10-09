/** Staged local artifact integrity, not issuer authentication or release authority. */
import { readFileSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hashCanonicalV10 } from './canonicalization-v10.mjs';
import { verifySystemIntegrationCertificate } from './verify-system-integration-certificate.mjs';
import { verifyCertificationManifest } from './generate-certification-manifest.mjs';
import { verifyCurrentCertificationCheckoutIdentity } from './runtime-telemetry-evidence.mjs';
import { collectSourceInventory } from './test-run-receipt.mjs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { runConnectivityCompiler } from './connectivity-compiler.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EVIDENCE_PATHS = Object.freeze([
  'artifacts/connectivity/CERTIFICATION_MANIFEST.json',
  'artifacts/connectivity/authority-graph.json',
  'artifacts/connectivity/static-graph.json',
  'artifacts/connectivity/c0-c10-scorecard.json',
  'artifacts/connectivity/RUNTIME_CONVERGENCE_REPORT.json',
  ...['c1-single-authority-door', 'c2-mutation-exclusivity', 'c3-decision-provenance', 'c4-authority-ancestry']
    .map(name => `docs/audit/evidence/${name}.json`),
]);
const fail = reason => { throw new Error(`EVIDENCE_BUNDLE_REJECTED: ${reason}`); };
const equal = (a, b, reason) => { if (hashCanonicalV10(a) !== hashCanonicalV10(b)) fail(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
function validTime(value, now) {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value || milliseconds > now) fail('GENERATION_TIMESTAMP');
}

/** Compare complete independently regenerated content; only documented generation times differ. */
export function compareRegeneratedEvidence(stored, fresh, now = Date.now()) {
  for (const path of EVIDENCE_PATHS.slice(5)) {
    const original = stored[path]; const regenerated = fresh[path];
    if (!original || !regenerated) fail('FRESH_PHYSICAL_MISSING');
    validTime(original.timestamp, now); validTime(regenerated.timestamp, now);
    const { timestamp: oldTime, manifestHash: oldRoot, ...oldBody } = original;
    const { timestamp: newTime, manifestHash: newRoot, ...newBody } = regenerated;
    const withoutRoot = ({ manifestHash, ...body }) => body;
    if (sha(Buffer.from(JSON.stringify(withoutRoot(original)))) !== oldRoot
      || sha(Buffer.from(JSON.stringify(withoutRoot(regenerated)))) !== newRoot) fail('REGENERATED_PHYSICAL_HASH');
    equal(oldBody, newBody, 'PHYSICAL_RECOMPUTATION_MISMATCH');
  }
  for (const path of EVIDENCE_PATHS.slice(1, 4)) {
    const original = structuredClone(stored[path]); const regenerated = structuredClone(fresh[path]);
    if (!original || !regenerated) fail('FRESH_STATIC_MISSING');
    if (path.endsWith('c0-c10-scorecard.json')) {
      validTime(original.metadata?.generatedAt, now); validTime(regenerated.metadata?.generatedAt, now);
      delete original.metadata.generatedAt; delete regenerated.metadata.generatedAt;
    }
    equal(original, regenerated, 'STATIC_RECOMPUTATION_MISMATCH');
  }
}

function recomputeEvidence() {
  const temporary = mkdtempSync(join(tmpdir(), 'sylph-v2-evidence-'));
  try {
    const physicalDir = join(temporary, 'physical');
    execFileSync(process.execPath, [join(ROOT, 'scripts/audit-single-authority-door.mjs'), '--output-dir', physicalDir],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    const staticDir = join(temporary, 'static');
    const result = runConnectivityCompiler({ outputDir: staticDir });
    if (result.success !== true) fail('STATIC_RECOMPUTATION_FAILED');
    return Object.fromEntries(EVIDENCE_PATHS.slice(1).filter(path => !path.endsWith('RUNTIME_CONVERGENCE_REPORT.json')).map(path =>
      [path, JSON.parse(readFileSync(join(path.startsWith('docs/') ? physicalDir : staticDir, path.split('/').at(-1)), 'utf8'))]));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export function readEvidenceArtifactBytes(root, path) {
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) fail('UNSAFE_ROOT');
  if (!EVIDENCE_PATHS.includes(path)) fail('UNEXPECTED_PATH');
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail('REPARSE_PATH');
  }
  if (realpathSync(current) !== current || !lstatSync(current).isFile()) fail('UNSAFE_PATH');
  const before = lstatSync(current, { bigint: true });
  if (before.nlink !== 1n) fail('HARDLINK_PATH');
  if (before.size < 1n || before.size > 32n * 1024n * 1024n) fail('ARTIFACT_SIZE');
  const fd = openSync(current, 'r');
  try {
    if (!sameFile(before, fstatSync(fd, { bigint: true }))) fail('ARTIFACT_CHANGED');
    const bytes = readFileSync(fd);
    if (!sameFile(before, fstatSync(fd, { bigint: true })) || !sameFile(before, lstatSync(current, { bigint: true }))
      || realpathSync(current) !== current) fail('ARTIFACT_CHANGED');
    return bytes;
  } finally { closeSync(fd); }
}

/** Pure local consistency checker for fixtures. Caller-provided source is NOT authentication. */
export function checkEvidenceBundleContents(bundle, bytesByPath, source) {
  if (!exact(bundle, ['schemaVersion', 'sourceIdentity', 'certificate', 'artifacts'])
    || bundle.schemaVersion !== 'SYLPH_CERTIFICATE_EVIDENCE_BUNDLE_V2') fail('SCHEMA');
  if (source?.valid !== true || !/^[a-f0-9]{40}$/.test(source.commitSha ?? '') || !/^[a-f0-9]{40}$/.test(source.treeSha ?? '')
    || !HASH.test(source.sourceInventoryRoot ?? '')) fail('SOURCE');
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length !== EVIDENCE_PATHS.length) fail('DESCRIPTORS');
  equal(Object.keys(bytesByPath).sort(), [...EVIDENCE_PATHS].sort(), 'ARTIFACT_SET');
  const artifacts = {}; const seen = new Set();
  for (const descriptor of bundle.artifacts) {
    if (!descriptor || Object.keys(descriptor).sort().join(',') !== 'byteLength,canonicalRoot,path,sha256'
      || !EVIDENCE_PATHS.includes(descriptor.path) || seen.has(descriptor.path)
      || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1 || descriptor.byteLength > 32 * 1024 * 1024
      || !HASH.test(descriptor.sha256 ?? '') || !HASH.test(descriptor.canonicalRoot ?? '')) fail('DESCRIPTOR_PATH_OR_SCHEMA');
    seen.add(descriptor.path);
    const bytes = bytesByPath[descriptor.path];
    if (!Buffer.isBuffer(bytes) || bytes.length !== descriptor.byteLength || sha(bytes) !== descriptor.sha256) fail('RAW_BYTES');
    const artifact = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('ARTIFACT_SCHEMA');
    if (hashCanonicalV10(artifact) !== descriptor.canonicalRoot) fail('CANONICAL_ROOT');
    artifacts[descriptor.path] = artifact;
  }
  const [manifest, authority, graph, score, convergence, ...physical] = EVIDENCE_PATHS.map(path => artifacts[path]);
  const certificate = bundle.certificate; const payload = certificate?.certifiedPayload;
  if (certificate?.schemaVersion !== '1.0.0' || !payload || certificate.certificateRoot !== hashCanonicalV10(payload)) fail('CERTIFICATE_ROOT');
  if (payload.systemId !== 'SYLPH_FUSION' || !['C0','C1','C2','C3','C4'].includes(payload.highestProvenLevel)) fail('UNSUPPORTED_LEVEL');
  if (payload.isFullyCertified !== false || payload.certificationStatus === 'UNIFIED_PIPELINE_CERTIFIED') fail('RELEASE_CLAIM');
  equal(bundle.sourceIdentity, { commitSha: source.commitSha, treeSha: source.treeSha }, 'SOURCE_IDENTITY');
  if (payload.manifestSummary?.repositoryCommitSha !== source.commitSha || manifest.certifiedPayload?.repositoryCommitSha !== source.commitSha) fail('STALE_COMMIT');
  if (manifest.manifestRoot !== hashCanonicalV10(manifest.certifiedPayload)) fail('MANIFEST_ROOT');
  const summaryKeys = ['repositoryCommitSha', 'nodeVersion', 'npmVersion', 'mandatoryEdgesCount', 'mandatoryEdgeSetHash', 'lockfileHash', 'tsConfigHash'];
  if (!exact(payload.manifestSummary, summaryKeys) || summaryKeys.some(key => manifest.certifiedPayload[key] === undefined)) fail('MANIFEST_SUMMARY_SCHEMA');
  equal(payload.manifestSummary, Object.fromEntries(summaryKeys.map(key => [key, manifest.certifiedPayload[key]])), 'MANIFEST_SUMMARY');
  for (const report of physical) {
    const { manifestHash, ...body } = report;
    if (sha(Buffer.from(JSON.stringify(body))) !== manifestHash || report.commitSha !== source.commitSha
      || report.treeSha !== source.treeSha || report.auditorVersion !== '4.0.0-c1-c4') fail('PHYSICAL_SOURCE_OR_ROOT');
    equal(report, physical[0], 'PHYSICAL_DIVERGENCE');
    if (['C1','C2','C3','C4'].some(gate => report.gateStatuses?.[gate] !== 'PASS')
      || report.gateStatuses?.LIVE_CAPITAL_AUTHORITY !== 'BLOCKED' || report.gateStatuses?.UNIFIED_PIPELINE_CERTIFIED !== 'FALSE'
      || !Array.isArray(report.blockers) || report.blockers.length || !report.runtimeTestResults?.length
      || report.runtimeTestResults.some(result => result.passed !== true)
      || !report.metrics || Object.values(report.metrics).some(value => value !== 0)) fail('PHYSICAL_SEMANTICS');
  }
  const cp = convergence.certifiedPayload;
  if (!cp || convergence.convergenceRoot !== hashCanonicalV10(cp)) fail('CONVERGENCE_ROOT');
  equal(payload.ladder, cp.ladder, 'LADDER');
  if (cp.highestProvenLevel !== payload.highestProvenLevel || cp.mode !== payload.evaluationMode
    || cp.isFullyCertified !== false || cp.stopReason !== payload.boundaryReason
    || cp.runtimeTelemetryRoot != null || cp.physicalAuditRoot != null) fail('CONVERGENCE_SEMANTICS');
  // A test-mode report historically omitted this binding. Strict V2 requires it.
  if (cp.staticBaselineRoot !== hashCanonicalV10(score)) fail('SCORECARD_BINDING_REQUIRED');
  const levels = ['C0', 'C1', 'C2', 'C3', 'C4'];
  if (!levels.includes(score.systemScore?.highestProvenLevel) || cp.highestProvenLevel !== score.systemScore.highestProvenLevel) fail('STATIC_LEVEL_MISMATCH');
  const ceiling = levels.indexOf(score.systemScore.highestProvenLevel);
  const scoreFlags = ['C0_exists', 'C1_compiles', 'C2_unit_tested', 'C3_declared_connection', 'C4_static_integration'];
  for (let i = 0; i <= 10; i++) {
    if (cp.ladder?.[`C${i}`]?.awarded !== (i <= ceiling)) fail('STATIC_LADDER_MISMATCH');
    if (i < 5 && score.systemScore[scoreFlags[i]] !== (i <= ceiling)) fail('STATIC_SCORE_FLAGS');
  }
  if (score.metadata?.sourceInventoryRoot !== source.sourceInventoryRoot || graph.sourceInventoryRoot !== source.sourceInventoryRoot
    || graph.ceiling !== 'C4' || authority.ceiling !== 'C4' || score.metadata?.enforcedCeiling !== 'C4'
    || !Array.isArray(authority.authorityCollisions) || authority.authorityCollisions.length
    || payload.authorityStatus?.collisionCount !== 0) fail('STATIC_SEMANTICS');
  const roles = ['canonicalStateWriter', 'economicStateWriter', 'decisionIssuer', 'terminalityIssuer'];
  if (!exact(payload.authorityStatus?.exclusiveAuthorities, roles) || !exact(authority.detectedAuthorities, roles)) fail('AUTHORITY_ROLE_SET');
  for (const [role, path] of Object.entries(payload.authorityStatus.exclusiveAuthorities)) {
    equal(authority.detectedAuthorities?.[role], [path], 'AUTHORITY_ASSIGNMENT');
  }
  equal(payload.roots, {
    certificationManifestRoot: manifest.manifestRoot, staticManifestRoot: source.sourceInventoryRoot,
    physicalAuthorityAuditRoot: physical[0].manifestHash, authorityGraphRoot: hashCanonicalV10(authority),
    staticGraphRoot: hashCanonicalV10(graph), convergenceRoot: convergence.convergenceRoot,
  }, 'CERTIFICATE_CHILD_ROOTS');
  return { valid: true, verificationScope: 'LOCAL_C4_ARTIFACT_BINDING_ONLY', referencedArtifactsVerified: true,
    currentSourceIndependentlyResolved: false, sourceSemanticsReconstructed: false, executableInventoryVerified: false,
    certificateIssuerAuthenticated: false, runtimeAuthority: false, certificationGranted: false,
    bundleRoot: hashCanonicalV10(bundle) };
}

/** Trusted-checkout entry point: no injectable source identity or caller artifact paths. */
export function verifyCertificateEvidenceBundle(bundlePath) {
  // Only parse data owned by this verifier; object accessors/proxies are not an input API.
  if (typeof bundlePath !== 'string' || !bundlePath || bundlePath.includes('\0')) fail('BUNDLE_PATH_REQUIRED');
  const inputPath = resolve(bundlePath);
  const inputStat = lstatSync(inputPath, { bigint: true });
  if (!inputStat.isFile() || inputStat.isSymbolicLink() || inputStat.nlink !== 1n
    || inputStat.size < 1n || inputStat.size > 2n * 1024n * 1024n) fail('BUNDLE_FILE_INVALID');
  const fd = openSync(inputPath, 'r');
  let inputBytes;
  try {
    if (!sameFile(inputStat, fstatSync(fd, { bigint: true }))) fail('BUNDLE_CHANGED');
    inputBytes = readFileSync(fd);
    if (!sameFile(inputStat, fstatSync(fd, { bigint: true })) || !sameFile(inputStat, lstatSync(inputPath, { bigint: true }))) fail('BUNDLE_CHANGED');
  } finally { closeSync(fd); }
  const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes));
  const before = verifyCurrentCertificationCheckoutIdentity();
  if (before.valid !== true) fail('CURRENT_SOURCE_UNAVAILABLE');
  const inventory = collectSourceInventory();
  const bytes = Object.fromEntries(EVIDENCE_PATHS.map(path => [path, readEvidenceArtifactBytes(ROOT, path)]));
  const report = checkEvidenceBundleContents(bundle, bytes, { ...before, sourceInventoryRoot: inventory.sourceInventoryRoot });
  verifySystemIntegrationCertificate(bundle.certificate);
  verifyCertificationManifest(JSON.parse(bytes[EVIDENCE_PATHS[0]].toString('utf8')));
  const stored = Object.fromEntries(Object.entries(bytes).map(([path, value]) => [path, JSON.parse(value.toString('utf8'))]));
  compareRegeneratedEvidence(stored, recomputeEvidence());
  for (const path of EVIDENCE_PATHS) if (!readEvidenceArtifactBytes(ROOT, path).equals(bytes[path])) fail('ARTIFACT_CHANGED');
  const after = verifyCurrentCertificationCheckoutIdentity();
  equal(after, before, 'SOURCE_CHANGED');
  equal(collectSourceInventory(), inventory, 'INVENTORY_CHANGED');
  return { ...report, currentSourceIndependentlyResolved: true, sourceSemanticsReconstructed: true,
    verificationScope: 'LOCAL_RECOMPUTED_C4_ARTIFACT_BINDING_ONLY' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) fail('USAGE: expected bundle JSON path');
    console.log(JSON.stringify(verifyCertificateEvidenceBundle(process.argv[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

/** Staged local artifact integrity, not issuer authentication or release authority. */
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { hashCanonicalV10 } from './canonicalization-v10.mjs';
import { verifySystemIntegrationCertificate } from './verify-system-integration-certificate.mjs';
import { verifyCertificationManifest } from './generate-certification-manifest.mjs';
import { verifyCurrentCertificationCheckoutIdentity } from './runtime-telemetry-evidence.mjs';
import { collectSourceInventory } from './test-run-receipt.mjs';

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
function safeBytes(root, path) {
  if (!EVIDENCE_PATHS.includes(path)) fail('UNEXPECTED_PATH');
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail('REPARSE_PATH');
  }
  if (realpathSync(current) !== current || !lstatSync(current).isFile()) fail('UNSAFE_PATH');
  if (lstatSync(current).size > 32 * 1024 * 1024) fail('ARTIFACT_TOO_LARGE');
  return readFileSync(current);
}

/** Pure local consistency checker for fixtures. Caller-provided source is NOT authentication. */
export function checkEvidenceBundleContents(bundle, bytesByPath, source) {
  if (bundle?.schemaVersion !== 'SYLPH_CERTIFICATE_EVIDENCE_BUNDLE_V2') fail('SCHEMA');
  if (!source?.valid || !/^[a-f0-9]{40}$/.test(source.commitSha ?? '') || !/^[a-f0-9]{40}$/.test(source.treeSha ?? '')) fail('SOURCE');
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length !== EVIDENCE_PATHS.length) fail('DESCRIPTORS');
  equal(Object.keys(bytesByPath).sort(), [...EVIDENCE_PATHS].sort(), 'ARTIFACT_SET');
  const artifacts = {}; const seen = new Set();
  for (const descriptor of bundle.artifacts) {
    if (!descriptor || Object.keys(descriptor).sort().join(',') !== 'byteLength,canonicalRoot,path,sha256'
      || !EVIDENCE_PATHS.includes(descriptor.path) || seen.has(descriptor.path)) fail('DESCRIPTOR_PATH_OR_SCHEMA');
    seen.add(descriptor.path);
    const bytes = bytesByPath[descriptor.path];
    if (!Buffer.isBuffer(bytes) || bytes.length !== descriptor.byteLength || sha(bytes) !== descriptor.sha256) fail('RAW_BYTES');
    const artifact = JSON.parse(bytes.toString('utf8'));
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
  if (score.metadata?.sourceInventoryRoot !== source.sourceInventoryRoot || graph.sourceInventoryRoot !== source.sourceInventoryRoot
    || graph.ceiling !== 'C4' || authority.ceiling !== 'C4' || score.metadata?.enforcedCeiling !== 'C4'
    || !Array.isArray(authority.authorityCollisions) || authority.authorityCollisions.length
    || payload.authorityStatus?.collisionCount !== 0) fail('STATIC_SEMANTICS');
  for (const [role, path] of Object.entries(payload.authorityStatus?.exclusiveAuthorities ?? {})) {
    equal(authority.detectedAuthorities?.[role], [path], 'AUTHORITY_ASSIGNMENT');
  }
  equal(payload.roots, {
    certificationManifestRoot: manifest.manifestRoot, staticManifestRoot: source.sourceInventoryRoot,
    physicalAuthorityAuditRoot: physical[0].manifestHash, authorityGraphRoot: hashCanonicalV10(authority),
    staticGraphRoot: hashCanonicalV10(graph), convergenceRoot: convergence.convergenceRoot,
  }, 'CERTIFICATE_CHILD_ROOTS');
  return { valid: true, verificationScope: 'LOCAL_ARTIFACT_BINDING_ONLY', referencedArtifactsVerified: true,
    certificateIssuerAuthenticated: false, runtimeAuthority: false, certificationGranted: false,
    bundleRoot: hashCanonicalV10(bundle) };
}

/** Trusted-checkout entry point: no injectable source identity or caller artifact paths. */
export function verifyCertificateEvidenceBundle(bundle) {
  const before = verifyCurrentCertificationCheckoutIdentity();
  if (!before.valid) fail('CURRENT_SOURCE_UNAVAILABLE');
  const inventory = collectSourceInventory();
  const bytes = Object.fromEntries(EVIDENCE_PATHS.map(path => [path, safeBytes(ROOT, path)]));
  const report = checkEvidenceBundleContents(bundle, bytes, { ...before, sourceInventoryRoot: inventory.sourceInventoryRoot });
  verifySystemIntegrationCertificate(bundle.certificate);
  verifyCertificationManifest(JSON.parse(bytes[EVIDENCE_PATHS[0]].toString('utf8')));
  for (const path of EVIDENCE_PATHS) if (!safeBytes(ROOT, path).equals(bytes[path])) fail('ARTIFACT_CHANGED');
  const after = verifyCurrentCertificationCheckoutIdentity();
  equal(after, before, 'SOURCE_CHANGED');
  equal(collectSourceInventory(), inventory, 'INVENTORY_CHANGED');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) fail('USAGE: expected bundle JSON path');
    console.log(JSON.stringify(verifyCertificateEvidenceBundle(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

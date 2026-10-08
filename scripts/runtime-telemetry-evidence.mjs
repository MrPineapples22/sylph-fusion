import { existsSync, readFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { hashCanonicalV10 } from './canonicalization-v10.mjs';
import { verifyCertificationManifest } from './generate-certification-manifest.mjs';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_TELEMETRY_EVIDENCE_PATH = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'runtime-telemetry.json');
const CERTIFICATION_CONFIG_PATH = resolve(ROOT_DIR, 'config', 'certification-config.json');
const HASH = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SPAN_ID = /^[a-f0-9]{16}$/;
const TRACE_ID = /^[a-f0-9]{32}$/;
const GENERATED_PHYSICAL_AUDIT_PATHS = [
  'docs/audit/evidence/c1-single-authority-door.json', 'docs/audit/evidence/c2-mutation-exclusivity.json',
  'docs/audit/evidence/c3-decision-provenance.json', 'docs/audit/evidence/c4-authority-ancestry.json',
];
// Captures are produced every 250 ms by default (and at most every 60 s).
// Five minutes tolerates scheduling and short publication delays while bounding
// replay exposure. This is a verifier policy constant, not a caller setting.
export const RUNTIME_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;
const SPAN_NAMES = new Set(['ingress.observation', 'ingress.compile', 'ingress.validate', 'ingress.commit', 'ingress.delivery']);

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

export function verifyRuntimeTelemetryEvidence(value, { trustedPublicKeyPem } = {}) {
  const v2 = value?.schemaVersion === 'SYLPH_RUNTIME_TELEMETRY_V2';
  const required = ['schemaVersion', 'provenanceClass', 'sourceCommitSha', 'sourceTreeSha', 'runtimeInstanceId',
    'processId', 'nodeVersion', 'processStartedAtMs', 'captureStartedAtMs', 'captureEndedAtMs', 'durability', 'spans', 'attestation', 'evidenceHash'];
  if (!exactKeys(value, required) || (!v2 && value.schemaVersion !== 'SYLPH_RUNTIME_TELEMETRY_V1') || value.provenanceClass !== 'REAL_RUNTIME') {
    return { valid: false, reason: 'C5_EVIDENCE_SCHEMA_INVALID' };
  }
  if (!SHA1.test(value.sourceCommitSha) || !SHA1.test(value.sourceTreeSha) ||
      typeof value.runtimeInstanceId !== 'string' || !/^[a-f0-9]{32}$/.test(value.runtimeInstanceId) ||
      !Number.isSafeInteger(value.processId) || value.processId < 1 ||
      typeof value.nodeVersion !== 'string' || !/^v(?:2[4-9]|[3-9]\d)\./.test(value.nodeVersion)) {
    return { valid: false, reason: 'C5_RUNTIME_IDENTITY_INVALID' };
  }
  if (![value.processStartedAtMs, value.captureStartedAtMs, value.captureEndedAtMs].every(Number.isSafeInteger) ||
      value.processStartedAtMs < 1 || value.captureStartedAtMs < value.processStartedAtMs ||
      value.captureEndedAtMs < value.captureStartedAtMs) {
    return { valid: false, reason: 'C5_RUNTIME_INTERVAL_INVALID' };
  }
  const d = value.durability;
  if (!exactKeys(d, ['barrier', 'storeEventId', 'storeAuditId', 'storeEventHash', ...(v2 ? ['storeInstanceId'] : [])]) || d.barrier !== 'FSYNC_COMMITTED' ||
      (v2 && (typeof d.storeInstanceId !== 'string' || !/^[a-f0-9]{32}$/.test(d.storeInstanceId))) ||
      typeof d.storeEventId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(d.storeEventId) ||
      !Number.isSafeInteger(d.storeAuditId) || d.storeAuditId < 1 || typeof d.storeEventHash !== 'string' || !HASH.test(d.storeEventHash)) {
    return { valid: false, reason: 'C5_DURABILITY_RECEIPT_INVALID' };
  }
  if (!Array.isArray(value.spans) || value.spans.length < 1 || value.spans.length > 10_000) {
    return { valid: false, reason: 'C5_SPANS_INVALID' };
  }
  const ids = new Set();
  for (const span of value.spans) {
    if (!exactKeys(span, ['spanId', 'traceId', 'parentSpanId', 'name', 'startedAtNs', 'endedAtNs', 'status']) ||
        typeof span.spanId !== 'string' || !SPAN_ID.test(span.spanId) || ids.has(span.spanId) ||
        typeof span.traceId !== 'string' || !TRACE_ID.test(span.traceId) ||
        (v2 && (/^0+$/.test(span.spanId) || /^0+$/.test(span.traceId))) ||
        (span.parentSpanId !== null && (typeof span.parentSpanId !== 'string' || !SPAN_ID.test(span.parentSpanId))) ||
        !SPAN_NAMES.has(span.name) || !['OK', 'ERROR'].includes(span.status) ||
        typeof span.startedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.startedAtNs) ||
        typeof span.endedAtNs !== 'string' || !/^[1-9][0-9]{0,19}$/.test(span.endedAtNs) ||
        BigInt(span.endedAtNs) < BigInt(span.startedAtNs)) {
      return { valid: false, reason: 'C5_SPAN_INVALID' };
    }
    ids.add(span.spanId);
  }
  if (v2) {
    const parents = new Map(value.spans.map(span => [span.spanId, span]));
    const roots = new Map();
    for (const span of value.spans) {
      if (span.name === 'ingress.observation') {
        if (span.parentSpanId !== null || roots.has(span.traceId)) return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
        roots.set(span.traceId, span);
      } else {
        const parent = parents.get(span.parentSpanId);
        if (!parent || parent.name !== 'ingress.observation' || parent.traceId !== span.traceId ||
            BigInt(span.startedAtNs) < BigInt(parent.startedAtNs) || BigInt(span.endedAtNs) > BigInt(parent.endedAtNs)) {
          return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
        }
      }
    }
    if (roots.size === 0 || [...roots.values()].some(root => !value.spans.some(span => span.parentSpanId === root.spanId))) {
      return { valid: false, reason: 'C5_SPAN_LINEAGE_INVALID' };
    }
  }
  if (typeof value.evidenceHash !== 'string' || !HASH.test(value.evidenceHash)) {
    return { valid: false, reason: 'C5_EVIDENCE_HASH_INVALID' };
  }
  const attestation = value.attestation;
  if (!exactKeys(attestation, ['algorithm', 'signatureBase64']) || attestation.algorithm !== 'Ed25519' ||
      typeof attestation.signatureBase64 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signatureBase64)) {
    return { valid: false, reason: 'C5_ATTESTATION_INVALID' };
  }
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.trim()) {
    return { valid: false, reason: 'C5_RUNTIME_ATTESTATION_TRUST_ROOT_MISSING' };
  }
  let attestedRoot;
  try {
    const { evidenceHash: _evidenceHash, attestation: _attestation, ...attestedPayload } = value;
    attestedRoot = hashCanonicalV10(attestedPayload);
    const signature = Buffer.from(attestation.signatureBase64, 'base64');
    if (signature.toString('base64') !== attestation.signatureBase64 ||
        !verifySignature(null, Buffer.from(attestedRoot, 'hex'), createPublicKey(trustedPublicKeyPem), signature)) {
      return { valid: false, reason: 'C5_ATTESTATION_SIGNATURE_INVALID' };
    }
  } catch {
    return { valid: false, reason: 'C5_ATTESTATION_SIGNATURE_INVALID' };
  }
  const { evidenceHash, ...payload } = value;
  if (hashCanonicalV10(payload) !== evidenceHash) return { valid: false, reason: 'C5_EVIDENCE_HASH_MISMATCH' };
  return { valid: true, evidenceHash, attestedRoot, spanCount: value.spans.length, provenanceClass: value.provenanceClass };
}

/**
 * Bind signed runtime claims to a verifier-derived checkout identity and apply
 * a bounded timestamp freshness policy. `nowMs` is exposed for deterministic
 * tests; certification callers use the local verifier clock.
 */
export function verifyRuntimeTelemetryCertificationBinding(value, {
  expectedCommitSha, expectedTreeSha, worktreeClean, nowMs = Date.now(),
} = {}) {
  if (worktreeClean !== true || !SHA1.test(expectedCommitSha ?? '') || !SHA1.test(expectedTreeSha ?? '')) {
    return { valid: false, reason: 'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE' };
  }
  if (value.sourceCommitSha !== expectedCommitSha || value.sourceTreeSha !== expectedTreeSha) {
    return { valid: false, reason: 'C5_SOURCE_IDENTITY_MISMATCH' };
  }
  if (!Number.isSafeInteger(nowMs) || value.captureEndedAtMs > nowMs) {
    return { valid: false, reason: 'C5_EVIDENCE_TIMESTAMP_FUTURE_OR_INVALID' };
  }
  if (nowMs - value.captureEndedAtMs > RUNTIME_EVIDENCE_MAX_AGE_MS) {
    return { valid: false, reason: 'C5_EVIDENCE_STALE' };
  }
  return { valid: true, sourceCommitSha: expectedCommitSha, sourceTreeSha: expectedTreeSha };
}

/** Read verifier time only after all upstream source/audit work is complete. */
export function verifyRuntimeTelemetryAfterSourceResolution(value, source, clock = Date.now) {
  if (!source?.valid) return source ?? { valid: false, reason: 'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE' };
  return verifyRuntimeTelemetryCertificationBinding(value, {
    expectedCommitSha: source.commitSha, expectedTreeSha: source.treeSha, worktreeClean: true, nowMs: clock(),
  });
}

/** Orchestrate source freshness and durable-store checks; dependencies permit
 * deterministic testing of expensive audit/store work without runtime secrets. */
export function appraiseRuntimeTelemetryBindings(value, {
  resolveSource = loadCurrentCertificationSourceIdentity,
  verifyStore = verifyRuntimeTelemetryStoreBinding,
  clock = Date.now,
} = {}) {
  const source = resolveSource();
  if (!source?.valid) return source ?? { valid: false, reason: 'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE' };
  const initialBinding = verifyRuntimeTelemetryAfterSourceResolution(value, source, clock);
  if (!initialBinding.valid) return initialBinding;
  const storeBinding = verifyStore(value);
  if (!storeBinding.valid) return storeBinding;
  const finalBinding = verifyRuntimeTelemetryAfterSourceResolution(value, source, clock);
  if (!finalBinding.valid) return finalBinding;
  return { valid: true, source, storeBinding };
}

export function resolveGitBinary() {
  for (const c of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return 'git';
}

function resolveGit(args) {
  return execFileSync(resolveGitBinary(), args, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase();
}

/**
 * Verify tracked checkout bytes against HEAD, including files hidden from
 * ordinary status by assume-unchanged/skip-worktree index flags. Only the
 * caller's explicitly named generated outputs may differ, and only unstaged.
 */
export function verifyGitWorkingTreeAgainstHead(repoRoot, allowedMutablePaths = []) {
  try {
    const root = resolve(repoRoot);
    const gitBinary = resolveGitBinary();
    const git = (args, input) => execFileSync(gitBinary, args, { cwd: root, input, stdio: ['pipe', 'pipe', 'ignore'] });
    const allowed = new Set(allowedMutablePaths);

    const indexEntries = git(['ls-files', '-t', '-v', '-z']).toString('utf8').split('\0').filter(Boolean);
    if (indexEntries.some(entry => entry.length < 3 || entry[1] !== ' ' || entry[0] !== 'H')) return false;

    // Staged changes mean the current index no longer describes HEAD.
    if (git(['diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD', '--']).toString('utf8') !== '') return false;

    const statusEntries = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString('utf8').split('\0').filter(Boolean);
    for (const entry of statusEntries) {
      const status = entry.slice(0, 2);
      const path = entry.slice(3);
      if (status !== ' M' || !allowed.has(path)) return false;
    }

    const treeEntries = git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString('utf8').split('\0').filter(Boolean);
    const pathsToHash = [];
    const expectedObjectIds = [];
    for (const entry of treeEntries) {
      const tab = entry.indexOf('\t');
      if (tab < 0) return false;
      const [mode, type, objectId] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (type !== 'blob' || !['100644', '100755'].includes(mode)) return false;
      if (allowed.has(path)) continue;
      // hash-object's batched stdin-path mode is newline-delimited. Reject the
      // unusual newline path case rather than parse it ambiguously.
      if (path.includes('\n') || path.includes('\r')) return false;
      const fullPath = resolve(root, path);
      if (!fullPath.startsWith(`${root}/`) && !fullPath.startsWith(`${root}\\`)) return false;
      const fileStat = lstatSync(fullPath);
      if (!fileStat.isFile()) return false;
      // Git's executable bit is meaningful on POSIX. Windows worktrees do not
      // reliably preserve Unix mode bits, so Git's own tracked mode is used there.
      if (process.platform !== 'win32' && Boolean(fileStat.mode & 0o111) !== (mode === '100755')) return false;
      pathsToHash.push(path);
      expectedObjectIds.push(objectId);
    }
    if (pathsToHash.length > 0) {
      const nul = String.fromCharCode(0);
      const attributeNames = ['filter', 'working-tree-encoding', 'ident'];
      const attributes = git(['check-attr', '--stdin', '-z', ...attributeNames],
        Buffer.from(`${pathsToHash.join(nul)}${nul}`)).toString('utf8').split(nul).filter(Boolean);
      if (attributes.length !== pathsToHash.length * attributeNames.length * 3) return false;
      for (let pathIndex = 0; pathIndex < pathsToHash.length; pathIndex++) {
        for (let attributeIndex = 0; attributeIndex < attributeNames.length; attributeIndex++) {
          const offset = (pathIndex * attributeNames.length + attributeIndex) * 3;
          if (attributes[offset] !== pathsToHash[pathIndex] || attributes[offset + 1] !== attributeNames[attributeIndex] ||
              !['unspecified', 'unset'].includes(attributes[offset + 2])) return false;
        }
      }
      // Do not execute repository/user-defined clean filter programs while
      // hashing. Built-in Git text/EOL normalization remains available.
      const actualObjectIds = git(['hash-object', '--stdin-paths'], Buffer.from(`${pathsToHash.join('\n')}\n`))
        .toString('utf8').trim().split(/\r?\n/);
      if (actualObjectIds.length !== expectedObjectIds.length ||
          actualObjectIds.some((objectId, index) => objectId !== expectedObjectIds[index])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Establish the current source identity from Git and the verified manifest. */
export function verifyCurrentCertificationCheckoutIdentity() {
  try {
    const manifestPath = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'CERTIFICATION_MANIFEST.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const commitSha = resolveGit(['rev-parse', 'HEAD']);
    const treeSha = resolveGit(['rev-parse', 'HEAD^{tree}']);
    verifyCertificationManifest(manifest, { expectedCommitSha: commitSha });
    if (!verifyGitWorkingTreeAgainstHead(ROOT_DIR, GENERATED_PHYSICAL_AUDIT_PATHS)) {
      return { valid: false, reason: 'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE' };
    }
    return { valid: true, commitSha, treeSha };
  } catch {
    return { valid: false, reason: 'C5_CURRENT_SOURCE_IDENTITY_UNAVAILABLE' };
  }
}

/** Establish identity and require fresh physical C1–C4 recomputation. */
function loadCurrentCertificationSourceIdentity() {
  const before = verifyCurrentCertificationCheckoutIdentity();
  if (!before.valid) return before;
  const freshAudit = runFreshPhysicalAudit(before.commitSha, before.treeSha);
  if (!freshAudit.valid) return freshAudit;
  const after = verifyCurrentCertificationCheckoutIdentity();
  if (!after.valid || after.commitSha !== before.commitSha || after.treeSha !== before.treeSha) {
    return { valid: false, reason: 'C5_CURRENT_SOURCE_CHANGED_DURING_AUDIT' };
  }
  return { valid: true, commitSha: before.commitSha, treeSha: before.treeSha, physicalAuditRoot: freshAudit.root };
}

/** Recompute C1–C4 in a child process; persisted JSON projections are not authority. */
function runFreshPhysicalAudit(commitSha, treeSha) {
  const outputDir = mkdtempSync(resolve(tmpdir(), 'sylph-c5-physical-audit-'));
  const startedAtMs = Date.now();
  try {
    const auditorPath = resolve(ROOT_DIR, 'scripts', 'audit-single-authority-door.mjs');
    execFileSync(process.execPath, [auditorPath, '--output-dir', outputDir], {
      cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
    const reportPath = resolve(outputDir, 'c1-single-authority-door.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const { manifestHash, ...payload } = report;
    const completedAtMs = Date.now();
    if (typeof manifestHash !== 'string' || createHash('sha256').update(JSON.stringify(payload)).digest('hex') !== manifestHash ||
        report.auditorVersion !== '4.0.0-c1-c4' || report.commitSha !== commitSha || report.treeSha !== treeSha ||
        !Number.isFinite(Date.parse(report.timestamp)) || Date.parse(report.timestamp) < startedAtMs - 1_000 ||
        Date.parse(report.timestamp) > completedAtMs ||
        ['C1', 'C2', 'C3', 'C4'].some(level => report.gateStatuses?.[level] !== 'PASS') ||
        !report.metrics || Object.values(report.metrics).some(metric => metric !== 0) ||
        !Array.isArray(report.blockers) || report.blockers.length !== 0 ||
        !Array.isArray(report.runtimeTestResults) || report.runtimeTestResults.length === 0 ||
        report.runtimeTestResults.some(result => result.passed !== true) ||
        report.workingTreeState !== '' || Object.keys(report.workingTreeFileHashes ?? {}).length !== 0 ||
        !verifyAuditedFileHashes(report.auditedFiles) ||
        !verifyGitWorkingTreeAgainstHead(ROOT_DIR, GENERATED_PHYSICAL_AUDIT_PATHS)) {
      return { valid: false, reason: 'C5_FRESH_PHYSICAL_AUDIT_INVALID' };
    }
    return { valid: true, root: manifestHash };
  } catch {
    return { valid: false, reason: 'C5_FRESH_PHYSICAL_AUDIT_FAILED' };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function verifyAuditedFileHashes(auditedFiles) {
  if (!auditedFiles || typeof auditedFiles !== 'object' || Array.isArray(auditedFiles)) return false;
  for (const [relativePath, expectedHash] of Object.entries(auditedFiles)) {
    if (!HASH.test(expectedHash)) return false;
    const path = resolve(ROOT_DIR, relativePath);
    if ((!path.startsWith(`${ROOT_DIR}/`) && !path.startsWith(`${ROOT_DIR}\\`)) ||
        !existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== expectedHash) return false;
  }
  return true;
}

/**
 * Bind the signed receipt to the configured SQLite store. The durable row is a
 * separately persisted runtime event; its body must carry the same runtime,
 * source, interval, and span observations as the signed certificate.
 */
export function verifyRuntimeTelemetryStoreBinding(value, { databasePath = process.env.DB_PATH ?? 'fusion.sqlite' } = {}) {
  let db;
  try {
    const absolutePath = resolve(databasePath);
    db = new DatabaseSync(absolutePath, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const v2 = value.schemaVersion === 'SYLPH_RUNTIME_TELEMETRY_V2';
    if (v2) {
      const present = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='runtime_store_identity_v1'").get();
      const identities = present ? db.prepare('SELECT singleton,instance_id FROM runtime_store_identity_v1').all() : [];
      if (identities.length !== 1 || identities[0].singleton !== 1 || identities[0].instance_id !== value.durability.storeInstanceId) {
        return { valid: false, reason: 'C5_DURABLE_STORE_IDENTITY_MISMATCH' };
      }
    }
    const tables = db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='audit_event_dedupe'").get();
    if (!tables) return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISSING' };
    const row = db.prepare(`SELECT COALESCE(a.id,d.audit_id) AS id,a.event,a.body,
      d.event_hash AS eventHash,(a.id IS NULL) AS pruned FROM audit_event_dedupe d
      LEFT JOIN audit a ON a.id=d.audit_id WHERE d.event_id=?`).get(value.durability.storeEventId);
    if (!row) return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISSING' };
    if (row.pruned || typeof row.body !== 'string' || typeof row.event !== 'string') {
      return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_PRUNED' };
    }
    if (row.id !== value.durability.storeAuditId || row.event !== (v2 ? 'runtime_telemetry_observed_v2' : 'runtime_telemetry_observed_v1') ||
        typeof row.eventHash !== 'string' || row.eventHash !== value.durability.storeEventHash ||
        createHash('sha256').update(`${row.event}:${row.body}`).digest('hex') !== row.eventHash) {
      return { valid: false, reason: 'C5_DURABLE_STORE_RECORD_MISMATCH' };
    }
    const body = JSON.parse(row.body);
    if (!exactKeys(body, ['schemaVersion', 'runtimeInstanceId', 'sourceCommitSha', 'sourceTreeSha', 'processId',
      'processStartedAtMs', 'captureStartedAtMs', 'captureEndedAtMs', 'spans', ...(v2 ? ['storeInstanceId'] : [])]) ||
        body.schemaVersion !== (v2 ? 'SYLPH_RUNTIME_TELEMETRY_STORE_V2' : 'SYLPH_RUNTIME_TELEMETRY_STORE_V1') ||
        (v2 && body.storeInstanceId !== value.durability.storeInstanceId) ||
        body.runtimeInstanceId !== value.runtimeInstanceId || body.sourceCommitSha !== value.sourceCommitSha ||
        body.sourceTreeSha !== value.sourceTreeSha || body.processId !== value.processId ||
        body.processStartedAtMs !== value.processStartedAtMs || body.captureStartedAtMs !== value.captureStartedAtMs ||
        body.captureEndedAtMs !== value.captureEndedAtMs ||
        JSON.stringify(body.spans) !== JSON.stringify(value.spans)) {
      return { valid: false, reason: 'C5_DURABLE_STORE_CONTENT_MISMATCH' };
    }
    return { valid: true, storePath: absolutePath, storeAuditId: row.id, storeEventHash: row.eventHash };
  } catch {
    return { valid: false, reason: 'C5_DURABLE_STORE_UNAVAILABLE' };
  } finally {
    db?.close();
  }
}

export function loadRuntimeTelemetryEvidence(path = RUNTIME_TELEMETRY_EVIDENCE_PATH, { clock = Date.now } = {}) {
  if (!existsSync(path)) return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_MISSING' };
  try {
    const config = JSON.parse(readFileSync(CERTIFICATION_CONFIG_PATH, 'utf8'));
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const verification = verifyRuntimeTelemetryEvidence(parsed, { trustedPublicKeyPem: config.runtimeAttestationPublicKeyPem });
    if (!verification.valid) return verification;
    const appraisal = appraiseRuntimeTelemetryBindings(parsed, { clock });
    if (!appraisal.valid) return appraisal;
    return { ...verification, storeBinding: appraisal.storeBinding,
      physicalAuditRoot: appraisal.source.physicalAuditRoot, evidence: parsed };
  } catch {
    return { valid: false, reason: 'C5_DURABLE_RUNTIME_EVIDENCE_INVALID' };
  }
}

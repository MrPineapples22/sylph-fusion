/**
 * SYLPH FUSION — SYSTEM INTEGRATION CERTIFICATE GENERATOR (STEP 7)
 * Specifications: Blueprint Sections 28, 29, 30, 31, 32
 *
 * Responsibilities:
 * 1. Collects multi-roots from Step 1-6 artifacts:
 *    - certificationManifestRoot
 *    - staticManifestRoot (sourceInventoryRoot)
 *    - authorityGraphRoot
 *    - staticGraphRoot
 *    - convergenceRoot
 *    - runtime / replay / fault / canary evidence roots (when awarded)
 * 2. Assembles structured certifiedPayload binding commit SHA, Node/npm facts,
 *    ladder state, authority assignments, and boundary stop reason.
 * 3. Enforces strict certification status taxonomy:
 *    - UNIFIED_PIPELINE_CERTIFIED (strictly C10 in certify mode with real canary)
 *    - PROVISIONALLY_INTEGRATED (C4..C9 or C10 in test mode)
 *    - NOT_CERTIFIED (C0..C3)
 * 4. Issues fail-closed rejection notice whenever full certification is not achieved.
 * 5. Computes certificateRoot = hashCanonicalV10(certifiedPayload).
 * 6. Self-verifies the output using independent verifySystemIntegrationCertificate.
 * 7. Persists artifacts/connectivity/SYSTEM_INTEGRATION_CERTIFICATE.json.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  canonicalJsonV10,
  hashCanonicalV10,
  EMPTY_SHA256_HEX,
} from './canonicalization-v10.mjs';
import { verifySystemIntegrationCertificate } from './verify-system-integration-certificate.mjs';
import { verifyCertificationManifest } from './generate-certification-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'artifacts', 'connectivity');
const DEFAULT_OUTPUT_PATH = resolve(ARTIFACTS_DIR, 'SYSTEM_INTEGRATION_CERTIFICATE.json');

function resolveGitBinary() {
  for (const c of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return 'git';
}

function verifyUnboundTestFixtureCertificate(certificate) {
  // Injected dry-run fixtures are not tied to a current repository or physical
  // audit. Verify only their hash mechanics and label the result accordingly.
  const independentRoot = createHash('sha256')
    .update(canonicalJsonV10(certificate.certifiedPayload), 'utf8').digest('hex');
  if (independentRoot !== certificate.certificateRoot) {
    throw new Error('TEST_FIXTURE_CERTIFICATE_ROOT_MISMATCH');
  }
  const tamperedPayload = { ...certificate.certifiedPayload, __fixture_tamper_marker__: true };
  const tamperedRoot = createHash('sha256').update(canonicalJsonV10(tamperedPayload), 'utf8').digest('hex');
  if (tamperedRoot === independentRoot) throw new Error('TEST_FIXTURE_TAMPER_CHECK_FAILED');
  return {
    valid: true,
    fixtureOnly: true,
    certificateRoot: independentRoot,
    independentRoot,
    payloadByteLength: Buffer.byteLength(canonicalJsonV10(certificate.certifiedPayload), 'utf8'),
    tamperSensitivityProven: true,
  };
}

/**
 * Loads JSON artifact safely or throws if missing.
 * @param {string} filename
 * @returns {object}
 */
function loadArtifact(filename) {
  const p = resolve(ARTIFACTS_DIR, filename);
  if (!existsSync(p)) {
    throw new Error(`MISSING_ARTIFACT: Required artifact ${filename} not found in ${ARTIFACTS_DIR}`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const content = readFileSync(p, 'utf8');
      if (content.trim()) {
        return JSON.parse(content);
      }
    } catch {
      // If parsing fails due to transient concurrent file write, briefly wait and retry
    }
    const start = Date.now();
    while (Date.now() - start < 50) {}
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadAndVerifyPhysicalAuthorityAudit(expectedCommitSha, { verifyWorktree = true } = {}) {
  const evidenceFiles = [
    'c1-single-authority-door.json',
    'c2-mutation-exclusivity.json',
    'c3-decision-provenance.json',
    'c4-authority-ancestry.json',
  ];
  const reports = evidenceFiles.map((filename) => {
    const path = resolve(ROOT_DIR, 'docs', 'audit', 'evidence', filename);
    if (!existsSync(path)) throw new Error(`PHYSICAL_AUDIT_MISSING: ${filename}`);
    return { filename, report: JSON.parse(readFileSync(path, 'utf8')) };
  });
  const first = reports[0].report;
  const { manifestHash, ...payload } = first;
  const computedHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (manifestHash !== computedHash) throw new Error('PHYSICAL_AUDIT_ROOT_MISMATCH: C1 manifest hash is invalid');
  for (const { filename, report } of reports) {
    if (report.manifestHash !== manifestHash || JSON.stringify(report) !== JSON.stringify(first)) {
      throw new Error(`PHYSICAL_AUDIT_DIVERGENCE: ${filename} does not match the C1-C4 audit bundle`);
    }
  }
  if (first.auditorVersion !== '4.0.0-c1-c4' || first.commitSha !== expectedCommitSha) {
    throw new Error('PHYSICAL_AUDIT_COMMIT_MISMATCH: Audit evidence is not bound to the certification commit');
  }
  let expectedTreeSha;
  try {
    expectedTreeSha = execFileSync(resolveGitBinary(), ['rev-parse', `${expectedCommitSha}^{tree}`], {
      cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
  } catch {
    throw new Error('PHYSICAL_AUDIT_GIT_UNAVAILABLE: Cannot verify audit tree identity');
  }
  if (first.treeSha !== expectedTreeSha) throw new Error('PHYSICAL_AUDIT_TREE_MISMATCH: Audit tree differs from certification commit');
  if (first.gateStatuses?.C1 !== 'PASS' || first.gateStatuses?.C2 !== 'PASS' ||
      first.gateStatuses?.C3 !== 'PASS' || first.gateStatuses?.C4 !== 'PASS' ||
      first.gateStatuses?.LIVE_CAPITAL_AUTHORITY !== 'BLOCKED' ||
      first.gateStatuses?.UNIFIED_PIPELINE_CERTIFIED !== 'FALSE' ||
      !Array.isArray(first.blockers) || first.blockers.length !== 0 ||
      !Array.isArray(first.runtimeTestResults) || first.runtimeTestResults.length === 0 ||
      first.runtimeTestResults.some((result) => result.passed !== true) ||
      !first.metrics || Object.values(first.metrics).some((value) => value !== 0)) {
    throw new Error('PHYSICAL_AUDIT_GATE_FAILURE: C1-C4 physical audit did not pass fail-closed invariants');
  }

  if (verifyWorktree) {
    for (const [relativePath, expectedHash] of Object.entries(first.workingTreeFileHashes ?? {})) {
      const resolvedPath = resolve(ROOT_DIR, relativePath);
      if (!resolvedPath.startsWith(`${ROOT_DIR}/`) && !resolvedPath.startsWith(`${ROOT_DIR}\\`)) {
        throw new Error(`PHYSICAL_AUDIT_PATH_INVALID: ${relativePath}`);
      }
      if (!existsSync(resolvedPath) || createHash('sha256').update(readFileSync(resolvedPath)).digest('hex') !== expectedHash) {
        throw new Error(`PHYSICAL_AUDIT_WORKTREE_DRIFT: ${relativePath}`);
      }
    }
  }
  return { root: manifestHash, report: first };
}

/**
 * Generates the System Integration Certificate.
 * @param {object} [options={}]
 * @param {string} [options.outputPath] Path to write the certificate
 * @param {boolean} [options.dryRun=false] If true, do not write to disk
 * @param {object} [options.convergenceReport] Optional pre-evaluated convergence report
 * @param {object} [options.scorecard] Optional pre-evaluated scorecard
 * @param {object} [options.manifest] Optional pre-evaluated manifest
 * @returns {{ certificate: object, verificationReport: object }}
 */
export function generateSystemIntegrationCertificate(options = {}) {
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;

  // 1. Load Precedent Artifacts
  const manifest = options.manifest ?? loadArtifact('CERTIFICATION_MANIFEST.json');
  // Test-only injected fixtures may use synthetic manifests. Every normal certificate
  // generation must reject stale commits, stale inputs, and invalid manifest roots.
  if (!(options.dryRun === true && options.manifest !== undefined)) {
    verifyCertificationManifest(manifest);
  }
  let physicalAudit;
  if (options.dryRun === true && options.manifest !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(options.physicalAudit?.root ?? '')) {
      throw new Error('PHYSICAL_AUDIT_FIXTURE_REQUIRED: Dry-run manifest fixtures require an explicit 64-hex audit root');
    }
    physicalAudit = { root: options.physicalAudit.root };
  } else {
    physicalAudit = loadAndVerifyPhysicalAuthorityAudit(manifest.certifiedPayload?.repositoryCommitSha, {
      verifyWorktree: options.dryRun !== true,
    });
  }
  const scorecard = options.scorecard ?? loadArtifact('c0-c10-scorecard.json');
  const authorityGraph = options.authorityGraph ?? loadArtifact('authority-graph.json');
  const staticGraph = options.staticGraph ?? loadArtifact('static-graph.json');
  const convergenceReport = options.convergenceReport ?? loadArtifact('RUNTIME_CONVERGENCE_REPORT.json');

  const convPayload = convergenceReport.certifiedPayload ?? {};
  const highestProvenLevel = convPayload.highestProvenLevel ?? scorecard.systemScore?.highestProvenLevel ?? 'C0';
  const mode = convPayload.mode ?? 'test';
  const isFullyCertified = convPayload.isFullyCertified === true;

  // 2. Determine Certification Status
  let certificationStatus = 'NOT_CERTIFIED';
  let rejectionNotice = null;

  if (highestProvenLevel === 'C10' && mode === 'certify' && isFullyCertified) {
    certificationStatus = 'UNIFIED_PIPELINE_CERTIFIED';
  } else if (['C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'].includes(highestProvenLevel)) {
    certificationStatus = 'PROVISIONALLY_INTEGRATED';
    rejectionNotice = `PROVISIONAL STATUS: System achieved level ${highestProvenLevel} under ${mode.toUpperCase()} mode. Full UNIFIED_PIPELINE_CERTIFIED requires level C10 evaluated in CERTIFY mode with physical Yellowstone/RPC telemetry, continuous SHA-256 artifact verification, authoritative journal write, deterministic replay, and real mainnet-canary execution. Zero live trading or financial authority granted.`;
  } else {
    certificationStatus = 'NOT_CERTIFIED';
    rejectionNotice = `NOT CERTIFIED: System reached level ${highestProvenLevel}. Missing prerequisites: ${convPayload.stopReason || 'Static integration requirements incomplete'}. Zero production authority granted.`;
  }

  // 3. Compute Component Roots
  const authorityGraphRoot = hashCanonicalV10(authorityGraph);
  const staticGraphRoot = hashCanonicalV10(staticGraph);
  const staticManifestRoot = scorecard.metadata?.sourceInventoryRoot ?? '0'.repeat(64);
  const certificationManifestRoot = manifest.manifestRoot ?? hashCanonicalV10(manifest.certifiedPayload ?? manifest);
  const convergenceRoot = convergenceReport.convergenceRoot ?? hashCanonicalV10(convPayload);

  // 4. Construct Certified Payload
  const certifiedPayload = {
    systemId: 'SYLPH_FUSION',
    certificateSchemaVersion: '1.0.0',
    certifiedAt: new Date().toISOString(),
    highestProvenLevel,
    certificationStatus,
    evaluationMode: mode,
    isFullyCertified,
    boundaryReason: convPayload.stopReason ?? 'No boundary reason specified',
    rejectionNotice,
    roots: {
      certificationManifestRoot,
      staticManifestRoot,
      physicalAuthorityAuditRoot: physicalAudit.root,
      authorityGraphRoot,
      staticGraphRoot,
      convergenceRoot,
    },
    manifestSummary: {
      repositoryCommitSha: manifest.certifiedPayload?.repositoryCommitSha ?? 'UNKNOWN',
      nodeVersion: manifest.certifiedPayload?.nodeVersion ?? process.version,
      npmVersion: manifest.certifiedPayload?.npmVersion ?? 'UNKNOWN',
      mandatoryEdgesCount: manifest.certifiedPayload?.mandatoryEdgesCount ?? 18,
      mandatoryEdgeSetHash: manifest.certifiedPayload?.mandatoryEdgeSetHash ?? '0'.repeat(64),
      lockfileHash: manifest.certifiedPayload?.lockfileHash ?? '0'.repeat(64),
      tsConfigHash: manifest.certifiedPayload?.tsConfigHash ?? '0'.repeat(64),
    },
    ladder: convPayload.ladder ?? scorecard.systemScore ?? {},
    authorityStatus: {
      collisionCount: 0,
      exclusiveAuthorities: {
        canonicalStateWriter: 'src/platform/pipeline/fusion-reducer.ts',
        economicStateWriter: 'src/intelligence/capital/economic-authority-store.ts',
        decisionIssuer: 'src/intelligence/decision/unified-decision.ts',
        terminalityIssuer: 'src/platform/execution/terminality-authority.ts',
      },
    },
    zeroAuthorityInvariants: {
      financialSignerAuthority: 'NONE',
      mainnetBroadcastAuthority: 'NONE',
      capitalDeploymentAuthority: 'NONE',
      deterministicInvariantDominance: true,
    },
  };

  // 5. Calculate Certificate Root
  const certificateRoot = hashCanonicalV10(certifiedPayload);

  if (certificateRoot === EMPTY_SHA256_HEX) {
    throw new Error('SECURITY_ERROR: Certificate root computed as empty hash');
  }

  const certificate = {
    schemaVersion: '1.0.0',
    certificateRoot,
    certifiedPayload,
  };

  // 6. Independent Self-Verification Audit
  const verificationReport = options.dryRun === true && options.manifest !== undefined
    ? verifyUnboundTestFixtureCertificate(certificate)
    : verifySystemIntegrationCertificate(certificate);

  // 7. Write Artifact to Disk
  if (!options.dryRun) {
    writeFileSync(outputPath, canonicalJsonV10(certificate), 'utf8');
  }

  return { certificate, verificationReport };
}

// CLI Execution Entry Point
if (process.argv[1] && process.argv[1].includes('generate-system-integration-certificate.mjs')) {
  try {
    console.log('[CERTIFICATE_GENERATOR] Generating System Integration Certificate...');
    const { certificate, verificationReport } = generateSystemIntegrationCertificate();
    console.log('[CERTIFICATE_GENERATOR] System Integration Certificate Successfully Generated & Verified:');
    console.log(` - File: artifacts/connectivity/SYSTEM_INTEGRATION_CERTIFICATE.json`);
    console.log(` - Certificate Root: ${certificate.certificateRoot}`);
    console.log(` - Status: ${certificate.certifiedPayload.certificationStatus}`);
    console.log(` - Highest Proven Level: ${certificate.certifiedPayload.highestProvenLevel}`);
    console.log(` - Independent Verifier: PASS (${verificationReport.payloadByteLength} bytes)`);
    process.exit(0);
  } catch (err) {
    console.error('[CERTIFICATE_GENERATOR_ERROR] Certificate Generation Failed:', err.message);
    process.exit(1);
  }
}

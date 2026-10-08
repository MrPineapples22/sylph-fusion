/**
 * SYLPH FUSION — CERTIFICATION MANIFEST GENERATOR (STEP 2)
 * Specifications: Blueprint Section 26
 *
 * Responsibilities:
 * 1. Binds immutable runtime environment facts:
 *    - repositoryCommitSha
 *    - nodeVersion
 *    - npmVersion
 *    - lockfileHash (SHA-256 of package-lock.json)
 *    - tsConfigHash (SHA-256 of tsconfig.json)
 *    - certificationConfigHash (Canonical SHA-256 of certification-config.json)
 *    - mandatoryEdgeSetHash (Canonical SHA-256 of mandatoryEdges)
 *    - canonicalizationVersion (v10)
 *    - certificateSchemaVersion (1.0.0)
 * 2. Computes manifestRoot over the canonicalized certifiedPayload.
 * 3. Enforces full 64-hex SHA-256 digests and empty-payload guard.
 * 4. Writes output to artifacts/connectivity/CERTIFICATION_MANIFEST.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  canonicalJsonV10,
  hashCanonicalV10,
  assertDigestMatch,
} from './canonicalization-v10.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const CONFIG_FILE = resolve(ROOT_DIR, 'config', 'certification-config.json');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'artifacts', 'connectivity');

function computeFileHash(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`FILE_NOT_FOUND: Cannot compute hash of missing file: ${filePath}`);
  }
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function resolveGitCommitSha() {
  const checkoutSha = resolveCheckoutCommitSha();
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)
    && process.env.GITHUB_SHA.trim().toLowerCase() !== checkoutSha) {
    throw new Error(`GITHUB_SHA_MISMATCH: Environment SHA ${process.env.GITHUB_SHA.trim()} differs from checkout ${checkoutSha}`);
  }
  return checkoutSha;
}

function resolveCheckoutCommitSha() {
  try {
    const gitCmd = process.platform === 'win32'
      ? (existsSync('C:\\Program Files\\Git\\cmd\\git.exe') ? '"C:\\Program Files\\Git\\cmd\\git.exe"' : 'git')
      : 'git';
    const sha = execSync(`${gitCmd} rev-parse HEAD`, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    // Verification cannot claim freshness without the checkout identity.
  }
  throw new Error('MANIFEST_GIT_UNAVAILABLE: Cannot verify manifest freshness without the current checkout SHA');
}

/**
 * Verify that a persisted certification manifest still describes this checkout.
 * Integrity alone is insufficient: a correctly hashed manifest may still be stale.
 * @param {object} manifest
 * @param {{ expectedCommitSha?: string }} [options]
 * @returns {{ valid: true, repositoryCommitSha: string }}
 */
export function verifyCertificationManifest(manifest, options = {}) {
  const payload = manifest?.certifiedPayload;
  if (!payload || manifest.schemaVersion !== '1.0.0') {
    throw new Error('MANIFEST_INVALID: Missing certified payload or unsupported schema');
  }
  if (manifest.manifestRoot !== hashCanonicalV10(payload)) {
    throw new Error('MANIFEST_ROOT_MISMATCH: Certified payload does not match manifest root');
  }

  const currentCommitSha = options.expectedCommitSha ?? resolveCheckoutCommitSha();
  if (!/^[0-9a-f]{40}$/i.test(currentCommitSha) || payload.repositoryCommitSha !== currentCommitSha.toLowerCase()) {
    throw new Error(`MANIFEST_COMMIT_STALE: Manifest commit ${payload.repositoryCommitSha} does not match checkout ${currentCommitSha}`);
  }

  const configRaw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  const expected = {
    lockfileHash: computeFileHash(resolve(ROOT_DIR, 'package-lock.json')),
    tsConfigHash: computeFileHash(resolve(ROOT_DIR, 'tsconfig.json')),
    certificationConfigHash: hashCanonicalV10(configRaw),
    mandatoryEdgeSetHash: hashCanonicalV10(configRaw.mandatoryEdges ?? []),
    mandatoryEdgesCount: configRaw.mandatoryEdges?.length ?? 0,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (payload[field] !== value) {
      throw new Error(`MANIFEST_INPUT_MISMATCH: ${field} does not match current repository inputs`);
    }
  }
  if (configRaw.mandatoryEdgesCount !== expected.mandatoryEdgesCount) {
    throw new Error('MANIFEST_CONFIG_INVALID: mandatoryEdgesCount does not match mandatoryEdges');
  }
  return { valid: true, repositoryCommitSha: currentCommitSha.toLowerCase() };
}

function resolveNpmVersion() {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd --version' : 'npm --version';
    return execSync(npmCmd, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Generates the immutable Certification Manifest.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] If true, compute but do not persist the manifest.
 * @param {string} [options.outputPath] Optional artifact destination for isolated verification.
 * @returns {object} Manifest object containing certifiedPayload and manifestRoot
 */
export function generateCertificationManifest(options = {}) {
  console.log('[CERTIFICATION_MANIFEST] Collecting environment and configuration facts...');

  // 1. Resolve environment facts
  const repositoryCommitSha = options.repositoryCommitSha ?? resolveGitCommitSha();
  const nodeVersion = options.nodeVersion ?? process.version;
  const npmVersion = options.npmVersion ?? resolveNpmVersion();

  // 2. Compute file hashes
  const lockfilePath = resolve(ROOT_DIR, 'package-lock.json');
  const lockfileHash = options.lockfileHash ?? computeFileHash(lockfilePath);

  const tsConfigPath = resolve(ROOT_DIR, 'tsconfig.json');
  const tsConfigHash = options.tsConfigHash ?? computeFileHash(tsConfigPath);

  // 3. Load and hash certification config & mandatory edges
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`CONFIG_ERROR: Certification config not found at ${CONFIG_FILE}`);
  }
  const configRaw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  const certificationConfigHash = options.certificationConfigHash ?? hashCanonicalV10(configRaw);
  const mandatoryEdges = configRaw.mandatoryEdges ?? [];
  const mandatoryEdgeSetHash = options.mandatoryEdgeSetHash ?? hashCanonicalV10(mandatoryEdges);

  const canonicalizationVersion = 'v10';
  const certificateSchemaVersion = '1.0.0';

  // 4. Assemble certified payload
  const certifiedPayload = {
    repositoryCommitSha,
    nodeVersion,
    npmVersion,
    lockfileHash,
    tsConfigHash,
    certificationConfigHash,
    mandatoryEdgeSetHash,
    canonicalizationVersion,
    certificateSchemaVersion,
    mandatoryEdgesCount: mandatoryEdges.length,
    generatedAt: options.timestamp ?? new Date().toISOString(),
  };

  // 5. Compute manifestRoot
  const manifestRoot = hashCanonicalV10(certifiedPayload);

  const manifest = {
    schemaVersion: certificateSchemaVersion,
    manifestRoot,
    certifiedPayload,
  };

  // 6. Write artifact
  if (!existsSync(ARTIFACTS_DIR)) {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const outputPath = options.outputPath ?? resolve(ARTIFACTS_DIR, 'CERTIFICATION_MANIFEST.json');
  if (options.dryRun !== true) writeFileSync(outputPath, canonicalJsonV10(manifest), 'utf8');

  console.log('[CERTIFICATION_MANIFEST] Successfully generated Certification Manifest:');
  console.log(` - File: ${options.dryRun === true ? '(dry run; not written)' : outputPath}`);
  console.log(` - Manifest Root: ${manifestRoot}`);
  console.log(` - Commit SHA: ${repositoryCommitSha}`);
  console.log(` - Mandatory Edges: ${mandatoryEdges.length} (Hash: ${mandatoryEdgeSetHash.slice(0, 16)}...)`);

  return manifest;
}

if (process.argv[1] && process.argv[1].includes('generate-certification-manifest.mjs')) {
  try {
    generateCertificationManifest();
    process.exit(0);
  } catch (err) {
    console.error('[CERTIFICATION_MANIFEST] Generation failed:', err);
    process.exit(1);
  }
}

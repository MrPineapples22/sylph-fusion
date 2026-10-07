import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCertificationManifest } from '../scripts/generate-certification-manifest.mjs';
import { hashCanonicalV10, assertDigestMatch, EMPTY_SHA256_HEX } from '../scripts/canonicalization-v10.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const MANIFEST_PATH = resolve(ROOT_DIR, 'artifacts', 'connectivity', 'CERTIFICATION_MANIFEST.json');

test('Step 2 Manifest: Generation and artifact persistence', () => {
  const manifest = generateCertificationManifest();
  assert.ok(manifest);
  assert.equal(manifest.schemaVersion, '1.0.0');
  assert.match(manifest.manifestRoot, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(MANIFEST_PATH));

  const onDisk = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(onDisk.manifestRoot, manifest.manifestRoot);
  assert.equal(onDisk.certifiedPayload.mandatoryEdgesCount, 18);
});

test('Step 2 Manifest: Deterministic reproducibility', () => {
  const fixedTimestamp = '2026-10-07T00:00:00.000Z';
  const run1 = generateCertificationManifest({ timestamp: fixedTimestamp });
  const run2 = generateCertificationManifest({ timestamp: fixedTimestamp });

  assert.equal(run1.manifestRoot, run2.manifestRoot);
  assert.equal(run1.certifiedPayload.repositoryCommitSha, run2.certifiedPayload.repositoryCommitSha);
  assert.equal(run1.certifiedPayload.mandatoryEdgeSetHash, run2.certifiedPayload.mandatoryEdgeSetHash);
});

test('Step 2 Manifest: Independent hash verification over certifiedPayload', () => {
  const manifest = generateCertificationManifest();
  const independentRoot = hashCanonicalV10(manifest.certifiedPayload);

  assert.equal(manifest.manifestRoot, independentRoot);
  assert.doesNotThrow(() => assertDigestMatch(manifest.manifestRoot, independentRoot));
  assert.notEqual(manifest.manifestRoot, EMPTY_SHA256_HEX);
});

test('Step 2 Manifest: Revision drift causes root divergence', () => {
  const fixedTimestamp = '2026-10-07T00:00:00.000Z';
  const base = generateCertificationManifest({ timestamp: fixedTimestamp });
  const drifted = generateCertificationManifest({
    timestamp: fixedTimestamp,
    repositoryCommitSha: '0000000000000000000000000000000000000000',
  });

  assert.notEqual(base.manifestRoot, drifted.manifestRoot);
});

test('Step 2 Manifest: Config drift causes root divergence', () => {
  const fixedTimestamp = '2026-10-07T00:00:00.000Z';
  const base = generateCertificationManifest({ timestamp: fixedTimestamp });
  const drifted = generateCertificationManifest({
    timestamp: fixedTimestamp,
    certificationConfigHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  });

  assert.notEqual(base.manifestRoot, drifted.manifestRoot);
});

test('Step 2 Manifest: Edge set drift causes root divergence', () => {
  const fixedTimestamp = '2026-10-07T00:00:00.000Z';
  const base = generateCertificationManifest({ timestamp: fixedTimestamp });
  const drifted = generateCertificationManifest({
    timestamp: fixedTimestamp,
    mandatoryEdgeSetHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  });

  assert.notEqual(base.manifestRoot, drifted.manifestRoot);
});

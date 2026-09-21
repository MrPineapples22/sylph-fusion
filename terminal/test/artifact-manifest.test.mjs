import test from 'node:test';
import assert from 'node:assert/strict';
import { generateArtifactManifest, sha256Hex, CURRENT_SCHEMAS, MANIFEST_SCHEMA_VERSION } from '../src/artifact-manifest-eval.js';

test('sha256Hex produces valid 64-character SHA-256 hashes matching known standard vectors', () => {
  // Known SHA-256 vectors
  const emptyHash = sha256Hex('');
  assert.strictEqual(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const testHash = sha256Hex('sylph-fusion');
  assert.strictEqual(testHash.length, 64);
  assert.match(testHash, /^[0-9a-f]{64}$/);
});

test('generateArtifactManifest compiles valid hashes, slot boundaries, and schema versions', () => {
  const session = {
    sessionDir: '2026-09-17-soak-run-001',
    startSlot: 285000100,
    endSlot: 285000500,
    startTimeMs: 1726000000000,
    endTimeMs: 1726000160000,
    rejections: { total: 4 },
  };

  const config = {
    slippage: 12,
    size: 0.1,
    tp1: 25,
    tp2: 50,
    tp3: 100,
    stop: 6,
    trailing: 6,
    maxPositions: 3,
    strategy: 'breakout',
    priority: 50000,
    tip: 0.0001,
  };

  const candidates = [
    {
      candidateId: 'cand-001',
      slot: 285000100,
      evaluationDisposition: 'cleared',
      featureSealHash: 'a'.repeat(64),
    },
    {
      candidateId: 'cand-002',
      slot: 285000150,
      evaluationDisposition: 'rejected',
      featureSealHash: 'b'.repeat(64),
    },
  ];

  const fills = [
    {
      id: 'fill-001',
      side: 'buy',
      mint: 'Mint001',
      requestedAmount: '100000000',
    },
  ];

  const manifest = generateArtifactManifest({ session, config, candidates, fills });

  assert.strictEqual(manifest.manifestSchemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.strictEqual(manifest.sessionId, '2026-09-17-soak-run-001');
  assert.deepStrictEqual(manifest.schemas, CURRENT_SCHEMAS);

  // Check cryptographic hashes
  assert.strictEqual(manifest.cryptographicHashes.policyHash.length, 64);
  assert.strictEqual(manifest.cryptographicHashes.configHash.length, 64);
  assert.strictEqual(manifest.cryptographicHashes.candidatesChecksum.length, 64);
  assert.strictEqual(manifest.cryptographicHashes.fillsChecksum.length, 64);

  // Check boundaries
  assert.strictEqual(manifest.sessionBoundaries.startSlot, 285000100);
  assert.strictEqual(manifest.sessionBoundaries.endSlot, 285000500);
  assert.strictEqual(manifest.sessionBoundaries.totalSlots, 400);
  assert.strictEqual(manifest.sessionBoundaries.durationSeconds, 160);

  // Integrity checks
  assert.strictEqual(manifest.integrityVerification.status, 'COMPUTED_UNVERIFIED');
  assert.strictEqual(manifest.integrityVerification.policyHashValid, true);
  assert.strictEqual(manifest.integrityVerification.configHashValid, true);
  assert.strictEqual(manifest.integrityVerification.slotContinuity, true);
});

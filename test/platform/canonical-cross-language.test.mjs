/**
 * SYLPH FUSION — CROSS-LANGUAGE CANONICAL VECTOR TEST (TYPESCRIPT)
 * Specifications: Blueprint Section 12 (Golden Vector Test in TypeScript)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeCanonicalV1, hashCanonicalV1 } from '../../dist/platform/pipeline/canonical-encoding-v1.js';

test('CanonicalEncodingV1 — Cross-language golden vectors parity', () => {
  const fixturePath = join(process.cwd(), 'test', 'fixtures', 'canonical-golden-v1.json');
  const raw = readFileSync(fixturePath, 'utf-8');
  const vectors = JSON.parse(raw);

  assert.ok(vectors.length > 0, 'Vectors must not be empty');

  for (const v of vectors) {
    const parsed = JSON.parse(v.rawJson);
    const bytes = encodeCanonicalV1(parsed);
    const encodedHex = bytes.toString('hex');
    const hash = hashCanonicalV1(parsed);

    assert.equal(encodedHex, v.encodedHex, `Hex mismatch for ${v.name}`);
    assert.equal(hash, v.sha256, `SHA256 mismatch for ${v.name}`);
  }
});

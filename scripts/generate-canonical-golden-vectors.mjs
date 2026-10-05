/**
 * Generates test/fixtures/canonical-golden-v1.json with diverse types:
 * null, boolean, integers, strings, arrays, maps, and nested objects.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodeCanonicalV1, hashCanonicalV1 } from '../dist/platform/pipeline/canonical-encoding-v1.js';

const testCases = [
  { name: 'null_value', value: null },
  { name: 'bool_false', value: false },
  { name: 'bool_true', value: true },
  { name: 'u64_zero', value: 0 },
  { name: 'u64_large', value: 310000000 },
  { name: 'i64_negative', value: -42 },
  { name: 'string_simple', value: 'hello_sylph' },
  { name: 'string_unicode', value: 'Solana_λ_proof_2026' },
  { name: 'array_integers', value: [1, 2, 3, 4, 5] },
  { name: 'map_simple', value: { b: 2, a: 1, c: 3 } },
  {
    name: 'nested_record',
    value: {
      actionId: 'action_001',
      cluster: 'mainnet-beta',
      slot: 310000000,
      authorized: true,
      routes: ['pump_v2', 'raydium_clmm'],
      metrics: {
        slippageBps: 25,
        feeLamports: 5000,
      },
    },
  },
];

const goldenVectors = testCases.map((tc) => {
  const bytes = encodeCanonicalV1(tc.value);
  const sha256 = hashCanonicalV1(tc.value);
  return {
    name: tc.name,
    rawJson: JSON.stringify(tc.value),
    encodedHex: bytes.toString('hex'),
    sha256,
  };
});

const outPath = join(process.cwd(), 'test', 'fixtures', 'canonical-golden-v1.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(goldenVectors, null, 2));
console.log(`Generated ${goldenVectors.length} golden vectors at ${outPath}`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const systemDrawer = readSource('../src/components/SystemIntelligenceDrawer.jsx');
const tokenInspector = readSource('../src/components/TokenIntelligenceInspector.jsx');

test('deep system intelligence requires a complete verified evidence receipt', () => {
  assert.match(systemDrawer, /hasCompleteVerifiedEvidence\(data\)/);
  assert.match(systemDrawer, /complete, current, independently verifiable system receipt has not been supplied\./i);
  assert.doesNotMatch(systemDrawer, /currentMode \|\| 'NORMAL'/);
  assert.match(systemDrawer, /currentMode \|\| 'UNKNOWN'/);
});

test('token intelligence clears changed-token state and rejects unclassified detailed claims', () => {
  assert.match(tokenInspector, /setData\(initialData\);\s*setLoading\(false\);\s*setError\(null\);/);
  assert.match(tokenInspector, /setData\(null\);\s*setLoading\(true\)/);
  assert.match(tokenInspector, /hasCompleteVerifiedEvidence\(data\)/);
  assert.match(tokenInspector, /Detailed intelligence is unavailable until a complete, current, independently verifiable evidence receipt is supplied\./);
});

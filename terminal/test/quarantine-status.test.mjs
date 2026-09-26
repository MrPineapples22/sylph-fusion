import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/design-system/primitives.jsx', import.meta.url)), 'utf8');

test('quarantined evidence is a visible caution state, never a success state', () => {
  assert.match(source, /warning = new Set\(\['DEGRADED','STALE','WARNING','QUARANTINED'\]\)/);
  assert.doesNotMatch(source, /good = new Set\([^\n]*'QUARANTINED'/);
});

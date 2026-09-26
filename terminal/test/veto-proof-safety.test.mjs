import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/components/VetoProofInspectorDrawer.jsx', import.meta.url)), 'utf8');

test('proof drawer never substitutes certification facts for missing proof fields', () => {
  assert.doesNotMatch(source, /coverageState \|\| 'COMPLETE'/);
  assert.doesNotMatch(source, /canonicality \|\| 'CANONICAL'/);
  assert.doesNotMatch(source, /evaluatedRuleIds\?\.length \|\| 4/);
  assert.doesNotMatch(source, /totalApplicableRules \|\| 4/);
  assert.doesNotMatch(source, /clusterGenesisHash \|\| '5eykt4Us/);
  assert.match(source, /coverageState \|\| 'UNKNOWN'/);
  assert.match(source, /canonicality \|\| 'UNAVAILABLE'/);
  assert.match(source, /Proof provenance unavailable/);
  assert.match(source, /setProofData\(null\);[\s\S]*setLoading\(true\)/);
  assert.match(source, /Proof evidence is unavailable from this paper terminal\. No safety conclusion is inferred\./);
});

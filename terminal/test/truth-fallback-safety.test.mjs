import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const activeOperatorSurfaces = [
  '../src/OperatorTerminal.jsx',
  '../src/components/AetherFlux.jsx',
  '../src/components/CommandCenterView.jsx',
  '../src/components/CapitalCommandView.jsx',
  '../src/components/IncidentCommandView.jsx',
  '../src/components/TokenClassification.jsx',
  '../src/components/VetoProofInspectorDrawer.jsx',
];

const optimisticFallback = /(?:\?\?|\|\|)\s*['"](?:PASS(?:ED)?|SAFE|VERIFIED|HEALTHY|CURRENT|READY|COMPLETE|ALLOWED|OPERATIONAL)['"]/i;

test('active operator surfaces never substitute a positive evidence or capability state', () => {
  for (const relativePath of activeOperatorSurfaces) {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, optimisticFallback, relativePath);
  }
});

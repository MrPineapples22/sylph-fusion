import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runtimeModuleClosure} from '../scripts/package-windows-release.mjs';
import {compareTerminalClosureToSource} from '../scripts/audit-terminal-source-connectivity.mjs';
import {hashCanonicalV10} from '../scripts/canonicalization-v10.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

function graphFor(root, ids, importedBy = {}) {
  const nodes = ids.map(id => {
    const bytes = fs.readFileSync(path.join(root, ...id.split('/')));
    return {id, sourceHash: hash(bytes), sizeBytes: bytes.length, importedBy: importedBy[id] || []};
  });
  const sourceManifest = nodes.map(({id, sourceHash, sizeBytes}) => ({relPath: id, sourceHash, sizeBytes}))
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
  return {sourceInventoryRoot: hashCanonicalV10(sourceManifest), nodes};
}

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-terminal-connectivity-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
  }
  return root;
}

test('terminal dist closure maps to current TypeScript source and corrects scoped orphan overlap', () => {
  const root = fixture({
    'terminal/server.mjs': "import '../dist/entry.js';",
    'dist/entry.js': "import './helper.js';",
    'dist/helper.js': 'export const helper = true;',
    'src/entry.ts': "import './helper.js';",
    'src/helper.ts': 'export const helper = true;',
    'src/other.ts': 'export const other = true;',
  });
  const graph = graphFor(root, ['src/entry.ts', 'src/helper.ts', 'src/other.ts'], {
    'src/helper.ts': ['src/entry.ts'],
  });
  const result = compareTerminalClosureToSource({
    root,
    closure: runtimeModuleClosure(root),
    staticGraph: graph,
    orphanRecords: [
      {file: 'src/entry.ts', sourceHash: graph.nodes.find(node => node.id === 'src/entry.ts').sourceHash},
      {file: 'src/other.ts', sourceHash: graph.nodes.find(node => node.id === 'src/other.ts').sourceHash},
    ],
  });

  assert.equal(result.terminalDistJavaScriptCount, 2);
  assert.equal(result.mappedCurrentSourceModuleCount, 2);
  assert.deepEqual(result.scopedOrphansReachableFromTerminal, ['src/entry.ts']);
  assert.deepEqual(result.unmappedDistJavaScript, []);
});

test('terminal closure audit rejects stale source hashes before reporting reachability', () => {
  const root = fixture({
    'terminal/server.mjs': "import '../dist/entry.js';",
    'dist/entry.js': 'export const entry = true;',
    'src/entry.ts': 'export const entry = true;',
  });

  assert.throws(() => compareTerminalClosureToSource({
    root,
    closure: runtimeModuleClosure(root),
    staticGraph: {sourceInventoryRoot: 'b'.repeat(64), nodes: [{id: 'src/entry.ts', sourceHash: '0'.repeat(64), sizeBytes: 25, importedBy: []}]},
    orphanRecords: [],
  }), /STATIC_GRAPH_SOURCE_DRIFT/);
});

test('terminal closure audit reports unmapped built files instead of guessing source identity', () => {
  const root = fixture({
    'terminal/server.mjs': "import '../dist/generated.js';",
    'dist/generated.js': 'export const generated = true;',
    'src/other.ts': 'export const other = true;',
  });

  const result = compareTerminalClosureToSource({
    root,
    closure: runtimeModuleClosure(root),
    staticGraph: graphFor(root, ['src/other.ts']),
    orphanRecords: [],
  });

  assert.deepEqual(result.unmappedDistJavaScript, [{distFile: 'dist/generated.js', sourceCandidates: []}]);
});

test('terminal closure audit rejects stale orphan classifications', () => {
  const root = fixture({
    'terminal/server.mjs': "import '../dist/entry.js';",
    'dist/entry.js': 'export const entry = true;',
    'src/entry.ts': 'export const entry = true;',
  });
  const staticGraph = graphFor(root, ['src/entry.ts']);

  assert.throws(() => compareTerminalClosureToSource({
    root,
    closure: runtimeModuleClosure(root),
    staticGraph,
    orphanRecords: [{file: 'src/entry.ts', sourceHash: '0'.repeat(64)}],
  }), /ORPHAN_ARTIFACT_MISMATCH/);
});

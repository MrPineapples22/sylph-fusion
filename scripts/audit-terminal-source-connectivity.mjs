import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeModuleClosure} from './package-windows-release.mjs';
import {hashCanonicalV10} from './canonicalization-v10.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'connectivity');
const normalize = value => value.replaceAll('\\', '/');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function sourcePathForDistModule(distPath) {
  const stem = distPath.replace(/^dist\//, 'src/').replace(/\.js$/, '');
  return ['.ts', '.tsx', '.mts', '.cts'].map(extension => stem + extension);
}

export function compareTerminalClosureToSource({root, closure, staticGraph, orphanRecords}) {
  if (!root || !Array.isArray(closure) || !Array.isArray(staticGraph?.nodes) || !Array.isArray(orphanRecords)) {
    throw new TypeError('Terminal connectivity inputs are malformed');
  }

  const nodes = new Map(staticGraph.nodes.map(node => [node.id, node]));
  if (nodes.size !== staticGraph.nodes.length || !/^[a-f0-9]{64}$/.test(staticGraph.sourceInventoryRoot || '')) {
    throw new Error('STATIC_GRAPH_SCHEMA_INVALID');
  }

  const sourceDrift = [];
  for (const node of nodes.values()) {
    if (typeof node.id !== 'string' || normalize(node.id) !== node.id || !node.id.startsWith('src/') || node.id.split('/').some(part => !part || part === '.' || part === '..') ||
        !Number.isSafeInteger(node.sizeBytes) || !/^[a-f0-9]{64}$/.test(node.sourceHash || '') || !Array.isArray(node.importedBy)) {
      throw new Error('STATIC_GRAPH_NODE_INVALID');
    }
    const sourceFile = path.join(root, ...node.id.split('/'));
    if (!fs.existsSync(sourceFile) || sha256(fs.readFileSync(sourceFile)) !== node.sourceHash) sourceDrift.push(node.id);
  }
  if (sourceDrift.length) throw new Error(`STATIC_GRAPH_SOURCE_DRIFT:${sourceDrift.slice(0, 8).join(',')}`);

  const sourceManifest = [...nodes.values()]
    .map(node => ({relPath: node.id, sourceHash: node.sourceHash, sizeBytes: node.sizeBytes}))
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
  if (hashCanonicalV10(sourceManifest) !== staticGraph.sourceInventoryRoot) {
    throw new Error('STATIC_GRAPH_INVENTORY_ROOT_MISMATCH');
  }

  const normalizedClosure = [...new Set(closure.map(normalize))].sort();
  const distJavaScript = normalizedClosure.filter(file => file.startsWith('dist/') && file.endsWith('.js'));
  const mapped = [];
  const unmapped = [];
  for (const distFile of distJavaScript) {
    const candidates = sourcePathForDistModule(distFile).filter(candidate => nodes.has(candidate));
    if (candidates.length !== 1) {
      unmapped.push({distFile, sourceCandidates: candidates});
      continue;
    }
    mapped.push({distFile, sourceFile: candidates[0]});
  }

  const orphanSet = new Set();
  for (const record of orphanRecords) {
    const node = nodes.get(record.file);
    if (!node || node.importedBy.length !== 0 || record.sourceHash !== node.sourceHash || orphanSet.has(record.file)) {
      throw new Error(`ORPHAN_ARTIFACT_MISMATCH:${record.file || 'UNKNOWN'}`);
    }
    orphanSet.add(record.file);
  }
  const terminalReachableOrphans = mapped
    .map(entry => entry.sourceFile)
    .filter(sourceFile => orphanSet.has(sourceFile))
    .sort();

  return {
    schemaVersion: 1,
    scope: 'Static package import closure from terminal/server.mjs, mapped through dist JavaScript to hash-verified TypeScript source. This is import reachability, not a live request or execution-path claim.',
    sourceInventoryRoot: staticGraph.sourceInventoryRoot,
    graphModuleCount: nodes.size,
    terminalClosureFileCount: normalizedClosure.length,
    terminalDistJavaScriptCount: distJavaScript.length,
    mappedCurrentSourceModuleCount: mapped.length,
    unmappedDistJavaScript: unmapped,
    scopedOrphanCount: orphanSet.size,
    scopedOrphansReachableFromTerminal: terminalReachableOrphans,
    scopedOrphanReachableCount: terminalReachableOrphans.length,
    examples: terminalReachableOrphans.slice(0, 20),
  };
}

export function auditTerminalSourceConnectivity(root = ROOT, artifactDir = ARTIFACT_DIR) {
  const staticGraph = JSON.parse(fs.readFileSync(path.join(artifactDir, 'static-graph.json'), 'utf8'));
  const orphanRecords = JSON.parse(fs.readFileSync(path.join(artifactDir, 'orphan-modules.json'), 'utf8'));
  const closure = runtimeModuleClosure(root, 'terminal/server.mjs');
  return compareTerminalClosureToSource({root, closure, staticGraph, orphanRecords});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditTerminalSourceConnectivity();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.unmappedDistJavaScript.length) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

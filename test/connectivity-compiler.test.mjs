import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConnectivityCompiler } from '../scripts/connectivity-compiler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT_DIR, 'artifacts', 'connectivity');

test('Step 1 Static Compiler: Complete execution and artifact generation', () => {
  const result = runConnectivityCompiler();
  assert.equal(result.success, true);
  assert.ok(result.modulesAudited > 0);
  assert.ok(result.nodesCount > 0);
  assert.ok(result.edgesCount > 0);
  assert.equal(result.highestProvenLevel, 'C1');

  const requiredArtifacts = [
    'intelligence-classification.json',
    'intelligence-classification.csv',
    'static-graph.json',
    'authority-graph.json',
    'evidence-graph.json',
    'authority-collisions.json',
    'synthetic-evidence-findings.json',
    'orphan-modules.json',
    'c0-c10-scorecard.json',
    'SYSTEM_CONNECTIVITY_AUDIT.md',
  ];

  for (const artifact of requiredArtifacts) {
    const fullPath = resolve(ARTIFACTS_DIR, artifact);
    assert.ok(existsSync(fullPath), `Artifact missing: ${artifact}`);
  }
});

test('Step 1 Static Compiler: Enforce strict C4 ceiling law', () => {
  const scorecardPath = resolve(ARTIFACTS_DIR, 'c0-c10-scorecard.json');
  const scorecard = JSON.parse(readFileSync(scorecardPath, 'utf8'));

  assert.equal(scorecard.metadata.enforcedCeiling, 'C4');
  assert.match(scorecard.metadata.ceilingReason, /STATIC_ANALYSIS_CEILING/);
  assert.equal(scorecard.systemScore.highestProvenLevel, 'C1');
  assert.equal(scorecard.systemScore.C1_compiles, true);
  assert.equal(scorecard.systemScore.C2_unit_tested, false, 'test-file references are not evidence that tests passed');
  assert.equal(scorecard.systemScore.C3_declared_connection, false, 'C3 is sequentially gated on demonstrated C2');
  assert.equal(scorecard.systemScore.C4_static_integration, false);
  assert.equal(scorecard.systemScore.C5_observed_runtime, false);
  assert.equal(scorecard.systemScore.C6_cryptographic_continuity, false);
  assert.equal(scorecard.systemScore.C7_authoritative_effect, false);
  assert.equal(scorecard.systemScore.C8_deterministic_replay, false);
  assert.equal(scorecard.systemScore.C9_fault_containment, false);
  assert.equal(scorecard.systemScore.C10_real_canary, false);

  for (const [mod, scores] of Object.entries(scorecard.modules)) {
    assert.equal(scores.C5_observed_runtime, false, `Module ${mod} illegally claimed C5`);
    assert.equal(scores.C6_cryptographic_continuity, false, `Module ${mod} illegally claimed C6`);
    assert.equal(scores.C7_authoritative_effect, false, `Module ${mod} illegally claimed C7`);
    assert.equal(scores.C8_deterministic_replay, false, `Module ${mod} illegally claimed C8`);
    assert.equal(scores.C9_fault_containment, false, `Module ${mod} illegally claimed C9`);
    assert.equal(scores.C10_real_canary, false, `Module ${mod} illegally claimed C10`);
    assert.ok(['C0', 'C1', 'C2', 'C3', 'C4'].includes(scores.highestProvenLevel), `Module ${mod} exceeded C4`);
    assert.equal(scores.C2_unit_tested, false);
    assert.equal(scores.C4_static_integration, false);
  }
});

test('Step 1 Static Compiler: Validate Section 6 classification taxonomy', () => {
  const classPath = resolve(ARTIFACTS_DIR, 'intelligence-classification.json');
  const classifications = JSON.parse(readFileSync(classPath, 'utf8'));

  const validTaxonomies = new Set([
    'ECONOMIC_AUTHORITATIVE',
    'ECONOMIC_ADVISORY',
    'SHADOW',
    'RESEARCH',
    'OBSERVABILITY',
    'UI_ONLY',
    'TEST_ONLY',
    'LEGACY',
    'ORPHAN',
  ]);

  for (const item of classifications) {
    assert.ok(validTaxonomies.has(item.classification), `Invalid taxonomy: ${item.classification}`);
    assert.equal(item.maxCeiling, 'C4');
    assert.match(item.sourceHash, /^[0-9a-f]{64}$/);
    assert.ok(item.sizeBytes > 0);
  }
});

test('Step 1 Static Compiler: Validate machine-readable authorityRequirements', () => {
  const authPath = resolve(ARTIFACTS_DIR, 'authority-graph.json');
  const authGraph = JSON.parse(readFileSync(authPath, 'utf8'));

  assert.ok(authGraph.authorityRequirements);
  assert.equal(authGraph.authorityRequirements.canonicalStateWriter, 'FusionReducer');
  assert.equal(authGraph.authorityRequirements.economicStateWriter, 'EconomicAuthorityStore');
  assert.equal(authGraph.authorityRequirements.decisionIssuer, 'UnifiedDecisionEngine');
  assert.equal(authGraph.authorityRequirements.terminalityIssuer, 'TerminalityAuthority');
  assert.equal(authGraph.authorityRequirements.requiredForSystemCertification, true);
  assert.equal(authGraph.authorityRequirements.requiredConnectivityLevel, 'C10');
});

test('Step 1 Static Compiler: Evidence graph contains only observed imports and reports disconnected authority paths', () => {
  const graph = JSON.parse(readFileSync(resolve(ARTIFACTS_DIR, 'static-graph.json'), 'utf8'));
  const evidence = JSON.parse(readFileSync(resolve(ARTIFACTS_DIR, 'evidence-graph.json'), 'utf8'));
  const scorecard = JSON.parse(readFileSync(resolve(ARTIFACTS_DIR, 'c0-c10-scorecard.json'), 'utf8'));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  assert.equal(evidence.configuredEvidenceSpine, false);
  assert.equal('canonicalSpineEdges' in evidence, false);
  assert.equal(evidence.staticEvidenceLinksCount, graph.edgesCount);
  assert.match(graph.sourceInventoryRoot, /^[0-9a-f]{64}$/);
  assert.equal(scorecard.metadata.sourceInventoryRoot, graph.sourceInventoryRoot);
  for (const edge of evidence.observedStaticImportEdges) {
    assert.equal(nodeIds.has(edge.from), true, `missing source node ${edge.from}`);
    assert.equal(nodeIds.has(edge.to), true, `missing target node ${edge.to}`);
  }

  const reachability = scorecard.systemScore.authorityReachability;
  assert.equal(reachability.canonicalStateWriter.reachable, true);
  assert.equal(reachability.economicStateWriter.reachable, false);
  assert.equal(reachability.decisionIssuer.reachable, false);
  assert.equal(reachability.terminalityIssuer.reachable, false);
});

test('Step 1 Static Compiler: Negative test against unauthorized authority claimants', () => {
  const collisionsPath = resolve(ARTIFACTS_DIR, 'authority-collisions.json');
  const collisions = JSON.parse(readFileSync(collisionsPath, 'utf8'));

  // Collisions must be zero in the validated repo
  assert.deepEqual(collisions, []);
});

test('Step 1 Static Compiler: Known system entry points must never be classified as ORPHAN', () => {
  const orphansPath = resolve(ARTIFACTS_DIR, 'orphan-modules.json');
  const orphans = JSON.parse(readFileSync(orphansPath, 'utf8'));
  const orphanFiles = new Set(orphans.map((o) => o.file));

  const entryPoints = [
    'src/fusion.ts',
    'src/app.ts',
    'src/db-worker.ts',
    'src/rpc.ts',
    'src/config.ts',
  ];

  for (const ep of entryPoints) {
    assert.equal(orphanFiles.has(ep), false, `Entry point ${ep} falsely marked as ORPHAN`);
  }
});

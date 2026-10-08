import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStaticConnectivity, findDirectedPath} from '../scripts/connectivity-static-core.mjs';

const edges = [
  {from: 'entry', to: 'reducer'},
  {from: 'reducer', to: 'economy'},
  {from: 'economy', to: 'terminality'},
];
const authorities = [
  {authority: 'canonicalStateWriter', module: 'reducer'},
  {authority: 'economicStateWriter', module: 'economy'},
  {authority: 'terminalityIssuer', module: 'terminality'},
];

test('static connectivity finds directed paths and rejects a disconnected authority', () => {
  assert.deepEqual(findDirectedPath(edges, 'entry', 'terminality'), {
    reachable: true,
    path: ['entry', 'reducer', 'economy', 'terminality'],
  });
  assert.deepEqual(findDirectedPath(edges, 'terminality', 'entry'), {reachable: false, path: []});
  const result = evaluateStaticConnectivity({
    sourceCount: 4,
    compileDiagnostics: 0,
    testRunPassed: { verified: true, status: 'PASS' },
    declaredEdges: edges,
    entryPoint: 'entry',
    requiredAuthorityModules: [...authorities, {authority: 'decisionIssuer', module: 'missing'}],
  });
  assert.equal(result.C4_static_integration, false);
  assert.equal(result.highestProvenLevel, 'C3');
  assert.equal(result.C5_observed_runtime, false);
});

test('imports and test references cannot bypass sequential C1/C2 gates', () => {
  const result = evaluateStaticConnectivity({
    sourceCount: 4,
    compileDiagnostics: 1,
    testRunPassed: { verified: true, status: 'PASS' },
    declaredEdges: edges,
    entryPoint: 'entry',
    requiredAuthorityModules: authorities,
  });
  assert.equal(result.C1_compiles, false);
  assert.equal(result.C2_unit_tested, false);
  assert.equal(result.C3_declared_connection, false);
  assert.equal(result.C4_static_integration, false);
  assert.equal(result.highestProvenLevel, 'C0');
});

test('static compiler never awards C2 from test references without a passing test-run record', () => {
  const result = evaluateStaticConnectivity({
    sourceCount: 4,
    compileDiagnostics: 0,
    declaredEdges: edges,
    entryPoint: 'entry',
    requiredAuthorityModules: authorities,
  });
  assert.equal(result.C1_compiles, true);
  assert.equal(result.C2_unit_tested, false);
  assert.equal(result.C3_staticEdgesObserved, true);
  assert.equal(result.C3_declared_connection, false);
  assert.equal(result.C4_static_integration, false);
  assert.equal(result.C10_real_canary, false);
});

test('a required but missing authority cannot disappear from the C4 denominator', () => {
  const score = evaluateStaticConnectivity({
    sourceCount: 2,
    compileDiagnostics: 0,
    testRunPassed: { verified: true, status: 'PASS' },
    declaredEdges: [{from: 'entry', to: 'present'}],
    entryPoint: 'entry',
    requiredAuthorityModules: [
      {authority: 'presentAuthority', module: 'present'},
      {authority: 'missingAuthority', module: null},
    ],
  });

  assert.equal(score.authorityReachability.presentAuthority.reachable, true);
  assert.equal(score.authorityReachability.missingAuthority.reachable, false);
  assert.equal(score.C4_static_integration, false);
});

test('static ceiling is C4 even when the directed graph and all prerequisites pass', () => {
  const result = evaluateStaticConnectivity({
    sourceCount: 4,
    compileDiagnostics: 0,
    testRunPassed: { verified: true, status: 'PASS' },
    declaredEdges: edges,
    entryPoint: 'entry',
    requiredAuthorityModules: authorities,
  });
  assert.equal(result.highestProvenLevel, 'C4');
  assert.equal(result.C4_static_integration, true);
  for (const key of ['C5_observed_runtime', 'C6_cryptographic_continuity', 'C7_authoritative_effect', 'C8_deterministic_replay', 'C9_fault_containment', 'C10_real_canary']) {
    assert.equal(result[key], false, `${key} must remain unproven by static analysis`);
  }
});

test('a legacy boolean assertion cannot substitute for a verified receipt', () => {
  const result = evaluateStaticConnectivity({
    sourceCount: 4,
    compileDiagnostics: 0,
    testRunPassed: true,
    declaredEdges: edges,
    entryPoint: 'entry',
    requiredAuthorityModules: authorities,
  });
  assert.equal(result.C2_unit_tested, false);
  assert.equal(result.highestProvenLevel, 'C1');
});

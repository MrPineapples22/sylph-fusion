/**
 * Pure helpers for the static connectivity compiler. Static evidence is
 * intentionally unable to award C5–C10.
 */

export function findDirectedPath(edges, from, to) {
  if (from === to) return {reachable: true, path: [from]};
  const adjacency = new Map();
  for (const edge of edges) {
    if (typeof edge?.from !== 'string' || typeof edge?.to !== 'string') continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const queue = [[from]];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    for (const target of adjacency.get(path.at(-1)) ?? []) {
      if (visited.has(target)) continue;
      const next = [...path, target];
      if (target === to) return {reachable: true, path: next};
      visited.add(target);
      queue.push(next);
    }
  }
  return {reachable: false, path: []};
}

export function evaluateStaticConnectivity({
  sourceCount,
  compileDiagnostics,
  testRunPassed = false,
  declaredEdges,
  entryPoint,
  requiredAuthorityModules,
}) {
  const c0 = Number.isSafeInteger(sourceCount) && sourceCount > 0;
  const c1 = c0 && Number.isSafeInteger(compileDiagnostics) && compileDiagnostics === 0;
  // The caller must provide the result of receipt verification, never a CLI
  // assertion. A test reference is not a test result.
  const c2 = c1 && testRunPassed?.verified === true && testRunPassed?.status === 'PASS';
  const c3Observed = Array.isArray(declaredEdges) && declaredEdges.length > 0;
  const c3 = c2 && c3Observed;
  const authorityReachability = Object.fromEntries(
    (requiredAuthorityModules ?? []).map(({authority, module}) => [
      authority,
      {...findDirectedPath(declaredEdges ?? [], entryPoint, module), module},
    ]),
  );
  const allRequiredAuthoritiesReachable = Object.keys(authorityReachability).length > 0 &&
    Object.values(authorityReachability).every((item) => item.reachable);
  const c4 = c3 && allRequiredAuthoritiesReachable;

  let highestProvenLevel = 'NONE';
  if (c0) highestProvenLevel = 'C0';
  if (c1) highestProvenLevel = 'C1';
  if (c2) highestProvenLevel = 'C2';
  if (c3) highestProvenLevel = 'C3';
  if (c4) highestProvenLevel = 'C4';

  return {
    C0_exists: c0,
    C1_compiles: c1,
    C2_unit_tested: c2,
    C3_declared_connection: c3,
    C3_staticEdgesObserved: c3Observed,
    C4_static_integration: c4,
    C5_observed_runtime: false,
    C6_cryptographic_continuity: false,
    C7_authoritative_effect: false,
    C8_deterministic_replay: false,
    C9_fault_containment: false,
    C10_real_canary: false,
    authorityReachability,
    highestProvenLevel,
    ceilingEnforced: 'C4',
    reasons: {
      C2: c2 ? 'PASSING_SOURCE_BOUND_TEST_RECEIPT_VERIFIED' : 'UNPROVEN: no valid source-bound test receipt verified',
      C3: c3 ? 'PASS: C2 passed and static source connections exist' : c3Observed ? 'UNPROVEN: source connections exist, but sequential C2 gate is unproven' : 'UNPROVEN: no static source connections found',
      C4: c4 ? 'PASS: required authority modules are reachable from the configured entry point' : 'UNPROVEN: C4 requires C3 plus directed static reachability to every required authority module',
      C5_C10: 'UNPROVEN: static evidence cannot award runtime, continuity, effect, replay, fault, or canary levels',
    },
  };
}

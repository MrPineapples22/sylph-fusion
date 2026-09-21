import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSoakSessions } from '../soak-reader.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = fileURLToPath(new URL('../../', import.meta.url));
const sessionsDir = resolve(project, 'sessions');

test('compareSoakSessions compares two real soak sessions side by side', async () => {
  const sessionA = 'soak-2026-09-16T23-13-54-634Z';
  const sessionB = 'soak-2026-09-16T23-14-19-074Z';

  const comparison = await compareSoakSessions(sessionsDir, sessionA, sessionB);

  assert.ok(comparison);
  assert.equal(comparison.sessionA.name, sessionA);
  assert.equal(comparison.sessionB.name, sessionB);

  assert.ok(typeof comparison.summaryDeltas.scoreDelta === 'number');
  assert.ok(typeof comparison.summaryDeltas.rpcDropRateDelta === 'number');
  assert.ok(typeof comparison.summaryDeltas.rpcDropsDelta === 'number');

  // Verify all 7 funnel gates are represented in comparison
  assert.equal(comparison.funnelComparison.length, 7);
  const gateIds = comparison.funnelComparison.map(g => g.gate);
  assert.deepEqual(gateIds, ['discovered', 'aged', 'buyerThreshold', 'safetyPassed', 'driftPassed', 'eligible', 'paperFilled']);

  // Verify rejection taxonomy shift is calculated
  assert.ok(Array.isArray(comparison.rejectionDiff));
  if (comparison.rejectionDiff.length > 0) {
    const first = comparison.rejectionDiff[0];
    assert.ok(first.reason);
    assert.ok(typeof first.countA === 'number');
    assert.ok(typeof first.countB === 'number');
    assert.ok(typeof first.deltaCount === 'number');
  }
});

test('compareSoakSessions returns null if sessions directory does not exist or has invalid sessions', async () => {
  const comparison = await compareSoakSessions('/non/existent/path', 'invalid-a', 'invalid-b');
  assert.equal(comparison, null);
});

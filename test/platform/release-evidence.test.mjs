import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseCertificationAuthority } from '../../dist/platform/certification/release-certification.js';

test('reading certification cannot manufacture passes, build identity or evaluation times', () => {
  const authority = ReleaseCertificationAuthority.getInstance();
  const first = authority.getReport(1000);
  const later = authority.getReport(2000);
  assert.equal(first.passedGatesCount, 0);
  assert.equal(first.candidateVersion, 'UNVERIFIED_BUILD');
  assert.equal(first.isProductionPermitted, false);
  assert.equal(authority.isProductionReleasePermitted(), false);
  assert.deepEqual(first.gates, later.gates);
  for (const gate of Object.values(first.gates)) {
    assert.notEqual(gate.state, 'PASSED');
    assert.equal(gate.evaluatedAt, null);
    assert.ok(gate.blockers.length > 0);
  }
  // Mutating a returned projection must not grant authority on a future read.
  first.gates.executionGate.state = 'PASSED';
  assert.equal(authority.getReport().gates.executionGate.state, 'NOT_EVALUATED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmarkSuite } from '../../src/verification/benchmarks.ts';

test('Benchmarks: Canonical 9/6 strategy benchmark cases', () => {
  const result = runBenchmarkSuite();
  assert.equal(result.passed, result.total, `Only ${result.passed}/${result.total} benchmarks passed`);
});

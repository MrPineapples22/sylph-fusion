import test from 'node:test';
import assert from 'node:assert/strict';
import { runMutationTestSuite } from '../../src/verification/mutation.ts';

test('Mutation: Verification suite kills 100% of injected synthetic defects', () => {
  const result = runMutationTestSuite();
  assert.equal(result.killedMutants, result.totalMutants, `Killed ${result.killedMutants}/${result.totalMutants} mutants`);
});

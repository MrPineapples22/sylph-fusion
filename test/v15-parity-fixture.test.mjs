import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFixture, compareDeltas } from '../scripts/v15/validate-parity-fixture.mjs';

test('reject missing historical provenance', () => {
  assert.ok(validateFixture({ slot: 1 }).length > 0);
});
test('exact lamport reconciliation uses bigint', () => {
  const actual = [{ address: 'A', lamportsDelta: '9007199254740994' }];
  const expected = [{ address: 'A', lamportsDelta: '9007199254740993' }];
  assert.deepEqual(compareDeltas(expected, actual), [{ address: 'A', expected: '9007199254740993', actual: '9007199254740994' }]);
});
test('reconciliation ignores account ordering', () => {
  const x = [{ address: 'A', lamportsDelta: '1' }, { address: 'B', lamportsDelta: '-1' }];
  assert.deepEqual(compareDeltas(x, [...x].reverse()), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRunReceipt, collectSourceInventory, verifyTestRunReceipt, CERTIFIED_TEST_COMMAND } from '../scripts/test-run-receipt.mjs';

test('test receipt binds current source, configuration, runtime, exact command and output', () => {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const completedAt = new Date().toISOString();
  const receipt = createTestRunReceipt({
    command: CERTIFIED_TEST_COMMAND,
    exitCode: 0,
    output: 'ℹ tests 2316\nℹ fail 0\n',
    startedAt,
    completedAt,
  });
  const { sourceInventoryRoot } = collectSourceInventory();
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.sourceInventoryRoot, sourceInventoryRoot);
  assert.equal(receipt.runtime.node, process.version);
  assert.match(receipt.runtime.npm, /^\d+\.\d+\.\d+/);
  assert.equal(verifyTestRunReceipt(receipt, sourceInventoryRoot).verified, true);
});

test('test receipt rejects nonzero runs, altered output digest, forged receipt hash and wrong source root', () => {
  const input = {
    command: CERTIFIED_TEST_COMMAND,
    output: 'test output',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const failed = createTestRunReceipt({ ...input, exitCode: 1 });
  assert.equal(failed.status, 'FAIL');
  const { sourceInventoryRoot } = collectSourceInventory();
  assert.equal(verifyTestRunReceipt(failed, sourceInventoryRoot).verified, false);

  const passing = createTestRunReceipt({ ...input, exitCode: 0 });
  assert.equal(verifyTestRunReceipt({ ...passing, outputSha256: '0'.repeat(64) }, sourceInventoryRoot).verified, false);
  assert.equal(verifyTestRunReceipt({ ...passing, receiptHash: '0'.repeat(64) }, sourceInventoryRoot).verified, false);
  assert.equal(verifyTestRunReceipt(passing, 'f'.repeat(64)).verified, false);
  assert.equal(verifyTestRunReceipt({ ...passing, runtime: { ...passing.runtime, platform: 'other' } }, passing.sourceInventoryRoot).verified, false);
  assert.equal(verifyTestRunReceipt({ ...passing, completedAt: 'invalid-time' }, passing.sourceInventoryRoot).verified, false);
  assert.throws(() => createTestRunReceipt({ ...input, command: 'node --test', exitCode: 0 }), /TEST_RECEIPT_INVALID_RUN_INPUT/);
});

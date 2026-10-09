import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRunReceipt, collectSourceInventory, collectTestConfigurationIdentity, verifyTestRunReceipt, CERTIFIED_TEST_COMMAND } from '../scripts/test-run-receipt.mjs';
import { hashCanonicalV10 } from '../scripts/canonicalization-v10.mjs';

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
  const config = collectTestConfigurationIdentity();
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.sourceInventoryRoot, sourceInventoryRoot);
  assert.equal(receipt.runtime.node, process.version);
  assert.match(receipt.runtime.npm, /^\d+\.\d+\.\d+/);
  assert.equal(receipt.runtime.pnpm, config.packageManager.slice('pnpm@'.length));
  assert.equal(receipt.pnpmLockHash, config.pnpmLockHash);
  assert.equal(receipt.pnpmWorkspaceHash, config.pnpmWorkspaceHash);
  assert.equal(verifyTestRunReceipt(receipt, sourceInventoryRoot).verified, true);
  assert.equal(verifyTestRunReceipt(receipt, sourceInventoryRoot).dependencyInstallationVerified, false);
  assert.equal(verifyTestRunReceipt(receipt, sourceInventoryRoot).issuerAuthenticated, false);
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
  const oldSchema = { ...passing, schemaVersion: 1 };
  oldSchema.receiptHash = hashCanonicalV10(Object.fromEntries(Object.entries(oldSchema).filter(([key]) => key !== 'receiptHash')));
  assert.equal(verifyTestRunReceipt(oldSchema, passing.sourceInventoryRoot).verified, false);
  const forgedLock = { ...passing, pnpmLockHash: '0'.repeat(64) };
  forgedLock.receiptHash = hashCanonicalV10(Object.fromEntries(Object.entries(forgedLock).filter(([key]) => key !== 'receiptHash')));
  assert.equal(verifyTestRunReceipt(forgedLock, passing.sourceInventoryRoot).verified, false);
  const wrongManager = { ...passing, runtime: { ...passing.runtime, pnpm: '12.0.0' } };
  wrongManager.receiptHash = hashCanonicalV10(Object.fromEntries(Object.entries(wrongManager).filter(([key]) => key !== 'receiptHash')));
  assert.equal(verifyTestRunReceipt(wrongManager, passing.sourceInventoryRoot).verified, false);
  const extraTopLevel = { ...passing, unauditedClaim: true };
  extraTopLevel.receiptHash = hashCanonicalV10(Object.fromEntries(Object.entries(extraTopLevel).filter(([key]) => key !== 'receiptHash')));
  assert.equal(verifyTestRunReceipt(extraTopLevel, passing.sourceInventoryRoot).verified, false);
  const extraRuntime = { ...passing, runtime: { ...passing.runtime, pnpmArguments: ['--frozen-lockfile'] } };
  extraRuntime.receiptHash = hashCanonicalV10(Object.fromEntries(Object.entries(extraRuntime).filter(([key]) => key !== 'receiptHash')));
  assert.equal(verifyTestRunReceipt(extraRuntime, passing.sourceInventoryRoot).verified, false);
  assert.equal(verifyTestRunReceipt({ ...passing, completedAt: 'invalid-time' }, passing.sourceInventoryRoot).verified, false);
  assert.throws(() => createTestRunReceipt({ ...input, command: 'node --test', exitCode: 0 }), /TEST_RECEIPT_INVALID_RUN_INPUT/);
  for (const field of ['pnpmLockHash', 'pnpmWorkspaceHash', 'terminalPackageLockHash', 'terminalPackageJsonHash', 'packageLockHash', 'packageJsonHash']) {
    const altered = { ...passing, [field]: '0'.repeat(64) };
    const { receiptHash, ...payload } = altered;
    altered.receiptHash = hashCanonicalV10(payload);
    assert.equal(verifyTestRunReceipt(altered, passing.sourceInventoryRoot).verified, false, field);
  }
  for (const mutation of [r => { delete r.pnpmWorkspaceHash; }, r => { delete r.runtime.pnpm; },
    r => { r.runtime.pnpm = 'UNAVAILABLE'; }, r => { r.packageManager = 'pnpm@12.0.0'; r.runtime.pnpm = '12.0.0'; }]) {
    const altered = structuredClone(passing); mutation(altered);
    const { receiptHash, ...payload } = altered; altered.receiptHash = hashCanonicalV10(payload);
    assert.equal(verifyTestRunReceipt(altered, passing.sourceInventoryRoot).verified, false);
  }
  const sourceSnapshot = collectSourceInventory(); const configurationSnapshot = collectTestConfigurationIdentity();
  for (const field of ['pnpmLockHash', 'pnpmWorkspaceHash', 'terminalPackageLockHash', 'packageManager']) {
    assert.throws(() => createTestRunReceipt({ ...input, exitCode: 0, sourceSnapshot,
      configurationSnapshot: { ...configurationSnapshot, [field]: 'changed-during-run' } }), /SOURCE_CHANGED_DURING_RUN/);
  }
});

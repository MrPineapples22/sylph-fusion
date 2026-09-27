import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditRootAuthority } from '../../dist/platform/recovery/audit-root.js';

test('AuditRootAuthority: appends events and maintains valid cryptographic hash chain', () => {
  const audit = new AuditRootAuthority();

  const r1 = audit.appendEvent('ECONOMIC_INTENT_CREATED', { intentId: 'intent-1', amount: 500000 });
  const r2 = audit.appendEvent('CAPITAL_RESERVED', { intentId: 'intent-1', lamports: 500000 });
  const r3 = audit.appendEvent('TRANSACTION_SIMULATED', { intentId: 'intent-1', cuLimit: 200000 });

  assert.equal(audit.getChainLength(), 3);
  assert.equal(r1.sequenceNumber, 1);
  assert.equal(r2.sequenceNumber, 2);
  assert.equal(r3.sequenceNumber, 3);

  // Link integrity
  assert.equal(r2.prevHash, r1.recordHash);
  assert.equal(r3.prevHash, r2.recordHash);

  const check = audit.verifyChainIntegrity();
  assert.equal(check.isChainValid, true);
  assert.equal(check.totalRecords, 3);
});

test('AuditRootAuthority: detects tampering if past audit record is modified (Section 69)', () => {
  const audit = new AuditRootAuthority();

  audit.appendEvent('EVENT_A', { value: 100 });
  const r2 = audit.appendEvent('EVENT_B', { value: 200 });
  audit.appendEvent('EVENT_C', { value: 300 });

  assert.equal(audit.verifyChainIntegrity().isChainValid, true);

  // Malicious tampering: change payload in record 2 without recomputing hash
  Object.assign(r2, { payload: { value: 999999 } });

  const check = audit.verifyChainIntegrity();
  assert.equal(check.isChainValid, false);
  assert.equal(check.brokenSequenceNumber, 2);
  assert.match(check.reason, /Tampering detected at sequence 2/);
});

test('AuditRootAuthority: generates verifiable Merkle checkpoint', () => {
  const audit = new AuditRootAuthority();

  for (let i = 1; i <= 4; i++) {
    audit.appendEvent('LOG_ENTRY', { index: i, detail: `Step ${i}` });
  }

  const checkpoint = audit.generateCheckpoint('audit-signer-prod');
  assert.ok(checkpoint.checkpointId.startsWith('CHKPT-'));
  assert.equal(checkpoint.startSequence, 1);
  assert.equal(checkpoint.endSequence, 4);
  assert.equal(checkpoint.recordCount, 4);
  assert.ok(checkpoint.merkleRoot.length === 64);
  assert.ok(checkpoint.signerAttestation.length === 64);
});

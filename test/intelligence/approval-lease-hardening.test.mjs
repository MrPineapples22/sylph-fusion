import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalLeaseEngine } from '../../dist/intelligence/policies/approval-lease.js';

test('a 3/3 lease establishes APPROVED, not execution readiness', () => {
  const engine = new ApprovalLeaseEngine();
  engine.issueLease({ mint: 'MintLease111', proofState: '3/3', ttlMs: 1000 });
  assert.equal(engine.getApprovalState('MintLease111'), 'APPROVED');
  assert.equal(engine.transitionState('MintLease111', 'EXECUTION_READY', 'independent readiness check'), 'EXECUTION_READY');
});

test('lease issuance rejects unsafe state and malformed TTL', () => {
  const engine = new ApprovalLeaseEngine();
  engine.transitionState('MintLeaseBlocked', 'QUARANTINED', 'safety event');
  assert.throws(() => engine.issueLease({ mint: 'MintLeaseBlocked', proofState: '3/3' }), /Cannot issue a lease/);
  assert.throws(() => engine.issueLease({ mint: 'MintLeaseBadTtl', proofState: '3/3', ttlMs: Number.NaN }), /finite and positive/);
  assert.throws(() => engine.transitionState('MintNoLease', 'EXECUTION_READY', 'bypass'), /requires an active 3\/3 lease/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {TransactionLifetimeAuthority} from '../../dist/platform/execution/transaction-lifetime.js';

const policy = {minimumBlocksForSigning: 20, minimumBlocksForSubmission: 4};
const assess = height => TransactionLifetimeAuthority.assess('blockhash-1', 100, 1_000, 200, height, policy);

test('transaction lifetime distinguishes fresh, aging, near-expiry, and expired payloads', () => {
  assert.equal(assess(170).state, 'FRESH');
  assert.equal(assess(185).state, 'AGING');
  assert.equal(assess(197).state, 'NEAR_EXPIRY');
  assert.equal(assess(201).state, 'EXPIRED');
});

test('new signing requires a larger block-height buffer than submission', () => {
  const aging = assess(185);
  assert.equal(TransactionLifetimeAuthority.authorizeSigning(aging, policy).allowed, false);
  assert.equal(TransactionLifetimeAuthority.authorizeSigning(aging, policy).reason, 'BLOCKHASH_INSUFFICIENT_FOR_SIGNING');
  assert.equal(TransactionLifetimeAuthority.authorizeSubmission(aging, policy).allowed, true);
});

test('unknown, near-expiry, and expired lifetimes are fail-closed for submission', () => {
  const unknown = TransactionLifetimeAuthority.assess('', 100, 1_000, 200, 190, policy);
  assert.equal(unknown.state, 'UNKNOWN');
  assert.equal(TransactionLifetimeAuthority.authorizeSubmission(unknown, policy).allowed, false);
  assert.equal(TransactionLifetimeAuthority.authorizeSubmission(assess(197), policy).reason, 'BLOCKHASH_NEAR_EXPIRY');
  assert.equal(TransactionLifetimeAuthority.authorizeSubmission(assess(201), policy).reason, 'BLOCKHASH_EXPIRED');
});

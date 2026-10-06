import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { SubscribeUpdateBlock } from '@triton-one/yellowstone-grpc';
import { BlockMembershipCorrelator } from '../../dist/platform/ingestion/block-membership-correlator.js';

const b58 = (length, fill) => bs58.encode(Buffer.alloc(length, fill));
const signature = n => b58(64, n);
const blockhash = n => b58(32, n);
const digest = value => createHash('sha256').update(value).digest('hex');
const transaction = (overrides = {}) => ({
  observationId: 'tx-observation-1', providerId: 'geyser-a', slot: 42,
  signature: signature(1), commitment: 'confirmed', observedAtMs: 100,
  rawPayloadHash: digest('tx'), ...overrides,
});
const block = (overrides = {}) => ({
  observationId: 'block-observation-1', providerId: 'geyser-a', slot: 42,
  blockhash: blockhash(2), commitment: 'confirmed', observedAtMs: 110,
  rawPayloadHash: digest('block'), signatures: [signature(1)], transactionsComplete: true, ...overrides,
});

test('exact same-provider slot and signature membership joins transaction-first and block-first', () => {
  const txFirst = new BlockMembershipCorrelator();
  assert.equal(txFirst.observeTransaction(transaction(), 100).status, 'PENDING');
  const joined = txFirst.observeBlock(block(), 110);
  assert.equal(joined.accepted, true);
  assert.equal(joined.disposition, 'ADDED');
  assert.equal(joined.resolutions.length, 1);
  assert.equal(joined.resolutions[0].status, 'MATCHED');
  assert.equal(joined.resolutions[0].blockhashesObserved[0], blockhash(2));
  assert.equal(joined.resolutions[0].evidenceClass, 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY');
  assert.equal(joined.resolutions[0].canonicalStatus, 'UNVERIFIED');
  assert.equal(joined.resolutions[0].bankIdStatus, 'UNAVAILABLE_IN_PINNED_YELLOWSTONE_V4');
  assert.match(joined.resolutions[0].evidenceHash, /^[a-f0-9]{64}$/);

  const blockFirst = new BlockMembershipCorrelator();
  blockFirst.observeBlock(block(), 110);
  assert.equal(blockFirst.observeTransaction(transaction(), 120).status, 'MATCHED');
});

test('provider, slot, signature and commitment scope prevent accidental joins', () => {
  const c = new BlockMembershipCorrelator();
  c.observeBlock(block(), 110);
  assert.equal(c.observeTransaction(transaction({ providerId: 'geyser-b' }), 120).status, 'PENDING');
  assert.equal(c.observeTransaction(transaction({ observationId: 'tx-other-slot', slot: 43 }), 121).status, 'PENDING');
  assert.equal(c.observeTransaction(transaction({ observationId: 'tx-finalized', commitment: 'finalized' }), 122).status, 'PENDING');
});

test('identical block payloads are idempotent across observation ids and transaction conflicts stay ambiguous', () => {
  const c = new BlockMembershipCorrelator();
  c.observeBlock(block(), 100);
  const duplicate = c.observeBlock(block({ observationId: 'block-observation-replay' }), 101);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.disposition, 'DUPLICATE');
  c.observeTransaction(transaction(), 102);
  const conflict = c.observeTransaction(transaction({ observationId: 'tx-observation-conflict', rawPayloadHash: digest('other') }), 103);
  assert.equal(conflict.status, 'AMBIGUOUS');
  assert.equal(conflict.reason, 'CONFLICTING_TRANSACTION_OBSERVATIONS');
  assert.equal(c.observeTransaction(transaction(), 104).status, 'AMBIGUOUS');
});

test('conflict-table saturation fails closed for the bounded retention window', () => {
  const c = new BlockMembershipCorrelator({ maxRetainedConflictSlots: 1, ttlMs: 50 });
  c.observeBlock(block(), 100);
  const joined = c.observeTransaction(transaction(), 101);
  assert.equal(joined.status, 'MATCHED');
  c.observeBlock(block({ slot: 43, signatures: [signature(7), signature(7)] }), 102);
  assert.equal(c.observeTransaction(transaction({ observationId: 'tx-uncertain', slot: 42 }), 103).status, 'AMBIGUOUS');
  c.observeBlock(block({ observationId: 'block-after-window' }), 153);
  assert.equal(c.observeTransaction(transaction({ observationId: 'tx-after-window', slot: 42 }), 154).status, 'MATCHED');
});

test('absence is MISSING only when a same-provider complete block at adequate commitment was observed', () => {
  const c = new BlockMembershipCorrelator();
  const absent = transaction({ signature: signature(9) });
  c.observeTransaction(absent, 100);
  assert.equal(c.observeBlock(block({ signatures: [], transactionsComplete: false }), 110).resolutions[0].status, 'PENDING');

  const complete = new BlockMembershipCorrelator();
  complete.observeTransaction(absent, 100);
  const result = complete.observeBlock(block({ signatures: [], transactionsComplete: true }), 110).resolutions[0];
  assert.equal(result.status, 'MISSING');
  assert.equal(result.reason, 'SIGNATURE_ABSENT_FROM_OBSERVED_COMPLETE_BLOCK');
});

test('competing fork blockhashes keep same-slot transaction context ambiguous', () => {
  const c = new BlockMembershipCorrelator();
  c.observeTransaction(transaction(), 100);
  assert.equal(c.observeBlock(block(), 110).resolutions[0].status, 'MATCHED');
  const forked = c.observeBlock(block({
    observationId: 'block-observation-fork', blockhash: blockhash(3),
    rawPayloadHash: digest('fork'), signatures: [signature(8)],
  }), 120);
  assert.equal(forked.disposition, 'ADDED');
  assert.equal(forked.resolutions[0].status, 'AMBIGUOUS');
  assert.equal(forked.resolutions[0].evidenceHash, undefined);
  assert.equal(forked.resolutions[0].blockhashesObserved.length, 2);
});

test('an explicit block retraction revises matched provenance without asserting canonical truth', () => {
  const c = new BlockMembershipCorrelator();
  c.observeTransaction(transaction(), 100);
  c.observeBlock(block(), 110);
  const result = c.retractBlock({
    observationId: 'retraction-1', providerId: 'geyser-a', slot: 42,
    blockhash: blockhash(2), observedAtMs: 120, rawPayloadHash: digest('retraction'),
  }, 120)[0];
  assert.equal(result.status, 'RETRACTED');
  assert.equal(result.retractedBlockhash, blockhash(2));
  assert.equal(result.retractionObservationId, 'retraction-1');
  assert.equal(result.retractionPayloadHash, digest('retraction'));
  assert.equal(result.canonicalStatus, 'UNVERIFIED');
});

test('queue, block and signature retention limits reject overload and expire stale observations', () => {
  const c = new BlockMembershipCorrelator({ maxPendingTransactions: 1, maxRetainedBlocks: 1, maxTotalSignatures: 1, maxSignaturesPerBlock: 1, ttlMs: 50 });
  assert.equal(c.observeTransaction(transaction(), 100).status, 'PENDING');
  assert.equal(c.observeTransaction(transaction({ observationId: 'tx-overflow', signature: signature(4), slot: 43 }), 101).status, 'OVERLOADED');
  assert.equal(c.observeBlock(block(), 102).resolutions[0].status, 'MATCHED');
  const overflow = c.observeBlock(block({ observationId: 'block-budget-overflow', blockhash: blockhash(5) }), 103);
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.disposition, 'OVERLOADED');
  assert.equal(overflow.resolutions[0].status, 'OVERLOADED');
  assert.equal(c.getStats().retainedSignatures, 1);
  const expired = c.sweep(150);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, 'EXPIRED');
  assert.equal(c.getStats().pendingTransactions, 0);
});

test('pinned Yellowstone v4 block protobuf sizing scales with its transaction signature list', () => {
  const sample = count => ({
    slot: '42', blockhash: blockhash(2), rewards: undefined, blockTime: undefined, blockHeight: undefined,
    parentSlot: '41', parentBlockhash: blockhash(3), executedTransactionCount: String(count), transactions: Array.from({ length: count }, (_, i) => ({
      signature: Buffer.alloc(64, (i % 250) + 1), isVote: false, transaction: undefined, meta: undefined, index: String(i),
    })), updatedAccountCount: '0', accounts: [], entriesCount: '0', entries: [],
  });
  const smallBytes = SubscribeUpdateBlock.encode(sample(100)).finish().byteLength;
  const largeBytes = SubscribeUpdateBlock.encode(sample(1000)).finish().byteLength;
  assert.ok(largeBytes > smallBytes * 8);
  assert.ok(largeBytes < 100_000, 'signature-only encoding stays below 100 KB at 1,000 transactions');
});

test('oversized block updates return explicit overload even when no transaction is pending', () => {
  const c = new BlockMembershipCorrelator({ maxSignaturesPerBlock: 1 });
  const result = c.observeBlock(block({ signatures: [signature(1), signature(2)] }), 100);
  assert.equal(result.accepted, false);
  assert.equal(result.disposition, 'OVERLOADED');
  assert.equal(result.resolutions.length, 0);
});

test('malformed observations and regressing receive clocks are rejected', () => {
  const c = new BlockMembershipCorrelator();
  assert.throws(() => c.observeTransaction(transaction({ signature: 'bad' }), 100), /INVALID_TRANSACTION/);
  c.observeTransaction(transaction(), 100);
  assert.throws(() => c.observeBlock(block(), 99), /INVALID_TIME/);
});

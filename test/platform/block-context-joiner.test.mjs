import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { BlockContextJoiner } from '../../dist/platform/pipeline/block-context-joiner.js';
import { UnifiedPipelineUnit } from '../../dist/platform/pipeline/unified-unit.js';
import { RuntimeDivergenceAuditor } from '../../dist/platform/pipeline/runtime-divergence.js';
import { composePaperRuntime } from '../../dist/runtime-composition.js';
import { createRuntimeContext } from '../../dist/runtime-context.js';

const b58 = (size, n) => bs58.encode(Buffer.alloc(size, n));
const sigA = b58(64, 1);
const sigB = b58(64, 2);
const VALID_BLOCKHASH = b58(32, 3);
const PROVIDER = 'quicknode-solana';
const blockContext = (overrides = {}) => ({
  slot: 320_000_000n, bankId: 'provider-observed-bank-context', blockhash: VALID_BLOCKHASH,
  commitment: 'confirmed', forkLineage: [], ...overrides,
});
const membership = (transactionSignatures, overrides = {}) => ({
  providerId: PROVIDER, transactionSignatures, rawPayloadHash: createHash('sha256').update(JSON.stringify(transactionSignatures)).digest('hex'),
  observedAtMs: 100, ...overrides,
});
const event = (signature = sigA, slot = 320_000_000, providerId = PROVIDER) => ({
  name: 'createevent', data: { mint: 'MintTest11111111111111111111111111111111111' },
  signature, slot, received: 100,
  observation: { observationId: `obs_${slot}_${signature.slice(0, 8)}`, sourceId: 'geyser-a', providerId, transport: 'yellowstone.transaction.logs',
    receivedAt: 100, slot, signature, commitment: 'confirmed', rawPayloadHash: createHash('sha256').update(signature).digest('hex'), schemaVersion: 'solana-program-logs/v1' },
});

test('context validation checks protocol-shaped values and RPC latest hash cannot register membership', () => {
  const joiner = new BlockContextJoiner();
  assert.throws(() => joiner.registerSlotContext(blockContext({ blockhash: 'short' }), membership([sigA])), /BLOCK_CONTEXT_INVALID/);
  assert.throws(() => joiner.registerSlotContext(blockContext({ slot: 1n << 64n }), membership([sigA])), /BLOCK_CONTEXT_INVALID/);
  assert.throws(() => joiner.registerSlotContext(blockContext({ commitment: 'unknown' }), membership([sigA])), /BLOCK_CONTEXT_INVALID/);
  assert.throws(() => joiner.registerFromRpc(320_000_000, VALID_BLOCKHASH, 'rpc_bank_fake', 'confirmed'), /CANNOT_PROVE_TRANSACTION_MEMBERSHIP/);
  const sparse = new Array(2); sparse[0] = sigA;
  assert.throws(() => joiner.registerSlotContext(blockContext(), membership(sparse)), /BLOCK_INPUT_INVALID/);
  assert.throws(() => joiner.registerSlotContext(new Proxy(blockContext(), {}), membership([sigA])), /BLOCK_INPUT_INVALID/);
});

test('same-provider exact signature membership joins while non-members remain pending', () => {
  const unit = new UnifiedPipelineUnit();
  const joiner = new BlockContextJoiner({ unifiedUnit: unit });
  joiner.joinObservation(event(sigA));
  joiner.joinObservation(event(sigB));
  const drained = joiner.registerSlotContext(blockContext(), membership([sigA]));
  assert.equal(drained.length, 1);
  assert.equal(drained[0].payload.signature, sigA);
  assert.equal(drained[0].chain.slot, 320_000_000n);
  assert.equal(drained[0].chain.blockhash, VALID_BLOCKHASH);
  assert.equal(drained[0].evidenceClass, 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY');
  assert.equal(unit.journal.length(), 1);
  assert.equal(joiner.getPendingCount(), 1);
  assert.equal(joiner.joinObservation(event(sigB)).reason, 'AWAITING_EXACT_SIGNATURE_MEMBERSHIP');
});

test('slot equality and a different provider never join a transaction', () => {
  const unit = new UnifiedPipelineUnit();
  const joiner = new BlockContextJoiner({ unifiedUnit: unit });
  joiner.joinObservation(event(sigA, 320_000_000, 'geyser-a'));
  joiner.registerSlotContext(blockContext(), membership([sigA], { providerId: 'geyser-b' }));
  assert.equal(unit.journal.length(), 0);
  assert.equal(joiner.getPendingCount(), 1);
});

test('outer and envelope slot/signature must agree and weaker block commitment cannot join', () => {
  const joiner = new BlockContextJoiner();
  const wrongSlot = event();
  wrongSlot.observation = { ...wrongSlot.observation, slot: 320_000_001 };
  assert.equal(joiner.joinObservation(wrongSlot).reason, 'INVALID_SLOT_OR_TRANSACTION_OBSERVATION');
  const wrongSignature = event();
  wrongSignature.observation = { ...wrongSignature.observation, signature: sigB };
  assert.equal(joiner.joinObservation(wrongSignature).reason, 'INVALID_SLOT_OR_TRANSACTION_OBSERVATION');
  joiner.registerSlotContext(blockContext({ commitment: 'processed' }), membership([sigA]));
  assert.equal(joiner.joinObservation(event()).reason, 'BLOCK_COMMITMENT_BELOW_TRANSACTION');
  assert.equal(joiner.getPendingCount(), 1);
});

test('conflicting block contexts poison that provider-slot and cannot join later observations', () => {
  const joiner = new BlockContextJoiner();
  joiner.registerSlotContext(blockContext(), membership([sigA]));
  const fork = blockContext({ blockhash: b58(32, 4), bankId: 'other-provider-observed-bank' });
  assert.deepEqual(joiner.registerSlotContext(fork, membership([sigA], { rawPayloadHash: createHash('sha256').update('fork').digest('hex') })), []);
  const result = joiner.joinObservation(event(sigA));
  assert.equal(result.joined, false);
  assert.equal(result.reason, 'BLOCK_CONTEXT_CONFLICT');
});

test('duplicate reports cannot change fork lineage or downgrade commitment', () => {
  const joiner = new BlockContextJoiner();
  joiner.registerSlotContext(blockContext({ commitment: 'confirmed', forkLineage: ['parent-a'] }), membership([sigA]));
  joiner.registerSlotContext(blockContext({ commitment: 'processed', forkLineage: ['parent-a'] }), membership([sigA]));
  assert.equal(joiner.getSlotContext(320_000_000, PROVIDER).commitment, 'confirmed');
  assert.deepEqual(joiner.registerSlotContext(blockContext({ commitment: 'finalized', forkLineage: ['parent-b'] }),
    membership([sigA], { rawPayloadHash: createHash('sha256').update('lineage-fork').digest('hex') })), []);
  assert.equal(joiner.joinObservation(event()).reason, 'BLOCK_CONTEXT_CONFLICT');
});

test('exact-membership block context can precede the transaction observation', () => {
  const unit = new UnifiedPipelineUnit();
  const joiner = new BlockContextJoiner({ unifiedUnit: unit });
  joiner.registerSlotContext(blockContext(), membership([sigA]));
  const result = joiner.joinObservation(event(sigA));
  assert.equal(result.joined, true);
  assert.equal(result.envelope.evidenceClass, 'SOURCE_REPORTED_BLOCK_MEMBERSHIP_ONLY');
  assert.equal(result.envelope.payload.blockPayloadHash, membership([sigA]).rawPayloadHash);
  assert.equal(unit.journal.length(), 1);
});

test('pending observations and retained block signatures enforce resource bounds', () => {
  const joiner = new BlockContextJoiner({ maxPendingObservations: 2, maxCachedSlots: 1, maxSignaturesPerBlock: 2, maxTotalSignatures: 2 });
  joiner.joinObservation(event(sigA, 320_000_000));
  joiner.joinObservation(event(sigA, 320_000_001));
  joiner.joinObservation(event(sigA, 320_000_002));
  assert.equal(joiner.getPendingCount(), 2);
  assert.equal(joiner.getEvictedCount(), 1);
  assert.throws(() => new BlockContextJoiner({ maxTotalSignatures: 1, maxSignaturesPerBlock: 2 }), /INVALID_BOUNDS/);
});

test('pending event payload is deeply snapshotted and byte-bounded before asynchronous join', () => {
  const joiner = new BlockContextJoiner({ maxPendingBytes: 65_536 });
  const mutable = event();
  mutable.data = { mint: sigA, nested: { label: 'before' } };
  assert.equal(joiner.joinObservation(mutable).joined, false);
  mutable.data.nested.label = 'after';
  const [joined] = joiner.registerSlotContext(blockContext(), membership([sigA]));
  assert.equal(joined.payload.data.nested.label, 'before');

  const oversized = event(sigB);
  oversized.data = { value: 'x'.repeat(70_000) };
  assert.equal(joiner.joinObservation(oversized).reason, 'BLOCK_EVENT_DATA_BOUNDS');
  const customJson = event(sigB);
  customJson.data = { toJSON() { return 'x'.repeat(100_000); } };
  assert.equal(joiner.joinObservation(customJson).reason, 'BLOCK_EVENT_DATA_INVALID');
  const sparse = event(sigB);
  const hugeSparse = new Array(1_000_000_000);
  hugeSparse[999_999_999] = 'value';
  sparse.data = { items: hugeSparse };
  assert.equal(joiner.joinObservation(sparse).reason, 'BLOCK_EVENT_DATA_BOUNDS');
  const extraField = { ...event(sigB), ignored: 'x'.repeat(100_000) };
  assert.equal(joiner.joinObservation(extraField).reason, 'BLOCK_INPUT_INVALID');
  const accessorEvent = event();
  Object.defineProperty(accessorEvent, 'signature', { get() { return sigA; } });
  assert.equal(joiner.joinObservation(accessorEvent).reason, 'BLOCK_INPUT_INVALID');
  const maliciousObservation = event(sigB);
  maliciousObservation.observation.observedAt = { toJSON() { return 'x'.repeat(100_000); } };
  assert.equal(joiner.joinObservation(maliciousObservation).reason, 'BLOCK_EVENT_INVALID');
  const hugeBn = event(sigB);
  hugeBn.data = { amount: new BN(1).ushln(200_000) };
  assert.equal(joiner.joinObservation(hugeBn).reason, 'BLOCK_EVENT_DATA_BOUNDS');
  const invalidBn = event(sigB);
  const badAmount = new BN(2); badAmount.negative = 3;
  invalidBn.data = { amount: badAmount };
  assert.equal(joiner.joinObservation(invalidBn).reason, 'BLOCK_EVENT_DATA_INVALID');
  const proxiedBn = event(sigB);
  proxiedBn.data = { amount: new Proxy(new BN(1), {}) };
  assert.equal(joiner.joinObservation(proxiedBn).reason, 'BLOCK_EVENT_DATA_INVALID');
  const proxiedKey = event(sigB);
  const malformedKey = new PublicKey(b58(32, 10));
  malformedKey._bn = new Proxy(malformedKey._bn, {});
  proxiedKey.data = { mint: malformedKey };
  assert.equal(joiner.joinObservation(proxiedKey).reason, 'BLOCK_EVENT_DATA_INVALID');
});

test('bounded payload copy normalizes the Solana PublicKey and BN forms used by Anchor', () => {
  const joiner = new BlockContextJoiner();
  const input = event();
  const mint = new PublicKey(b58(32, 9));
  input.data = { mint, amount: new BN(12345) };
  const pending = joiner.joinObservation(input);
  assert.equal(pending.joined, false, pending.reason);
  assert.equal(joiner.getPendingCount(), 1, pending.reason);
  const [joined] = joiner.registerSlotContext(blockContext(), membership([sigA]));
  assert.ok(joined);
  assert.equal(joined.subject, mint.toBase58());
  assert.equal(joined.payload.data.mint, mint.toBase58());
  assert.equal(joined.payload.data.amount, '12345');
});

test('paper runtime composition does not claim to wire the unverified block joiner', () => {
  const context = createRuntimeContext({ MODE: 'paper', RPC_URLS: 'https://rpc-a.example', WS_URLS: 'wss://ws-a.example' }, { now: 1, runtimeGeneration: 'r1' });
  const composed = composePaperRuntime({ context, market: {}, execution: {}, reconciliation: {} });
  assert.ok(composed.unit instanceof UnifiedPipelineUnit);
  assert.ok(composed.divergenceAuditor instanceof RuntimeDivergenceAuditor);
  assert.equal('blockContextJoiner' in composed, false);
  assert.ok(new BlockContextJoiner() instanceof BlockContextJoiner);
  assert.equal(Object.isFrozen(composed), true);
});

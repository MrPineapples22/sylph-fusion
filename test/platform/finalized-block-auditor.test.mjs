import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { auditFinalizedBlockRange } from '../../dist/platform/ingestion/finalized-block-auditor.js';
import { correlateFinalizedTransactionToSigningIntent } from '../../dist/platform/execution/finalized-signing-correlation.js';
import { RpcPool } from '../../dist/rpc.js';
import { schema } from '../../dist/config.js';
import bs58 from 'bs58';
import { Keypair, MessageV0, PublicKey, SystemProgram } from '@solana/web3.js';

function block({ blockhash = 'A'.repeat(43), previousBlockhash = 'B'.repeat(43), parentSlot = 9, signatures = ['C'.repeat(88)], version = 0, meta = {}, message } = {}) {
  return {
    blockhash,
    previousBlockhash,
    parentSlot,
    transactions: signatures.map(signature => ({
      transaction: { message: message ?? {
        accountKeys: ['11111111111111111111111111111111'],
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
        instructions: [],
        recentBlockhash: 'B'.repeat(43),
      }, signatures: [signature] },
      meta,
      version,
    })),
  };
}

function rpcBlock({ blockhash = 'A'.repeat(43), previousBlockhash = 'B'.repeat(43), parentSlot = 9 } = {}) {
  return {
    blockhash,
    previousBlockhash,
    parentSlot,
    transactions: [{
      transaction: {
        signatures: ['C'.repeat(88)],
        message: {
          accountKeys: ['11111111111111111111111111111111'],
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
          instructions: [],
          recentBlockhash: 'B'.repeat(43),
        },
      },
      meta: {
        err: null, fee: 5000, innerInstructions: null,
        preBalances: [100000], postBalances: [95000], logMessages: null,
        preTokenBalances: null, postTokenBalances: null,
      },
      version: 'legacy',
    }],
    blockTime: 1_728_000_000,
    blockHeight: 1,
  };
}

function provider(providerId, {
  slots = [10],
  finalizedSlot = 10_000,
  firstAvailableBlock = 0,
  genesisHash = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  getGenesisHash = async () => genesisHash,
  getFinalizedSlot = async () => finalizedSlot,
  getFirstAvailableBlock = async () => firstAvailableBlock,
  getBlock = async slot => {
    const earlier = slots.filter(candidate => candidate < slot);
    return block({
      parentSlot: earlier.at(-1) ?? slot - 1,
      previousBlockhash: earlier.length ? 'A'.repeat(43) : 'B'.repeat(43),
    });
  },
  getBlocks = async () => slots,
} = {}) {
  return { providerId, getGenesisHash, getFinalizedSlot, getFirstAvailableBlock, getBlocks, getBlock };
}

test('finalized block audit compares configured endpoint observations but never emits recovery authority', async () => {
  const calls = [];
  const makeProvider = providerId => provider(providerId, {
    getBlocks: async (start, end, commitment) => { calls.push(['blocks', providerId, start, end, commitment]); return [10]; },
    getBlock: async (slot, config) => { calls.push(['block', providerId, slot, config]); return block(); },
  });
  const report = await auditFinalizedBlockRange([makeProvider('rpc-a'), makeProvider('rpc-b')], 10, 10);
  assert.equal(report.authorityEligible, false);
  assert.equal(Object.hasOwn(report, 'recoveryCertificate'), false);
  assert.equal(report.comparisons[0].status, 'MATCHED_CONFIGURED_ENDPOINTS');
  assert.equal(report.comparisons[0].transactionMetadataStatus, 'MATCHED_CONFIGURED_ENDPOINTS');
  assert.equal(report.comparisons[0].transactionMetadataFingerprints.length, 1);
  assert.deepEqual(report.comparisons[0].availableProviderIds, ['rpc-a', 'rpc-b']);
  assert.deepEqual(calls.filter(call => call[0] === 'blocks').map(call => call[4]), ['finalized', 'finalized']);
  for (const call of calls.filter(call => call[0] === 'block')) {
    assert.deepEqual(call[3], {
      commitment: 'finalized', maxSupportedTransactionVersion: 0,
      transactionDetails: 'full', rewards: false,
    });
  }
});

test('transaction metadata is compared separately from block identity and field order is canonical', async () => {
  const left = provider('rpc-a', { getBlock: async () => block({ meta: { fee: 5000, err: null, innerInstructions: null } }) });
  const reordered = provider('rpc-b', { getBlock: async () => block({ meta: { innerInstructions: null, err: null, fee: 5000 } }) });
  const matching = await auditFinalizedBlockRange([left, reordered], 10, 10);
  assert.equal(matching.comparisons[0].status, 'MATCHED_CONFIGURED_ENDPOINTS');
  assert.equal(matching.comparisons[0].transactionMetadataStatus, 'MATCHED_CONFIGURED_ENDPOINTS');
  assert.equal(matching.providerAudits[0].observations[0].blockFingerprint,
    matching.providerAudits[1].observations[0].blockFingerprint);
  assert.equal(matching.providerAudits[0].observations[0].transactionMetadataFingerprint,
    matching.providerAudits[1].observations[0].transactionMetadataFingerprint);

  const conflict = await auditFinalizedBlockRange([left, provider('rpc-c', {
    getBlock: async () => block({ meta: { fee: 7000, err: null, innerInstructions: null } }),
  })], 10, 10);
  assert.equal(conflict.providerAudits[0].observations[0].blockFingerprint,
    conflict.providerAudits[1].observations[0].blockFingerprint);
  assert.notEqual(conflict.providerAudits[0].observations[0].transactionMetadataFingerprint,
    conflict.providerAudits[1].observations[0].transactionMetadataFingerprint);
  assert.equal(conflict.comparisons[0].transactionMetadataStatus, 'DISAGREEMENT');
  assert.equal(conflict.comparisons[0].status, 'DISAGREEMENT');
});

test('malformed transaction metadata is rejected before it can be fingerprinted', async () => {
  const meta = {};
  Object.defineProperty(meta, 'fee', { enumerable: true, get() { throw new Error('must not execute'); } });
  const report = await auditFinalizedBlockRange([provider('rpc', { getBlock: async () => block({ meta }) })], 10, 10);
  assert.equal(report.providerAudits[0].observations[0].status, 'MALFORMED_BLOCK');
});

test('opt-in finalized CPI extraction resolves v0 static and lookup-table account indexes per signature', async () => {
  const signature = 'C'.repeat(88);
  const staticKey = new PublicKey('11111111111111111111111111111111');
  const loadedWritable = new PublicKey('Vote111111111111111111111111111111111111111');
  const loadedReadonly = SystemProgram.programId;
  const message = new MessageV0({
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    staticAccountKeys: [staticKey, SystemProgram.programId],
    recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0], data: new Uint8Array() }],
    addressTableLookups: [{ accountKey: staticKey, writableIndexes: [0], readonlyIndexes: [1] }],
  });
  const metadata = {
    fee: 5000, err: null,
    loadedAddresses: { writable: [loadedWritable.toBase58()], readonly: [loadedReadonly.toBase58()] },
    preBalances: [100, 200, 300, 400], postBalances: [90, 200, 310, 400],
    preTokenBalances: [], postTokenBalances: [],
    innerInstructions: [{ index: 0, instructions: [
      { programIdIndex: 3, accounts: [0, 2, 3], data: bs58.encode(Buffer.from([1, 2, 3])), stackHeight: 2 },
      { programIdIndex: 2, accounts: [2], data: '', stackHeight: 3 },
    ] }],
  };
  const providerA = provider('rpc-a', { getBlock: async () => block({ signatures: [signature], version: 0, meta: metadata, message }) });
  const providerB = provider('rpc-b', { getBlock: async () => block({ signatures: [signature], version: 0, meta: metadata, message }) });
  const report = await auditFinalizedBlockRange([providerA, providerB], 10, 10, { transactionSignature: signature });
  assert.equal(report.transactionSignature, signature);
  assert.equal(report.providerAudits[0].observations[0].targetedTransactionCpi.status, 'STRUCTURALLY_VALID');
  const trace = report.providerAudits[0].observations[0].targetedTransactionCpi;
  assert.equal(trace.topLevelInstructionCount, 1);
  assert.equal(trace.innerInstructionCount, 2);
  assert.equal(trace.transactionError, null);
  assert.match(trace.messageSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(trace.accountKeys, [staticKey.toBase58(), SystemProgram.programId.toBase58(), loadedWritable.toBase58(), loadedReadonly.toBase58()]);
  assert.equal(trace.balanceEvidenceStatus, 'AVAILABLE');
  assert.deepEqual(trace.preBalances, ['100', '200', '300', '400']);
  assert.deepEqual(trace.postBalances, ['90', '200', '310', '400']);
  assert.match(trace.tokenBalanceEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(trace.instructions[0].programId, loadedReadonly.toBase58());
  assert.deepEqual(trace.instructions[0].accountKeys, [staticKey.toBase58(), loadedWritable.toBase58(), loadedReadonly.toBase58()]);
  assert.deepEqual(trace.instructions[1].parent, { kind: 'INNER', topLevelInstructionIndex: 0, innerInstructionIndex: 0 });
  assert.match(trace.instructions[0].dataSha256, /^[a-f0-9]{64}$/);
  assert.match(trace.traceHash, /^[a-f0-9]{64}$/);
  assert.equal(report.comparisons[0].targetedTransactionCpiStatus, 'MATCHED_CONFIGURED_ENDPOINTS');
  assert.equal(report.comparisons[0].targetedTransactionCpiFingerprints.length, 1);
  assert.equal(report.authorityEligible, false);
  assert.equal(Object.isFrozen(trace.instructions[0]), true);

  const conflictingMeta = structuredClone(metadata);
  conflictingMeta.innerInstructions[0].instructions[0].accounts[1] = 3;
  const conflicting = await auditFinalizedBlockRange([providerA, provider('rpc-c', {
    getBlock: async () => block({ signatures: [signature], version: 0, meta: conflictingMeta, message }),
  })], 10, 10, { transactionSignature: signature });
  assert.equal(conflicting.comparisons[0].targetedTransactionCpiStatus, 'DISAGREEMENT');
});

test('targeted finalized evidence preserves incomplete and malformed account balances without inventing deltas', async () => {
  const signature = 'C'.repeat(88);
  const key = SystemProgram.programId;
  const message = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    staticAccountKeys: [key], recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 0, accountKeyIndexes: [], data: new Uint8Array() }], addressTableLookups: [] });
  const read = async (providerId, meta) => auditFinalizedBlockRange([provider(providerId, {
    getBlock: async () => block({ signatures: [signature], message, meta }),
  })], 10, 10, { transactionSignature: signature });
  const missing = await read('missing-balances', { err: null, innerInstructions: [] });
  const absent = missing.providerAudits[0].observations[0].targetedTransactionCpi;
  assert.equal(absent.balanceEvidenceStatus, 'UNAVAILABLE');
  assert.equal(absent.preBalances, null);
  assert.equal(absent.postBalances, null);

  const malformed = await read('malformed-balances', { err: null, innerInstructions: [], preBalances: [1], postBalances: [0, 1] });
  const invalid = malformed.providerAudits[0].observations[0].targetedTransactionCpi;
  assert.equal(invalid.balanceEvidenceStatus, 'MALFORMED');
  assert.equal(invalid.preBalances, null);
  assert.equal(invalid.postBalances, null);
  assert.equal(malformed.authorityEligible, false);
});

test('targeted finalized evidence verifies the reported first signature against the decoded message', async () => {
  const signer = Keypair.fromSeed(Buffer.alloc(32, 17));
  const program = SystemProgram.programId;
  const message = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    staticAccountKeys: [signer.publicKey, program], recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0], data: new Uint8Array() }], addressTableLookups: [] });
  const privateKey = createPrivateKey({ key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(signer.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8' });
  const signature = bs58.encode(sign(null, message.serialize(), privateKey));
  const metadata = { err: null, innerInstructions: [], preBalances: [100, 200], postBalances: [90, 210] };
  const read = async (reportedSignature) => auditFinalizedBlockRange([provider('signature-binding', {
    getBlock: async () => block({ signatures: [reportedSignature], message, meta: metadata }),
  })], 10, 10, { transactionSignature: reportedSignature });
  const valid = await read(signature);
  const evidence = valid.providerAudits[0].observations[0].targetedTransactionCpi;
  assert.equal(evidence.messageSignatureBinding, 'VERIFIED');
  assert.equal(valid.authorityEligible, false);
  const intent = { economicIntentId: 'intent-1', wallet: signer.publicKey.toBase58(), messageSha256: evidence.messageSha256,
    state: 'SIGNED', signatureBase64: Buffer.from(bs58.decode(signature)).toString('base64') };
  assert.equal(correlateFinalizedTransactionToSigningIntent(evidence, intent), 'MATCHED_REPORTED_SIGNING_IDENTITY');
  assert.equal(correlateFinalizedTransactionToSigningIntent(evidence, { ...intent, messageSha256: '0'.repeat(64) }),
    'MISMATCHED_REPORTED_SIGNING_IDENTITY');
  assert.equal(correlateFinalizedTransactionToSigningIntent(evidence, { ...intent, wallet: SystemProgram.programId.toBase58() }),
    'UNAVAILABLE_SIGNING_INTENT_BINDING');
  assert.equal(correlateFinalizedTransactionToSigningIntent(evidence, { ...intent, state: 'PREPARED', signatureBase64: null }),
    'UNAVAILABLE_SIGNING_INTENT_BINDING');

  const mismatchedSignature = bs58.encode(Buffer.alloc(64, 3));
  const invalid = await read(mismatchedSignature);
  assert.equal(invalid.providerAudits[0].observations[0].targetedTransactionCpi.messageSignatureBinding, 'MISMATCH');
  assert.equal(invalid.authorityEligible, false);
});

test('targeted CPI trace preserves partial and unavailable distinctions and validates signatures', async () => {
  const signature = 'C'.repeat(88);
  const key = SystemProgram.programId;
  const message = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    staticAccountKeys: [key], recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 0, accountKeyIndexes: [], data: new Uint8Array() }], addressTableLookups: [] });
  const partialProvider = provider('partial', { getBlock: async () => block({ signatures: [signature], message,
    meta: { loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [{ index: 0, instructions: [
      { programIdIndex: 0, accounts: [], data: '', stackHeight: null },
    ] }] } }) });
  const unavailableProvider = provider('unavailable', { getBlock: async () => block({ signatures: [signature], message,
    meta: { loadedAddresses: { writable: [], readonly: [] }, innerInstructions: null } }) });
  const partial = await auditFinalizedBlockRange([partialProvider], 10, 10, { transactionSignature: signature });
  assert.equal(partial.providerAudits[0].observations[0].targetedTransactionCpi.status, 'PARTIAL');
  assert.equal(partial.comparisons[0].status, 'PARTIAL');
  const unavailable = await auditFinalizedBlockRange([unavailableProvider], 10, 10, { transactionSignature: signature });
  assert.equal(unavailable.providerAudits[0].observations[0].targetedTransactionCpi.status, 'UNAVAILABLE_TRACE');
  await assert.rejects(auditFinalizedBlockRange([partialProvider], 10, 10, { transactionSignature: 'not-a-signature' }), /INPUT_INVALID/);

  const lookupMessage = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    staticAccountKeys: [key], recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 0, accountKeyIndexes: [], data: new Uint8Array() }],
    addressTableLookups: [{ accountKey: key, writableIndexes: [0], readonlyIndexes: [] }] });
  const missingLookup = provider('missing-lookup-evidence', { getBlock: async () => block({ signatures: [signature], message: lookupMessage,
    meta: { innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 0, accounts: [], data: '', stackHeight: 2 }] }] } }) });
  const missingLookupReport = await auditFinalizedBlockRange([missingLookup], 10, 10, { transactionSignature: signature });
  assert.equal(missingLookupReport.providerAudits[0].observations[0].targetedTransactionCpi.status, 'UNAVAILABLE_ACCOUNT_KEYS');
});

test('targeted CPI evidence snapshots and freezes provider-reported transaction failure', async () => {
  const signature = 'C'.repeat(88);
  const key = SystemProgram.programId;
  const message = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 },
    staticAccountKeys: [key], recentBlockhash: 'B'.repeat(43),
    compiledInstructions: [{ programIdIndex: 0, accountKeyIndexes: [], data: new Uint8Array() }], addressTableLookups: [] });
  const error = { InstructionError: [0, { Custom: 42 }] };
  const report = await auditFinalizedBlockRange([provider('failed-provider', { getBlock: async () => block({ signatures: [signature], message,
    meta: { err: error, loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [] } }) })], 10, 10,
  { transactionSignature: signature });
  const evidence = report.providerAudits[0].observations[0].targetedTransactionCpi;
  assert.equal(evidence.transactionOutcome, 'REPORTED_FAILURE');
  assert.notEqual(evidence.transactionError, error);
  assert.equal(Object.isFrozen(evidence.transactionError), true);
  assert.equal(Object.isFrozen(evidence.transactionError.InstructionError), true);
  error.InstructionError[1].Custom = 9;
  assert.deepEqual(evidence.transactionError, { InstructionError: [0, { Custom: 42 }] });
});

test('only a valid getBlocks response can classify omitted slots as skipped', async () => {
  let blockCalls = 0;
  const read = provider('rpc', {
    slots: [10, 12],
    getBlock: async slot => {
      blockCalls++;
      return slot === 10
        ? block({ parentSlot: 9, previousBlockhash: 'B'.repeat(43) })
        : block({ parentSlot: 10, previousBlockhash: 'A'.repeat(43) });
    },
  });
  const report = await auditFinalizedBlockRange([read], 10, 12);
  assert.deepEqual(report.providerAudits[0].observations.map(item => item.status), [
    'AVAILABLE', 'SKIPPED_BY_GETBLOCKS', 'AVAILABLE',
  ]);
  assert.equal(blockCalls, 2);

  const unavailable = provider('offline', { getBlocks: async () => { throw new Error('timeout'); } });
  const failed = await auditFinalizedBlockRange([unavailable], 10, 12);
  assert.ok(failed.providerAudits[0].observations.every(item => item.status === 'RANGE_UNAVAILABLE'));
  assert.ok(failed.comparisons.every(item => item.status === 'NO_BLOCK_EVIDENCE'));
});

test('slots above endpoint finality or below retained history cannot be mislabeled skipped', async () => {
  const bounded = provider('bounded', {
    finalizedSlot: 11,
    firstAvailableBlock: 11,
    slots: [11],
  });
  const report = await auditFinalizedBlockRange([bounded], 10, 12);
  assert.deepEqual(report.providerAudits[0].observations.map(item => item.status), [
    'HISTORY_PRUNED_OR_UNAVAILABLE', 'AVAILABLE', 'NOT_FINALIZED_AT_ENDPOINT',
  ]);

  const badBounds = provider('bad-bounds', { finalizedSlot: 10, firstAvailableBlock: 11 });
  const invalid = await auditFinalizedBlockRange([badBounds], 10, 10);
  assert.equal(invalid.providerAudits[0].rangeStatus, 'INVALID_RESPONSE');
  assert.equal(invalid.providerAudits[0].observations[0].status, 'RANGE_UNAVAILABLE');
});

test('pruning that races an audit and unverified endpoint clusters fail closed', async () => {
  let retentionReads = 0;
  const pruningRace = provider('pruning-race', {
    slots: [],
    getBlocks: async () => [],
    getFirstAvailableBlock: async () => ++retentionReads === 1 ? 0 : 11,
  });
  const pruned = await auditFinalizedBlockRange([pruningRace], 10, 10);
  assert.equal(pruned.providerAudits[0].observations[0].status, 'HISTORY_PRUNED_OR_UNAVAILABLE');

  const wrongCluster = provider('wrong-cluster', { genesisHash: 'devnet-genesis' });
  const mismatch = await auditFinalizedBlockRange([wrongCluster], 10, 10);
  assert.equal(mismatch.providerAudits[0].observations[0].status, 'CLUSTER_MISMATCH');
  assert.equal(mismatch.comparisons[0].status, 'NO_BLOCK_EVIDENCE');
});

test('omitted blocks require stable finalized and retained range bounds', async () => {
  let finalizedReads = 0;
  const finalityRegression = provider('finality-regression', {
    slots: [],
    getBlocks: async () => [],
    getFinalizedSlot: async () => ++finalizedReads === 1 ? 100 : 9,
  });
  const finalityChanged = await auditFinalizedBlockRange([finalityRegression], 10, 10);
  assert.equal(finalityChanged.providerAudits[0].observations[0].status, 'NOT_FINALIZED_AT_ENDPOINT');

  let retentionReads = 0;
  const retentionRegression = provider('retention-regression', {
    slots: [],
    getBlocks: async () => [],
    getFirstAvailableBlock: async () => ++retentionReads === 1 ? 0 : 11,
  });
  const retentionChanged = await auditFinalizedBlockRange([retentionRegression], 10, 10);
  assert.equal(retentionChanged.providerAudits[0].observations[0].status, 'HISTORY_PRUNED_OR_UNAVAILABLE');

  let unavailableFinalityReads = 0;
  const unavailableRecheck = provider('unavailable-recheck', {
    slots: [10],
    getFinalizedSlot: async () => {
      if (++unavailableFinalityReads === 1) return 100;
      throw new Error('finality unavailable');
    },
  });
  const unverified = await auditFinalizedBlockRange([unavailableRecheck], 10, 10);
  assert.equal(unverified.providerAudits[0].observations[0].status, 'AVAILABLE');
});

test('null blocks, unsupported transaction versions, partial metadata, and disagreements stay distinct', async () => {
  const nullBlock = provider('null', { getBlock: async () => null });
  const unsupported = provider('unsupported', { getBlock: async () => { throw new Error('Transaction version (1) is not supported by this node'); } });
  const other = provider('other', { getBlock: async () => block({ blockhash: 'D'.repeat(43) }) });
  const partialMeta = provider('partial-meta', { getBlock: async () => block({ meta: null }) });
  const report = await auditFinalizedBlockRange([nullBlock, unsupported, other, partialMeta], 10, 10);
  assert.deepEqual(report.providerAudits.map(item => item.observations[0].status), [
    'UNAVAILABLE_NULL', 'UNSUPPORTED_TRANSACTION_VERSION', 'AVAILABLE', 'AVAILABLE_WITH_NULL_META',
  ]);
  assert.equal(report.providerAudits[3].observations[0].nullMetaCount, 1);
  assert.equal(report.comparisons[0].status, 'DISAGREEMENT');
});

test('provider slot lists and block shapes are validated before comparison', async () => {
  let blockCalls = 0;
  const invalidLists = [
    [12], [11, 10], [10, 10], ['10'], null,
  ];
  for (const slotList of invalidLists) {
    const report = await auditFinalizedBlockRange([provider('rpc', {
      getBlocks: async () => slotList,
      getBlock: async () => { blockCalls++; return block(); },
    })], 10, 11);
    assert.equal(report.providerAudits[0].rangeStatus, 'INVALID_RESPONSE');
    assert.deepEqual(report.providerAudits[0].observations.map(item => item.status), [
      'INVALID_PROVIDER_SLOT_LIST', 'INVALID_PROVIDER_SLOT_LIST',
    ]);
  }
  assert.equal(blockCalls, 0);

  const malformed = await auditFinalizedBlockRange([provider('malformed', { getBlock: async () => ({ ...block(), parentSlot: 10 }) })], 10, 10);
  assert.equal(malformed.providerAudits[0].observations[0].status, 'MALFORMED_BLOCK');
});

test('v1 transaction responses are not mislabeled as complete under the pinned v0 decoder contract', async () => {
  const report = await auditFinalizedBlockRange([provider('rpc', { getBlock: async () => block({ version: 1 }) })], 10, 10);
  assert.equal(report.providerAudits[0].observations[0].status, 'UNSUPPORTED_TRANSACTION_VERSION');
  assert.equal(report.comparisons[0].status, 'NO_BLOCK_EVIDENCE');
});

test('reported parent-chain inconsistency remains explicit and null metadata prevents a complete comparison', async () => {
  const parentMismatch = await auditFinalizedBlockRange([provider('bad-link', {
    slots: [10, 11],
    getBlock: async slot => slot === 10
      ? block({ parentSlot: 9, previousBlockhash: 'B'.repeat(43) })
      : block({ parentSlot: 9, previousBlockhash: 'D'.repeat(43) }),
  })], 10, 11);
  assert.equal(parentMismatch.providerAudits[0].observations[1].status, 'BLOCK_PARENT_MISMATCH');

  const nullMeta = await auditFinalizedBlockRange([provider('meta', { getBlock: async () => block({ meta: null }) })], 10, 10);
  assert.equal(nullMeta.comparisons[0].status, 'PARTIAL');
});

test('block fetch concurrency stays globally bounded across configured endpoints', async () => {
  let active = 0;
  let maximum = 0;
  const slowProvider = id => provider(id, {
    slots: Array.from({ length: 8 }, (_, index) => 10 + index),
    getBlock: async slot => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      const first = 10;
      return block({
        blockhash: String.fromCharCode(65 + ((slot - first) % 22)).repeat(43),
        previousBlockhash: String.fromCharCode(65 + ((slot - first + 21) % 22)).repeat(43),
        parentSlot: slot - 1,
      });
    },
  });
  const report = await auditFinalizedBlockRange([slowProvider('a'), slowProvider('b')], 10, 17, { blockConcurrency: 3 });
  assert.equal(maximum, 3);
  assert.ok(report.comparisons.every(item => item.status === 'MATCHED_CONFIGURED_ENDPOINTS'));
});

test('auditor enforces bounded range, concurrency, endpoint count, and unique labels', async () => {
  const one = provider('one');
  await assert.rejects(auditFinalizedBlockRange([one], 10, 10, { maxSlots: 257 }), /INPUT_INVALID/);
  await assert.rejects(auditFinalizedBlockRange([one], 10, 20, { maxSlots: 10 }), /INPUT_INVALID/);
  await assert.rejects(auditFinalizedBlockRange([one], 10, 10, { blockConcurrency: 9 }), /INPUT_INVALID/);
  await assert.rejects(auditFinalizedBlockRange([one, provider('one')], 10, 10), /PROVIDER_INVALID/);
  await assert.rejects(auditFinalizedBlockRange([], 10, 10), /INPUT_INVALID/);
});

test('RpcPool integration uses configured endpoints directly and sends finalized v0-cap bounded reads', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request);
    const result = request.method === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
      : request.method === 'getSlot' ? 100
      : request.method === 'getFirstAvailableBlock' ? 0
        : request.method === 'getBlocks' ? [10] : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  try {
    const rpc = new RpcPool(schema.parse({ RPC_URLS: 'https://provider-a.invalid', WS_URLS: 'wss://provider-a.invalid' }));
    const report = await rpc.auditFinalizedBlockRange(10, 10);
    assert.equal(report.providerAudits[0].rangeStatus, 'READ');
    assert.equal(report.providerAudits[0].observations[0].status, 'UNAVAILABLE_NULL');
    assert.equal(report.comparisons[0].status, 'NO_BLOCK_EVIDENCE');
    assert.deepEqual(calls.map(call => call.method).sort(), ['getBlock', 'getBlocks', 'getFirstAvailableBlock', 'getGenesisHash', 'getSlot', 'getFirstAvailableBlock', 'getSlot'].sort());
    const getBlocks = calls.find(call => call.method === 'getBlocks');
    const getBlock = calls.find(call => call.method === 'getBlock');
    assert.equal(getBlocks.params[2].commitment, 'finalized');
    assert.equal(getBlock.params[1].commitment, 'finalized');
    assert.equal(getBlock.params[1].maxSupportedTransactionVersion, 0);
    assert.equal(getBlock.params[1].transactionDetails, 'full');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RpcPool decodes a full legacy getBlock response and records it as available', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request);
    const result = request.method === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
      : request.method === 'getSlot' ? 100
      : request.method === 'getFirstAvailableBlock' ? 0
      : request.method === 'getBlocks' ? [10]
      : request.method === 'getBlock' ? rpcBlock() : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  };
  try {
    const rpc = new RpcPool(schema.parse({ RPC_URLS: 'https://provider-a.invalid', WS_URLS: 'wss://provider-a.invalid' }));
    const report = await rpc.auditFinalizedBlockRange(10, 10, { transactionSignature: 'C'.repeat(88) });
    assert.equal(report.providerAudits[0].rangeStatus, 'READ');
    assert.equal(report.providerAudits[0].observations[0].status, 'AVAILABLE');
    assert.equal(report.providerAudits[0].observations[0].transactionCount, 1);
    assert.equal(report.providerAudits[0].observations[0].nullMetaCount, 0);
    assert.equal(report.transactionSignature, 'C'.repeat(88));
    assert.equal(report.providerAudits[0].observations[0].targetedTransactionCpi.status, 'UNAVAILABLE_TRACE');
    assert.equal(report.comparisons[0].status, 'SINGLE_ENDPOINT_OBSERVATION');
    assert.deepEqual(calls.find(call => call.method === 'getBlock').params[1], {
      commitment: 'finalized', maxSupportedTransactionVersion: 0,
      transactionDetails: 'full', rewards: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});


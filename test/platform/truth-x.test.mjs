import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TruthClassificationValidator,
  TxV1TruthEngine,
  EconomicDeltaEngine,
  ParserCanaryEngine,
  CommitmentLadderEngine,
  SlotCausalClock,
  ForkReversalEngine,
  ProviderTrustLedger,
} from '../../dist/platform/ingestion/truth-x.js';

test('TruthClassificationValidator: enforces truth classes and rejects derived intelligence masquerading as chain truth', () => {
  const chainTruth = {
    truthClass: 'CHAIN_TRUTH',
    payload: { slot: 100 },
    slot: 100,
    timestampMs: Date.now(),
    providerId: 'helios-1',
    hash: 'abc',
  };

  assert.doesNotThrow(() => {
    TruthClassificationValidator.validateClass(chainTruth, 'CHAIN_TRUTH');
  });
  assert.equal(TruthClassificationValidator.isChainTruth(chainTruth), true);

  const derived = {
    truthClass: 'DERIVED_INTELLIGENCE',
    payload: { aiScore: 0.95 },
    slot: 100,
    timestampMs: Date.now(),
    providerId: 'ai-engine',
    hash: 'def',
  };

  assert.equal(TruthClassificationValidator.isChainTruth(derived), false);
  assert.throws(() => {
    TruthClassificationValidator.validateClass(derived, 'CHAIN_TRUTH');
  }, /TRUTH_CLASS_VIOLATION/);
});

test('TxV1TruthEngine: decodes Legacy, V0, V1 transactions and fails closed on unknown versions', () => {
  // Legacy
  const legacy = TxV1TruthEngine.decodeTransaction({
    signature: 'sig1',
    version: 'legacy',
    slot: 1000,
    rawMessageBytes: new Uint8Array([10, 20, 30]),
    meta: { err: null, fee: 5000n },
    accountKeys: ['prog1', 'acc1', 'acc2'],
    compiledInstructions: [
      {
        programIdIndex: 0,
        accountIndices: [1, 2],
        dataHex: '010203',
      },
    ],
  });
  assert.equal(legacy.version, 'LEGACY');
  assert.equal(legacy.instructions.length, 1);
  assert.equal(legacy.instructions[0].programId, 'prog1');
  assert.deepEqual([...legacy.rawMessageBytes], [10, 20, 30]);
  assert.equal(legacy.feeLamports, 5000n);

  // V0
  const v0 = TxV1TruthEngine.decodeTransaction({
    signature: 'sig2',
    version: 0,
    slot: 1001,
    rawMessageBytes: new Uint8Array([11, 21, 31]),
    meta: { err: null, fee: 5000n },
    accountKeys: ['prog2', 'user1'],
    compiledInstructions: [{ programIdIndex: 0, accountIndices: [1], data: new Uint8Array() }],
  });
  assert.equal(v0.version, 'V0');

  // V1
  const v1 = TxV1TruthEngine.decodeTransaction({
    signature: 'sig3',
    version: 1,
    slot: 1002,
    rawMessageBytes: new Uint8Array([12, 22, 32]),
    meta: { err: null, fee: 5000n },
    accountKeys: ['prog3', 'user2'],
    compiledInstructions: [{ programIdIndex: 0, accountIndices: [1], dataBase58: '2' }],
  });
  assert.equal(v1.version, 'V1');
  assert.deepEqual([...v1.instructions[0].data], [1]);

  assert.throws(() => TxV1TruthEngine.decodeTransaction({
    signature: 'sig-null', version: null, slot: 1, rawMessageBytes: new Uint8Array([1]),
    accountKeys: ['prog'], compiledInstructions: [],
  }), /TXV1_TRUTH_UNKNOWN_VERSION/);
  assert.throws(() => TxV1TruthEngine.decodeTransaction({
    signature: 'sig-missing', version: 0, slot: 1, accountKeys: ['prog'], compiledInstructions: [],
  }), /TXV1_TRUTH_RAW_MESSAGE_REQUIRED/);
  assert.throws(() => TxV1TruthEngine.decodeTransaction({
    signature: 'sig-index', version: 0, slot: 1, rawMessageBytes: new Uint8Array([1]),
    feeLamports: 1n, meta: { err: null },
    accountKeys: ['prog'], compiledInstructions: [{ programIdIndex: 4, accountIndices: [], data: new Uint8Array() }],
  }), /TXV1_TRUTH_INVALID_PROGRAM_INDEX/);
  assert.throws(() => TxV1TruthEngine.decodeTransaction({
    signature: 'sig-no-outcome', version: 0, slot: 1, rawMessageBytes: new Uint8Array([1]),
    feeLamports: 1n, accountKeys: ['prog'], compiledInstructions: [],
  }), /TXV1_TRUTH_TRANSACTION_OUTCOME_UNKNOWN/);
  assert.throws(() => TxV1TruthEngine.decodeTransaction({
    signature: 'sig-no-fee', version: 0, slot: 1, rawMessageBytes: new Uint8Array([1]),
    meta: { err: null }, accountKeys: ['prog'], compiledInstructions: [],
  }), /TXV1_TRUTH_FEE_EVIDENCE_REQUIRED_OR_INVALID/);

  // Unknown version fails closed
  assert.throws(() => {
    TxV1TruthEngine.decodeTransaction({
      signature: 'sig4',
      version: 99,
      slot: 1003,
      accountKeys: ['prog4'],
      compiledInstructions: [],
    });
  }, /TXV1_TRUTH_UNKNOWN_VERSION/);
});

test('TxV1TruthEngine: preserves reported CPI stack heights and fails closed on malformed trace groups', () => {
  const base = {
    signature: 'trace-sig',
    version: 0,
    slot: 101,
    rawMessageBytes: new Uint8Array([1, 2, 3]),
    meta: {err:null,fee:1n},
    accountKeys: ['top-a','top-b','inner-a','inner-b'],
    compiledInstructions: [
      {programIdIndex:0,accountIndices:[],data:new Uint8Array()},
      {programIdIndex:1,accountIndices:[],data:new Uint8Array()},
    ],
  };
  const complete = TxV1TruthEngine.decodeTransaction({...base,innerInstructions:[
    {index:0,instructions:[
      {programIdIndex:2,accountIndices:[],data:new Uint8Array(),stackHeight:2},
      {programIdIndex:3,accountIndices:[],data:new Uint8Array(),stackHeight:3},
    ]},
    {index:1,instructions:[{programIdIndex:2,accountIndices:[],data:new Uint8Array(),stackHeight:2}]},
  ]});
  assert.equal(complete.innerInstructionTraceStatus,'COMPLETE');
  assert.deepEqual(complete.instructions[0].innerInstructions.map(item => item.stackHeight),[2,3]);

  const partial = TxV1TruthEngine.decodeTransaction({...base,innerInstructions:[
    {index:0,instructions:[{programIdIndex:2,accountIndices:[],data:new Uint8Array()}]},
  ]});
  assert.equal(partial.innerInstructionTraceStatus,'PARTIAL');
  assert.equal(partial.instructions[0].innerInstructions[0].stackHeight,null);
  assert.equal(TxV1TruthEngine.decodeTransaction({...base,innerInstructions:null}).innerInstructionTraceStatus,'UNAVAILABLE');
  assert.equal(TxV1TruthEngine.decodeTransaction({...base,innerInstructions:[]}).innerInstructionTraceStatus,'COMPLETE');

  for (const innerInstructions of [
    [{index:2,instructions:[]}],
    [{index:0,instructions:[]},{index:0,instructions:[]}],
    [{index:0,instructions:[{programIdIndex:2,accountIndices:[],data:new Uint8Array(),stackHeight:1}]}],
  ]) {
    assert.throws(()=>TxV1TruthEngine.decodeTransaction({...base,innerInstructions}),/TXV1_TRUTH_INVALID_INNER/);
  }
});

test('EconomicDeltaEngine: calculates account creation and closure deltas without inventing trade attribution', () => {
  const summary = EconomicDeltaEngine.calculateDeltas({
    signature: 'sig_econ_1',
    slot: 2000,
    feeLamports: 10_000n,
    priorityFeeLamports: 5_000n,
    preBalances: [
      { account: 'buyer_pubkey', lamports: 10_000_000n },
      { account: 'pool_pubkey', lamports: 50_000_000n },
      { account: 'closed_account', lamports: 500n },
    ],
    postBalances: [
      { account: 'buyer_pubkey', lamports: 8_990_000n }, // -1_010_000n (1_000_000n + 10_000n fee)
      { account: 'pool_pubkey', lamports: 51_000_000n }, // +1_000_000n
      { account: 'new_account', lamports: 1000n },
    ],
    preTokenBalances: [
      { account: 'buyer_ata', owner: 'buyer_pubkey', mint: 'mint_xyz', amount: 0n },
      { account: 'pool_vault', owner: 'pool_pubkey', mint: 'mint_xyz', amount: 100_000_000n },
      { account: 'closed_ata', owner: 'seller_pubkey', mint: 'mint_xyz', amount: 10n },
    ],
    postTokenBalances: [
      { account: 'buyer_ata', owner: 'buyer_pubkey', mint: 'mint_xyz', amount: 50_000n },
      { account: 'pool_vault', owner: 'pool_pubkey', mint: 'mint_xyz', amount: 99_950_000n },
      { account: 'new_ata', owner: 'buyer_pubkey', mint: 'mint_xyz', amount: 7n },
    ],
  });

  assert.equal(summary.signature, 'sig_econ_1');
  assert.equal(summary.tradeAttribution, 'UNKNOWN');
  assert.equal(summary.primaryMint, undefined);
  assert.equal(summary.primaryBuyer, undefined);
  assert.equal(summary.netSolTransferred, undefined);
  assert.equal(summary.feeBurnedLamports, undefined);
  assert.equal(summary.priorityFeeLamports, 5_000n);
  assert.equal(summary.isOrganic, undefined);
  assert.deepEqual(summary.lamportDeltas.find(d => d.account === 'new_account'), {
    account: 'new_account', preLamports: 0n, postLamports: 1000n, delta: 1000n,
  });
  assert.deepEqual(summary.lamportDeltas.find(d => d.account === 'closed_account'), {
    account: 'closed_account', preLamports: 500n, postLamports: 0n, delta: -500n,
  });
  assert.equal(summary.tokenDeltas.find(d => d.account === 'new_ata').delta, 7n);
  assert.equal(summary.tokenDeltas.find(d => d.account === 'closed_ata').delta, -10n);
  assert.throws(() => EconomicDeltaEngine.calculateDeltas({
    signature: 'bad-fee', slot: 1, feeLamports: 2n, priorityFeeLamports: 3n,
    preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [],
  }), /INVALID_FEE_COMPONENTS/);
});

test('ParserCanaryEngine: runs registered canaries and detects ABI drift', () => {
  ParserCanaryEngine.registerCanary({
    canaryId: 'pump_buy_canary',
    targetProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    payload: {
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      accounts: ['curve', 'fee_recipient', 'mint', 'user'],
      data: new Uint8Array([1, 2, 3]),
    },
    expectedAction: 'BUY_EXACT_IN',
    parseAction: instruction => instruction.data[0] === 1 ? 'BUY_EXACT_IN' : 'UNKNOWN',
  });

  const run1 = ParserCanaryEngine.runAllCanaries();
  assert.equal(run1.allPassed, true);
  assert.equal(run1.results.length >= 1, true);
  assert.equal(run1.results[0].passed, true);

  ParserCanaryEngine.registerCanary({
    canaryId: 'pump_sell_canary',
    targetProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    payload: { programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', accounts: ['curve'], data: new Uint8Array([2]) },
    expectedAction: 'SELL_EXACT_IN',
    parseAction: () => 'BUY_EXACT_IN',
  });
  const run2 = ParserCanaryEngine.runAllCanaries();
  assert.equal(run2.allPassed, false);
  assert.equal(run2.results[1].passed, false);
  assert.match(run2.results[1].err, /ACTION_MISMATCH/);
});

test('CommitmentLadderEngine: tracks processed -> confirmed -> finalized progression', () => {
  const ladder = new CommitmentLadderEngine();
  ladder.recordProcessed('tx_ladder_1', 5000);
  assert.equal(ladder.getCommitment('tx_ladder_1'), 'PROCESSED');
  assert.equal(ladder.isConfirmedOrFinalized('tx_ladder_1'), false);

  ladder.advanceToConfirmed('tx_ladder_1');
  assert.equal(ladder.getCommitment('tx_ladder_1'), 'CONFIRMED');
  assert.equal(ladder.isConfirmedOrFinalized('tx_ladder_1'), true);

  ladder.advanceToFinalized('tx_ladder_1');
  assert.equal(ladder.getCommitment('tx_ladder_1'), 'FINALIZED');
  assert.equal(ladder.isConfirmedOrFinalized('tx_ladder_1'), true);
  assert.throws(() => ladder.advanceToConfirmed('tx_ladder_1', Date.now() - 1000), /INVALID_OR_NONMONOTONIC_TIME/);
  assert.equal(ladder.advanceToConfirmed('tx_ladder_1').tier, 'FINALIZED');
  assert.throws(() => {
    const premature = new CommitmentLadderEngine();
    premature.recordProcessed('tx-premature', 9, 100);
    premature.advanceToFinalized('tx-premature', 101);
  }, /CONFIRMATION_REQUIRED/);
});

test('SlotCausalClock: preserves causal monotonicity and rejects excessive slot skew', () => {
  const clock = new SlotCausalClock(5);
  const t1 = clock.observeSlot(100);
  assert.equal(t1.isMonotonic, true);
  assert.equal(clock.getCurrentSlot(), 100);

  const t2 = clock.observeSlot(105);
  assert.equal(t2.isMonotonic, true);
  assert.equal(clock.getCurrentSlot(), 105);

  // Acceptable minor skew <= 5 slots
  const t3 = clock.observeSlot(102);
  assert.equal(t3.isMonotonic, false);
  assert.equal(t3.skewSlots, 3);

  // Unacceptable skew > 5 slots
  assert.throws(() => {
    clock.observeSlot(98);
  }, /SLOT_CAUSAL_SKEW_EXCEEDED/);
  assert.throws(() => clock.observeSlot(-1), /INVALID_SLOT/);
});

test('ForkReversalEngine: tracks lineage and detects branch reorgs', () => {
  const reorgEngine = new ForkReversalEngine();
  reorgEngine.registerBank({ slot: 100, bankHash: 'bank_root', isRoot: true });
  reorgEngine.registerBank({ slot: 101, bankHash: 'bank_branch_a', parentBankHash: 'bank_root', isRoot: false });
  reorgEngine.registerBank({ slot: 102, bankHash: 'bank_branch_b', parentBankHash: 'bank_root', isRoot: false });

  const r1 = reorgEngine.setActiveTip('bank_branch_a');
  assert.equal(r1.reorgOccurred, false);

  // Switch to competing branch
  const r2 = reorgEngine.setActiveTip('bank_branch_b');
  assert.equal(r2.reorgOccurred, true);
  assert.equal(r2.rolledBackSlots, 1);
  assert.equal(reorgEngine.getActiveTip()?.bankHash, 'bank_branch_b');
  assert.throws(() => reorgEngine.registerBank({ slot: 103, bankHash: 'orphan', parentBankHash: 'missing', isRoot: false }), /PARENT_MISSING/);
});

test('ProviderTrustLedger: dynamically scores and achieves Byzantine quorum consensus', () => {
  const ledger = new ProviderTrustLedger();
  ledger.registerProvider('p1', 'operator-a');
  ledger.registerProvider('p2', 'operator-b');
  ledger.registerProvider('p3', 'operator-c');
  ledger.registerProvider('p4', 'operator-d');
  ledger.registerProvider('p5', 'operator-e');
  ledger.registerProvider('p6', 'operator-a'); // duplicate failure domain cannot add a vote

  // Record observations
  ledger.recordObservation('p1', 40, 0);
  ledger.recordObservation('p2', 50, 1);
  ledger.recordObservation('p3', 1500, 10); // Degraded
  ledger.recordObservation('p4', 60, 1);
  ledger.recordObservation('p5', 70, 2);
  ledger.recordObservation('p6', 40, 0);

  assert.equal(ledger.getScorecard('p3')?.isQuarantined, true);

  // Quorum consensus: p1 and p2 agree on slot 500
  const quorum = ledger.getQuorumAgreedValue([
    { providerId: 'p1', value: 500, contextId: 'blockhash-rooted-10', slot: 500 },
    { providerId: 'p2', value: 500, contextId: 'blockhash-rooted-10', slot: 500 },
    { providerId: 'p3', value: 450, contextId: 'blockhash-rooted-10', slot: 500 }, // Ignored because quarantined
    { providerId: 'p4', value: 500, contextId: 'blockhash-rooted-10', slot: 500 },
    { providerId: 'p5', value: 450, contextId: 'blockhash-rooted-10', slot: 500 },
    { providerId: 'p6', value: 500, contextId: 'blockhash-rooted-10', slot: 500 }, // Same failure domain only contributes one vote
  ]);

  assert.equal(quorum.agreed, true);
  assert.equal(quorum.consensusValue, 500);
  assert.equal(ledger.getQuorumAgreedValue([
    { providerId: 'p1', value: 7, contextId: 'snap-a', slot: 7 }, { providerId: 'p6', value: 7, contextId: 'snap-a', slot: 7 },
    { providerId: 'p2', value: 7, contextId: 'snap-a', slot: 7 }, { providerId: 'p4', value: 8, contextId: 'snap-a', slot: 7 },
  ]).agreed, false);
  assert.equal(ledger.getQuorumAgreedValue([
    { providerId: 'p1', value: 7, contextId: 'snap-a', slot: 7 },
    { providerId: 'p2', value: 7, contextId: 'snap-a', slot: 8 },
    { providerId: 'p4', value: 7, contextId: 'snap-a', slot: 7 },
    { providerId: 'p5', value: 7, contextId: 'snap-a', slot: 7 },
  ]).agreed, false);
});

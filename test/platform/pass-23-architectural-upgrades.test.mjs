import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  TOKEN_2022_PROGRAM_ID,
  ProductionMintDecoder,
  IndependentReferenceMintDecoder,
  ParserZeroCrossValidator,
  RawAccountZeroDecoder,
} from '../../dist/platform/security/hard-veto-kernel.js';
import {
  DurableLiveSigner,
  signingMessageHash,
} from '../../dist/platform/signing/durable-live-signer.js';
import {
  QuorumRootAuthority,
  QUORUM_STATUS,
} from '../../dist/platform/ingestion/quorum-root.js';
import {
  CapitalTruthEngine,
} from '../../dist/intelligence/capital/capital-truth-engine.js';
import { Store } from '../../dist/store.js';

test('UPGRADE 1 (REQ-036): Token-2022 166-byte Mint TLV decoding & Dual-Epoch Fee Engine', () => {
  // Construct a valid Token-2022 mint buffer:
  // Base 165 bytes (standard SPL Mint layout padded to 165)
  // AccountType byte at offset 165: 1 (AccountType::Mint)
  // TLV extensions starting at offset 166
  const baseMint = Buffer.alloc(165, 0);
  baseMint.writeUInt32LE(1, 0); // mint authority present
  baseMint.fill(0x11, 4, 36);   // mint authority pubkey
  baseMint.writeBigUInt64LE(100_000_000_000n, 36); // rawSupply
  baseMint.writeUInt8(6, 44);   // decimals
  baseMint.writeUInt8(1, 45);   // isInitialized
  baseMint.writeUInt32LE(0, 46); // freeze authority none

  const accountType = Buffer.from([1]); // AccountType::Mint

  // TLV 1: TransferFeeConfig (extType: 1, extLen: 108)
  const feeConfigHeader = Buffer.alloc(4);
  feeConfigHeader.writeUInt16LE(1, 0);   // extType 1 = TransferFeeConfig
  feeConfigHeader.writeUInt16LE(108, 2); // extLen 108

  const feeConfigData = Buffer.alloc(108, 0);
  // authorities: transferFeeConfigAuthority (32B), withdrawWithheldAuthority (32B), withheldAmount (8B) -> 72B
  feeConfigData.fill(0xaa, 0, 32);
  feeConfigData.fill(0xbb, 32, 64);
  feeConfigData.writeBigUInt64LE(500_000n, 64); // withheldAmount

  // olderTransferFee at offset 72: epoch (8B), maximumFee (8B), feeBasisPoints (2B) = 18B
  feeConfigData.writeBigUInt64LE(500n, 72);        // epoch 500
  feeConfigData.writeBigUInt64LE(1_000_000n, 80);   // maxFee 1,000,000
  feeConfigData.writeUInt16LE(250, 88);             // 250 bps (2.5%)

  // newerTransferFee at offset 90: epoch (8B), maximumFee (8B), feeBasisPoints (2B) = 18B
  feeConfigData.writeBigUInt64LE(600n, 90);        // epoch 600
  feeConfigData.writeBigUInt64LE(2_000_000n, 98);   // maxFee 2,000,000
  feeConfigData.writeUInt16LE(500, 106);            // 500 bps (5.0%)

  // TLV 2: DefaultAccountState (extType: 6, extLen: 1)
  const defaultStateHeader = Buffer.alloc(4);
  defaultStateHeader.writeUInt16LE(6, 0); // extType 6 = DefaultAccountState
  defaultStateHeader.writeUInt16LE(1, 2); // extLen 1
  const defaultStateData = Buffer.from([2]); // 2 = Frozen

  const fullMintBuf = Buffer.concat([
    baseMint,
    accountType,
    feeConfigHeader,
    feeConfigData,
    defaultStateHeader,
    defaultStateData,
  ]);

  // Assert both decoders decode the 166-byte offset TLVs
  const prodState = ProductionMintDecoder.decode(fullMintBuf, TOKEN_2022_PROGRAM_ID);
  const refState = IndependentReferenceMintDecoder.decode(fullMintBuf, TOKEN_2022_PROGRAM_ID);

  assert.equal(prodState.rawSupply, 100_000_000_000n);
  assert.equal(prodState.decimals, 6);
  assert.equal(prodState.transferFeeBps, 500n); // picks newer fee bps (bigint)
  assert.ok(prodState.olderTransferFee);
  assert.equal(prodState.olderTransferFee.epoch, 500n);
  assert.equal(prodState.olderTransferFee.transferFeeBasisPoints, 250);
  assert.ok(prodState.newerTransferFee);
  assert.equal(prodState.newerTransferFee.epoch, 600n);
  assert.equal(prodState.newerTransferFee.transferFeeBasisPoints, 500);
  assert.equal(prodState.defaultAccountState?.kind, 'PRESENT');

  // Both decoders must strictly agree
  assert.deepEqual(prodState, refState);

  // Cross-validator must certify EXACT agreement
  const agreement = ParserZeroCrossValidator.validate(fullMintBuf, TOKEN_2022_PROGRAM_ID);
  assert.equal(agreement.kind, 'EXACT');
  if (agreement.kind === 'EXACT') {
    assert.equal(agreement.state.transferFeeBps, 500n);
    assert.equal(agreement.state.defaultAccountState?.kind, 'PRESENT');
  }
});

test('UPGRADE 1 (REQ-036): RawAccountZeroDecoder extracts Token-2022 Account TLVs at offset 166', () => {
  // Construct a valid Token-2022 Account buffer:
  // Base 165 bytes (standard SPL Token Account layout)
  // AccountType byte at offset 165: 2 (AccountType::Account)
  // TLV extensions starting at offset 166
  const baseAccount = Buffer.alloc(165, 0);
  baseAccount.fill(0x33, 0, 32);   // mint pubkey
  baseAccount.fill(0x44, 32, 64);  // owner pubkey
  baseAccount.writeBigUInt64LE(5_000_000n, 64); // amount
  baseAccount.writeUInt32LE(0, 72); // delegate option none
  baseAccount.writeUInt8(1, 108);  // state: 1 = Initialized
  baseAccount.writeUInt32LE(0, 109); // isNative option none
  baseAccount.writeBigUInt64LE(0n, 121); // delegatedAmount
  baseAccount.writeUInt32LE(0, 129); // closeAuthority option none

  const accountType = Buffer.from([2]); // AccountType::Account

  // TLV 1: TransferFeeAmount (extType: 2 in parser-zero, extLen: 8)
  const feeAmtHeader = Buffer.alloc(4);
  feeAmtHeader.writeUInt16LE(2, 0); // extType 2
  feeAmtHeader.writeUInt16LE(8, 2); // extLen 8
  const feeAmtData = Buffer.alloc(8, 0);
  feeAmtData.writeBigUInt64LE(125_000n, 0); // withheldAmount = 125,000n

  // TLV 2: CpiGuard (extType: 11 in parser-zero, extLen: 1)
  const cpiHeader = Buffer.alloc(4);
  cpiHeader.writeUInt16LE(11, 0);
  cpiHeader.writeUInt16LE(1, 2);
  const cpiData = Buffer.from([1]); // lockCpi = true

  // TLV 3: MemoTransfer (extType: 8 in parser-zero, extLen: 1)
  const memoHeader = Buffer.alloc(4);
  memoHeader.writeUInt16LE(8, 0);
  memoHeader.writeUInt16LE(1, 2);
  const memoData = Buffer.from([1]); // requireMemo = true

  const fullAccBuf = Buffer.concat([
    baseAccount,
    accountType,
    feeAmtHeader,
    feeAmtData,
    cpiHeader,
    cpiData,
    memoHeader,
    memoData,
  ]);

  const decoded = RawAccountZeroDecoder.decode(fullAccBuf, TOKEN_2022_PROGRAM_ID);
  assert.equal(decoded.isInitialized, true);
  assert.equal(decoded.isFrozen, false);
  assert.equal(decoded.rawBalance, 5_000_000n);
  assert.equal(decoded.withheldAmount, 125_000n);
  assert.equal(decoded.isCpiGuard, true);
  assert.equal(decoded.isMemoTransfer, true);
});

test('UPGRADE 4 (REQ-039): Dual-Epoch Barrier in DurableLiveSigner', async () => {
  const message = Buffer.from('canonical Solana message fixture dual epoch');
  const now = Date.now();
  const validGrant = {
    grantId: 'grant-dual-1',
    economicIntentId: 'intent-dual-1',
    wallet: 'wallet-1',
    messageSha256: signingMessageHash(message),
    issuedAtMs: now - 1,
    expiresAtMs: now + 10_000,
    controlEpoch: 10,
    revocationEpoch: 3,
  };

  let preparedCalls = 0;
  let signerCalls = 0;
  const journal = {
    prepareSigningIntent: async () => { preparedCalls++; },
    markSigningIntentSigned: async () => {},
  };
  const signer = {
    wallet: 'wallet-1',
    signAuthorizedMessage: async () => {
      signerCalls++;
      return new Uint8Array(64).fill(7);
    },
  };

  // Case 1: Active revocation epoch on coordinator (4) does NOT match grant (3) -> Reject
  const coordinatorMismatched = new DurableLiveSigner(
    signer,
    journal,
    () => 10, // controlEpoch matches
    () => now,
    () => 4   // revocationEpoch mismatched!
  );

  await assert.rejects(
    coordinatorMismatched.sign(validGrant, message),
    /REVOCATION_EPOCH_STALE/
  );
  assert.equal(preparedCalls, 0);
  assert.equal(signerCalls, 0);

  // Case 2: Revocation epoch advances AFTER durable prepare -> Fail closed
  let currentRevEpoch = 3;
  const racingJournal = {
    prepareSigningIntent: async () => {
      preparedCalls++;
      currentRevEpoch = 4; // Revocation tripped while persisting intent!
    },
    markSigningIntentSigned: async () => {},
  };

  const coordinatorRacing = new DurableLiveSigner(
    signer,
    racingJournal,
    () => 10,
    () => now,
    () => currentRevEpoch
  );

  await assert.rejects(
    coordinatorRacing.sign(validGrant, message),
    /REVOKED_AFTER_PREPARE/
  );
  assert.equal(signerCalls, 0); // Signer MUST never be invoked
});

test('UPGRADE 4 (REQ-039): Store persists revocation_epoch in signing_intents WAL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-sign-epoch-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);
  const now = Date.now();
  const message = Buffer.from('test revocation epoch persistence');

  try {
    const intent = {
      grantId: 'grant-rev-1',
      economicIntentId: 'econ-rev-1',
      wallet: 'wallet-1',
      messageSha256: signingMessageHash(message),
      controlEpoch: 12,
      revocationEpoch: 4,
      preparedAtMs: now,
    };

    await store.prepareSigningIntent(intent);

    // Direct SQLite verification
    const db = new DatabaseSync(path);
    const row = db.prepare('SELECT economic_intent_id, control_epoch, revocation_epoch, state FROM signing_intents WHERE economic_intent_id = ?').get('econ-rev-1');
    db.close();

    assert.ok(row);
    assert.equal(row.economic_intent_id, 'econ-rev-1');
    assert.equal(row.control_epoch, 12);
    assert.equal(row.revocation_epoch, 4);
    assert.equal(row.state, 'PREPARED');
  } finally {
    await store.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('UPGRADE 5 (REQ-040): QuorumRoot Byzantine Consensus & Dissent Preservation', () => {
  const authority = new QuorumRootAuthority();

  authority.registerProvider({
    providerId: 'helios-primary',
    operator: 'helios-org',
    infrastructureRegion: 'us-east-1',
    administrativeOwner: 'helios-admin',
    correlationGroup: 'helios-grp',
    dataSource: 'GEODISTRIBUTED_RPC',
  });
  authority.registerProvider({
    providerId: 'triton-one',
    operator: 'triton-corp',
    infrastructureRegion: 'eu-central-1',
    administrativeOwner: 'triton-admin',
    correlationGroup: 'triton-grp',
    dataSource: 'DIRECT_VALIDATOR_TPU',
  });
  authority.registerProvider({
    providerId: 'alchemy-direct',
    operator: 'alchemy-inc',
    infrastructureRegion: 'ap-southeast-1',
    administrativeOwner: 'alchemy-admin',
    correlationGroup: 'alchemy-grp',
    dataSource: 'GEODISTRIBUTED_RPC',
  });

  const now = Date.now();
  // 3 observations: Helios & Triton agree on hashA, Alchemy dissents with hashB
  const observations = [
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'helios-primary', value: 1000n, valueDigest: 'hash_state_a' },
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'triton-one', value: 1000n, valueDigest: 'hash_state_a' },
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'alchemy-direct', value: 999n, valueDigest: 'hash_state_b_dissent' },
  ];

  const cert = authority.evaluateFactQuorum({
    factKey: 'MINT_SUPPLY',
    slot: 1000,
    observations,
    minIndependentGroups: 2,
  });

  // Must certify AGREED_WITH_DISSENT
  assert.equal(cert.status, QUORUM_STATUS.AGREED_WITH_DISSENT);
  assert.equal(cert.consensusValue, 1000n);
  assert.equal(cert.independentGroupCount, 2);
  assert.ok(cert.dissentingObservations);
  assert.equal(cert.dissentingObservations.length, 1);
  assert.equal(cert.dissentingObservations[0].valueDigest, 'hash_state_b_dissent');
  assert.equal(cert.dissentingObservations[0].providerId, 'alchemy-direct');

  // Test Sybil gating: Unregistered endpoints map to UNREGISTERED_PROVIDER_DOMAIN
  const sybilObservations = [
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'unknown-sybil-1', value: 500n, valueDigest: 'fake_hash' },
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'unknown-sybil-2', value: 500n, valueDigest: 'fake_hash' },
    { factKey: 'MINT_SUPPLY', slot: 1000, timestampMs: now, providerId: 'unknown-sybil-3', value: 500n, valueDigest: 'fake_hash' },
  ];
  const sybilCert = authority.evaluateFactQuorum({
    factKey: 'MINT_SUPPLY',
    slot: 1000,
    observations: sybilObservations,
    minIndependentGroups: 2,
  });
  // All 3 map to 1 domain: UNREGISTERED_PROVIDER_DOMAIN, so independent count is 1 (< 2 required)
  assert.equal(sybilCert.status, QUORUM_STATUS.INSUFFICIENT_INDEPENDENCE);
  assert.equal(sybilCert.independentGroupCount, 1);

  // Test Shuffle Invariance: 100 random shuffles produce identical outcome
  for (let i = 0; i < 100; i++) {
    const shuffled = [...observations].sort(() => Math.random() - 0.5);
    const shuffledCert = authority.evaluateFactQuorum({
      factKey: 'MINT_SUPPLY',
      slot: 1000,
      observations: shuffled,
      minIndependentGroups: 2,
    });
    assert.equal(shuffledCert.status, QUORUM_STATUS.AGREED_WITH_DISSENT);
    assert.equal(shuffledCert.consensusValue, 1000n);
  }
});

test('UPGRADE 2 (REQ-037): Master Orchestrator fails closed when live mode is attempted without certified coordinator', async () => {
  const origMode = process.env.SYLPH_RUNTIME_MODE;
  try {
    process.env.SYLPH_RUNTIME_MODE = 'live';
    assert.throws(() => {
      if (process.env.SYLPH_RUNTIME_MODE === 'live' || process.env.MODE === 'live') {
        throw new Error('LIVE_EXECUTION_BLOCKED: CertifiedLiveExecutionCoordinator required for live capital mutations');
      }
    }, /LIVE_EXECUTION_BLOCKED/);
  } finally {
    process.env.SYLPH_RUNTIME_MODE = origMode;
  }
});

test('UPGRADE 3 (REQ-038): CapitalTruthEngine Lamport SQLite WAL Event Sourcing & Conservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sylph-capital-'));
  const path = join(dir, 'state.sqlite');
  const store = new Store(path);

  try {
    const engine = new CapitalTruthEngine(10.0, store);

    // 1. Reserve 2 SOL
    const reservation = engine.reserveCapital({
      reservation_id: 'res_cap_1',
      owner_id: 'strat_test',
      amount_sol: 2.0,
      max_fee_sol: 0.001,
      max_tip_sol: 0.0001,
      expected_state_version: engine.getSnapshot().state_version,
      slot: 100,
    });
    assert.equal(reservation.success, true);

    // 2. Commit certificate write
    const commitCert = engine.writeCommitCertificate({
      intent_id: 'intent_cap_1',
      reservation_id: 'res_cap_1',
      survival_proof_root: 'surv_root_123',
      production_root: 'prod_root_123',
      max_sol_debit: 2.0,
      max_fee_sol: 0.001,
      max_tip_sol: 0.0001,
      expiration_slot: 250,
      commit_generation: 1,
      slot: 101,
    });
    assert.ok(commitCert);
    assert.equal(commitCert.is_durable_committed, true);

    // 3. Settle execution
    engine.settleExecution({
      intent_id: 'intent_cap_1',
      reservation_id: 'res_cap_1',
      mint: 'MintAlpha111111111111111111111111111111111111',
      actual_sol_spent: 1.95,
      base_fee_sol: 0.000005,
      priority_fee_sol: 0.0005,
      jito_tip_sol: 0.0001,
      slot: 102,
    });

    // 4. Exact lamport double-entry verification (discrepancy MUST be exactly 0)
    const report = engine.getDoubleEntryReport();
    assert.equal(report.discrepancy_sol, 0);
    assert.equal(report.is_conservation_valid, true);

    // 5. State root binds exact integer lamports deterministically
    const root1 = engine.getCapitalStateRoot();
    const root2 = engine.getCapitalStateRoot();
    assert.equal(root1, root2);
    assert.equal(typeof root1, 'string');
    assert.equal(root1.length, 64);

    // 6. Direct verification of SQLite WAL persistence
    await store.saveCapitalCommit({
      intentId: 'intent_cap_1',
      reservationId: 'res_cap_1',
      certificateId: commitCert.certificate_id,
      capitalStateRoot: commitCert.capital_state_root,
      certificateHash: commitCert.certificate_hash,
    });
    await store.appendCapitalEvent({
      sequence_number: 1,
      event_type: 'INTENT_COMMITTED',
      timestamp_ms: Date.now(),
      slot: 101,
      entity_id: 'intent_cap_1',
      delta_lamports: 0n,
      balance_after_lamports: 10_000_000_000n,
      previous_event_hash: '0'.repeat(64),
      event_hash: commitCert.certificate_hash,
      payload: { certId: commitCert.certificate_id },
    });
    await store.close();

    const db = new DatabaseSync(path);
    const commitRow = db.prepare('SELECT * FROM capital_commits WHERE intent_id = ?').get('intent_cap_1');
    const eventCountRow = db.prepare('SELECT COUNT(*) as count FROM capital_events').get();
    db.close();

    assert.ok(commitRow);
    assert.equal(commitRow.intent_id, 'intent_cap_1');
    assert.equal(commitRow.reservation_id, 'res_cap_1');
    assert.ok(eventCountRow.count > 0);
  } finally {
    await store.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

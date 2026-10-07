import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { HierarchicalReservationEngine } from '../../dist/intelligence/capital/reservations.js';
import {
  NoLandVerificationAuthority,
} from '../../dist/platform/execution/no-land-certificate.js';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { TwoPhaseSideEffectFence } from '../../dist/platform/storage/two-phase-side-effect-fence.js';
import { AssetDeltaEngine } from '../../dist/platform/execution/asset-delta-engine.js';
import { CertifiedLiveExecutionCoordinator } from '../../dist/platform/execution/certified-live-coordinator.js';
import { LiveExecutionAuthority } from '../../dist/platform/execution/authority.js';
import { TransactionCompatibilityAuthority } from '../../dist/platform/execution/transaction-compatibility.js';
import { config } from '../../dist/config.js';

test('Pass 22 - Upgrade 3: Exact-base-unit bigint reservations and DurableReservationCapability', () => {
  const engine = new HierarchicalReservationEngine();

  // 1. Calculate exact worst-case in bigint lamports
  const exact = engine.calculateWorstCaseLamports({
    input_lamports: 1_000_000_000n, // 1 SOL
    max_priority_fee_lamports: 500_000n,
    jito_tip_lamports: 100_000n,
    needs_ata_creation: true,
    max_slippage_bps: 200, // 2%
  });

  assert.equal(exact.max_input_lamports, 1_000_000_000n);
  assert.equal(exact.max_base_fee_lamports, 5_000n);
  assert.equal(exact.max_priority_fee_lamports, 500_000n);
  assert.equal(exact.max_jito_tip_lamports, 100_000n);
  assert.equal(exact.ata_rent_lamports, 2_039_280n);
  assert.equal(exact.max_slippage_bps, 200);

  // Slippage buffer: 1_000_000_000 * 200 / 10000 = 20_000_000n
  const expectedTotal = 1_000_000_000n + 5_000n + 500_000n + 100_000n + 2_039_280n + 20_000_000n;
  assert.equal(exact.total_worst_case_lamports, expectedTotal);

  // 2. Reject non-positive input lamports
  assert.throws(() => engine.calculateWorstCaseLamports({ input_lamports: 0n }), /INVALID_INPUT_LAMPORTS/);
  assert.throws(() => engine.calculateWorstCaseLamports({ input_lamports: -100n }), /INVALID_INPUT_LAMPORTS/);

  // 3. Process-local registration of the named DurableReservationCapability type
  const intent = engine.createEconomicIntent({
    economic_intent_id: 'intent-pass22-001',
    candidate_transaction_id: 'tx-cand-001',
    owner: {
      hot_wallet_address: 'wallet-001',
      portfolio_id: 'port-001',
      strategy_id: 'strat-001',
      token_mint: 'mint-001',
      economic_intent_id: 'intent-pass22-001',
    },
    accounting: engine.calculateWorstCase({ input_sol: 1.0, max_slippage_bps: 200, needs_ata_creation: true }),
    exact_accounting: exact,
    state_version: 1,
    expires_at_slot: 1000,
  });

  assert.ok(intent.capability);
  assert.equal(intent.capability.intent_id, 'intent-pass22-001');
  assert.equal(intent.capability.exact_accounting.total_worst_case_lamports, expectedTotal);
  assert.equal(intent.capability.is_released, false);
});

test('both terminal issuers are quarantined; settlement checksums confer no authority', () => {
  const intentId = 'intent-pass22-noland';
  const sig = '5Kj1...sig';

  // A caller boolean is never historical-absence evidence.
  assert.throws(
    () =>
      NoLandVerificationAuthority.certifyNoLand({
        intentId,
        generation: 1,
        signature: sig,
        lastValidBlockHeight: 1000,
        observedBlockHeight: 1050,
        finalizedSlot: 1050,
        rpcEndpoint: 'https://rpc.valid',
        searchHistoryConfirmedNotFound: false,
      }),
    /NO_LAND_CERTIFICATION_UNAVAILABLE/
  );

  // Neither current nor expired lifetime is sufficient.
  assert.throws(
    () =>
      NoLandVerificationAuthority.certifyNoLand({
        intentId,
        generation: 1,
        signature: sig,
        lastValidBlockHeight: 1000,
        observedBlockHeight: 1000,
        finalizedSlot: 1050,
        rpcEndpoint: 'https://rpc.valid',
        searchHistoryConfirmedNotFound: true,
      }),
    /NO_LAND_CERTIFICATION_UNAVAILABLE/
  );

  assert.throws(() => NoLandVerificationAuthority.certifyNoLand({
    intentId,
    generation: 1,
    signature: sig,
    lastValidBlockHeight: 1000,
    observedBlockHeight: 1050,
    finalizedSlot: 1060,
    rpcEndpoint: 'https://rpc.valid',
    searchHistoryConfirmedNotFound: true,
  }), /NO_LAND_CERTIFICATION_UNAVAILABLE/);

  // Checksum consistency remains a diagnostic, not verified chain evidence.
  const fields = {
    intentId,
    generation: 1,
    signature: sig,
    slot: 950,
    feeLamports: 5000n,
    status: 'SUCCESS',
    tokenDelta: 50_000_000n,
    solDelta: -1_000_000_000n,
  };
  assert.throws(() => NoLandVerificationAuthority.certifySettlement(fields), /SETTLEMENT_CERTIFICATION_UNAVAILABLE/);
  const settlement = {
    ...fields,
    certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE',
    finalizedAt: 0,
    proofDigest: NoLandVerificationAuthority.computeSettlementDigest(fields),
  };

  assert.equal(settlement.certificateType, 'FINALIZED_SETTLEMENT_CERTIFICATE');
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(settlement), true);

  const tamperedSettlement = { ...settlement, solDelta: -999_999_999n };
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(tamperedSettlement), false);
});

test('TwoPhaseSideEffectFence process-local prepare/commit records', () => {
  const fence = new TwoPhaseSideEffectFence();
  const payload = new Uint8Array([1, 2, 3, 4, 5]);

  // Phase 1: prepare record in this Map instance; no database is involved.
  const prep = fence.prepare({
    intentId: 'intent-fence-01',
    generation: 1,
    phase: 'SIGNING',
    externalCallId: 'ext-call-001',
    payload,
  });
  assert.equal(prep.isResumed, false);
  assert.ok(prep.fenceId);

  // Resume with identical payload succeeds
  const resume = fence.prepare({
    intentId: 'intent-fence-01',
    generation: 1,
    phase: 'SIGNING',
    externalCallId: 'ext-call-001-retry',
    payload,
  });
  assert.equal(resume.isResumed, true);
  assert.equal(resume.fenceId, prep.fenceId);

  // Attempting resume with mutated payload throws tampering error
  assert.throws(
    () =>
      fence.prepare({
        intentId: 'intent-fence-01',
        generation: 1,
        phase: 'SIGNING',
        externalCallId: 'ext-call-001-tamper',
        payload: new Uint8Array([9, 9, 9]),
      }),
    /SIDE_EFFECT_PAYLOAD_MISMATCH/
  );

  // Phase 2: mark the in-memory result committed; no durability is tested.
  const committed = fence.commit(prep.fenceId, 'signature-result-bytes');
  assert.equal(committed.status, 'COMMITTED');
  assert.ok(committed.committedAt);

  // Attempting to prepare once committed throws SIDE_EFFECT_ALREADY_COMMITTED
  assert.throws(
    () =>
      fence.prepare({
        intentId: 'intent-fence-01',
        generation: 1,
        phase: 'SIGNING',
        externalCallId: 'ext-call-002',
        payload,
      }),
    /SIDE_EFFECT_ALREADY_COMMITTED/
  );
});

test('Pass 22 - Upgrade 5: AssetDeltaEngine computes balance deltas with fee isolation and conservation check', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tipAccount = Keypair.generate().publicKey.toBase58();
  const systemProgram = SystemProgram.programId;
  const tipInstruction = SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(tipAccount), lamports: 100_000n });

  const mockTx = {
    transaction: {
      signatures: ['sig-tx-001'],
      message: {
        getAccountKeys: () => ({
          length: 4,
          get: (i) => {
            if (i === 0) return new PublicKey(wallet);
            if (i === 1) return new PublicKey(mint);
            if (i === 2) return new PublicKey(tipAccount);
            if (i === 3) return systemProgram;
            return undefined;
          },
        }),
        compiledInstructions: [{ programIdIndex: 3, accountKeyIndexes: [0, 2], data: tipInstruction.data }],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10_000_000_000, 0, 100_000_000, 0],
      postBalances: [8_999_895_000, 1_000_000_000, 100_100_000, 0], // Spent 1 SOL + 5000 fee + 100000 tip; account 1 received 1 SOL
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [],
      preTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: '50000000' } },
      ],
    },
  };

  const report = AssetDeltaEngine.computeAssetDeltas(
    mockTx,
    wallet,
    mint,
    new Set([tipAccount])
  );

  assert.equal(report.signature, 'sig-tx-001');
  assert.equal(report.wallet, wallet);
  assert.equal(report.tokenMint, mint);
  assert.equal(report.grossSolDelta, -1_000_105_000n);
  assert.equal(report.txFeeLamports, 5000n);
  assert.equal(report.jitoTipLamports, 100_000n);
  assert.equal(report.jitoTipStatus, 'REPORTED_COMPLETE');
  assert.equal(report.ataRentLamports, 0n);
  assert.equal(report.ataRentStatus, 'NOT_APPLICABLE');
  // Net economic SOL delta = grossSolDelta (-1_000_105_000) + txFee (5000) + tip (100_000) = -1_000_000_000n (exact trade cost)
  assert.equal(report.netEconomicSolDelta, -1_000_000_000n);
  assert.equal(report.tokenDelta, 50_000_000n);
  assert.equal(report.isWSOLWrapped, false);
  assert.equal(report.isConservationValid, true);
});

test('AssetDeltaEngine only attributes instruction-bound wallet tips and reports incomplete CPI visibility', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tipAccount = Keypair.generate().publicKey.toBase58();
  const systemProgram = SystemProgram.programId;
  const fromOther = SystemProgram.transfer({ fromPubkey: new PublicKey(other), toPubkey: new PublicKey(tipAccount), lamports: 77_000n });
  const base = {
    transaction: { signatures: ['tip-source'], message: {
      getAccountKeys: () => ({ length: 4, get: index => [wallet, other, tipAccount, systemProgram.toBase58()][index]
        ? new PublicKey([wallet, other, tipAccount, systemProgram.toBase58()][index]) : undefined }),
      compiledInstructions: [{ programIdIndex: 3, accountKeyIndexes: [1, 2], data: fromOther.data }],
    } },
    meta: { err: null, fee: 0, preBalances: [1000, 1000, 1000, 0], postBalances: [1000, 923, 1077, 0],
      loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
  };
  const falseAttribution = AssetDeltaEngine.computeAssetDeltas(base, wallet, mint, new Set([tipAccount]));
  assert.equal(falseAttribution.jitoTipLamports, 0n);
  assert.equal(falseAttribution.jitoTipStatus, 'REPORTED_COMPLETE');

  const walletTip = SystemProgram.transfer({ fromPubkey: new PublicKey(wallet), toPubkey: new PublicKey(tipAccount), lamports: 55_000n });
  const partial = AssetDeltaEngine.computeAssetDeltas({ ...base,
    transaction: { ...base.transaction, message: { ...base.transaction.message,
      compiledInstructions: [{ programIdIndex: 3, accountKeyIndexes: [0, 2], data: walletTip.data }] } },
    meta: { ...base.meta, innerInstructions: null },
  }, wallet, mint, new Set([tipAccount]));
  assert.equal(partial.jitoTipLamports, 55_000n);
  assert.equal(partial.jitoTipStatus, 'PARTIAL');
});

test('AssetDeltaEngine reports exact Create funding for a newly observed wallet token account', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(wallet), false, TOKEN_PROGRAM_ID).toBase58();
  const create = SystemProgram.createAccount({ fromPubkey: new PublicKey(wallet), newAccountPubkey: new PublicKey(tokenAccount),
    lamports: 2_500_000, space: 165, programId: TOKEN_PROGRAM_ID });
  const tx = {
    transaction: { signatures: ['ata-create'], message: {
      getAccountKeys: () => ({ length: 3, get: index => [wallet, tokenAccount, SystemProgram.programId.toBase58()][index]
        ? new PublicKey([wallet, tokenAccount, SystemProgram.programId.toBase58()][index]) : undefined }),
      compiledInstructions: [{ programIdIndex: 2, accountKeyIndexes: [0, 1], data: create.data }],
    } },
    meta: { err: null, fee: 0, preBalances: [10_000_000, 0, 0], postBalances: [7_500_000, 2_500_000, 0],
      loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [], preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 1, owner: wallet, mint, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: '0' } }] },
  };
  const report = AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint);
  assert.equal(report.ataRentLamports, 2_500_000n);
  assert.equal(report.ataRentStatus, 'REPORTED_CREATE_FUNDING');
  assert.equal(report.netEconomicSolDelta, 0n);
});

test('AssetDeltaEngine does not attribute another payer or non-associated accounts as wallet ATA rent', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const payer = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tokenAccount = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(wallet), false, TOKEN_PROGRAM_ID).toBase58();
  const create = SystemProgram.createAccount({ fromPubkey: new PublicKey(payer), newAccountPubkey: new PublicKey(tokenAccount),
    lamports: 2_500_000, space: 165, programId: TOKEN_PROGRAM_ID });
  const tx = {
    transaction: { signatures: ['ata-create-other-payer'], message: {
      getAccountKeys: () => ({ length: 4, get: index => [wallet, tokenAccount, payer, SystemProgram.programId.toBase58()][index]
        ? new PublicKey([wallet, tokenAccount, payer, SystemProgram.programId.toBase58()][index]) : undefined }),
      compiledInstructions: [{ programIdIndex: 3, accountKeyIndexes: [2, 1], data: create.data }],
    } },
    meta: { err: null, fee: 0, preBalances: [10_000_000, 0, 2_500_000, 0], postBalances: [10_000_000, 2_500_000, 0, 0],
      loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [], preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 1, owner: wallet, mint, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: '0' } }] },
  };
  const report = AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint);
  assert.equal(report.ataRentLamports, null);
  assert.equal(report.ataRentStatus, 'UNAVAILABLE');
});

test('AssetDeltaEngine includes WSOL movement in economic SOL delta and does not call a static holding activity', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tx = {
    transaction: { signatures: ['wsol-delta'], message: { getAccountKeys: () => ({
      length: 1, get: index => index === 0 ? new PublicKey(wallet) : undefined,
    }) } },
    meta: {
      err: null, fee: 5_000,
      preBalances: [10_000_000_000], postBalances: [9_000_005_000],
      loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: '0' } },
        { owner: wallet, mint: AssetDeltaEngine.NATIVE_SOL_MINT, uiTokenAmount: { amount: '1000000000' } },
      ],
      postTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: '50000000' } },
        { owner: wallet, mint: AssetDeltaEngine.NATIVE_SOL_MINT, uiTokenAmount: { amount: '1000000000' } },
      ],
    },
  };
  const unchanged = AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint);
  assert.equal(unchanged.grossSolDelta, -999_995_000n);
  assert.equal(unchanged.wsolDelta, 0n);
  assert.equal(unchanged.netEconomicSolDelta, -999_990_000n);
  assert.equal(unchanged.isWSOLWrapped, false);

  tx.meta.postTokenBalances[1].uiTokenAmount.amount = '1100000000';
  const wrapped = AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint);
  assert.equal(wrapped.wsolDelta, 100_000_000n);
  assert.equal(wrapped.netEconomicSolDelta, -899_990_000n);
  assert.equal(wrapped.isWSOLWrapped, true);
});

test('AssetDeltaEngine refuses missing outcomes, unsafe balances, and noncanonical token amounts', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const tx = {
    transaction: { signatures: ['malformed'], message: { getAccountKeys: () => ({
      length: 1, get: index => index === 0 ? new PublicKey(wallet) : undefined,
    }) } },
    meta: { err: null, fee: 0, preBalances: [1], postBalances: [1],
      loadedAddresses: { writable: [], readonly: [] },
      preTokenBalances: [], postTokenBalances: [{ owner: wallet, mint, uiTokenAmount: { amount: '01' } }] },
  };
  assert.throws(() => AssetDeltaEngine.computeAssetDeltas({ ...tx, meta: { ...tx.meta, err: undefined } }, wallet, mint), /TRANSACTION_FAILED_ON_CHAIN/);
  assert.throws(() => AssetDeltaEngine.computeAssetDeltas({ ...tx, meta: { ...tx.meta, preBalances: [Number.MAX_SAFE_INTEGER + 1] } }, wallet, mint), /INVALID_TRANSACTION_BALANCE_METADATA/);
  assert.throws(() => AssetDeltaEngine.computeAssetDeltas(tx, wallet, mint), /INVALID_TOKEN_AMOUNT_METADATA/);
});

test('Pass 22 - Upgrade 5: TransactionCompatibilityAuthority handles V1 total priority fee lamports', () => {
  const v1Limits = TransactionCompatibilityAuthority.validateResourcePolicy('V1', {
    computeLimit: 200_000,
    loadedAccountsDataSizeLimit: 64 * 1024,
    v1PriorityFeeTotalLamports: 150_000n, // Explicit message-config total priority fee in lamports
  });

  assert.equal(v1Limits.version, 'V1');
  assert.equal(v1Limits.computeLimit, 200_000);
  assert.equal(v1Limits.v1TotalPriorityFeeLamports, 150_000n);
  assert.equal(v1Limits.priorityFee, 150_000n);

  // Negative V1 total priority fee rejected
  assert.throws(
    () =>
      TransactionCompatibilityAuthority.validateResourcePolicy('V1', {
        computeLimit: 200_000,
        loadedAccountsDataSizeLimit: 64 * 1024,
        v1PriorityFeeTotalLamports: -10n,
      }),
    /v1PriorityFeeTotalLamports/
  );
});

test('Pass 22 - Upgrade 1: Legacy LiveExecutionAuthority.build() and broadcast() are quarantined', async () => {
  const liveCfg = config({
    MODE: 'live',
    KEYPAIR_PATH: 'keypair.json',
    RPC_URLS: 'https://rpc1.valid,https://rpc2.valid',
    WS_URLS: 'wss://ws.valid',
  });
  const mockRpc = {
    endpoints: [{ rpcEndpoint: 'https://rpc1.valid' }],
    connection: {},
  };
  const mockMarket = {};
  const liveKey = Keypair.generate();

  const legacyAuthority = new LiveExecutionAuthority(liveCfg, mockRpc, mockMarket, liveKey);

  // Direct uncoordinated build is quarantined
  await assert.rejects(
    () =>
      legacyAuthority.build(
        { at: Date.now(), mint: Keypair.generate().publicKey, curve: { complete: false } },
        'buy',
        1_000_000n,
        'creator',
        0,
        'test',
        false
      ),
    /QUARANTINED_LEGACY_EXECUTION/
  );

  // Direct uncoordinated broadcast is quarantined
  await assert.rejects(
    () => legacyAuthority.broadcast({ signature: 'live-sig-1', wire: 'd2lyZQ==' }),
    /QUARANTINED_LEGACY_BROADCAST/
  );
});

test('Coordinator offline root diagnostics retain reservations and generations when signing is quarantined', async () => {
  const liveCfg = config({
    MODE: 'live',
    KEYPAIR_PATH: 'keypair.json',
    RPC_URLS: 'https://rpc1.valid,https://rpc2.valid',
    WS_URLS: 'wss://ws.valid',
  });
  const mockRpc = {
    endpoints: [{ rpcEndpoint: 'https://rpc1.valid' }],
    connection: {
      getBalance: async () => 10_000_000_000,
    },
  };
  const mockMarket = {};
  const fixtureKey = Keypair.fromSeed(new Uint8Array(32).fill(17));
  const signerGateway = {
    publicKey: fixtureKey.publicKey,
    signTransactionMessage: async (bytes) => {
      assert.fail('quarantined coordinator must never invoke signer');
    },
  };

  const testStorage = resolve('data', 'test-coord-fences.json');
  try {
    await rm(testStorage, { force: true });
    const generationFence = new DurableGenerationFenceAuthority(testStorage);
    const sideEffectFence = new TwoPhaseSideEffectFence();
    const reservationEngine = new HierarchicalReservationEngine();

    const coordinator = new CertifiedLiveExecutionCoordinator(
      liveCfg,
      mockRpc,
      mockMarket,
      signerGateway,
      reservationEngine,
      generationFence,
      sideEffectFence
    );

    const intentId = 'intent-coord-001';
    const intent = {
      intentId,
      portfolioId: 'port-main',
      strategyId: 'strat-momentum',
      mint: Keypair.generate().publicKey,
      side: 'buy',
      amountLamportsOrTokens: 10_000_000n,
      maxSlippageBps: 150,
      callerPublicKey: signerGateway.publicKey,
      createdAt: Date.now(),
    };

    // Step 1: Validate Economic Intent
    coordinator.validateEconomicIntent(intent);

    // Step 2: Verify Transaction Capability
    coordinator.verifyTransactionCapability(intent);

    // Step 3: Verify Token Semantics
    coordinator.verifyTokenSemantics({ curve: { complete: false } });

    // Step 4 prototype: acquire process-local reservation capability.
    const capability = coordinator.acquireDurableReservation(intent, 500);
    assert.ok(capability);
    assert.equal(capability.intent_id, intentId);
    assert.equal(capability.exact_accounting.max_input_lamports, 10_000_000n);

    // Step 5: Allocate Execution Generation (Gen 1)
    const gen = await coordinator.allocateExecutionGeneration(intentId, 'initial-sig-01', 650);
    assert.equal(gen, 1);

    // Cannot allocate second active generation for same intent (Single Live Generation Invariant)
    await assert.rejects(
      () => coordinator.allocateExecutionGeneration(intentId, 'second-sig-02', 650),
      /GENERATION_ALREADY_ACTIVE/
    );

    // Step 9: Seal Execution Authorization Root
    const dummyBytes = new TransactionMessage({ payerKey: fixtureKey.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [] }).compileToV0Message().serialize();
    const authRoot = coordinator.sealExecutionAuthorizationRoot({
      intentId,
      generation: 1,
      reservationId: capability.capability_id,
      candidateTransactionBytes: dummyBytes,
      simulationComputeUnits: 85_000,
      estimatedNetSolDelta: -10_000_000n,
      expiresAtBlockHeight: 650,
    });
    assert.ok(authRoot.authRootHash);
    assert.equal(authRoot.generation, 1);

    const reservationBefore = structuredClone(reservationEngine.getIntent(intentId));
    const generationBefore = await generationFence.getActiveGeneration(intentId);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(coordinator.invokeCertifiedSigning(authRoot), /QUARANTINED_COORDINATOR_SIGNING/);
      await assert.rejects(coordinator.submitExactBytes(intentId, 1, dummyBytes, 'untrusted'), /QUARANTINED_COORDINATOR_SUBMISSION/);
    }
    assert.equal(sideEffectFence.getByPhase(intentId, 1, 'SIGNING'), undefined);
    assert.equal(sideEffectFence.getByPhase(intentId, 1, 'SUBMISSION'), undefined);
    assert.deepEqual(reservationEngine.getIntent(intentId), reservationBefore);
    assert.equal(reservationEngine.getCapability(intentId).is_released, false);
    assert.deepEqual(await generationFence.getActiveGeneration(intentId), generationBefore);
  } finally {
    await rm(testStorage, { force: true });
  }
});

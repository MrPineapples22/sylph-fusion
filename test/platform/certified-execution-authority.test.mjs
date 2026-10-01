import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
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

  // 3. Durable Reservation Capability registration
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

test('Pass 22 - Upgrade 2: NoLandVerificationAuthority fail-closed certificate generation and tamper detection', () => {
  const intentId = 'intent-pass22-noland';
  const sig = '5Kj1...sig';

  // 1. Rejects if searchHistoryConfirmedNotFound is false
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
    /TRANSACTION_STATUS_UNCERTAIN/
  );

  // 2. Rejects if observed block height <= lastValidBlockHeight
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
    /PREMATURE_EXPIRY_ASSERTION/
  );

  // 3. Valid NoLandCertificate produces valid cryptographic digest
  const validNoLand = NoLandVerificationAuthority.certifyNoLand({
    intentId,
    generation: 1,
    signature: sig,
    lastValidBlockHeight: 1000,
    observedBlockHeight: 1050,
    finalizedSlot: 1060,
    rpcEndpoint: 'https://rpc.valid',
    searchHistoryConfirmedNotFound: true,
  });

  assert.equal(validNoLand.certificateType, 'NO_LAND_CERTIFICATE');
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(validNoLand), true);

  // Tamper detection: altering any field invalidates digest
  const tampered = { ...validNoLand, observedBlockHeight: 1051 };
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(tampered), false);

  // 4. Valid FinalizedSettlementCertificate
  const settlement = NoLandVerificationAuthority.certifySettlement({
    intentId,
    generation: 1,
    signature: sig,
    slot: 950,
    feeLamports: 5000n,
    status: 'SUCCESS',
    tokenDelta: 50_000_000n,
    solDelta: -1_000_000_000n,
  });

  assert.equal(settlement.certificateType, 'FINALIZED_SETTLEMENT_CERTIFICATE');
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(settlement), true);

  const tamperedSettlement = { ...settlement, solDelta: -999_999_999n };
  assert.equal(NoLandVerificationAuthority.validateCertificateDigest(tamperedSettlement), false);
});

test('Pass 22 - Upgrade 4: TwoPhaseSideEffectFence DB PREPARE -> COMMIT pattern', () => {
  const fence = new TwoPhaseSideEffectFence();
  const payload = new Uint8Array([1, 2, 3, 4, 5]);

  // Phase 1: DB PREPARE
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

  // Phase 2: DB RESULT COMMIT
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

  const mockTx = {
    transaction: {
      signatures: ['sig-tx-001'],
      message: {
        getAccountKeys: () => ({
          length: 3,
          get: (i) => {
            if (i === 0) return new PublicKey(wallet);
            if (i === 1) return new PublicKey(mint);
            if (i === 2) return new PublicKey(tipAccount);
            return undefined;
          },
        }),
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10_000_000_000, 0, 100_000_000],
      postBalances: [8_999_895_000, 1_000_000_000, 100_100_000], // Spent 1_000_000_000 SOL + 5000 fee + 100_000 tip = 1_000_105_000 delta, account 1 got 1_000_000_000
      loadedAddresses: { writable: [], readonly: [] },
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
  // Net economic SOL delta = grossSolDelta (-1_000_105_000) + txFee (5000) + tip (100_000) = -1_000_000_000n (exact trade cost)
  assert.equal(report.netEconomicSolDelta, -1_000_000_000n);
  assert.equal(report.tokenDelta, 50_000_000n);
  assert.equal(report.isWSOLWrapped, false);
  assert.equal(report.isConservationValid, true);
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

test('Pass 22 - Upgrade 1: CertifiedLiveExecutionCoordinator coordinates 14-step proof-carrying chain', async () => {
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
  const signerGateway = {
    publicKey: Keypair.generate().publicKey,
    signTransactionMessage: async (bytes) => new Uint8Array([...bytes, 255]),
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

    // Step 4: Acquire Durable Reservation
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
    const dummyBytes = new Uint8Array([10, 20, 30, 40]);
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

    // Steps 10-12: Two-Phase Isolated Signer Invocation
    const signedBytes = await coordinator.invokeCertifiedSigning(authRoot);
    assert.ok(signedBytes);
    assert.equal(signedBytes.length, dummyBytes.length + 1);

    // Verifying side effect fence recorded the signing commit
    const fenceRecord = sideEffectFence.getByPhase(intentId, 1, 'SIGNING');
    assert.ok(fenceRecord);
    assert.equal(fenceRecord.status, 'COMMITTED');
  } finally {
    await rm(testStorage, { force: true });
  }
});

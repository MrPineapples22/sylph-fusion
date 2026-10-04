import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TransportRaceCoordinator,
  ChainOutcomeReconciler,
  AuthoritativeEconomicReconciler,
} from '../../dist/platform/pipeline/index.js';

test('TRANSPORT COORDINATOR: multiple transport attempts tracked under one economicFactId', () => {
  const coordinator = new TransportRaceCoordinator();
  const factId = 'fact_transport_001';

  // Jito attempt
  coordinator.recordAttempt(factId, {
    transport: 'JITO_BUNDLE',
    attemptedAt: '2026-10-03T20:00:00.000Z',
    status: 'ACCEPTED', // Accepted bundle != landed!
    bundleId: 'bundle_jito_xyz123',
    latencyMs: 12,
  });

  // TPU retry attempt
  coordinator.recordAttempt(factId, {
    transport: 'TPU_QUIC',
    attemptedAt: '2026-10-03T20:00:00.100Z',
    status: 'ACCEPTED',
    endpoint: '127.0.0.1:8003',
    latencyMs: 8,
  });

  const attempts = coordinator.getAttempts(factId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].transport, 'JITO_BUNDLE');
  assert.equal(attempts[1].transport, 'TPU_QUIC');

  // Both accepted -> duplicate delivery risk detected!
  assert.equal(coordinator.hasDuplicateDeliveryRisk(factId), true);
});

test('CHAIN OUTCOME: correctly categorizes all 5 mutually exclusive states and prevents state collapse', () => {
  const reconciler = new ChainOutcomeReconciler();

  // 1. Finalized without error -> LANDED_SUCCESS
  assert.equal(
    reconciler.reconcileChainOutcome({
      signature: 'sig_1',
      slot: 1000n,
      confirmationStatus: 'finalized',
      err: null,
      searchConfirmedNotFound: false,
      isDisputedSources: false,
    }),
    'LANDED_SUCCESS'
  );

  // 2. Finalized with error -> LANDED_FAILED
  assert.equal(
    reconciler.reconcileChainOutcome({
      signature: 'sig_2',
      slot: 1000n,
      confirmationStatus: 'finalized',
      err: { InstructionError: [0, 'CustomError'] },
      searchConfirmedNotFound: false,
      isDisputedSources: false,
    }),
    'LANDED_FAILED'
  );

  // 3. Certified not found via archive search -> CERTIFIED_NOLAND
  assert.equal(
    reconciler.reconcileChainOutcome({
      signature: 'sig_3',
      slot: 0n,
      confirmationStatus: 'processed',
      err: null,
      searchConfirmedNotFound: true,
      isDisputedSources: false,
    }),
    'CERTIFIED_NOLAND'
  );

  // 4. Disputed sources -> DISPUTED
  assert.equal(
    reconciler.reconcileChainOutcome({
      signature: 'sig_4',
      slot: 1000n,
      confirmationStatus: 'finalized',
      err: null,
      searchConfirmedNotFound: false,
      isDisputedSources: true,
    }),
    'DISPUTED'
  );

  // 5. Incomplete proof -> EXPIRED_UNRESOLVED (must NOT collapse to NoLand)
  assert.equal(
    reconciler.reconcileChainOutcome({
      signature: 'sig_5',
      slot: 0n,
      confirmationStatus: 'processed',
      err: null,
      searchConfirmedNotFound: false,
      isDisputedSources: false,
    }),
    'EXPIRED_UNRESOLVED'
  );
});

test('ECONOMIC RECONCILER: produces exact integer lamport settlement and hash', () => {
  const reconciler = new AuthoritativeEconomicReconciler();

  const balanceDeltas = {
    solDeltaLamports: 5000000000n, // +5 SOL gross
    tokenDeltaTokens: -1000000n,    // -1,000,000 tokens disposed
    baseFeeLamports: 5000n,
    priorityFeeLamports: 25000n,
    jitoTipLamports: 1000000n,
    rentDepositLamports: 2039280n,
    token2022TransferFeeTokens: 0n,
  };

  const settlement = reconciler.reconcileSettlement(
    'fact_econ_001',
    '5M78SignatureXYZ1234567890abcdef',
    'LANDED_SUCCESS',
    balanceDeltas,
    1005n,
    '2026-10-03T20:00:02.000Z'
  );

  // Total Friction = 5000 + 25000 + 1000000 + 2039280 = 3,069,280 lamports
  assert.equal(settlement.totalFrictionLamports, 3069280n);

  // Net Proceeds = 5,000,000,000 - 3,069,280 = 4,996,930,720 lamports
  assert.equal(settlement.netProceedsLamports, 4996930720n);
  assert.equal(settlement.landedSlot, 1005n);
  assert.equal(typeof settlement.settlementHash, 'string');
  assert.equal(settlement.settlementHash.length, 64);
});

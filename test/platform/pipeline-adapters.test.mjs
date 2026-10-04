import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FusionPipeline,
  envelopeFromSylphEvent,
  createEvidenceCertifiedTransitionRequest,
  EconomicAuthorityAdapter,
  computeBankFingerprint,
  assertTemporalFirewall,
  createTemporallyValidTransitionRequest,
  ExecutionAuthorityAdapter,
} from '../../dist/platform/pipeline/index.js';
import { EconomicAuthorityStore } from '../../dist/intelligence/capital/economic-authority-store.js';

function createDummySylphEvent(overrides = {}) {
  return {
    eventId: 'evt_token_discovered_11111111_1',
    canonicalKey: 'fact_token_pool_123',
    correlationId: 'corr_test_999',
    sequence: 1,
    eventType: 'TOKEN_DISCOVERED',
    mint: '11111111111111111111111111111111',
    slot: 250000,
    transactionSignature: '5J4...dummySig',
    source: 'yellowstone_grpc',
    commitment: 'confirmed',
    chainTime: 1791080000000,
    observedAt: 1791080000100,
    receivedAt: 1791080000150,
    processedAt: 1791080000200,
    payload: { symbol: 'ALPHA', initialReserveSol: 30 },
    quality: 'HIGH',
    schemaVersion: '1.0.0',
    sessionId: 'session_001',
    environment: 'PRODUCTION',
    checksum: 'checksum_sha256_abcdef1234567890',
    rawHash: 'checksum_sha256_abcdef1234567890',
    ...overrides,
  };
}

test('ADAPTER: CanonicalEventAdapter generates valid FusionEnvelope and binds evidence', async () => {
  const event = createDummySylphEvent();
  const envelope = envelopeFromSylphEvent(event);

  assert.equal(envelope.envelopeId, 'env_evt_token_discovered_11111111_1');
  assert.equal(envelope.economicFactId, 'fact_token_pool_123');
  assert.equal(envelope.traceId, 'corr_test_999');
  assert.equal(envelope.observedSlot, 250000n);
  assert.equal(envelope.state, 'OBSERVED');
  assert.equal(envelope.evidenceRoot, 'checksum_sha256_abcdef1234567890');
  assert.ok(envelope.bankFingerprint.length === 64);

  const pipeline = new FusionPipeline(envelope);
  assert.equal(pipeline.snapshot().state, 'OBSERVED');

  const req = createEvidenceCertifiedTransitionRequest(event, 'cov_cert_001');
  const result = await pipeline.transition(req);

  assert.equal(result.state.state, 'EVIDENCE_CERTIFIED');
  assert.equal(result.journalEntry.canonicalEventId, event.eventId);
  assert.equal(result.journalEntry.canonicalEventChecksum, event.checksum);
  assert.equal(pipeline.verify().valid, true);
});

test('ADAPTER: ChainTruthAdapter computes bank fingerprints and enforces temporal firewall', () => {
  const fp1 = computeBankFingerprint({
    slot: 300000n,
    bankHashOrBlockhash: 'hash_block_1',
    commitment: 'finalized',
    providerEndpoint: 'https://rpc1.solana.com',
  });
  const fp2 = computeBankFingerprint({
    slot: 300000n,
    bankHashOrBlockhash: 'hash_block_2', // different fork reality
    commitment: 'finalized',
    providerEndpoint: 'https://rpc1.solana.com',
  });
  assert.notEqual(fp1, fp2);

  // Temporal Firewall: knownAt <= decisionAt passes
  assert.doesNotThrow(() => {
    assertTemporalFirewall('2026-10-03T20:00:00.000Z', '2026-10-03T20:00:01.000Z');
  });
  assert.doesNotThrow(() => {
    assertTemporalFirewall('2026-10-03T20:00:00.000Z', '2026-10-03T20:00:00.000Z');
  });

  // Future leakage strictly throws
  assert.throws(() => {
    assertTemporalFirewall('2026-10-03T20:00:05.000Z', '2026-10-03T20:00:01.000Z');
  }, /TEMPORAL_LEAKAGE_DETECTED/);
});

test('ADAPTER: EconomicAuthorityAdapter binds reservations and settlements without duplicating state', async () => {
  const initialCash = 100_000_000_000n; // 100 SOL
  const store = new EconomicAuthorityStore(initialCash);
  const adapter = new EconomicAuthorityAdapter(store);

  // 1. Acquire Reservation
  const { reservation, transitionRequest } = adapter.acquireReservationAndCreateTransition({
    intentId: 'intent_buy_001',
    maxDebitLamports: 10_000_000_000n,
    expirationSlot: 300050,
  });

  assert.equal(reservation.intentId, 'intent_buy_001');
  assert.equal(store.getReservedCash(), 10_000_000_000n);
  assert.equal(transitionRequest.targetState, 'CAPITAL_RESERVED');
  assert.equal(transitionRequest.authority, 'RESERVE');
  assert.equal(transitionRequest.envelopePatch.capitalReservationId, reservation.reservationId);
  assert.equal(transitionRequest.envelopePatch.capitalStateRoot, store.getLastJournalHash());

  // 2. Settle Open Buy Fill
  const { lot, transitionRequest: settleOpenReq } = adapter.settleOpenAndCreateReconciledTransition({
    intentId: 'intent_buy_001',
    reservationId: reservation.reservationId,
    mint: 'TokenMintA',
    tokenQtyRaw: 1_000_000_000n,
    principalDebitLamports: 9_000_000_000n,
    feeLamports: 5_000n,
    tipLamports: 50_000n,
    rentLamports: 2_039_280n,
    slot: 300020,
    signature: 'sig_buy_fill_1',
  });

  assert.equal(lot.mint, 'TokenMintA');
  assert.equal(store.getReservedCash(), 0n);
  assert.equal(store.getTokenInventory('TokenMintA'), 1_000_000_000n);
  assert.equal(settleOpenReq.targetState, 'ECONOMIC_RECONCILED');
  assert.equal(settleOpenReq.authority, 'SETTLE');
  assert.equal(settleOpenReq.economicJournalRoot, store.getLastJournalHash());

  // 3. Settle Partial Exit
  const { exitResult, transitionRequest: settleExitReq } = adapter.settleExitAndCreateReconciledTransition({
    intentId: 'intent_exit_001',
    mint: 'TokenMintA',
    tokensToSellRaw: 500_000_000n,
    grossProceedsLamports: 6_000_000_000n,
    exitFeeLamports: 5_000n,
    exitTipLamports: 25_000n,
    slot: 300040,
    signature: 'sig_sell_fill_1',
  });

  assert.equal(exitResult.tokensSoldRaw, 500_000_000n);
  assert.equal(store.getTokenInventory('TokenMintA'), 500_000_000n);
  assert.equal(settleExitReq.targetState, 'ECONOMIC_RECONCILED');
  assert.equal(settleExitReq.economicJournalRoot, store.getLastJournalHash());
});

test('ADAPTER: ExecutionAuthorityAdapter validates permits and rejects consumed or expired permits', () => {
  const validPermit = {
    permitId: 'permit_token_123',
    mint: 'TokenMintA',
    decisionId: 'dec_123',
    policyHash: 'policy_hash_1',
    evidenceHash: 'ev_hash_1',
    snapshotSlot: 300000,
    stateEpoch: 1,
    maxNotionalSol: 5,
    expiryMs: Date.now() + 10000,
    allowedExecutionModes: ['SIMULATION', 'SHADOW'],
    routeConstraints: ['pump_direct'],
    riskReservationId: 'res_123',
    isConsumed: false,
  };

  const req = ExecutionAuthorityAdapter.createAuthorizeTransitionRequest({
    permit: validPermit,
  });

  assert.equal(req.targetState, 'AUTHORIZED');
  assert.equal(req.authority, 'AUTHORIZE');
  assert.equal(req.envelopePatch.executionPermitId, 'permit_token_123');

  // Consumed permit rejected
  assert.throws(() => {
    ExecutionAuthorityAdapter.createAuthorizeTransitionRequest({
      permit: { ...validPermit, isConsumed: true },
    });
  }, /AUTHORIZE_ERROR.*already been consumed/);

  // Expired permit rejected
  assert.throws(() => {
    ExecutionAuthorityAdapter.createAuthorizeTransitionRequest({
      permit: { ...validPermit, expiryMs: Date.now() - 1000 },
    });
  }, /AUTHORIZE_ERROR.*expired/);
});

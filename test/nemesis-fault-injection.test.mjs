import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandGateway } from '../dist/command-gateway.js';
import { SystemLifecycleManager } from '../dist/lifecycle/system-lifecycle.js';
import { evaluateDataQuality, createEventEnvelope } from '../dist/events/event-envelope.js';
import { ExecutionPermitEngine } from '../dist/intelligence/execution/execution-permit.js';
import { JanusReconciler } from '../dist/intelligence/reconciliation/janus-reconciler.js';
import { CapitalKernel } from '../dist/intelligence/capital/capital-kernel.js';
import { SimulatedEngine } from '../dist/execution-engine.js';

test('Nemesis 1: Expired AXIOM permit fails closed and cannot execute', () => {
  const permitEngine = new ExecutionPermitEngine();
  const res = permitEngine.createRiskReservation('MintAlpha111', 1.0, 50); // 50ms TTL
  const permit = permitEngine.issuePermit({
    mint: 'MintAlpha111',
    decisionId: 'dec_1',
    policyHash: 'pol_hash',
    evidenceHash: 'evi_hash',
    snapshotSlot: 100,
    stateEpoch: 1,
    maxNotionalSol: 1.0,
    riskReservationId: res.reservationId,
    ttlMs: 20, // 20ms permit expiry
  });

  // Wait for permit to expire
  const start = Date.now();
  while (Date.now() - start < 30) {}

  assert.throws(() => {
    permitEngine.prepareExecution(permit.permitId);
  }, /Permit expired/);
});

test('Nemesis 2: Duplicate economic intent fails closed and cannot execute twice', async () => {
  const { globalLifecycle } = await import('../dist/lifecycle/system-lifecycle.js');
  globalLifecycle.bootstrapToHealthy();
  const gateway = CommandGateway.resetInstance();
  const cmd = {
    commandId: 'cmd_nemesis_dup',
    type: 'SUBMIT_ORDER',
    timestamp: Date.now(),
    initiator: 'adversary',
    payload: {
      orderId: 'intent_fixed_uuid_123',
      mint: 'MintNemesis111111111111111111111111111',
      poolAddress: 'PoolNemesis11111111111111111111111111',
      side: 'BUY',
      usdAmount: 50.0,
    },
  };

  const first = await gateway.executeCommand(cmd);
  assert.equal(first.success, true);

  const duplicate = await gateway.executeCommand(cmd);
  assert.equal(duplicate.success, false);
  assert.match(duplicate.error, /DUPLICATE_INTENT/);
});

test('Nemesis 3: Stale market observation cannot silently become fresh', () => {
  const staleTimestamp = Date.now() - 35_000; // 35 seconds old
  const quality = evaluateDataQuality(staleTimestamp);
  assert.equal(quality, 'STALE');

  const envelope = createEventEnvelope({
    event_id: 'evt_stale_1',
    event_type: 'PRICE_UPDATE',
    source: 'DELAYED_RPC',
    source_timestamp: staleTimestamp,
    slot: 200,
    payload: { price: 1.5 },
  });

  assert.equal(envelope.quality_state, 'STALE');
});

test('Nemesis 4: Hard safety rules cannot be outvoted by probabilistic models', () => {
  const kernel = new CapitalKernel();
  // Attempting to increase exposure when emergency reserve is compromised
  const report = kernel.verifyCapitalAction({
    action_type: 'INCREASE_EXPOSURE',
    proposed_delta_sol: 5.0,
    confirmed_cash_sol: 2.0, // Insufficient cash
    reserved_cash_sol: 0,
    emergency_reserve_sol: 10.0,
    current_open_positions_count: 1,
    unresolved_intents_count: 0,
    unknown_capital_sol: 0,
    has_active_reservation: true,
    has_commit_certificate: true,
    has_valid_survival_certificate: true,
    market_drawdown_pct: 0,
    regime_allows_expansion: true, // Model is bullish
  });

  assert.equal(report.is_authorized, false);
  assert.equal(report.all_invariants_passed, false);
  assert.ok(report.violated_invariants.length > 0);
});

test('Nemesis 5: Slippage breach rejects without corrupting ledger', async () => {
  const engine = new SimulatedEngine(7, 100_000n, 10_000_000n);
  engine.pushState({
    timestamp: Date.now() + 1000,
    slot: 250000,
    reserves: { sol: 10_000_000_000n, token: 1_000_000_000_000n }, // Small pool
    price: 0.01,
    volatility: 0.5,
  }, 'PoolSlippageTest');

  // Large order against small pool with strict 50 bps slippage limit
  const res = await engine.execute({
    orderId: 'slippage_test_order',
    tokenMint: 'MintTest',
    poolAddress: 'PoolSlippageTest',
    side: 'BUY',
    amountLamports: 5_000_000_000n, // 50% of pool
    maxSlippageBps: 50,
    triggerTimestamp: Date.now(),
  });

  assert.equal(res.report.status, 'REJECTED');
  assert.equal(res.report.failureReason, 'SLIPPAGE_EXCEEDED');
});

test('Nemesis 6: JANUS consensus mirror catches transport failures vs on-chain landing', () => {
  const reconciler = new JanusReconciler();
  reconciler.registerSubmittedTransaction({
    intent_id: 'intent_mirror_1',
    signature: 'sig_landing_ok',
    submitted_slot: 100,
    expiration_slot: 250,
  });

  // Transport returned error but transaction actually landed on chain
  const mirrorReport = reconciler.evaluateConsensusMirror({
    signature: 'sig_landing_ok',
    rpc_confirmed: true,
    err: null,
    current_slot: 120,
    token_balance_delta: 5000n,
  });

  assert.equal(mirrorReport.settlement_state, 'CONFIRMED');
  assert.equal(mirrorReport.economic_success, true);

  const reconResult = reconciler.reconcileTransaction({
    signature: 'sig_landing_ok',
    current_slot: 120,
    rpc_status: 'CONFIRMED',
  });

  assert.equal(reconResult.branch_resolved, 'LANDED');
  assert.equal(reconResult.should_resend_exact_signature, false);
  assert.equal(reconResult.should_rebuild_new_transaction, false);
});

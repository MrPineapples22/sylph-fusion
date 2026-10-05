import test from 'node:test';
import assert from 'node:assert/strict';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

const liveError = /^LIVE_EXECUTION_BLOCKED: CertifiedLiveExecutionCoordinator required for live capital mutations$/;
const mint = 'So11111111111111111111111111111111111111112';
const event = {
  eventId: 'live_guard_launch', eventType: 'TOKEN_CREATE', mint,
  signature: 'synthetic_fixture', instructionIndex: 0, source: 'PUMP_PORTAL',
  sourceTimestampMs: 1_000_000, receivedTimestampMs: 1_000_020,
  monotonicTimestamp: 10020, slot: 250_000, parentSlot: 249_999,
  blockhash: 'synthetic_blockhash', commitment: 'confirmed',
  transactionVersion: 'legacy', sequenceId: 1, chainState: 'CONFIRMED',
  payload: { amountSol: 12.5, priceSol: 0.00002 },
  sourceConfidence: 0.99, freshnessMs: 20, provenance: ['SYNTHETIC_TEST'],
};
const context = {
  tokenAgeSec: 25,
  rawWallets: [
    { address: 'w1', solFundedAmount: 2, parentFundingAddress: 'binance_hot', buyVolumeSol: 1.5 },
    { address: 'w2', solFundedAmount: 1.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.2 },
    { address: 'w3', solFundedAmount: 3, parentFundingAddress: 'kraken_hot', buyVolumeSol: 2.5 },
    { address: 'w4', solFundedAmount: 0.8, parentFundingAddress: 'bybit_hot', buyVolumeSol: 0.7 },
    { address: 'w5', solFundedAmount: 5, parentFundingAddress: 'okx_hot', buyVolumeSol: 4.1 },
  ],
  programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  hasFreezeAuthority: false, hasMintAuthority: false,
  marketCapSol: 120, liquiditySol: 60, txCount: 45,
};
const exit = { mint, netProceedsSol: 0.6, slot: 250_001 };

function setModes(t, mode, runtimeMode) {
  for (const [key, value] of [['MODE', mode], ['SYLPH_RUNTIME_MODE', runtimeMode]]) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function seedPosition(engine) {
  // In-memory fixture only; no signer, network, or configured database.
  assert.equal(engine.capitalTruth.reserveCapital({
    reservation_id: 'fixture_reservation', owner_id: 'fixture_intent',
    amount_sol: 0.5, max_fee_sol: 0, max_tip_sol: 0,
    expected_state_version: engine.capitalTruth.getSnapshot().state_version, slot: 249_999,
  }).success, true);
  engine.capitalTruth.settleExecution({
    reservation_id: 'fixture_reservation', intent_id: 'fixture_intent', mint,
    actual_sol_spent: 0.5, base_fee_sol: 0, priority_fee_sol: 0, jito_tip_sol: 0, slot: 249_999,
  });
  engine.portfolioEvac.registerPosition({
    mint, size_sol: 0.5, route: 'Pump_Bonding_Curve', pool_liquidity_sol: 60,
    current_evacuated_pct: 0, last_evacuated_slot: 249_999,
  });
}

function forcePolicy(t, engine, action) {
  const original = engine.policyRouter.route.bind(engine.policyRouter);
  t.mock.method(engine.policyRouter, 'route', input => ({ ...original(input), action }));
}

function capture(engine) {
  return structuredClone({
    snapshot: engine.capitalTruth.getSnapshot(),
    ledger: engine.capitalTruth.getEventLedger(),
    accounting: engine.capitalTruth.getDoubleEntryReport(),
    position: engine.capitalTruth.getPosition(mint),
    commit: engine.capitalTruth.getCommitCertificate(`intent_${event.eventId}`),
  });
}

function watchMutations(t, engine) {
  const methods = [
    ...['reserveCapital', 'writeCommitCertificate', 'settleExecution', 'settleExit', 'releaseReservation']
      .map(name => [engine.capitalTruth, name]),
    [engine.survivalCore, 'reserveExitCapacity'],
    [engine.portfolioEvac, 'registerPosition'], [engine.portfolioEvac, 'removePosition'],
    [engine.liveThesis, 'invalidateThesis'],
  ].map(([owner, name]) => [name, t.mock.method(owner, name)]);
  // Never invoke a signer even if a regression routes this test past a guard.
  methods.push(['processSignatureRequest', t.mock.method(engine.vaultSigner, 'processSignatureRequest', () => {
    throw new Error('UNEXPECTED_SIGNER_INVOCATION');
  })]);
  return () => {
    for (const [name, method] of methods) assert.equal(method.mock.callCount(), 0, name);
  };
}

for (const [mode, runtimeMode] of [['live', 'paper'], ['paper', 'live'], ['live', 'live']]) {
  const label = `MODE=${mode}, SYLPH_RUNTIME_MODE=${runtimeMode}`;
  test(`live entry denies before reservations and commit artifacts: ${label}`, async t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    const before = capture(engine);
    const assertUntouched = watchMutations(t, engine);
    await assert.rejects(engine.processEvent(event, context), { message: liveError });
    assertUntouched();
    assert.deepEqual(capture(engine), before);
  });

  test(`live routed exit denies before synthetic settlement: ${label}`, async t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    seedPosition(engine);
    forcePolicy(t, engine, 'EXIT');
    const before = capture(engine);
    const assertUntouched = watchMutations(t, engine);
    await assert.rejects(engine.processEvent(event, context), { message: liveError });
    assertUntouched();
    assert.deepEqual(capture(engine), before);
  });

  test(`live direct exit denies, including a missing position: ${label}`, t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    seedPosition(engine);
    const before = capture(engine);
    const assertUntouched = watchMutations(t, engine);
    assert.throws(() => engine.executeExit(exit), { message: liveError });
    assert.throws(() => engine.executeExit({ ...exit, mint: 'missing' }), { message: liveError });
    assertUntouched();
    assert.deepEqual(capture(engine), before);
  });

  test(`live observation remains available without capital mutation: ${label}`, async t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    forcePolicy(t, engine, 'OBSERVE');
    const before = capture(engine);
    const assertUntouched = watchMutations(t, engine);
    const result = await engine.processEvent(event, context);
    assert.equal(result.decision, 'CHALLENGED_ABSTAIN');
    assert.equal(result.allocatedSol, 0);
    assertUntouched();
    assert.deepEqual(capture(engine), before);
  });
}

for (const [mode, runtimeMode] of [['paper', 'paper'], [undefined, undefined]]) {
  test(`paper entry artifacts preserved: MODE=${mode}, SYLPH_RUNTIME_MODE=${runtimeMode}`, async t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    // Inspect the paper request without invoking the signer or simulating a chain landing.
    const signatureRequest = t.mock.method(engine.vaultSigner, 'processSignatureRequest', () => ({
      success: false, reason: 'TEST_SIGNER_UNAVAILABLE',
    }));
    const result = await engine.processEvent(event, context);
    assert.equal(result.decision, 'AUTHORIZED_BUY');
    assert.ok(result.allocatedSol > 0);
    assert.equal(signatureRequest.mock.callCount(), 1);
    const request = signatureRequest.mock.calls[0].arguments[0];
    assert.equal(request.serialized_tx_bytes.toString(), `SYLPH/PAPER_TX/V1:intent_${event.eventId}:${mint}:${event.slot}`);
    assert.deepEqual(request.commit_certificate, engine.capitalTruth.getCommitCertificate(`intent_${event.eventId}`));
    assert.equal(engine.capitalTruth.getEventLedger().at(-1).event_type, 'INTENT_COMMITTED');
    assert.equal(engine.capitalTruth.hasPosition(mint), false);
  });

  test(`paper exit behavior preserved: MODE=${mode}, SYLPH_RUNTIME_MODE=${runtimeMode}`, async t => {
    setModes(t, mode, runtimeMode);
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);
    seedPosition(engine);
    forcePolicy(t, engine, 'EXIT');
    const result = await engine.processEvent(event, context);
    assert.equal(result.decision, 'AUTHORIZED_SELL');
    assert.equal(engine.capitalTruth.hasPosition(mint), false);
    assert.equal(engine.capitalTruth.getEventLedger().at(-1).event_type, 'POSITION_CLOSED');
    assert.deepEqual(engine.executeExit(exit), { success: false, realizedPnlSol: 0 });
  });
}

test('direct exit checks mode at invocation, and paper success is preserved', t => {
  setModes(t, 'paper', 'paper');
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  seedPosition(engine);
  const before = capture(engine);
  process.env.SYLPH_RUNTIME_MODE = 'live';
  assert.throws(() => engine.executeExit(exit), { message: liveError });
  assert.deepEqual(capture(engine), before);
  process.env.SYLPH_RUNTIME_MODE = 'paper';
  const result = engine.executeExit(exit);
  assert.equal(result.success, true);
  assert.ok(Math.abs(result.realizedPnlSol - 0.1) < 1e-9);
  assert.equal(engine.capitalTruth.hasPosition(mint), false);
});

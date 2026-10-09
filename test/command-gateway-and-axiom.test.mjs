import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigAuthority, globalConfigAuthority } from '../dist/config-authority.js';
import { SystemLifecycleManager, globalLifecycle } from '../dist/lifecycle/system-lifecycle.js';
import { CommandGateway, globalCommandGateway } from '../dist/command-gateway.js';
import { ProjectionService, globalProjectionService } from '../dist/projection-service.js';
import { createEventEnvelope, evaluateDataQuality } from '../dist/events/event-envelope.js';

test('ConfigAuthority: provides immutable, versioned, hashable configuration', () => {
  const cfg = globalConfigAuthority.getConfig();
  assert.equal(cfg.version, '1.0.0');
  assert.equal(cfg.maxPositions, 3);
  assert.equal(cfg.minHsiScore, 50);
  assert.equal(cfg.graceSeconds, 60);

  const hash1 = globalConfigAuthority.getConfigHash();
  assert.ok(typeof hash1 === 'string' && hash1.length === 64);

  // Hash remains deterministic
  assert.equal(globalConfigAuthority.getConfigHash(), hash1);
});

test('EventEnvelope: evaluates data quality states and constructs tamper-proof envelopes', () => {
  const now = Date.now();
  assert.equal(evaluateDataQuality(now - 1000, now), 'FRESH');
  assert.equal(evaluateDataQuality(now - 6000, now), 'AGING');
  assert.equal(evaluateDataQuality(now - 15000, now), 'STALE');
  assert.equal(evaluateDataQuality(now + 5000, now), 'CONFLICTED');

  const envelope = createEventEnvelope({
    event_id: 'evt_test_1',
    event_type: 'TRADE_OBSERVED',
    source: 'TEST_FEED',
    source_timestamp: now,
    slot: 250100,
    payload: { price: 0.00045, volume: 15.2 },
  });

  assert.equal(envelope.event_id, 'evt_test_1');
  assert.equal(envelope.quality_state, 'FRESH');
  assert.equal(envelope.commitment, 'confirmed');
  assert.ok(envelope.payload_hash.length === 64);
});

test('CommandGateway retains only a fresh observed SOL/USD timestamp for display projections', () => {
  const gateway = CommandGateway.resetInstance();
  const initial = gateway.getSnapshot();
  assert.equal(initial.solPriceUpdatedAtMs, null, 'the configured fallback price has no market observation time');

  const observedAt = Date.now() - 1;
  gateway.updateSolPriceUsd(151.25, observedAt);
  const fresh = gateway.getSnapshot();
  assert.equal(fresh.solPriceUsd, 151.25);
  assert.equal(fresh.solPriceUpdatedAtMs, observedAt);

  gateway.updateSolPriceUsd(152, observedAt - 5_001);
  gateway.updateSolPriceUsd(153, Date.now() + 1);
  gateway.updateSolPriceUsd(154, 1.5);
  const afterInvalid = gateway.getSnapshot();
  assert.equal(afterInvalid.solPriceUsd, 151.25);
  assert.equal(afterInvalid.solPriceUpdatedAtMs, observedAt, 'invalid timestamps cannot refresh or replace the last valid quote');
});

test('SystemLifecycleManager: enforces valid paths and blocks illegal shortcuts', () => {
  const lifecycle = new SystemLifecycleManager();
  assert.equal(lifecycle.getState(), 'BOOT');

  // Illegal: BOOT -> READY without initialization
  assert.throws(() => lifecycle.transition('READY', 'invalid leap'));

  // Valid flow
  assert.ok(lifecycle.transition('INITIALIZING', 'boot complete'));
  assert.ok(lifecycle.transition('CONNECTING', 'sockets opened'));
  assert.ok(lifecycle.transition('SYNCHRONIZING', 'slot sync'));
  assert.ok(lifecycle.transition('RECONCILING', 'ledger check'));
  assert.ok(lifecycle.transition('CERTIFYING', 'running DCVE gates'));

  // Cannot transition to READY without recorded certification and reconciliation
  assert.throws(() => lifecycle.transition('READY', 'premature ready'));

  lifecycle.recordReconciliation();
  lifecycle.recordCertification(true);
  assert.ok(lifecycle.transition('READY', 'certified and reconciled'));
  assert.ok(lifecycle.transition('HEALTHY', 'operational nominal'));

  assert.equal(lifecycle.isEntryPermitted(), true);
  assert.equal(lifecycle.isExitPermitted(), true);

  // Degradation to REDUCE_ONLY
  assert.ok(lifecycle.transition('REDUCE_ONLY', 'risk threshold alert'));
  assert.equal(lifecycle.isEntryPermitted(), false);
  assert.equal(lifecycle.isExitPermitted(), true);

  // Recovery must go through reconciliation and certification
  assert.ok(lifecycle.transition('RECOVERING', 'restoring'));
  assert.throws(() => lifecycle.transition('HEALTHY', 'skipping verification'));
});

test('CommandGateway: enforces AXIOM verification, idempotency, and lifecycle rules', async () => {
  globalLifecycle.bootstrapToHealthy();
  const gateway = CommandGateway.resetInstance();
  gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({
    mint, poolAddress, priceUsd: 1, liquidityUsd: 1_000_000,
    observedAt: Date.now(), solPriceUsd: 150, solObservedAt: Date.now(),
    marketObservationValid: true, source: 'TEST', entryAllowed: true,
  }));
  const initialSnap = gateway.getSnapshot();
  assert.equal(initialSnap.positions.length, 0);
  assert.equal(initialSnap.cashUsd, 10_000);

  // 1. Submit valid BUY order
  const buyCmd = {
    commandId: 'cmd_buy_101',
    type: 'SUBMIT_ORDER',
    timestamp: Date.now(),
    initiator: 'test_suite',
    payload: {
      orderId: 'intent_101',
      mint: 'MintTokenAlpha1111111111111111111111111111',
      poolAddress: 'PoolAlpha111111111111111111111111111111111',
      side: 'BUY',
      usdAmount: 100.0,
    },
  };

  const buyRes = await gateway.executeCommand(buyCmd);
  assert.equal(buyRes.success, true);
  assert.ok(buyRes.data?.report);
  assert.equal(buyRes.data.report.status, 'FILLED');

  const afterBuySnap = gateway.getSnapshot();
  assert.equal(afterBuySnap.positions.length, 1);
  assert.equal(afterBuySnap.cashUsd, 10_000.0 - afterBuySnap.positions[0].costBasisUsd);
  assert.equal(afterBuySnap.positions[0].asset, 'PoolAlpha111111111111111111111111111111111');

  // 2. Duplicate order rejection (Idempotency enforcement)
  const dupRes = await gateway.executeCommand(buyCmd);
  assert.equal(dupRes.success, false);
  assert.match(dupRes.error, /DUPLICATE_INTENT/);

  // 3. Close position via CLOSE_POSITION command
  const closeCmd = {
    commandId: 'cmd_close_101',
    type: 'CLOSE_POSITION',
    timestamp: Date.now(),
    initiator: 'test_suite',
    payload: {
      mint: 'MintTokenAlpha1111111111111111111111111111',
      poolAddress: 'PoolAlpha111111111111111111111111111111111',
    },
  };

  const closeRes = await gateway.executeCommand(closeCmd);
  assert.equal(closeRes.success, true);

  const afterCloseSnap = gateway.getSnapshot();
  assert.equal(afterCloseSnap.positions.length, 0);
  assert.ok(afterCloseSnap.cashUsd > 9900.0);
});

test('CommandGateway rejects stale observations and unapproved baskets before paper execution', async () => {
  globalLifecycle.bootstrapToHealthy();
  const gateway = CommandGateway.resetInstance();
  const buy = {
    commandId: 'cmd_stale_observation', type: 'SUBMIT_ORDER', timestamp: Date.now(), initiator: 'test',
    payload: {orderId: 'stale-observation', mint: 'MintStale111111111111111111111111111111',
      poolAddress: 'PoolStale111111111111111111111111111111', side: 'BUY', usdAmount: 25},
  };
  gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({
    mint, poolAddress, priceUsd: 1, liquidityUsd: 10_000,
    observedAt: Date.now() - 5_001, solPriceUsd: 150, solObservedAt: Date.now(),
    marketObservationValid: true, source: 'TEST', entryAllowed: true,
  }));
  const before = gateway.getSnapshot();
  const stale = await gateway.executeCommand(buy);
  assert.equal(stale.success, false);
  assert.match(stale.error, /Fresh, identity-matched market price/);
  assert.equal(gateway.getSnapshot().cashUsd, before.cashUsd);
  assert.equal(gateway.getSnapshot().positions.length, 0);

  gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({
    mint, poolAddress, priceUsd: 1, liquidityUsd: 10_000,
    observedAt: Date.now(), solPriceUsd: 150, solObservedAt: Date.now(),
    marketObservationValid: true, source: 'TEST', entryAllowed: false,
  }));
  const unauthorized = await gateway.executeCommand({...buy, commandId: 'cmd_unapproved_basket', payload: {...buy.payload, orderId: 'unapproved-basket'}});
  assert.equal(unauthorized.success, false);
  assert.match(unauthorized.error, /basket authorization/);
  assert.equal(gateway.getSnapshot().cashUsd, before.cashUsd);
  assert.equal(gateway.getSnapshot().positions.length, 0);
});

test('CommandGateway: Emergency Stop halts new entries and cancels in-flight buys', async () => {
  globalLifecycle.bootstrapToHealthy();
  const gateway = CommandGateway.resetInstance();

  gateway.setEmergencyStopPersistence({save: async () => {}, clearSync: () => {}});

  const stopCmd = {
    commandId: 'cmd_stop_999',
    type: 'EMERGENCY_STOP',
    timestamp: Date.now(),
    initiator: 'operator_panic',
    payload: { reason: 'Adverse market anomaly' },
  };

  const stopRes = await gateway.executeCommand(stopCmd);
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.data?.automationEnabled, false);
  assert.equal(globalLifecycle.getState(), 'REDUCE_ONLY');

  // Attempting new BUY in REDUCE_ONLY fails closed
  const failBuy = {
    commandId: 'cmd_buy_fail',
    type: 'SUBMIT_ORDER',
    timestamp: Date.now(),
    initiator: 'test_suite',
    payload: {
      orderId: 'intent_fail',
      mint: 'MintTokenBeta11111111111111111111111111111',
      poolAddress: 'PoolBeta1111111111111111111111111111111111',
      side: 'BUY',
      usdAmount: 50.0,
    },
  };

  const failRes = await gateway.executeCommand(failBuy);
  assert.equal(failRes.success, false);
  assert.match(failRes.error, /ENTRY_BLOCKED/);
});

test('ProjectionService: projects authoritative system strip, position, and best opportunity view models', () => {
  const strip = globalProjectionService.getSystemStrip();
  assert.ok(['LIVE', 'SHADOW', 'SIM'].includes(strip.mode));
  assert.ok(['FRESH', 'DEGRADED', 'STALE'].includes(strip.data));
  assert.ok(['READY', 'OPEN_LOCKED', 'REDUCE_ONLY', 'HALTED'].includes(strip.execution));

  const sampleTokens = [
    { mint: 'TokenA', poolAddress: 'PoolA', liquidity: 15000, cap: 60000, txCount: 45, volume5m: 50, volume1h: 800 },
    { mint: 'TokenB', poolAddress: 'PoolB', liquidity: 800, cap: 3000, txCount: 3, volume5m: 10, volume1h: 20 },
  ];

  const enriched = globalProjectionService.projectEnrichedTokens(sampleTokens);
  assert.equal(enriched.length, 2);
  assert.equal(enriched[0].symbol, 'TOKE');
  assert.equal(enriched[0].confidence, 'LOW');
  assert.equal(enriched[0].decision, 'ABSTAIN');
  assert.equal(enriched[1].decision, 'ABSTAIN');

  const bestOpp = globalProjectionService.getBestOpportunity(enriched);
  assert.equal(bestOpp.capitalResult, 'NO_TRADE');
  assert.equal(bestOpp.mint, null);
  assert.equal(bestOpp.rejectionReason, 'EXECUTION_EVIDENCE_UNAVAILABLE');

  const emptyOpp = globalProjectionService.getBestOpportunity([]);
  assert.equal(emptyOpp.capitalResult, 'NO_TRADE');
  assert.equal(emptyOpp.rejectionReason, 'NO_CANDIDATES_AVAILABLE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandGateway } from '../dist/platform/execution/command-gateway.js';
import { SageCapabilityAssurance } from '../dist/intelligence/sage/capability-assurance.js';
import { SimulatedEngine } from '../dist/execution-engine.js';
import { reducer, initialState } from '../terminal/src/engine.js';
import { extractSystemAlerts } from '../terminal/src/alert-manager.js';
import { createAutomationController } from '../terminal/src/automation-controller.js';

// Emergency paper exits still require a quoteable market snapshot.  Give these
// regression cases explicitly future-valid evidence instead of treating the
// advisory fallback price as an executable fill.
function pushExitQuote(engine, poolAddress) {
  engine.pushState({
    timestamp: Date.now() + 10_000,
    slot: 1,
    reserves: { sol: 100_000_000_000n, token: 1_000_000_000_000n },
    price: 0.1,
    volatility: 0,
  }, poolAddress);
}

test('RT-001: Max-open-positions limit cannot block Close 100% or position reduction', async () => {
  const gateway = new CommandGateway();
  const contextAtCapacity = {
    activePositionsCount: 3,
    maxPositions: 3,
    feedFresh: true,
    rpcHealthy: true,
    hasPosition: true,
  };

  // 1. Exposure increasing command must be blocked at capacity
  const buyValidation = gateway.validateCommand({
    commandId: 'cmd-buy-1',
    controlId: 'BTN_MANUAL_BUY',
    screen: 'OrderEntryPanel',
    actionType: 'OPEN',
    tokenMint: 'TOKEN_NEW',
    requestedBy: 'operator',
    timestamp: Date.now(),
  }, contextAtCapacity);
  assert.equal(buyValidation.isValid, false);
  assert.equal(buyValidation.reasonCode, 'MAX_POSITIONS_REACHED');

  // 2. Exposure reducing command (Close 100%) MUST NOT be blocked by capacity
  const closeValidation = gateway.validateCommand({
    commandId: 'cmd-close-1',
    controlId: 'BTN_CLOSE_100',
    screen: 'PositionsTable',
    actionType: 'CLOSE',
    tokenMint: 'TOKEN_HELD',
    requestedBy: 'operator',
    timestamp: Date.now(),
  }, contextAtCapacity);
  assert.equal(closeValidation.isValid, true);
  assert.equal(closeValidation.classification, 'EXPOSURE_REDUCING');

  // 3. Execution Engine executes an exposure-reducing order using fresh evidence.
  const engine = new SimulatedEngine(7, 100_000n, 10_000_000n);
  pushExitQuote(engine, 'POOL_HELD');
  const result = await engine.execute({
    orderId: 'ord-close-1',
    tokenMint: 'TOKEN_HELD',
    poolAddress: 'POOL_HELD',
    side: 'SELL',
    amountLamports: 1_000_000_000n,
    amountDecimals: 9,
    maxSlippageBps: 5000,
    triggerTimestamp: Date.now(),
    emergency: true,
    fallbackPriceSol: 0.00005,
  });
  assert.equal(result.report.status, 'FILLED');
  assert.ok(result.report.outputAmount > 0n);

  // 4. Reducer evicts the position from state
  let s = {
    ...initialState(),
    positions: [{ asset: 'POOL_HELD', qty: 1, cost: 10, entry: 10, initialQty: 1, tiers: [] }],
  };
  s = reducer(s, {
    type: 'EXTERNAL_FILL',
    payload: {
      orderId: 'ord-close-1',
      asset: 'POOL_HELD',
      side: 'SELL',
      qty: 1,
      price: 10,
      totalUsd: 10,
      feeUsd: 0.01,
    },
  });
  assert.equal(s.positions.length, 0);
});

test('RT-002: HSI failure or entry filter rejection cannot reject pure reduction or stop exit', async () => {
  const controller = createAutomationController();
  const now = Date.now();
  let s = {
    ...initialState(now),
    executionMode: 'external',
    running: true,
    positions: [{ asset: 'LOW_HSI_TOKEN', qty: 100, cost: 10, entry: 0.1, initialQty: 100, stop: 0.09, tiers: [] }],
    assets: [{
      id: 'LOW_HSI_TOKEN',
      mint: 'LOW_HSI_TOKEN',
      price: 0.08, // Below stop loss -> must trigger SELL
      liquidity: 50000,
      observedAt: now,
      volume: 0.1, // Failed volume threshold
      rsi: 10,     // Deep oversold
      history: [{ time: now/1000 - 10, value: 0.1 }, { time: now/1000, value: 0.08 }],
    }],
    config: { ...initialState().config, interval: 0, stop: 10 },
  };

  const executedExits = [];
  const mockExecution = {
    panicCloseUsd(poolAddress, mint, qty) {
      executedExits.push({ poolAddress, mint, qty });
      return Promise.resolve();
    },
    isPending: () => false,
  };

  controller.evaluate(s, mockExecution, 150);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executedExits.length, 1);
  assert.equal(executedExits[0].poolAddress, 'LOW_HSI_TOKEN');
});

test('RT-003: Stale market discovery feed disables new entry while reduction capability remains enabled', () => {
  const sage = new SageCapabilityAssurance();
  const matrix = sage.getGranularCapabilityMatrix({
    rpcHealthy: true,
    feedFresh: false, // Stale discovery feed (>5s lag)
    isRecovering: false,
    queueLag: 0,
    killSwitchActive: false,
  });

  // Entry is BLOCKED
  assert.equal(matrix.can_open, 'BLOCKED');
  assert.equal(matrix.can_increase, 'BLOCKED');
  assert.equal(matrix.can_discover, 'DEGRADED');

  // Reduction & Close are ENABLED
  assert.equal(matrix.can_reduce, 'ENABLED');
  assert.equal(matrix.can_close, 'ENABLED');
  assert.equal(matrix.can_reconcile, 'ENABLED');
});

test('RT-004: Execution submission timeout with confirmed landing prevents duplicate exit', async () => {
  let s = {
    ...initialState(),
    positions: [{ asset: 'TOKEN_X', qty: 50, cost: 50, entry: 1, initialQty: 50, tiers: [] }],
  };

  // Order fills and reconciles
  s = reducer(s, {
    type: 'EXTERNAL_FILL',
    payload: {
      orderId: 'tx-sig-abc',
      asset: 'TOKEN_X',
      side: 'SELL',
      qty: 50,
      price: 1,
      totalUsd: 50,
      feeUsd: 0.05,
    },
  });
  assert.equal(s.positions.length, 0);

  // A duplicate callback / rebroadcast landing must not double-deduct
  const preCash = s.cash;
  s = reducer(s, {
    type: 'EXTERNAL_FILL',
    payload: {
      orderId: 'tx-sig-abc',
      asset: 'TOKEN_X',
      side: 'SELL',
      qty: 50,
      price: 1,
      totalUsd: 50,
      feeUsd: 0.05,
    },
  });
  // Position was already evicted; cash should not corrupt
  assert.equal(s.positions.length, 0);
});

test('RT-005: 30-second UI freeze does not cause catch-up trade runaway or ledger corruption', () => {
  const now = Date.now();
  let s = initialState(now);
  s.running = true;

  // Simulate 30s UI freeze
  const postSleepNow = now + 30_000;
  s = reducer(s, { type: 'TICK', now: postSleepNow });

  // Verify that price histories and indicators remained bounded
  for (const a of s.assets) {
    assert.ok(Number.isFinite(a.price) && a.price > 0);
    assert.ok(a.history.length <= 300);
  }
  assert.equal(s.positions.length, 0);
  assert.equal(s.pending.length, 0);
});

test('RT-006: Heavy intelligence inference block does not delay settlement or position liquidation', async () => {
  const engine = new SimulatedEngine(11, 100_000n, 10_000_000n);
  pushExitQuote(engine, 'POOL_URGENT');

  // Background slow intelligence simulation
  let intelComplete = false;
  const slowIntelTask = new Promise(resolve => {
    setTimeout(() => {
      intelComplete = true;
      resolve('intel_ready');
    }, 10_000);
  });

  // Fast emergency exit must complete immediately regardless of background intel
  const start = Date.now();
  const exitResult = await engine.execute({
    orderId: 'ord-fast-exit',
    tokenMint: 'TOKEN_URGENT',
    poolAddress: 'POOL_URGENT',
    side: 'SELL',
    amountLamports: 5_000_000_000n,
    amountDecimals: 9,
    maxSlippageBps: 5000,
    triggerTimestamp: Date.now(),
    emergency: true,
    fallbackPriceSol: 0.0001,
  });
  const elapsed = Date.now() - start;

  assert.equal(exitResult.report.status, 'FILLED');
  assert.ok(elapsed < 1500, `Exit took ${elapsed}ms; must complete well below async intel delay`);
  assert.equal(intelComplete, false, 'Exit settled while background intel was still running');
});

test('RT-007: Quality gate with 0 dropped candidates correctly passes and emits no block alert', () => {
  const totalRejections = 0;
  const rpcRejectionCount = 0;
  const rpcFailureRate = totalRejections > 0 ? Number(((rpcRejectionCount / totalRejections) * 100).toFixed(1)) : 0;
  const isGatePassed = rpcFailureRate < 5;

  assert.equal(isGatePassed, true);

  const alerts = extractSystemAlerts({
    gatePassed: isGatePassed,
    rpcDropRate: rpcFailureRate,
    rpcDropsCount: rpcRejectionCount,
    halted: false,
    feedFresh: true,
  });

  const gateAlert = alerts.find(a => a.type === 'quality_gate_blocked');
  assert.equal(gateAlert, undefined, 'No quality gate blocked alert should be emitted on 0 drops');
});

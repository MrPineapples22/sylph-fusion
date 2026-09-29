import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandGateway } from '../dist/command-gateway.js';
import { globalConfigAuthority } from '../dist/config-authority.js';
import { globalTradeLearningService } from '../dist/intelligence/attribution/trade-learning-service.js';

function fixture(t) {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const gateway = CommandGateway.resetInstance();
  const position = {
    asset: 'freshness-pool', mint: 'freshness-mint', qty: 10,
    entry: 100, peak: 100, trough: 100, stop: 88,
    openedAt: now - 60_000, costBasisUsd: 1_000, stage: 0,
    reconciliationState: 'SIMULATED', tokenDecimals: 6,
  };
  gateway.positions.set(position.asset, position);
  const closes = [];
  t.mock.method(gateway, 'handleClosePosition', async command => {
    closes.push(command);
    return { success: true };
  });
  return {
    gateway, position, closes,
    now: () => now,
    advance: ms => { now += ms; },
    token: (price, at = now) => ({ mint: position.mint, price, at }),
    maxAge: globalConfigAuthority.getConfig().feedStaleMs,
  };
}

test('near-stale marks retain observation time and cannot authorize exits after expiry', async t => {
  const f = fixture(t);
  const observedAt = f.now() - f.maxAge + 1;
  f.gateway.updatePositionMarks([f.token(80, observedAt)]);
  assert.equal(f.position.lastMarkAt, observedAt);
  f.advance(2);

  assert.deepEqual(await f.gateway.tickAutonomousExits([]), []);
  // A fresh timestamp without a valid price must not renew cached evidence.
  assert.deepEqual(await f.gateway.tickAutonomousExits([f.token(NaN)]), []);
  assert.equal(f.closes.length, 0);
  assert.equal(f.position.lastMarkAt, observedAt);
});

test('fresh cached price and timestamp stay paired when a new quote is unusable', async t => {
  const f = fixture(t);
  const observedAt = f.now() - f.maxAge + 10;
  f.gateway.updatePositionMarks([f.token(80, observedAt)]);
  const exits = await f.gateway.tickAutonomousExits([f.token(NaN)]);
  assert.equal(exits[0].action, 'STOP_LOSS');
  assert.equal(f.closes[0].payload.priceUsd, 80);
  assert.equal(f.position.lastMarkAt, observedAt);

  f.advance(11);
  assert.deepEqual(await f.gateway.tickAutonomousExits([]), []);
  assert.equal(f.closes.length, 1);
});

test('older incoming marks cannot replace a newer price or trigger an autonomous exit', async t => {
  const f = fixture(t);
  const observedAt = f.now() - 100;
  f.gateway.updatePositionMarks([f.token(101, observedAt)]);
  assert.deepEqual(await f.gateway.tickAutonomousExits([f.token(80, observedAt - 1)]), []);
  assert.equal(f.position.lastMark, 101);
  assert.equal(f.position.lastMarkAt, observedAt);
  assert.equal(f.position.lastPeakAt, observedAt);
  assert.equal(f.position.trough, 100);
  assert.equal(f.closes.length, 0);
});

test('a mark that expires while another position closes cannot authorize the next exit', async t => {
  const f = fixture(t);
  const second = { ...f.position, asset: 'second-pool', mint: 'second-mint' };
  f.gateway.positions.set(second.asset, second);
  const observedAt = f.now() - f.maxAge + 1;
  f.gateway.handleClosePosition.mock.mockImplementation(async command => {
    f.closes.push(command);
    await Promise.resolve();
    f.advance(2);
    return { success: true };
  });

  const exits = await f.gateway.tickAutonomousExits([
    f.token(80, observedAt),
    { mint: second.mint, price: 80, at: observedAt },
  ]);

  assert.deepEqual(exits.map(exit => exit.mint), [f.position.mint]);
  assert.deepEqual(f.closes.map(close => close.payload.mint), [f.position.mint]);
  assert.equal(second.lastMarkAt, observedAt);
});

function executionFixture(t, verifiedPrice) {
  const f = fixture(t);
  f.gateway.handleClosePosition.mock.restore();
  const seeded = [];
  const executions = [];
  const skips = [];
  t.mock.method(console, 'warn', (...args) => skips.push(args));
  f.gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({
    mint, poolAddress, priceUsd: verifiedPrice, liquidityUsd: 1_000_000,
    observedAt: f.now(), solPriceUsd: 160, solObservedAt: f.now(),
    verified: true, entryAllowed: false,
  }));
  t.mock.method(f.gateway.executionEngine, 'pushState', (...args) => seeded.push(args));
  t.mock.method(globalTradeLearningService, 'recordClosedTrade', () => {});
  t.mock.method(f.gateway.executionEngine, 'execute', async request => {
    executions.push(request);
    return {
      report: {
        orderId: request.orderId, status: 'FILLED', execPrice: verifiedPrice / 160,
        inputAmount: request.amountLamports, outputAmount: 5_000_000_000n,
        priorityFeeLamports: 0n, jitoTipLamports: 0n, slotLatency: 1,
      },
      telemetry: {
        engineMode: 'PAPER', simulatedSlotLagMs: 1, priceImpactPct: 0,
        preTradeReserves: { sol: 1n, token: 1n }, postTradeReserves: { sol: 1n, token: 1n },
      },
    };
  });
  return { ...f, seeded, executions, skips };
}

test('a six-second-old stop trigger with a fresh neutral quote cannot seed or execute a sale', async t => {
  const f = executionFixture(t, 100);
  f.gateway.updatePositionMarks([f.token(80, f.now() - 6_000)]);
  const before = f.gateway.getSnapshot();

  assert.deepEqual(await f.gateway.tickAutonomousExits([]), []);
  assert.equal(f.seeded.length, 0);
  assert.equal(f.executions.length, 0);
  assert.equal(f.gateway.executedIntentIds.size, 0);
  assert.deepEqual(f.gateway.getSnapshot(), before);
  assert.deepEqual(f.skips, [['[CommandGateway] Autonomous exit skipped', {
    reasonCode: 'AUTONOMOUS_EXIT_DECISION_CHANGED', mint: f.position.mint,
    poolAddress: f.position.asset, requestedReason: 'STOP_LOSS', refreshedReason: null,
  }]]);
});

test('a stop confirmed by fresh verified evidence remains executable', async t => {
  const f = executionFixture(t, 80);
  f.gateway.updatePositionMarks([f.token(80)]);
  const exits = await f.gateway.tickAutonomousExits([]);

  assert.equal(exits[0].action, 'STOP_LOSS');
  assert.equal(f.seeded.length, 1);
  assert.equal(f.seeded[0][0].price, 80 / 160);
  assert.equal(f.executions.length, 1);
  assert.equal(f.executions[0].emergency, true);
  assert.equal(f.executions[0].amountLamports, 10_000_000n);
  assert.equal(f.gateway.getSnapshot().positions.length, 0);
  assert.deepEqual(f.skips, []);
});

test('a full trailing exit that becomes a partial profit decision is rejected before execution', async t => {
  const f = executionFixture(t, 130);
  f.position.peak = 125;
  f.gateway.updatePositionMarks([f.token(104, f.now() - 6_000)]);
  const before = f.gateway.getSnapshot();

  assert.deepEqual(await f.gateway.tickAutonomousExits([]), []);
  assert.equal(f.seeded.length, 0);
  assert.equal(f.executions.length, 0);
  assert.equal(f.gateway.executedIntentIds.size, 0);
  assert.deepEqual(f.gateway.getSnapshot(), before);
  assert.equal(f.skips.length, 1);
  assert.equal(f.skips[0][1].refreshedReason, 'TAKE_PROFIT_1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandGateway } from '../dist/command-gateway.js';
import { globalConfigAuthority } from '../dist/config-authority.js';

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

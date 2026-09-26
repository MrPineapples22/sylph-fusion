import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../dist/fusion.js';

test('pending retry cannot broadcast after failed persistence; recovery reuses the same order', async () => {
  const engine = Object.create(Engine.prototype);
  const order = { signature: 'same-signature', wire: 'same-signed-bytes', created: Date.now(), mint: 'mint', side: 'buy' };
  engine.state = { pending: order, positions: {}, closed: {}, day: new Date().toISOString().slice(0, 10) };
  engine.cfg = { MAX_AGE_MS: 10000 };
  engine.candidates = new Map();
  const events = [];
  let failing = true;
  engine.store = { save: async (state) => {
    events.push('save');
    assert.equal(state.pending, order);
    if (failing) throw new Error('disk unavailable');
  } };
  engine.executor = {
    reconcile: async () => { events.push('reconcile'); return { status: 'pending' }; },
    broadcast: async (sent) => {
      events.push('broadcast'); assert.equal(sent, order);
      return { status: 'ACCEPTED', signature: sent.signature, attemptedAt: Date.now(), bundleId: 'test-bundle' };
    },
  };
  await assert.rejects(engine.tick(), /disk unavailable/);
  await assert.rejects(engine.tick(), /disk unavailable/);
  assert.deepEqual(events, ['reconcile', 'save', 'reconcile', 'save']);
  assert.equal(engine.state.pending, order);
  failing = false;
  await engine.tick();
  assert.deepEqual(events.slice(-4), ['reconcile', 'save', 'broadcast', 'save']);
  assert.equal(engine.state.pending, order);
});

test('order replacement while persistence is in flight prevents broadcast', async () => {
  const engine = Object.create(Engine.prototype);
  const order = { signature: 'old' };
  engine.state = { pending: order };
  engine.store = { save: async () => { engine.state.pending = { signature: 'new' }; } };
  engine.executor = { broadcast: async () => assert.fail('stale order broadcast') };
  await assert.rejects(engine.persistAndBroadcast(order), /changed during persistence/);
});

test('live expired execution creates a durable reconciliation lock before clearing pending', async () => {
  const engine = Object.create(Engine.prototype);
  const order = { signature: 'expired-wire', wire: 'wire', created: Date.now(), mint: 'mint', side: 'sell', lastValidBlockHeight: 100 };
  engine.state = { pending: order, positions: {}, closed: {}, day: new Date().toISOString().slice(0, 10), cash: '100', halted: false, mode: 'live' };
  engine.cfg = { MODE: 'live', MAX_AGE_MS: 10_000 };
  engine.candidates = new Map();
  engine.executor = { reconcile: async () => ({ status: 'expired' }) };
  let saved;
  engine.store = { save: async state => { saved = structuredClone(state); } };
  await engine.tick();
  assert.equal(engine.state.pending, null);
  assert.equal(engine.state.halted, true);
  assert.deepEqual(engine.state.reconciliationBlocked, {
    signature: 'expired-wire', mint: 'mint', side: 'sell', lastValidBlockHeight: 100,
    detectedAt: engine.state.reconciliationBlocked.detectedAt, reason: 'LIVE_RECONCILIATION_UNRESOLVED',
  });
  assert.equal(saved.reconciliationBlocked.signature, 'expired-wire');
  assert.equal(saved.risk.haltReason, 'LIVE_RECONCILIATION_UNRESOLVED');
});

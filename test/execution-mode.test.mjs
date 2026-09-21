import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from '../terminal/src/engine.js';

test('execution mode defaults to legacy and rejects invalid values', () => {
  const state = initialState();
  assert.equal(state.executionMode, 'legacy');
  const external = reducer(state, { type: 'SET_EXECUTION_MODE', mode: 'external' });
  assert.equal(external.executionMode, 'external');
  assert.equal(reducer(external, { type: 'SET_EXECUTION_MODE', mode: 'invalid' }).executionMode, 'external');
});

test('external mode preserves pending queue and disables legacy settlement/automation', () => {
  let state = reducer(initialState(1000), { type: 'SET_EXECUTION_MODE', mode: 'external' });
  state.running = true;
  state.pending = [{ id: 1, asset: 'SOL', side: 'buy', budget: 150, fee: 0.01,
    reference: 150, due: 1050, config: { ...state.config } }];
  const next = reducer(state, { type: 'TICK', now: 1200 });
  assert.equal(next.pending.length, 1);
  assert.equal(next.pending[0].id, 1);
  assert.equal(next.positions.length, 0);
  assert.equal(next.cash, state.cash);
});

test('external mode still advances position high-water and trailing stop', () => {
  let state = reducer(initialState(1000), { type: 'SET_EXECUTION_MODE', mode: 'external' });
  state.liveMode = true;
  state.positions = [{ asset: 'SOL', qty: 10, entry: 100, cost: 1000, high: 100, stop: 93, tiers: [] }];
  state.assets = state.assets.map(a => a.id === 'SOL' ? { ...a, price: 200 } : a);
  const pos = reducer(state, { type: 'TICK', now: 1100 }).positions[0];
  assert.equal(pos.high, 200);
  assert.equal(pos.stop, 186);
});

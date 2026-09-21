import test from 'node:test';
import assert from 'node:assert/strict';
import { assetToPoolState, syncAssetsToEngine } from '../terminal/src/pool-sync.js';

test('pool-sync converts liquidity and price to bigint reserves', () => {
  const state = assetToPoolState({ id: 'TEST', price: 0.00005, liquidity: 300_000, sigma: 0.04 }, 150, 1_700_000_000_000, 9);
  assert.equal(state.reserves.sol, 1_000_000_000_000n);
  assert.equal(state.reserves.token, 3_000_000_000_000_000_000n);
  assert.equal(state.slot, 4_250_000_000);
  assert.equal(state.volatility, 0.04);
});

test('pool-sync pushes only valid assets to the execution engine', () => {
  const engine = { records: [], pushState(state, pool) { this.records.push({ state, pool }); } };
  const count = syncAssetsToEngine(engine, [{ id: 'SOL', price: 150, liquidity: 8_000_000 }, { id: 'BAD', price: 0 }], 150, 1_700_000_000_000);
  assert.equal(count, 1);
  assert.equal(engine.records[0].pool, 'SOL');
});

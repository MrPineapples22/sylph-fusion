import {test} from 'node:test';
import assert from 'node:assert/strict';
import {globalProjectionService as projection} from '../dist/projection-service.js';
import {globalCommandGateway} from '../dist/command-gateway.js';

test('operator health does not promote simulated routing into observed infrastructure', () => {
  const strip = projection.getSystemStrip();
  for (const field of ['activeLeaderPubkey', 'isJitoLeader', 'tipFloorP75', 'contentionTier', 'helios']) {
    assert.equal(strip[field], undefined, field);
  }
});

test('public listing preserves zero, missing, and malformed metrics distinctly', () => {
  const [zero, missing, malformed] = projection.projectEnrichedTokens([
    {mint: 'zero', price: 0, liquidity: 0, cap: 0, txCount: 0, at: Date.now()},
    {mint: 'missing', volume1h: 1e9},
    {mint: 'bad', price: Infinity, liquidity: -1, cap: NaN, txCount: 0.5, at: 1e30},
  ]);
  assert.equal(zero.liquidity, 0); assert.equal(zero.txs, 0); assert.equal(zero.price, 0);
  for (const row of [missing, malformed]) {
    assert.equal(row.liquidity, null); assert.equal(row.price, null);
    assert.equal(row.txs, null); assert.equal(row.hsi, null);
    assert.equal(row.risk, 'UNKNOWN'); assert.equal(row.decision, 'ABSTAIN');
  }
});

test('large fresh public metrics do not imply clean risk or executable edge', () => {
  const rows = projection.projectEnrichedTokens([{mint: 'listed', price: 10, liquidity: 1e8,
    cap: 1e9, txCount: 10000, at: Date.now(), hsi: 1, risk: 'CLEAN', decision: 'FAST_BUY'}]);
  assert.equal(rows[0].decision, 'WATCH');
  assert.equal(rows[0].risk, 'UNKNOWN');
  assert.equal(rows[0].edge, '—');
  assert.equal(projection.getBestOpportunity(rows).capitalResult, 'NO_TRADE');
});

test('projection cannot fabricate gains or liquidation proceeds from entry price', t => {
  t.mock.method(globalCommandGateway, 'getSnapshot', () => ({positions: [{asset: 'T', mint: 'mint',
    qty: 100, entry: 2, costBasisUsd: 200, reconciliationState: 'RECONCILED', openedAt: 123}]}));
  const [position] = projection.getPositions();
  assert.equal(position.entryPriceUsd, 2);
  for (const field of ['markPriceUsd','executableLiquidationUsd','unrealizedPnlUsd','unrealizedPnlPct']) {
    assert.equal(position[field], null);
  }
});

test('position marks require a fresh observed timestamp and expire from the UI projection', t => {
  const mint = 'timestamped-mint';
  t.mock.method(globalCommandGateway, 'getSnapshot', () => ({positions: [{asset: mint, mint,
    qty: 10, entry: 2, costBasisUsd: 20, reconciliationState: 'SIMULATED', openedAt: 123}]}));
  const now = Date.now();
  const [fresh] = projection.getPositions([{mint, price: 3, at: now}]);
  assert.equal(fresh.markPriceUsd, 3);
  assert.equal(fresh.markObservedAt, now);
  assert.equal(fresh.markState, 'FRESH');

  t.mock.method(Date, 'now', () => now + 6_000);
  const [stale] = projection.getPositions([{mint, price: 99, at: now - 10_000}]);
  assert.equal(stale.markPriceUsd, null);
  assert.equal(stale.unrealizedPnlUsd, null);
  assert.equal(stale.markState, 'STALE');

  const [future] = projection.getPositions([{mint, price: 99, at: now + 7_000}]);
  assert.equal(future.markPriceUsd, null);
});

test('malformed rows cannot crash or contaminate a projection batch', () => {
  assert.equal(projection.projectEnrichedTokens([null, [], false, {at: 1e30}, {mint: 'valid'}]).length, 1);
});

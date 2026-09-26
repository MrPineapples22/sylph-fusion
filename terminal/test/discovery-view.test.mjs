import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryRows } from '../src/components/discovery-view.js';
const tokens = [
  { mint: 'mint-alpha', symbol: 'Alpha', tier: 'PRIME', liquidity: 0, highSignalIndex: 5, at: 10 },
  { mint: 'mint-beta', symbol: 'Beta', tier: 'DEVELOPING', liquidity: 300, highSignalIndex: 5, at: 20 },
  { mint: 'mint-gamma', symbol: 'Gamma', tier: 'VETOED', liquidity: null, highSignalIndex: 999, isNativeAsset: true },
];
const order = ['mint-gamma', 'mint-beta', 'mint-alpha'];
const mints = rows => rows.map(row => row.mint);
test('snapshot membership and order survive updates, duplicate and expired identifiers', () => {
  assert.deepEqual(mints(discoveryRows(tokens, [...order, order[0], 'missing'])), order);
  assert.deepEqual(discoveryRows(tokens, []), []);
});
test('search normalizes whitespace and matches every term across symbol and mint', () => {
  assert.deepEqual(mints(discoveryRows(tokens, order, { query: ' ALPHA   mint- ' })), ['mint-alpha']);
  assert.equal(discoveryRows(tokens, order, { query: 'alpha', filter: 'Watch' }).length, 0);
  assert.equal(discoveryRows(tokens, order, { query: '  ' }).length, 3);
});
test('numeric sort puts zero before missing values and preserves snapshot ties without mutation', () => {
  assert.deepEqual(mints(discoveryRows(tokens, order, { sort: 'liquidity' })), ['mint-beta', 'mint-alpha', 'mint-gamma']);
  assert.deepEqual(mints(discoveryRows(tokens, order, { sort: 'signal' })), ['mint-beta', 'mint-alpha', 'mint-gamma']);
  assert.deepEqual(mints(discoveryRows(tokens, order, { sort: 'recent' })), ['mint-beta', 'mint-alpha', 'mint-gamma']);
  assert.deepEqual(order, ['mint-gamma', 'mint-beta', 'mint-alpha']);
  assert.equal(tokens[0].liquidity, 0);
});
test('symbol sort and tier filters are independent display projections', () => {
  assert.deepEqual(mints(discoveryRows(tokens, order, { sort: 'symbol' })), ['mint-alpha', 'mint-beta', 'mint-gamma']);
  for (const [filter, mint] of [['Prime', 'mint-alpha'], ['Watch', 'mint-beta'], ['Vetoed', 'mint-gamma']]) {
    assert.deepEqual(mints(discoveryRows(tokens, order, { filter })), [mint]);
  }
});

test('restricted is a distinct observation-only filter, not a synonym for vetoed', () => {
  const restricted = [...tokens, { mint: 'mint-delta', symbol: 'Delta', tier: 'QUARANTINED' }];
  assert.deepEqual(mints(discoveryRows(restricted, [...order, 'mint-delta'], { filter: 'Restricted' })), ['mint-delta']);
  assert.deepEqual(mints(discoveryRows(restricted, [...order, 'mint-delta'], { filter: 'Vetoed' })), ['mint-gamma']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from '../dist/market-hub.js';

const mint = 'So11111111111111111111111111111111111111112';

test('unconfigured shared market adapters make no implicit network request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; throw new Error('unexpected network request'); });
  const hub = new MarketHub('unused-watchlist.json');
  await assert.rejects(hub.search('SOL'), /explicitly configured/);
  await assert.rejects(hub.risk(mint), /explicitly configured/);
  assert.equal(calls, 0);
});

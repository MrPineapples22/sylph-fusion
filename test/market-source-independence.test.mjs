import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from '../dist/market-hub.js';

const mint = 'So11111111111111111111111111111111111111112';

test('a PumpPortal launch cannot corroborate a DexScreener price', async t => {
  const pair = {
    chainId: 'solana', baseToken: { address: mint, symbol: 'SOL' },
    priceUsd: '120', liquidity: { usd: 100_000 }, marketCap: 1_000_000,
    dexId: 'raydium', pairAddress: 'observed-pool',
  };
  t.mock.method(globalThis, 'fetch', async url => ({
    ok: true,
    json: async () => String(url).includes('token-profiles') ? [] : [pair],
  }));
  const hub = new MarketHub('unused-watchlist.json', '', undefined, '', '', 'https://market.example');
  // Run the actual enrichment path without starting timers or network sockets.
  await hub.dex();
  const unlaunched = hub.tokens[0];
  assert.equal(unlaunched.crossValidationStatus, 'SINGLE_SOURCE');
  hub.launches = [{ mint, symbol: 'SOL', name: 'Solana', at: Date.now() }];
  await hub.dex();
  assert.equal(hub.tokens[0].crossValidationStatus, 'SINGLE_SOURCE');
  assert.equal(hub.tokens[0].confidenceScore, unlaunched.confidenceScore);
  assert.equal(hub.tokens[0].price, 120);
});

test('a PumpPortal launch cannot fill an absent DexScreener price', async t => {
  t.mock.method(globalThis, 'fetch', async url => ({
    ok: true,
    json: async () => String(url).includes('token-profiles') ? [] : [{
      chainId: 'solana', baseToken: { address: mint, symbol: 'SOL' },
      liquidity: { usd: 100_000 }, dexId: 'raydium',
    }],
  }));
  const hub = new MarketHub('unused-watchlist.json', '', undefined, '', '', 'https://market.example');
  hub.launches = [{ mint, symbol: 'SOL', name: 'Solana', at: Date.now() }];
  await hub.dex();
  assert.equal(hub.tokens[0].price, null);
  assert.equal(hub.tokens[0].crossValidationStatus, 'UNKNOWN');
  assert.equal(hub.tokens[0].confidenceScore, 0);
});

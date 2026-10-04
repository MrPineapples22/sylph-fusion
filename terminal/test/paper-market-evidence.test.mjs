import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBasketEntryAuthorized,
  isFreshObservation,
  resolvePaperMarketEvidence,
  selectFreshMarketObservation,
  selectFreshSolObservation,
} from '../paper-market-evidence.mjs';

const now = 1_800_000_000_000;

test('fresh market evidence requires exact mint and pool, positive observed liquidity, and an unexpired source time', () => {
  const valid = {mint: 'mint-a', pair: 'pool-a', price: 0.25, liquidity: 24_000, at: now - 2_000};
  assert.deepEqual(selectFreshMarketObservation([valid], 'mint-a', 'pool-a', now), {
    mint: 'mint-a', poolAddress: 'pool-a', priceUsd: 0.25, liquidityUsd: 24_000, observedAt: now - 2_000,
  });
  assert.equal(selectFreshMarketObservation([{...valid, at: now - 5_001}], 'mint-a', 'pool-a', now), null);
  assert.equal(selectFreshMarketObservation([{...valid, at: now + 1}], 'mint-a', 'pool-a', now), null);
  assert.equal(selectFreshMarketObservation([{...valid, liquidity: 0}], 'mint-a', 'pool-a', now), null);
  assert.equal(selectFreshMarketObservation([{...valid, liquidity: undefined}], 'mint-a', 'pool-a', now), null);
  assert.equal(selectFreshMarketObservation([{...valid, pair: 'pool-b'}], 'mint-a', 'pool-a', now), null);
  assert.equal(selectFreshMarketObservation([{...valid, mint: 'mint-b'}], 'mint-a', 'pool-a', now), null);
});

test('fresh SOL conversion evidence cannot be renewed when its timestamp is stale or absent', () => {
  assert.deepEqual(selectFreshSolObservation({price: 150, at: now - 5_000}, now), {
    priceUsd: 150, observedAt: now - 5_000,
  });
  assert.equal(selectFreshSolObservation({price: 150, at: now - 5_001}, now), null);
  assert.equal(selectFreshSolObservation({price: 150}, now), null);
  assert.equal(isFreshObservation(now + 1, now), false);
});

test('market freshness never implies permission to enter', () => {
  assert.equal(isBasketEntryAuthorized({verified: false, entryAllowed: false}, 'ASTRA_FEED'), false);
  assert.equal(isBasketEntryAuthorized({verified: true, entryAllowed: false}, 'ASTRA_FEED'), false);
  assert.equal(isBasketEntryAuthorized({verified: true, entryAllowed: true}, 'MARKET_HUB'), false);
  assert.equal(isBasketEntryAuthorized({verified: true, entryAllowed: true}, 'ASTRA_FEED'), true);
});

const sol = {mint: 'So11111111111111111111111111111111111111112', price: 150, at: now};

test('Astra observation is preferred and only an authorized Astra basket can authorize entry', async () => {
  let hubReads = 0;
  const evidence = await resolvePaperMarketEvidence({
    mint: 'mint-a', poolAddress: 'pool-a', now: () => now,
    getBasket: async () => ({
      verified: true, entryAllowed: true,
      pairs: [{mint: 'mint-a', pair: 'pool-a', price: 2, liquidity: 20_000, at: now}],
    }),
    getHubSnapshot: () => { hubReads++; return {tokens: [sol]}; },
  });
  assert.equal(evidence.source, 'ASTRA_FEED');
  assert.equal(evidence.entryAllowed, true);
  assert.equal(evidence.priceUsd, 2);
  assert.equal(hubReads, 1);
});

test('MarketHub fallback is pool-bound and cannot authorize entry from basket claims', async () => {
  const evidence = await resolvePaperMarketEvidence({
    mint: 'mint-a', poolAddress: 'pool-a', now: () => now,
    getBasket: async () => ({verified: true, entryAllowed: true, pairs: []}),
    getHubSnapshot: () => ({tokens: [
      {...sol},
      {mint: 'mint-a', pair: 'wrong-pool', price: 99, liquidity: 1_000_000, at: now},
      {mint: 'mint-a', pair: 'pool-a', price: 3, liquidity: 30_000, at: now},
    ]}),
    fetchImpl: async () => { throw new Error('HTTP must not run after a valid Hub match'); },
    marketDexUrl: 'https://dex.invalid',
  });
  assert.equal(evidence.source, 'MARKET_HUB');
  assert.equal(evidence.poolAddress, 'pool-a');
  assert.equal(evidence.priceUsd, 3);
  assert.equal(evidence.entryAllowed, false);
});

test('HTTP fallback binds exact mint and pool, uses receipt time, and never grants entry permission', async () => {
  let clock = now;
  let requestedUrl;
  const evidence = await resolvePaperMarketEvidence({
    mint: 'mint-a', poolAddress: 'pool-a', now: () => clock,
    getBasket: async () => ({verified: true, entryAllowed: true, pairs: []}),
    getHubSnapshot: () => ({tokens: [sol]}),
    marketDexUrl: 'https://dex.invalid',
    makeTimeoutSignal: () => 'bounded-timeout',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.signal, 'bounded-timeout');
      clock += 10;
      return {ok: true, json: async () => [
        {baseToken: {address: 'other-mint'}, pairAddress: 'pool-a', priceUsd: '99', liquidity: {usd: 1_000_000}},
        {baseToken: {address: 'mint-a'}, pairAddress: 'other-pool', priceUsd: '88', liquidity: {usd: 1_000_000}},
        {baseToken: {address: 'mint-a'}, pairAddress: 'pool-a', priceUsd: '4', liquidity: {usd: 40_000}},
      ]};
    },
  });
  assert.equal(requestedUrl, 'https://dex.invalid/tokens/v1/solana/mint-a');
  assert.equal(evidence.source, 'DEXSCREENER_HTTP_RECEIPT');
  assert.equal(evidence.poolAddress, 'pool-a');
  assert.equal(evidence.priceUsd, 4);
  assert.equal(evidence.observedAt, now + 10);
  assert.equal(evidence.entryAllowed, false);
});

test('evidence provider returns unavailable when fresh SOL evidence is absent and contains adapter failures', async () => {
  const evidence = await resolvePaperMarketEvidence({
    mint: 'mint-a', poolAddress: 'pool-a', now: () => now,
    getBasket: async () => { throw new Error('feed unavailable'); },
    getHubSnapshot: () => { throw new Error('hub unavailable'); },
  });
  assert.equal(evidence, null);
});

test('fresh market price remains unavailable for missing or stale SOL conversion evidence', async t => {
  const market = {mint: 'mint-a', pair: 'pool-a', price: 2, liquidity: 20_000, at: now};
  for (const [name, tokens] of [
    ['missing SOL', []],
    ['stale SOL', [{...sol, at: now - 5_001}]],
  ]) {
    await t.test(name, async () => {
      const evidence = await resolvePaperMarketEvidence({
        mint: 'mint-a', poolAddress: 'pool-a', now: () => now,
        getBasket: async () => ({pairs: [market]}),
        getHubSnapshot: () => ({tokens}),
      });
      assert.equal(evidence, null);
    });
  }
});

test('SOL evidence that expires during the HTTP fallback cannot authorize returned evidence', async () => {
  let clock = now;
  const evidence = await resolvePaperMarketEvidence({
    mint: 'mint-a', poolAddress: 'pool-a', now: () => clock,
    getBasket: async () => ({pairs: []}),
    getHubSnapshot: () => ({tokens: [{...sol, at: now - 4_999}]}),
    marketDexUrl: 'https://dex.invalid',
    makeTimeoutSignal: () => null,
    fetchImpl: async () => {
      clock = now + 2;
      return {ok: true, json: async () => [{
        baseToken: {address: 'mint-a'}, pairAddress: 'pool-a', priceUsd: '2', liquidity: {usd: 20_000},
      }]};
    },
  });
  assert.equal(evidence, null);
});

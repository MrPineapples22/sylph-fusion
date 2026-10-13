import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BirdeyeResearchService} from '../birdeye-research.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const payload = data => new Response(JSON.stringify({success: true, data}), {status: 200, headers: {'content-type': 'application/json'}});

test('Birdeye overview uses authenticated Solana token-overview request and emits normalized research fields only', async () => {
  let requestedUrl;
  let requestInit;
  const service = new BirdeyeResearchService({apiKey: 'secret-test-key', fetchImpl: async (url, init) => {
    requestedUrl = new URL(url); requestInit = init;
    return payload({address: mint, price: 0.000012, liquidity: 56000, mc: 340000, volume1h: 100000, transaction: 'must-not-escape'});
  }});
  const result = await service.overview(mint);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.provider, 'BIRDEYE');
  assert.equal(result.authority, 'RESEARCH_ONLY');
  assert.equal(result.executionAuthorized, false);
  assert.equal(requestedUrl.origin, 'https://public-api.birdeye.so');
  assert.equal(requestedUrl.pathname, '/defi/token_overview');
  assert.equal(requestedUrl.searchParams.get('address'), mint);
  assert.equal(requestedUrl.searchParams.get('frames'), '1h,24h');
  assert.equal(requestInit.method, 'GET');
  assert.equal(requestInit.redirect, 'error');
  assert.equal(requestInit.headers['X-API-KEY'], 'secret-test-key');
  assert.equal(requestInit.headers['x-chain'], 'solana');
  assert.deepEqual(result.fields, {priceUsd: 0.000012, liquidityUsd: 56000, marketCapUsd: 340000});
  assert.equal(JSON.stringify(result).includes('secret-test-key'), false);
  assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
});

test('Birdeye fails closed for missing credentials, unsupported mints, and mismatched response identity', async () => {
  let calls = 0;
  const disabled = new BirdeyeResearchService({fetchImpl: async () => {calls += 1;}});
  assert.equal((await disabled.overview(mint)).errorCode, 'BIRDEYE_API_KEY_UNCONFIGURED');
  assert.equal((await disabled.overview('invalid mint')).errorCode, 'BIRDEYE_MINT_INVALID');
  assert.equal(calls, 0);
  const mismatch = new BirdeyeResearchService({apiKey: 'test', fetchImpl: async () => payload({address: '11111111111111111111111111111111', price: 1})});
  assert.equal((await mismatch.overview(mint)).errorCode, 'BIRDEYE_MINT_MISMATCH');
});

test('Birdeye rejects missing market fields, oversized payloads, and HTTP errors without leaking bodies', async () => {
  const empty = new BirdeyeResearchService({apiKey: 'test', fetchImpl: async () => payload({address: mint, price: '0.1', liquidity: -1})});
  assert.equal((await empty.overview(mint)).errorCode, 'BIRDEYE_NO_VALID_MARKET_FIELDS');
  const oversized = new BirdeyeResearchService({apiKey: 'test', fetchImpl: async () => new Response('x'.repeat(262_145), {status: 200})});
  assert.equal((await oversized.overview(mint)).errorCode, 'BIRDEYE_RESPONSE_TOO_LARGE');
  const failed = new BirdeyeResearchService({apiKey: 'test', fetchImpl: async () => new Response('private provider detail', {status: 429})});
  const result = await failed.overview(mint);
  assert.equal(result.errorCode, 'BIRDEYE_HTTP_429');
  assert.equal(JSON.stringify(result).includes('private provider detail'), false);
});

test('Birdeye overview coalesces concurrent calls and caches briefly', async () => {
  let calls = 0;
  const service = new BirdeyeResearchService({apiKey: 'test', fetchImpl: async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return payload({price: 1.25, liquidity: 1000});
  }});
  const [first, concurrent] = await Promise.all([service.overview(mint), service.overview(mint)]);
  assert.equal(first, concurrent);
  assert.equal(await service.overview(mint), first);
  assert.equal(calls, 1);
});

test('Birdeye serializes different mints at the documented baseline request rate', async () => {
  const otherMint = '11111111111111111111111111111111';
  let clock = 1_000;
  const waits = [];
  const service = new BirdeyeResearchService({apiKey: 'test', now: () => clock,
    wait: async ms => { waits.push(ms); clock += ms; },
    fetchImpl: async () => payload({price: 1, liquidity: 100}),
  });
  await service.overview(mint);
  await service.overview(otherMint);
  assert.deepEqual(waits, [1_000]);
});

test('Birdeye research is explicitly operator-triggered and has no entry-authority wiring', async () => {
  const [server, ui] = await Promise.all([
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/Astra.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /\/api\/research\/birdeye-overview/);
  assert.match(server, /birdeyeResearch\.overview\(mint\)/);
  assert.match(ui, /requestBirdeyeOverview/);
  assert.match(ui, /Cross-check Birdeye/);
  assert.match(ui, /manual research only/);
});

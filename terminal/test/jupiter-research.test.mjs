import test from 'node:test';
import assert from 'node:assert/strict';
import { JupiterResearchQuoteService } from '../jupiter-research.mjs';

const wrappedSol = 'So11111111111111111111111111111111111111112';
const mint = 'So11111111111111111111111111111111111111113';
const quote = (inputMint, outputMint, inAmount, outAmount, extra = {}) => new Response(JSON.stringify({
  inputMint, outputMint, inAmount, outAmount, transaction: null, router: 'metis', ...extra,
}));

test('Jupiter round-trip uses two quote-only requests and reports size-specific round-trip friction', async () => {
  const requests = [];
  const validatedLatencies = [];
  const service = new JupiterResearchQuoteService({ apiKey: 'test-api-key', amountLamports: 10_000_000,
    minRequestGapMs: 0, now: () => 1_800_000_000_000,
    onValidatedQuote: latencyMs => validatedLatencies.push(latencyMs),
    fetchImpl: async (url, init) => {
      const parsed = new URL(url); requests.push({ parsed, init });
      assert.equal(parsed.pathname, '/swap/v2/order');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers['x-api-key'], 'test-api-key');
      assert.equal(parsed.searchParams.has('taker'), false);
      if (requests.length === 1) return quote(wrappedSol, mint, '10000000', '2000000');
      return quote(mint, wrappedSol, '2000000', '9900000');
    },
  });
  const result = await service.quoteRoundTrip(mint);
  assert.equal(result.status, 'QUOTED');
  assert.equal(result.authority, 'QUOTE_ONLY');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.amountLamports, '10000000');
  assert.equal(result.buyOutputRaw, '2000000');
  assert.equal(result.sellOutputLamports, '9900000');
  assert.equal(result.roundTripDeltaBps, -100);
  assert.equal(requests.length, 2);
  assert.equal(validatedLatencies.length, 2);
  assert.equal(requests[1].parsed.searchParams.get('amount'), '2000000');
  assert.equal(JSON.stringify(result).includes('test-api-key'), false);
  assert.equal('transaction' in result, false);
  assert.match(result.note, /not a fill or profit forecast/i);
  assert.equal(await service.quoteRoundTrip(mint), result);
  assert.equal(requests.length, 2, 'fresh quote result is cached');
});

test('Jupiter research rejects executable transaction payloads and does not request a sell', async () => {
  let calls = 0;
  const failures = [];
  const service = new JupiterResearchQuoteService({ minRequestGapMs: 0, onFailure: reason => failures.push(reason), fetchImpl: async () => {
    calls += 1;
    return quote(wrappedSol, mint, '10000000', '2000000', { transaction: 'base64-transaction' });
  } });
  const result = await service.quoteRoundTrip(mint);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.errorCode, 'JUPITER_QUOTE_SCHEMA_INVALID');
  assert.equal(calls, 1);
  assert.deepEqual(failures, ['JUPITER_QUOTE_SCHEMA_INVALID']);
  assert.equal('transaction' in result, false);
});

test('Jupiter research rejects token output amounts outside the SPL u64 range', async () => {
  let calls = 0;
  const service = new JupiterResearchQuoteService({ minRequestGapMs: 0, fetchImpl: async () => {
    calls += 1;
    return quote(wrappedSol, mint, '10000000', '18446744073709551616');
  } });
  const result = await service.quoteRoundTrip(mint);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.errorCode, 'JUPITER_QUOTE_SCHEMA_INVALID');
  assert.equal(calls, 1, 'invalid output must not be reused as the sell input');
  assert.equal(result.executionAuthorized, false);
});

test('Jupiter research coalesces concurrent requests and rejects invalid mints before network access', async () => {
  let calls = 0;
  const service = new JupiterResearchQuoteService({ minRequestGapMs: 0, fetchImpl: async url => {
    calls += 1;
    const params = new URL(url).searchParams;
    return quote(params.get('inputMint'), params.get('outputMint'), params.get('amount'), params.get('inputMint') === wrappedSol ? '2000000' : '9900000');
  } });
  assert.equal((await service.quoteRoundTrip('not-a-mint')).errorCode, 'JUPITER_MINT_INVALID');
  const [a, b, c] = await Promise.all([service.quoteRoundTrip(mint), service.quoteRoundTrip(mint), service.quoteRoundTrip(mint)]);
  assert.equal(a.status, 'QUOTED');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(calls, 2);
});

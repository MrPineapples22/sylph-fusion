import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MayanResearchQuoteService } from '../mayan-research.mjs';

const quote = (type, expected, minimum, etaSeconds = 10) => ({
  type, fromChain: 'solana', toChain: 'base', expectedAmountOut: expected,
  expectedAmountOutBaseUnits: String(Math.round(Number(expected) * 1_000_000)),
  minAmountOut: minimum, minAmountOutBaseUnits: String(Math.round(Number(minimum) * 1_000_000)),
  etaSeconds, slippageBps: 50, serializedTransaction: 'must-not-escape-normalizer',
});
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('Mayan quote requests a bounded Solana-to-Base route and returns only normalized advisory fields', async () => {
  let requestedUrl;
  let requestInit;
  const service = new MayanResearchQuoteService({ amountLamports: 10_000_000, fetchImpl: async (url, init) => {
    requestedUrl = new URL(url); requestInit = init;
    return response({ minimumSdkVersion: [7, 0, 0], quotes: [quote('SWIFT', '1.025717', '1.020078', 3), quote('FAST_MCTP', '1.050270', '1.044590', 35)] });
  } });
  const result = await service.quoteSolToBaseUsdc();
  assert.equal(result.status, 'QUOTED');
  assert.equal(result.provider, 'MAYAN');
  assert.equal(result.authority, 'QUOTE_ONLY');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.highestOutputRouteType, 'FAST_MCTP');
  assert.equal(requestedUrl.origin, 'https://price-api.mayan.finance');
  assert.equal(requestedUrl.pathname, '/v3/quote');
  assert.equal(requestedUrl.searchParams.get('fromChain'), 'solana');
  assert.equal(requestedUrl.searchParams.get('toChain'), 'base');
  assert.equal(requestedUrl.searchParams.get('amountIn64'), '10000000');
  assert.equal(requestedUrl.searchParams.get('sdkVersion'), '15.2.2');
  assert.equal(requestInit.method, 'GET');
  assert.equal(requestInit.redirect, 'error');
  assert.equal(JSON.stringify(result).includes('must-not-escape-normalizer'), false);
  assert.equal(JSON.stringify(result).includes('serializedTransaction'), false);
});

test('Mayan quote coalesces concurrent requests and briefly caches a valid quote', async () => {
  let calls = 0;
  const service = new MayanResearchQuoteService({ fetchImpl: async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return response({ quotes: [quote('SWIFT', '1.1', '1.0')] });
  } });
  const [first, concurrent] = await Promise.all([service.quoteSolToBaseUsdc(), service.quoteSolToBaseUsdc()]);
  assert.equal(first.status, 'QUOTED');
  assert.equal(concurrent, first);
  assert.equal(await service.quoteSolToBaseUsdc(), first);
  assert.equal(calls, 1);
});

test('Mayan rejects malformed routes, future SDK floors, and HTTP failures without leaking provider payloads', async () => {
  const malformed = new MayanResearchQuoteService({ fetchImpl: async () => response({ quotes: null }) });
  const malformedResult = await malformed.quoteSolToBaseUsdc();
  assert.equal(malformedResult.status, 'UNAVAILABLE');
  assert.equal(malformedResult.errorCode, 'MAYAN_RESPONSE_SCHEMA_INVALID');

  const futureSdk = new MayanResearchQuoteService({ fetchImpl: async () => response({ minimumSdkVersion: [99, 0, 0], quotes: [quote('SWIFT', '1.2', '1.1')] }) });
  const futureResult = await futureSdk.quoteSolToBaseUsdc();
  assert.equal(futureResult.errorCode, 'MAYAN_SDK_UPDATE_REQUIRED');

  const httpFailure = new MayanResearchQuoteService({ fetchImpl: async () => new Response('secret provider detail', { status: 429 }) });
  const failed = await httpFailure.quoteSolToBaseUsdc();
  assert.equal(failed.errorCode, 'MAYAN_HTTP_429');
  assert.equal(JSON.stringify(failed).includes('secret provider detail'), false);
});

test('Mayan quote route is operator-triggered in Astra and wired to the local API', async () => {
  const [server, ui] = await Promise.all([
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/Astra.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /\/api\/research\/mayan-bridge-quote/);
  assert.match(server, /mayanResearchQuotes\.quoteSolToBaseUsdc\(\)/);
  assert.match(ui, /requestMayanBridgeQuote/);
  assert.match(ui, /Quote Mayan bridge routes/);
  assert.match(ui, /Indicative bridge research only/);
});

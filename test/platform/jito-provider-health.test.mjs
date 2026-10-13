import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {Executor} from '../../dist/execution.js';
import {ProviderHealthTracker} from '../../dist/platform/ingestion/provider-health.js';

test('Jito read-only warmup feeds validated endpoint health without becoming a market authority', async () => {
  const originalFetch = globalThis.fetch;
  const tracker = new ProviderHealthTracker();
  globalThis.fetch = async url => {
    if (String(url).includes('/api/v1/bundles')) {
      return new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: ['11111111111111111111111111111111']}), {status: 200});
    }
    if (String(url).includes('/tip_floor')) {
      return new Response(JSON.stringify([{landed_tips_75th_percentile: 0.0001}]), {status: 200});
    }
    throw new Error('Unexpected Jito warmup request');
  };
  try {
    const config = {JITO_URL: 'https://test-jito.mock/api/v1/bundles?api-key=private', JITO_AUTH: '',
      RPC_TIMEOUT_MS: 1000, MIN_TIP_LAMPORTS: 1000};
    await new Executor(config, {}, {}, Keypair.generate(), undefined, tracker).warm();
    const provider = tracker.getReport().providers.JITO_BLOCK_ENGINE;
    assert.equal(provider.configured, true);
    assert.equal(provider.enabled, true);
    assert.equal(provider.transportReachable, true);
    assert.equal(provider.observationValidated, true);
    assert.equal(provider.capabilityAvailable, true);
    assert.equal(provider.isAuthoritative, false);
    assert.equal(provider.endpointUrlSanitized, 'https://test-jito.mock/api/v1/bundles');
    assert.equal(provider.totalRequestsCount, 2);
    assert.equal(tracker.isMarketFeedStale(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

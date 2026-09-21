import test from 'node:test';
import assert from 'node:assert/strict';
import { RpcPool, sanitizeRpcUrl } from '../../dist/rpc.js';
import { config } from '../../dist/config.js';

test('sanitizeRpcUrl redacts sensitive query keys, paths, and passwords into host/provider labels', () => {
  const url1 = 'https://mainnet.helius-rpc.com/?api-key=secret-abc-123';
  assert.equal(sanitizeRpcUrl(url1), 'Helius (mainnet.helius-rpc.com)');
  assert.equal(sanitizeRpcUrl(url1).includes('secret-abc-123'), false);

  const url2 = 'https://solana-mainnet.g.alchemy.com/v2/secret-token-xyz';
  assert.equal(sanitizeRpcUrl(url2), 'Alchemy (solana-mainnet.g.alchemy.com)');
  assert.equal(sanitizeRpcUrl(url2).includes('secret-token-xyz'), false);
  assert.equal(sanitizeRpcUrl(url2).includes('/v2/'), false);

  const url3 = 'https://user:password123@private-rpc.internal.net/#secret-hash';
  assert.equal(sanitizeRpcUrl(url3), 'INTERNAL (private-rpc.internal.net)');
  assert.equal(sanitizeRpcUrl(url3).includes('password123'), false);
  assert.equal(sanitizeRpcUrl(url3).includes('secret-hash'), false);
});

test('RpcPool tracks per-endpoint operational statistics and sanitized URLs', () => {
  const cfg = config({
    RPC_URLS: 'https://rpc1.invalid/?api-key=key1,https://rpc2.invalid/?token=key2',
    WS_URLS: 'wss://feed.invalid',
    KEYPAIR_PATH: 'test-key.json',
  });

  const pool = new RpcPool(cfg);
  const stats = pool.getEndpointStats();

  assert.equal(stats.length, 2);
  assert.equal(stats[0].index, 0);
  assert.equal(stats[0].url, 'RPC1 (rpc1.invalid)');
  assert.equal(stats[0].url.includes('key1'), false);
  assert.equal(stats[0].active, true);
  assert.equal(stats[1].index, 1);
  assert.equal(stats[1].url, 'RPC2 (rpc2.invalid)');
  assert.equal(stats[1].url.includes('key2'), false);
  assert.equal(stats[1].active, false);

  // Update slot on endpoint 1
  pool.updateSlot(0, 310500100);
  const updated = pool.getEndpointStats();
  assert.equal(updated[0].currentSlot, 310500100);
});

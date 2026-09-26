import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { config } from '../dist/config.js';
import { Executor } from '../dist/execution.js';

test('an absent Jupiter endpoint rejects before any routing request', async t => {
  const cfg = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://one.invalid',
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    throw new Error('routing must not contact an implicit endpoint');
  });
  const executor = new Executor(cfg, {}, {}, Keypair.generate());
  await assert.rejects(
    executor.graduatedSell('So11111111111111111111111111111111111111112', 1n, 100),
    /not explicitly configured/,
  );
  assert.equal(calls, 0);
});

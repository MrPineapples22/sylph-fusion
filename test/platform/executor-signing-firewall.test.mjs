import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { Executor } from '../../dist/execution.js';

const buildDenied = /QUARANTINED_LEGACY_EXECUTION/;
const broadcastDenied = /QUARANTINED_LEGACY_BROADCAST/;
const address = PublicKey.default;
const config = (mode = 'paper') => ({
  MODE: mode, QUOTE_MAX_AGE_MS: 10_000, SLIPPAGE_BPS: 300, PANIC_SLIPPAGE_BPS: 1000,
  MIN_TIP_LAMPORTS: 10_000, MAX_TIP_LAMPORTS: 500_000, MAX_PRIORITY_LAMPORTS: 200_000,
  JITO_URL: 'https://jito.invalid', JITO_AUTH: '', RPC_TIMEOUT_MS: 1000,
});
const snapshot = (complete = false) => ({
  at: Date.now(), slot: 1, mint: address, tokenProgram: TOKEN_PROGRAM_ID,
  curve: { complete, realQuoteReserves: 1_000_000n }, creatorTokens: '0',
});

function trappedExecutor(t, cfg) {
  const calls = [];
  const trap = name => (..._args) => { calls.push(name); throw new Error(`UNEXPECTED_${name}`); };
  const rpc = { connection: {
    getLatestBlockhashAndContext: trap('blockhash'), getRecentPrioritizationFees: trap('fees'),
    getAddressLookupTable: trap('lookup'), simulateTransaction: trap('simulation'),
  } };
  const market = { buyQuote: trap('buyQuote'), sellQuote: trap('sellQuote') };
  const signer = { publicKey: address, signTransactionMessage: trap('signer') };
  const firewall = { evaluate: trap('firewall') };
  t.mock.method(globalThis, 'fetch', trap('fetch'));
  const executor = new Executor(cfg, rpc, market, signer, firewall);
  t.mock.method(executor, 'graduatedSell', trap('route'));
  t.mock.method(PUMP_SDK, 'buyV2Instructions', trap('buyInstructions'));
  t.mock.method(PUMP_SDK, 'sellV2Instructions', trap('sellInstructions'));
  return { executor, calls, market };
}

for (const mode of ['live', 'LIVE', undefined, null, 'invalid']) {
  test(`legacy build rejects mode ${String(mode)} before quote, RPC, firewall, or signer`, async t => {
    const cfg = { ...config(), MODE: mode };
    const { executor, calls } = trappedExecutor(t, cfg);
    for (const complete of [false, true]) {
      for (const side of ['buy', 'sell']) {
        await assert.rejects(executor.build(snapshot(complete), side, 100n, 'creator', 0, 'test', false), buildDenied);
      }
    }
    // Mode quarantine also takes priority over stale/invalid event payload handling.
    await assert.rejects(executor.build(null, 'buy', 100n, 'creator', 0, 'test', false), buildDenied);
    assert.deepEqual(calls, []);
  });
}

for (const route of ['graduated', 'curve']) {
  test(`paper-to-live change during deferred ${route} build denies before any live action`, async t => {
    const cfg = config();
    const { executor, calls, market } = trappedExecutor(t, cfg);
    let resolve;
    const deferred = new Promise(done => { resolve = done; });
    if (route === 'graduated') {
      executor.graduatedSell.mock.mockImplementation(() => deferred);
    } else {
      t.mock.method(market, 'sellQuote', () => 1_000_000n);
      PUMP_SDK.sellV2Instructions.mock.mockImplementation(() => deferred);
    }
    const pending = executor.build(snapshot(route === 'graduated'), 'sell', 100n, 'creator', 0, 'test', false);
    cfg.MODE = 'live';
    resolve(route === 'graduated' ? { instructions: [], alts: [], output: 1_000_000n } : []);
    await assert.rejects(pending, buildDenied);
    assert.deepEqual(calls, []);
  });
}

for (const mode of ['paper', 'live', undefined, 'invalid']) {
  test(`legacy broadcast is unconditionally quarantined for ${String(mode)}, including retries`, async t => {
    const { executor, calls } = trappedExecutor(t, { ...config(), MODE: mode });
    for (const signature of ['signature', 'paper', 'sim_fixture']) {
      const order = { signature, wire: 'identical-signed-wire' };
      const before = structuredClone(order);
      await assert.rejects(executor.broadcast(order), broadcastDenied);
      await assert.rejects(executor.broadcast(order), broadcastDenied);
      assert.deepEqual(order, before);
    }
    await assert.rejects(executor.broadcast(null), broadcastDenied);
    assert.deepEqual(calls, []);
  });
}

test('legacy paper build retains buy/sell deltas and artifacts without signing or simulation', async t => {
  const { executor, calls, market } = trappedExecutor(t, config());
  t.mock.method(market, 'buyQuote', () => 1_000_000n);
  t.mock.method(market, 'sellQuote', () => 1_000_000n);
  PUMP_SDK.buyV2Instructions.mock.mockImplementation(async () => []);
  PUMP_SDK.sellV2Instructions.mock.mockImplementation(async () => []);
  const s = snapshot();
  const buy = await executor.build(s, 'buy', 100_000n, 'creator', 0, 'test', false);
  const sell = await executor.build(s, 'sell', 100_000n, 'creator', 1, 'test', false);
  assert.equal(buy.pending.signature, 'paper');
  assert.equal(buy.pending.wire, '');
  assert.equal(buy.pending.lastValidBlockHeight, 0);
  assert.equal(buy.quotedOutput, 1_000_000n);
  assert.equal(buy.quoteTimestamp, s.at);
  assert.equal(buy.tokenDelta, 970_000n);
  assert.equal(buy.solDelta, -3_315_000n);
  assert.equal(sell.pending.signature, 'paper');
  assert.equal(sell.pending.wire, '');
  assert.equal(sell.tokenDelta, -100_000n);
  assert.equal(sell.solDelta, 755_000n);
  assert.equal(sell.overhead.slippageLamports, '30000');
  assert.deepEqual(calls, []);
});

test('legacy Executor exposes no generic Jito send surface; warm and reconciliation remain read-only', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = init?.body ? JSON.parse(init.body) : { method: 'TIP_FLOOR_GET' };
    requests.push(request);
    if (request.method === 'getTipAccounts') return new Response(JSON.stringify({ result: [address.toBase58()] }));
    if (request.method === 'TIP_FLOOR_GET') return new Response(JSON.stringify([{ landed_tips_75th_percentile: 0.00001 }]));
    assert.equal(request.method, 'getInflightBundleStatuses');
    return new Response(JSON.stringify({ result: { value: [{ bundle_id: 'bundle', status: 'Pending' }] } }));
  });
  const observations = [];
  const endpoints = [{
    getTransaction: async signature => { observations.push(['transaction', signature]); return null; },
    getBlockHeight: async commitment => { observations.push(['height', commitment]); return 100; },
  }];
  const executor = new Executor(config(), { endpoints }, {}, { publicKey: address });
  assert.equal(executor.jito, undefined);
  assert.equal(Object.hasOwn(Object.getPrototypeOf(executor), 'jito'), false);
  assert.equal(executor.getTipAccounts, undefined);
  await executor.warm();
  assert.deepEqual(await executor.reconcile({ signature: 'unknown', lastValidBlockHeight: 200 }, 'bundle'), { status: 'pending' });
  assert.deepEqual(requests.map(row => row.method), ['getTipAccounts', 'TIP_FLOOR_GET', 'getInflightBundleStatuses']);
  assert.deepEqual(requests[0].params, []);
  assert.deepEqual(requests[2].params, [['bundle']]);
  assert.deepEqual(observations, [['transaction', 'unknown'], ['height', 'finalized']]);
});

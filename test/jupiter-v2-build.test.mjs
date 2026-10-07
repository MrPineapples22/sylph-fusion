import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../dist/config.js';
import { Executor } from '../dist/execution.js';

const mint = Keypair.generate().publicKey.toBase58();
const key = Keypair.generate();
const nativeMint = 'So11111111111111111111111111111111111111112';
const cfg = config({
  RPC_URLS: 'https://one.invalid,https://two.invalid',
  WS_URLS: 'wss://feed.invalid',
  JUPITER_URL: 'https://api.jup.ag/swap/v2',
  JUPITER_API_KEY: 'unit-test-key',
});

function routeData({ inAmount = 1000n, outAmount = 50000n, slippageBps = 1000, platformFeeBps = 0 } = {}) {
  const data = Buffer.alloc(32);
  Buffer.from('c1209b3341d69c81', 'hex').copy(data, 0); // sharedAccountsRoute discriminator
  data.writeUInt8(1, 8); // route id
  data.writeUInt32LE(0, 9); // empty fixture route plan
  data.writeBigUInt64LE(inAmount, 13);
  data.writeBigUInt64LE(outAmount, 21);
  data.writeUInt16LE(slippageBps, 29);
  data[31] = platformFeeBps;
  return data.toString('base64');
}

function response(overrides = {}) {
  return {
    inputMint: mint,
    outputMint: nativeMint,
    inAmount: '1000',
    outAmount: '50000',
    otherAmountThreshold: '45000',
    swapMode: 'ExactIn',
    slippageBps: 1000,
    routePlan: [{ swapInfo: { inputMint: mint, outputMint: nativeMint, inAmount: '1000', outAmount: '50000' }, percent: 100 }],
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [{ pubkey: key.publicKey.toBase58(), isSigner: true, isWritable: true }],
      data: routeData(),
    },
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: null,
    blockhashWithMetadata: { blockhash: Array(32).fill(7), lastValidBlockHeight: 300 },
    ...overrides,
  };
}

test('V2 Router build sends exact-in sell request with API key and accepts no-ALT result', async t => {
  let requestUrl;
  let requestHeaders;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requestUrl = new URL(String(url));
    requestHeaders = init.headers;
    return new Response(JSON.stringify(response()));
  });
  const executor = new Executor(cfg, {}, {}, key);
  const result = await executor.graduatedSell(mint, 1000n, 1000);
  assert.equal(requestUrl.pathname, '/swap/v2/build');
  assert.equal(requestUrl.searchParams.get('inputMint'), mint);
  assert.equal(requestUrl.searchParams.get('outputMint'), nativeMint);
  assert.equal(requestUrl.searchParams.get('amount'), '1000');
  assert.equal(requestUrl.searchParams.get('taker'), key.publicKey.toBase58());
  assert.equal(requestUrl.searchParams.get('slippageBps'), '1000');
  assert.equal(requestHeaders['x-api-key'], 'unit-test-key');
  assert.equal(result.output, 50000n);
  assert.equal(result.minimumOutput, 45000n);
  assert.equal(result.alts.length, 0);
  assert.equal(result.instructions.length, 1);
  assert.equal(result.lastValidBlockHeight, 300);
  assert.ok(Number.isSafeInteger(result.quoteTimestamp));
});

test('V2 Router build retains only bounded compute-unit-price instructions', async t => {
  const price = Buffer.alloc(9);
  price[0] = 3;
  price.writeBigUInt64LE(1000n, 1);
  const computeIx = {
    programId: 'ComputeBudget111111111111111111111111111111',
    accounts: [],
    data: price.toString('base64'),
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response({ computeBudgetInstructions: [computeIx] }))));
  const executor = new Executor(cfg, {}, {}, key);
  const result = await executor.graduatedSell(mint, 1000n, 1000);
  assert.equal(result.instructions[0].programId.toBase58(), computeIx.programId);
  assert.equal(result.instructions.length, 2);
});

test('V2 Router build rejects unexpected side instructions and priority fee over cap', async t => {
  const fixtures = [
    response({ tipInstruction: { programId: '11111111111111111111111111111111', accounts: [], data: '' } }),
    response({ computeBudgetInstructions: [{
      programId: 'ComputeBudget111111111111111111111111111111',
      accounts: [],
      data: Buffer.concat([Buffer.from([3]), Buffer.alloc(8, 255)]).toString('base64'),
    }] }),
  ];
  for (const fixture of fixtures) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(fixture)));
    const executor = new Executor(cfg, {}, {}, key);
    await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /unsupported|exceeds configured cap/);
    t.mock.restoreAll();
  }
});

test('V2 Router build rejects configured requests without an API key before network access', async t => {
  let called = false;
  t.mock.method(globalThis, 'fetch', async () => { called = true; throw new Error('unexpected request'); });
  const noKey = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://feed.invalid',
    JUPITER_URL: 'https://api.jup.ag/swap/v2',
  });
  const executor = new Executor(noKey, {}, {}, key);
  await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /requires an explicitly configured API key/);
  assert.equal(called, false);
});

test('V2 Router build rejects absent or malformed blockhash expiry metadata', async t => {
  for (const blockhashWithMetadata of [undefined, { blockhash: Array(31).fill(0), lastValidBlockHeight: 300 }, { blockhash: Array(32).fill(0), lastValidBlockHeight: 0 }]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response({ blockhashWithMetadata }))));
    const executor = new Executor(cfg, {}, {}, key);
    await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /invalid or unsupported Jupiter V2 build response/);
    t.mock.restoreAll();
  }
});

test('V2 Router build rejects minimum output that does not equal the requested slippage bound', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response({ otherAmountThreshold: '44999' }))));
  const executor = new Executor(cfg, {}, {}, key);
  await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /invalid Jupiter V2 minimum output/);
});

test('V2 Router build rejects response economics that disagree with Jupiter route instruction bytes', async t => {
  const fixtures = [
    response({ swapInstruction: { ...response().swapInstruction, data: routeData({ inAmount: 999n }) } }),
    response({ swapInstruction: { ...response().swapInstruction, data: routeData({ outAmount: 50001n }) } }),
    response({ swapInstruction: { ...response().swapInstruction, data: routeData({ slippageBps: 999 }) } }),
    response({ swapInstruction: { ...response().swapInstruction, data: routeData({ platformFeeBps: 1 }) } }),
    response({ routePlan: [] }),
  ];
  for (const fixture of fixtures) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(fixture)));
    const executor = new Executor(cfg, {}, {}, key);
    await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /invalid or unsupported|do not match/);
    t.mock.restoreAll();
  }
});

test('graduated paper settlement credits Jupiter minimum output less configured fees', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response())));
  const settleCfg = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://feed.invalid',
    JUPITER_URL: 'https://api.jup.ag/swap/v2',
    JUPITER_API_KEY: 'unit-test-key',
    SLIPPAGE_BPS: 1000,
    PANIC_SLIPPAGE_BPS: 1000,
  });
  const executor = new Executor(settleCfg, { connection: {} }, {}, key);
  t.mock.method(executor, 'tip', () => 0);
  const snapshot = {
    at: Date.now(),
    mint: new PublicKey(mint),
    tokenProgram: TOKEN_PROGRAM_ID,
    curve: { complete: true, realQuoteReserves: 1_000n },
  };
  const built = await executor.build(snapshot, 'sell', 1_000n, key.publicKey.toBase58(), 0, 'test', false);
  const fees = BigInt(built.overhead.baseFeeLamports) + BigInt(built.overhead.priorityLamports) + BigInt(built.overhead.tipLamports);
  assert.equal(built.quotedOutput, 50_000n);
  assert.equal(built.solDelta + fees, 45_000n);
  assert.equal(built.pending.lastValidBlockHeight, 300);
  assert.ok(built.quoteTimestamp >= snapshot.at);
});

test('graduated paper build rechecks source-snapshot freshness after quote and ALT awaits', async t => {
  const shortTtl = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://feed.invalid',
    JUPITER_URL: 'https://api.jup.ag/swap/v2',
    JUPITER_API_KEY: 'unit-test-key',
    QUOTE_MAX_AGE_MS: 250,
  });
  const executor = new Executor(shortTtl, {}, {}, key);
  t.mock.method(executor, 'graduatedSell', async () => {
    await new Promise(resolve => setTimeout(resolve, 275));
    return { instructions: [], alts: [], output: 50_000n, quoteTimestamp: Date.now(), lastValidBlockHeight: 300 };
  });
  const snapshot = {
    at: Date.now(),
    mint: new PublicKey(mint),
    tokenProgram: TOKEN_PROGRAM_ID,
    curve: { complete: true, realQuoteReserves: 1_000n },
  };
  await assert.rejects(executor.build(snapshot, 'sell', 1_000n, key.publicKey.toBase58(), 0, 'test', false), /quote expired/);
});

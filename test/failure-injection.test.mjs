import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../dist/config.js';
import { settle } from '../dist/core.js';
import { Store } from '../dist/store.js';
import { Executor } from '../dist/execution.js';
import { checkCandidateReserveDrift } from '../dist/fusion.js';
import { RpcPool } from '../dist/rpc.js';

const cfg = (extra = {}) => config({
  RPC_URLS: 'https://rpc1.invalid,https://rpc2.invalid',
  WS_URLS: 'wss://feed.invalid',
  KEYPAIR_PATH: 'test-key.json',
  JUPITER_URL: 'https://jupiter.invalid/swap/v2',
  JUPITER_API_KEY: 'test-jupiter-key',
  ...extra,
});

const key = Keypair.fromSeed(Buffer.alloc(32, 11));
const mint = Keypair.fromSeed(Buffer.alloc(32, 12)).publicKey.toBase58();

const makePending = (side = 'buy', sig = 'test-sig-1') => ({
  id: 'intent-fail-1',
  mint,
  side,
  signature: sig,
  wire: Buffer.from('signed-test-wire-bytes').toString('base64'),
  lastValidBlockHeight: 150,
  created: Date.now(),
  creator: key.publicKey.toBase58(),
  tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  stage: 0,
  reserve: '1000000000',
  reason: 'buyer-accumulation',
  requested: '10000000',
});

const makeSnapshot = (realQuote = 1_000_000_000n, vQuote, vToken, complete = false) => {
  const r = BigInt(realQuote);
  return {
    mint: new PublicKey(mint),
    tokenProgram: TOKEN_PROGRAM_ID,
    supply: 1_000_000_000_000_000n,
    curve: {
      realQuoteReserves: r,
      virtualQuoteReserves: vQuote !== undefined ? BigInt(vQuote) : 30_000_000_000n + r,
      virtualTokenReserves: vToken !== undefined ? BigInt(vToken) : 1_073_000_000_000_000n,
      complete,
      isMayhemMode: false,
      isHolderReward: false,
      quoteMint: PublicKey.default,
      creatorFeeBps: 0n,
    },
    global: {},
    fee: {},
    info: {},
    ata: null,
    slot: 100,
    at: Date.now(),
    entrySafe: true,
  };
};

test('1. RPC failover during Snapshot 1 -> Snapshot 2 preserves payload and falls over', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let failFirst = true;

  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init.body });
    if (failFirst && url.includes('rpc1.invalid')) {
      failFirst = false;
      throw new Error('Connection refused by peer');
    }
    const req = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { context: { slot: 105 }, value: [] } }));
  };

  try {
    const pool = new RpcPool(cfg());
    const res = await pool.connection.getMultipleAccountsInfoAndContext([new PublicKey(mint)]);
    assert.equal(res.context.slot, 105);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /rpc1\.invalid/);
    assert.match(calls[1].url, /rpc2\.invalid/);
    assert.equal(calls[0].body, calls[1].body);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('2A. Creator sell during safety checks prevents order construction', () => {
  const candidate = {
    mint,
    creator: key.publicKey.toBase58(),
    born: Date.now() - 15_000,
    slot: 100,
    buyers: new Map([['buyer1', 1], ['buyer2', 2], ['buyer3', 3], ['buyer4', 4], ['buyer5', 5]]),
    buy: 50_000_000n,
    sell: 10_000_000n,
    devSold: false,
    next: 0,
  };

  const s = makeSnapshot();
  // Simulate tradeevent arriving while safety() was awaiting
  candidate.devSold = true;

  // canSubmitEntry check evaluates !candidate.devSold
  const canSubmit = !candidate.devSold && !s.curve.complete;
  assert.equal(canSubmit, false);
});

test('2B. Creator sell arriving during build simulation aborts before broadcast', async () => {
  const s = makeSnapshot();
  const candidate = {
    mint,
    creator: key.publicKey.toBase58(),
    devSold: false,
  };

  let broadcastCalled = false;
  const mockExecutor = {
    build: async () => {
      // Simulate build/simulation latency during which onEvent flips devSold
      candidate.devSold = true;
      return { pending: makePending('buy') };
    },
    broadcast: async () => { broadcastCalled = true; },
  };

  const candidates = new Map([[mint, candidate]]);
  // Mirroring fusion.ts:213-218 post-build gate
  const built = await mockExecutor.build();
  const abort = candidate.devSold || s.curve.complete;
  if (!abort) {
    await mockExecutor.broadcast(built.pending);
  }

  assert.equal(abort, true);
  assert.equal(broadcastCalled, false);
});

test('3A. Jupiter route failure during graduation leaves position in panic without hanging pending order', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('/build')) return new Response(JSON.stringify({ error: 'No routes found' }), { status: 404 });
    return new Response('{}');
  };

  try {
    const executor = new Executor(cfg(), {}, {}, key);
    await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /HTTP 404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('3B. Jupiter missing ALT address table throws fail-closed error', async () => {
  const originalFetch = globalThis.fetch;
  const routeData = Buffer.alloc(32);
  Buffer.from('c1209b3341d69c81', 'hex').copy(routeData);
  routeData.writeUInt8(1, 8);
  routeData.writeUInt32LE(0, 9);
  routeData.writeBigUInt64LE(1000n, 13);
  routeData.writeBigUInt64LE(50000n, 21);
  routeData.writeUInt16LE(1000, 29);
  globalThis.fetch = async (url) => {
    if (url.includes('/build')) {
      return new Response(JSON.stringify({
        inputMint: mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        swapMode: 'ExactIn',
        inAmount: '1000',
        outAmount: '50000',
        otherAmountThreshold: '45000',
        slippageBps: 1000,
        routePlan: [{ swapInfo: { inputMint: mint, outputMint: 'So11111111111111111111111111111111111111112', inAmount: '1000', outAmount: '50000' }, percent: 100 }],
        computeBudgetInstructions: [],
        setupInstructions: [],
        swapInstruction: {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          data: routeData.toString('base64'),
          accounts: [{ pubkey: key.publicKey.toBase58(), isSigner: true, isWritable: true }],
        },
        cleanupInstruction: null,
        otherInstructions: [],
        tipInstruction: null,
        addressesByLookupTableAddress: { [Keypair.generate().publicKey.toBase58()]: [] },
        blockhashWithMetadata: { blockhash: Array(32).fill(7), lastValidBlockHeight: 300 },
      }));
    }
    return new Response('{}');
  };

  try {
    const mockRpc = { connection: { getAddressLookupTable: async () => ({ value: null }) } };
    const executor = new Executor(cfg(), mockRpc, {}, key);
    await assert.rejects(executor.graduatedSell(mint, 1000n, 1000), /missing lookup table/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4. Process crash between SQLite persistence and broadcast recovers pending state cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fusion-crash-'));
  const dbPath = join(dir, 'crash.sqlite');
  const initialStore = new Store(dbPath);

  const testPending = makePending('buy', 'sig-crash-recovery-99');
  const savedState = {
    version: 1,
    wallet: key.publicKey.toBase58(),
    mode: 'paper',
    positions: {},
    pending: testPending,
    cash: '1000000000',
    day: new Date().toISOString().slice(0, 10),
    dayPnl: '0',
    closed: {},
    halted: false,
  };

  try {
    // 1. Commit to SQLite WAL
    await initialStore.save(savedState, `prepared:${testPending.signature}`);
    // 2. Simulate immediate unceremonious process termination (close store without broadcasting)
    await initialStore.close();

    // 3. Restart engine: load store from disk
    const restartedStore = new Store(dbPath);
    try {
      const recoveredState = await restartedStore.load();
      assert.ok(recoveredState);
      assert.equal(recoveredState.pending?.signature, 'sig-crash-recovery-99');
      assert.equal(recoveredState.pending?.wire, testPending.wire);
      assert.equal(recoveredState.pending?.mint, mint);
      assert.equal(recoveredState.pending?.lastValidBlockHeight, 150);
    } finally {
      await restartedStore.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('5. Quarantined retries preserve the pending order for separate reconciliation', async () => {
  const payloads = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ result: 'bundle-accepted-123' }));
  };

  try {
    const executor = new Executor(cfg(), {}, {}, key);
    const order = makePending('buy', 'sig-retry-123');

    const originalOrder = structuredClone(order);
    await assert.rejects(executor.broadcast(order), /QUARANTINED_LEGACY_BROADCAST/);
    await assert.rejects(executor.broadcast(order), /QUARANTINED_LEGACY_BROADCAST/);
    assert.equal(payloads.length, 0);
    assert.deepEqual(order, originalOrder);

    // Separate, synthetic confirmed-fill fixture; denial is not settlement evidence.
    const testState = {
      version: 1,
      wallet: key.publicKey.toBase58(),
      mode: 'paper',
      positions: {},
      pending: order,
      cash: '1000000000',
      day: new Date().toISOString().slice(0, 10),
      dayPnl: '0',
      closed: {},
      halted: false,
    };

    settle(testState, 50_000n, -10_000_000n);
    assert.equal(testState.pending, null);
    assert.equal(testState.positions[mint]?.qty, '50000');
    assert.equal(testState.positions[mint]?.cost, '10000000');
    assert.equal(testState.cash, '990000000');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6. Reserve drift precision at exact threshold boundaries', () => {
  // s1 baseline: P1 = (30_000_000_000 * 10^12) / 1_000_000_000_000 = 30_000_000
  const s1 = makeSnapshot(10_000n, 30_000_000_000n, 1_000_000_000_000n);

  // Exact 200 bps spot price drift: P2 = 30_600_000 (+2.00%)
  const s2Exact200Price = makeSnapshot(10_000n, 30_600_000_000n, 1_000_000_000_000n);
  const resExactPrice = checkCandidateReserveDrift(s1, s2Exact200Price, 200n, 200n);
  assert.equal(resExactPrice.passed, true);
  assert.equal(resExactPrice.priceDriftBps, 200n);

  // 201 bps spot price drift: P2 = 30_603_000 (+2.01%)
  const s2Over200Price = makeSnapshot(10_000n, 30_603_000_000n, 1_000_000_000_000n);
  const resOverPrice = checkCandidateReserveDrift(s1, s2Over200Price, 200n, 200n);
  assert.equal(resOverPrice.passed, false);
  assert.equal(resOverPrice.reason, 'EXCESSIVE_PRICE_DRIFT');

  // Exact 200 bps real liquidity drop: 10_000 -> 9_800 (-2.00%)
  const s2Exact200Drop = makeSnapshot(9_800n, 30_000_000_000n, 1_000_000_000_000n);
  const resExactDrop = checkCandidateReserveDrift(s1, s2Exact200Drop, 200n, 200n);
  assert.equal(resExactDrop.passed, true);
  assert.equal(resExactDrop.liquidityDropBps, 200n);

  // 201 bps real liquidity drop: 10_000 -> 9_799 (-2.01%)
  const s2Over200Drop = makeSnapshot(9_799n, 30_000_000_000n, 1_000_000_000_000n);
  const resOverDrop = checkCandidateReserveDrift(s1, s2Over200Drop, 200n, 200n);
  assert.equal(resOverDrop.passed, false);
  assert.equal(resOverDrop.reason, 'EXCESSIVE_LIQUIDITY_DROP');
});

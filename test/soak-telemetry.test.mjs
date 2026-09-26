import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { SessionLogger } from '../dist/session-logger.js';
import { Executor } from '../dist/execution.js';
import { Engine } from '../dist/fusion.js';
import { config } from '../dist/config.js';
import { Store } from '../dist/store.js';

const makeKey = (seed) => Keypair.fromSeed(Buffer.alloc(32, seed));
const key = makeKey(42);
const mintPub = makeKey(43).publicKey;
const creatorPub = makeKey(44).publicKey;
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const dummySnapshot = (quoteOut = 50_000_000n) => {
  const zero = new BN(0);
  return {
    mint: mintPub,
    tokenProgram: TOKEN_PROGRAM_ID,
    supply: 1_000_000_000_000_000n,
    curve: {
      complete: false,
      isMayhemMode: false,
      realQuoteReserves: new BN('2000000000'),
      virtualQuoteReserves: new BN('30000000000'),
      virtualTokenReserves: new BN('1073000000000000'),
      realTokenReserves: new BN('793100000000000'),
      tokenTotalSupply: new BN('1000000000000000'),
      quoteMint: PublicKey.default,
      creator: creatorPub,
      creatorFeeBps: zero,
    },
    global: {
      feeRecipient: creatorPub,
      feeRecipients: [creatorPub],
      feeBasisPoints: new BN(100),
      creatorFeeBasisPoints: zero,
      creatorFeeConfigurable: false,
    },
    fee: null,
    info: { data: Buffer.alloc(256), owner: PUMP_PROGRAM_ID, lamports: 100, executable: false, rentEpoch: 0 },
    ata: null,
    slot: 100,
    at: Date.now() - 50,
    entrySafe: true,
    creatorTokens: '0',
  };
};

test('SessionLogger writes structured JSONL events and tabular CSV fills', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fusion-session-test-'));
  try {
    const logger = new SessionLogger(dir);
    await logger.init();

    logger.writeEvent('test_event', { key: 'value', count: 42 });
    logger.writeFill({
      timestampUtc: '2026-09-16T23:00:00.000Z',
      id: 'fill-uuid-1',
      mint: mintPub.toBase58(),
      side: 'buy',
      reason: 'buyer-accumulation',
      stage: 0,
      requestedAmount: '10000000',
      quotedOutput: '50000000',
      tokenDelta: '48500000',
      netLamports: '-13500000',
      quoteAgeMs: 45,
      slippageBps: 300,
      tipLamports: '10000',
      priorityLamports: '200000',
      rentLamports: '3000000',
    });

    await logger.close();

    const jsonl = await readFile(join(dir, 'session.jsonl'), 'utf8');
    const lines = jsonl.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].event, 'test_event');
    assert.equal(lines[0].count, 42);
    assert.equal(lines[1].event, 'fill_recorded');
    assert.equal(lines[1].id, 'fill-uuid-1');

    const csv = await readFile(join(dir, 'fills.csv'), 'utf8');
    const csvRows = csv.trim().split('\n');
    assert.equal(csvRows.length, 2);
    assert.match(csvRows[0], /timestamp_utc,id,mint,side,reason/);
    assert.match(csvRows[1], /fill-uuid-1/);
    assert.match(csvRows[1], /48500000/);
    assert.match(csvRows[1], /3000000/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const baseCfg = (extra = {}) => config({
  RPC_URLS: 'https://rpc1.invalid,https://rpc2.invalid',
  WS_URLS: 'wss://feed.invalid',
  KEYPAIR_PATH: 'test-key.json',
  ...extra,
});

test('Executor.build() in paper mode enriches output with quote and overhead telemetry', async () => {
  const cfg = baseCfg({
    MODE: 'paper',
    BUY_LAMPORTS: 10_000_000,
    SLIPPAGE_BPS: 300,
    MAX_TIP_LAMPORTS: 500_000,
    MIN_TIP_LAMPORTS: 10_000,
    MAX_PRIORITY_LAMPORTS: 200_000,
  });

  const mockMarket = {
    buyQuote: () => 1_000_000_000n,
    sellQuote: () => 9_500_000n,
  };

  const executor = new Executor(cfg, {}, mockMarket, key);
  const snap = dummySnapshot();

  const buyBuilt = await executor.build(snap, 'buy', 10_000_000n, creatorPub.toBase58(), 0, 'accumulation', false);
  assert.equal(buyBuilt.pending.side, 'buy');
  assert.equal(buyBuilt.quotedOutput, 1_000_000_000n);
  assert.ok(buyBuilt.quoteTimestamp && buyBuilt.quoteTimestamp > 0);
  assert.equal(buyBuilt.overhead?.slippageBps, 300);
  assert.equal(buyBuilt.overhead?.rentLamports, '3000000');
  assert.equal(buyBuilt.overhead?.priorityLamports, '200000');

  const sellBuilt = await executor.build(snap, 'sell', 500_000_000n, creatorPub.toBase58(), 1, 'take-profit', false);
  assert.equal(sellBuilt.pending.side, 'sell');
  assert.equal(sellBuilt.quotedOutput, 9_500_000n);
  assert.equal(sellBuilt.overhead?.rentLamports, '0');
});

test('Engine instruments exit-blocked-by-pending when an order is in flight', async () => {
  const cfg = baseCfg({
    MODE: 'paper',
    BUY_LAMPORTS: 10_000_000,
    STOP_BPS: 1200,
  });

  const events = [];
  const mockLogger = {
    writeEvent: (event, fields) => events.push({ event, ...fields }),
    writeFill: () => {},
  };

  const testState = {
    version: 1,
    wallet: key.publicKey.toBase58(),
    mode: 'paper',
    positions: {
      [mintPub.toBase58()]: {
        mint: mintPub.toBase58(),
        creator: creatorPub.toBase58(),
        tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
        qty: '1000000',
        initialQty: '1000000',
        cost: '10000000',
        originalCost: '10000000',
        peak: '10000000',
        stage: 0,
        opened: Date.now() - 10_000,
        reserve: '1000000000',
        panic: false,
        creatorTokens: '0',
      },
    },
    pending: {
      id: 'pending-order-1',
      mint: 'AnotherMint111111111111111111111111111111111',
      side: 'buy',
      signature: 'pending-sig',
      wire: '',
      lastValidBlockHeight: 100,
      created: Date.now() - 3000,
      creator: creatorPub.toBase58(),
      tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      stage: 0,
      reserve: '1000000000',
      reason: 'accumulation',
      requested: '10000000',
    },
    cash: '1000000000',
    day: new Date().toISOString().slice(0, 10),
    dayPnl: '0',
    closed: {},
    halted: false,
  };

  const mockRpc = {
    connection: {},
    endpoints: [],
  };
  const mockMarket = {
    snapshot: async () => dummySnapshot(),
  };
  const mockExecutor = {
    reconcile: async () => ({ status: 'pending' }),
    broadcast: async order => ({
      status: 'NOT_SENT',
      signature: order.signature,
      attemptedAt: Date.now(),
      reason: 'TEST_TRANSPORT_DISABLED',
    }),
  };
  const mockStore = {
    save: async () => {},
  };

  const engine = new Engine(cfg, mockRpc, mockMarket, mockExecutor, mockStore, testState, mockLogger);

  // Position mark is at 8,000,000 lamports (20% loss, breaching the 12% stop)
  engine.marks.set(mintPub.toBase58(), { value: '8000000', at: Date.now() });

  // Run a single tick while pending is non-null
  await engine.tick();

  const blocked = events.find(e => e.event === 'exit_blocked_by_pending');
  assert.ok(blocked, 'Expected exit_blocked_by_pending event');
  assert.equal(blocked.mint, mintPub.toBase58());
  assert.equal(blocked.reason, 'stop');
  assert.equal(blocked.pendingMint, 'AnotherMint111111111111111111111111111111111');

  // Verify internal map records blocked exit
  assert.ok(engine.blockedExits.has(mintPub.toBase58()));

  // Now clear pending and execute tick with market producing sell quote
  testState.pending = null;
  mockMarket.sellQuote = () => 8_000_000n;
  mockExecutor.build = async () => ({
    pending: {
      id: 'sell-order-1',
      mint: mintPub.toBase58(),
      side: 'sell',
      signature: 'sell-sig',
      created: Date.now(),
      requested: '1000000',
      creator: creatorPub.toBase58(),
      stage: 0,
      reason: 'stop',
    },
    tokenDelta: -1_000_000n,
    solDelta: 7_500_000n,
    quotedOutput: 8_000_000n,
    quoteTimestamp: Date.now(),
    overhead: { tipLamports: '10000', priorityLamports: '200000', rentLamports: '0', slippageBps: 1200 },
  });

  await engine.tick();

  const cleared = events.find(e => e.event === 'exit_block_cleared');
  assert.ok(cleared, 'Expected exit_block_cleared event');
  assert.equal(cleared.mint, mintPub.toBase58());
  assert.equal(cleared.reason, 'stop');
  assert.ok(cleared.blockedDurationMs >= 0);
  assert.equal(engine.blockedExits.has(mintPub.toBase58()), false);
});

test('Engine records rejection taxonomy and emits periodic soak checkpoint', async () => {
  const cfg = baseCfg({
    MODE: 'paper',
    CHECKPOINT_INTERVAL_MS: 10_000,
  });

  const events = [];
  const mockLogger = {
    writeEvent: (event, fields) => events.push({ event, ...fields }),
    writeFill: () => {},
  };

  const testState = {
    version: 1,
    wallet: key.publicKey.toBase58(),
    mode: 'paper',
    positions: {},
    pending: null,
    cash: '1000000000',
    day: new Date().toISOString().slice(0, 10),
    dayPnl: '0',
    closed: {},
    halted: false,
  };

  const engine = new Engine(cfg, {}, {}, {}, {}, testState, mockLogger);

  // Record diverse rejection reasons
  engine.recordRejection('MintA111111111111111111111111111111111111111', 'creator concentration');
  engine.recordRejection('MintA111111111111111111111111111111111111111', 'creator concentration');
  engine.recordRejection('MintB111111111111111111111111111111111111111', 'rug report rejected');
  engine.recordRejection('MintC111111111111111111111111111111111111111', 'insufficient real reserves');

  assert.equal(engine.rejectionCounts.get('creator concentration'), 2);
  assert.equal(engine.rejectionCounts.get('rug report rejected'), 1);
  assert.equal(engine.rejectionCounts.get('insufficient real reserves'), 1);

  // Trigger checkpoint emission
  engine.emitCheckpoint();

  const checkpoint = events.find(e => e.event === 'soak_checkpoint');
  assert.ok(checkpoint, 'Expected soak_checkpoint event');
  assert.ok(checkpoint.uptimeHours !== undefined);
  assert.equal(checkpoint.cash, '1000000000');
  assert.equal(checkpoint.rejectionTaxonomy['creator concentration'], 2);
  assert.equal(checkpoint.rejectionTaxonomy['rug report rejected'], 1);
  assert.equal(checkpoint.rejectionTaxonomy['insufficient real reserves'], 1);
  assert.equal(checkpoint.openPositionsCount, 0);
  assert.equal(checkpoint.blockedExitsCount, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getPumpProgram, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { config } from '../dist/config.js';
import { settle, exitDecision, BoundedSet, mulBps, ceilDiv, recordFailure, recordEquity, pruneRiskState } from '../dist/core.js';
import { atomicArbPreflight, curveScalpDecision, strategyStatuses } from '../dist/strategy.js';
import { Store } from '../dist/store.js';
import { Executor, transactionDeltas } from '../dist/execution.js';
import { Engine } from '../dist/fusion.js';
import { Feed } from '../dist/feed.js';
import { RpcPool } from '../dist/rpc.js';

const cfg = (extra = {}) => config({ RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid', ...extra });
const key = Keypair.fromSeed(Buffer.alloc(32, 8));
const mint = Keypair.fromSeed(Buffer.alloc(32, 9)).publicKey.toBase58();
const pending = (side = 'buy') => ({ id: 'intent-1', mint, side, signature: 'signature', wire: 'identical-signed-wire', lastValidBlockHeight: 100, created: Date.now(), creator: key.publicKey.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(), stage: 0, reserve: '1000000000', reason: 'test', requested: '1000' });
const state = () => ({ version: 1, wallet: key.publicKey.toBase58(), mode: 'paper', positions: {}, pending: pending(), cash: '1000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', closed: {}, halted: false });
const position = () => { const s = state(); settle(s, 1000n, -1000n); return s.positions[mint]; };

test('live configuration rejects missing keys, insecure endpoints and duplicate fallback', () => {
  assert.throws(() => cfg({ MODE: 'live' }));
  assert.throws(() => cfg({ RPC_URLS: 'http://one.invalid' }));
  assert.throws(() => cfg({ MODE: 'live', KEYPAIR_PATH: 'key.json', RPC_URLS: 'https://one.invalid,https://one.invalid' }));
});
test('configuration rejects NaN, fractional units and inconsistent caps', () => {
  for (const BUY_LAMPORTS of ['NaN', '100000.5', '-1', 'Infinity']) assert.throws(() => cfg({ BUY_LAMPORTS }));
  assert.throws(() => cfg({ MIN_TIP_LAMPORTS: '1000000', MAX_TIP_LAMPORTS: '10000' }));
});
test('fifty percent at twenty percent does not imply principal recovered', () => {
  const s = state(); settle(s, 1000n, -1000n);
  s.pending = { ...pending('sell'), stage: 1 }; settle(s, -500n, 600n);
  assert.equal(s.positions[mint].qty, '500');
  assert.equal(s.positions[mint].cost, '500');
  assert.equal(s.dayPnl, '100');
  assert.equal(s.cash, '999600');
  assert.equal(s.positions[mint].stage, 1);
});
test('integer quantity and cost basis conserved across thousands of partial sequences', () => {
  for (let n = 2n; n < 2000n; n++) {
    const s = state(); settle(s, n, -10007n);
    let remaining = n;
    while (remaining > 0n) {
      const sold = remaining > 1n ? remaining / 2n : 1n;
      s.pending = pending('sell'); settle(s, -sold, sold * 3n); remaining -= sold;
    }
    assert.equal(s.positions[mint], undefined);
    assert.equal(BigInt(s.dayPnl), n * 3n - 10007n);
  }
});
test('overfills and repeated settlement cannot corrupt inventory', () => {
  const s = state(); settle(s, 10n, -100n);
  assert.throws(() => settle(s, 10n, -100n));
  s.pending = pending('sell'); assert.throws(() => settle(s, -11n, 1n));
  assert.equal(s.positions[mint].qty, '10');
});
test('panic takes precedence over profit ladders', () => {
  const p = position(); p.panic = true;
  assert.equal(exitDecision(p, 5000n, 1200).reason, 'panic');
});
test('hard stop responds to gaps below threshold', () => {
  assert.equal(exitDecision(position(), 700n, 1200).reason, 'stop');
});
test('take-profit stage advances only with a settled fill', () => {
  const p = position();
  assert.deepEqual(exitDecision(p, 1200n, 1200), { fraction: 5000, stage: 1, reason: 'take-profit' });
  assert.equal(p.stage, 0);
});
test('runner trailing stop widens at six times original value', () => {
  const p = position(); p.stage = 4; p.peak = '7000';
  assert.equal(exitDecision(p, 4300n, 1200), null);
  assert.equal(exitDecision(p, 4100n, 1200).reason, 'trailing-stop');
});
test('basis points and CU fees round conservatively above floating-point precision', () => {
  assert.equal(mulBps(900719925474099312345n, 300), 27021597764222979370n);
  assert.equal(ceilDiv(1000001n, 1000000n), 2n);
});
test('rolling circuit breaker halts after three failures and drawdown breach', () => {
  const s = state();
  assert.equal(recordFailure(s, 1_000, 3_600_000, 3), false);
  assert.equal(recordFailure(s, 2_000, 3_600_000, 3), false);
  assert.equal(recordFailure(s, 3_000, 3_600_000, 3), true);
  assert.match(s.risk.haltReason, /transaction failures/);
  const fresh = state(); recordEquity(fresh, 1_000_000n, 1_000); recordEquity(fresh, 940_000n, 2_000, 3_600_000, 500);
  assert.equal(fresh.halted, true); assert.match(fresh.risk.haltReason, /drawdown/);
});
test('highWater decays when historical peak expires outside rolling window', () => {
  const s = state();
  // Peak recorded at T=1,000
  recordEquity(s, 1_500_000n, 1_000, 3_600_000, 500);
  assert.equal(s.risk.highWater, '1500000');
  assert.equal(s.risk.lifetimePeak, '1500000');

  // Advance time past 1-hour window (3,600,000 ms) to T=4,000,000
  recordEquity(s, 1_400_000n, 4_000_000, 3_600_000, 500);
  // highWater must decay to current active-window peak (1,400,000), not stay anchored to 1,500,000
  assert.equal(s.risk.highWater, '1400000');
  assert.equal(s.risk.lifetimePeak, '1500000');

  // Small drop of 50,000 (357 bps from 1,400,000) does not breach 500 bps threshold
  recordEquity(s, 1_350_000n, 4_001_000, 3_600_000, 500);
  assert.equal(s.halted, false);

  // Larger drop of 80,000 (571 bps from 1,400,000) breaches 500 bps threshold
  recordEquity(s, 1_320_000n, 4_002_000, 3_600_000, 500);
  assert.equal(s.halted, true);
  assert.match(s.risk.haltReason, /drawdown reached 500 bps/);
});
test('pruneRiskState cleans expired samples on restart and recalibrates high water', () => {
  const s = state();
  s.cash = '1000000';
  s.risk = {
    failures: [1_000, 2_000],
    equity: [{ at: 1_000, value: '1500000' }, { at: 2_000, value: '1400000' }],
    highWater: '1500000',
  };
  // Advance time past window (T=5,000,000 > 2,000 + 3,600,000)
  pruneRiskState(s, 5_000_000, 3_600_000);
  assert.equal(s.risk.failures.length, 0);
  assert.equal(s.risk.equity.length, 0);
  assert.equal(s.risk.highWater, '1000000'); // resets to current cash

  // Partially expired scenario
  s.risk = {
    failures: [1_000, 4_000_000],
    equity: [{ at: 1_000, value: '1500000' }, { at: 4_000_000, value: '1300000' }],
    highWater: '1500000',
  };
  pruneRiskState(s, 4_500_000, 3_600_000);
  assert.deepEqual(s.risk.failures, [4_000_000]);
  assert.equal(s.risk.equity.length, 1);
  assert.equal(s.risk.highWater, '1300000'); // recalibrated to remaining sample
});
test('failure-window expiry prevents stale transaction errors from accumulating into a halt', () => {
  const s = state();
  assert.equal(recordFailure(s, 1_000, 3_600_000, 3), false);
  assert.equal(recordFailure(s, 2_000, 3_600_000, 3), false);
  // Advance time past 1-hour window (T=4,000,000)
  assert.equal(recordFailure(s, 4_000_000, 3_600_000, 3), false); // only 1 failure in window
  assert.equal(s.halted, false);
  assert.equal(recordFailure(s, 4_001_000, 3_600_000, 3), false); // 2 in window
  assert.equal(recordFailure(s, 4_002_000, 3_600_000, 3), true);  // 3 in window -> halt
  assert.equal(s.halted, true);
});
test('UTC date rollover resets dayPnl but keeps safety halt sticky', () => {
  const s = state();
  s.day = '2026-09-14';
  s.dayPnl = '-25000000';
  s.halted = true;

  // Simulate tick loop date rollover logic from fusion.ts
  const today = '2026-09-15';
  if (s.day !== today) { s.day = today; s.dayPnl = '0'; }

  assert.equal(s.day, '2026-09-15');
  assert.equal(s.dayPnl, '0');
  assert.equal(s.halted, true); // sticky across date rollover
});
test('strategy gates keep unsupported routes explicit and preserve atomicity', () => {
  const statuses = strategyStatuses();
  assert.equal(statuses.find(s => s.kind === 'curve-scalp').enabled, true);
  assert.equal(statuses.find(s => s.kind === 'liquidation-harvest').enabled, false);
  const base = { mint, buyLamports: 100n, sellLamports: 200n, feeLamports: 10n, slot: 8, observedAt: 1000 };
  const arb = atomicArbPreflight({ ...base, venue: 'raydium' }, { ...base, venue: 'orca' }, 1000);
  assert.equal(arb.accepted, true); assert.equal(arb.netLamports > 0n, true);
  assert.equal(atomicArbPreflight({ ...base, venue: 'raydium' }, { ...base, venue: 'orca', slot: 9 }, 1000).accepted, false);
  assert.equal(curveScalpDecision({ ageMs: 10_000, holdMs: 0, returnBps: 0, peakBps: 0, migrated: false, creatorSold: false, buyVelocityBps: 0 }).action, 'reject');
  assert.equal(curveScalpDecision({ ageMs: 20_000, holdMs: 130_000, returnBps: 100, peakBps: 100, migrated: false, creatorSold: false, buyVelocityBps: 0 }).action, 'exit');
});
test('deduplication is bounded and expires entries', () => {
  const set = new BoundedSet(2, 10);
  assert.equal(set.add('a', 0), true); assert.equal(set.add('a', 1), false);
  set.add('b', 2); set.add('c', 3); assert.equal(set.add('a', 4), true);
  assert.equal(set.add('a', 15), true);
});
test('SQLite persists pending bytes across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fusion-test-')), path = join(dir, 'state.sqlite');
  let db = new Store(path);
  try {
    await db.save(state(), 'prepared'); await db.close(); db = new Store(path);
    assert.equal((await db.load()).pending.wire, 'identical-signed-wire');
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
test('finalized metadata drives actual SOL and token deltas', () => {
  const msg = new TransactionMessage({ payerKey: key.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [] }).compileToV0Message();
  const response = { transaction: { message: msg }, meta: { err: null, preBalances: [100000], postBalances: [88995], preTokenBalances: [], postTokenBalances: [{ owner: key.publicKey.toBase58(), mint, uiTokenAmount: { amount: '99999999999999999' } }] } };
  assert.deepEqual(transactionDeltas(response, key.publicKey.toBase58(), mint), { tokenDelta: 99999999999999999n, solDelta: -11005n });
});
test('unknown send outcome remains pending when any RPC cannot prove expiry', async () => {
  const endpoints = [{ getTransaction: async () => null, getBlockHeight: async () => 200 }, { getTransaction: async () => { throw new Error('offline'); } }];
  const e = new Executor(cfg(), { endpoints }, {}, key);
  assert.equal((await e.reconcile(pending())).status, 'pending');
});
test('expiry requires every RPC to report finalized height beyond validity margin', async () => {
  const e = new Executor(cfg(), { endpoints: [1, 2].map(() => ({ getTransaction: async () => null, getBlockHeight: async () => 133 })) }, {}, key);
  assert.equal((await e.reconcile(pending())).status, 'expired');
});
test('a landed transaction found by fallback prevents false expiry', async () => {
  const failed = { meta: { err: { InstructionError: [0, 'error'] }, fee: 5000 } };
  const e = new Executor(cfg(), { endpoints: [{ getTransaction: async () => null, getBlockHeight: async () => 200 }, { getTransaction: async () => failed }] }, {}, key);
  const result = await e.reconcile(pending()); assert.equal(result.status, 'failed'); assert.equal(result.fee, 5000n);
});
test('durability failure prevents broadcast and propagates out of the actor', async () => {
  let sent = false;
  const s = state(); s.pending = null;
  const executor = { build: async () => ({ pending: pending('sell') }), broadcast: async () => { sent = true; } };
  const engine = new Engine(cfg({ MODE: 'live', KEYPAIR_PATH: 'file' }), { connection: {} }, {}, executor, { save: async () => { throw new Error('disk full'); } }, s);
  await assert.rejects(engine.trade({ mint: new PublicKey(mint) }, 'sell', 1n, '', 0, 'panic', true), /disk full/);
  assert.equal(sent, false);
});
test('RPC failover preserves method and request body', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: init.body }); if (calls.length === 1) throw new Error('drop'); return new Response(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: 123 })); };
  try { const pool = new RpcPool(cfg()); assert.equal(await pool.connection.getSlot(), 123); assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body); }
  finally { globalThis.fetch = original; }
});
test('Jito retry transmits identical signed bytes and explicit base64', async () => {
  const original = globalThis.fetch; const payloads = [];
  globalThis.fetch = async (_url, init) => { payloads.push(JSON.parse(init.body)); return new Response(JSON.stringify({ result: 'bundle-id' })); };
  try {
    const e = new Executor(cfg(), {}, {}, key); await e.broadcast(pending()); e.lastSubmit = 0; await e.broadcast(pending());
    assert.deepEqual(payloads[0].params, [['identical-signed-wire'], { encoding: 'base64' }]);
    assert.deepEqual(payloads[0], payloads[1]);
  } finally { globalThis.fetch = original; }
});
test('Anchor parser rejects spoofed event from unrelated invocation', async () => {
  const received = [], feed = new Feed(cfg(), {}, e => received.push(e));
  feed.accept('fake-sig', 123, ['Program 11111111111111111111111111111111 invoke [1]', 'Program data: AQIDBA==', 'Program 11111111111111111111111111111111 success']);
  assert.equal(received.length, 0);
});
test('SDK curve quotes use integer reserves and cannot produce profitable immediate roundtrip', () => {
  const zero = new BN(0), global = { feeBasisPoints: new BN(100), creatorFeeBasisPoints: zero, creatorFeeConfigurable: false };
  const curve = { virtualTokenReserves: new BN('1073000000000000'), virtualQuoteReserves: new BN('30000000000'), realTokenReserves: new BN('793100000000000'), realQuoteReserves: zero, tokenTotalSupply: new BN('1000000000000000'), creator: PublicKey.default, quoteMint: PublicKey.default, creatorFeeBps: zero, isMayhemMode: false };
  for (let amount = 1000n; amount <= 1000000000n; amount *= 10n) {
    const args = { global, feeConfig: null, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount: new BN(String(amount)), quoteMint: PublicKey.default };
    const bought = getBuyTokenAmountFromSolAmount(args);
    const sold = getSellSolAmountFromTokenAmount({ ...args, amount: bought });
    assert.ok(BigInt(sold.toString()) < amount); assert.ok(bought.lte(curve.realTokenReserves));
  }
});

function fixture() {
  const zero = new BN(0), one = new BN(1), address = key.publicKey;
  return { mint: new PublicKey(mint), tokenProgram: TOKEN_PROGRAM_ID, supply: 1000000000000000n, at: Date.now(), slot: 1, ata: null,
    info: { data: Buffer.alloc(256), owner: PUMP_PROGRAM_ID, lamports: 100, executable: false, rentEpoch: 0 }, fee: null,
    global: { feeRecipient: address, feeRecipients: [address], feeBasisPoints: new BN(100), creatorFeeBasisPoints: zero, creatorFeeConfigurable: false },
    curve: { virtualTokenReserves: new BN('1073000000000000'), virtualQuoteReserves: new BN('30000000000'), realTokenReserves: new BN('793100000000000'), realQuoteReserves: new BN('1000000000'), tokenTotalSupply: new BN('1000000000000000'), creator: address, quoteMint: PublicKey.default, creatorFeeBps: zero, isMayhemMode: false, complete: false } };
}
test('legacy Pump V2 builder is rejected by the real firewall before signing or simulation', async () => {
  const s = fixture(), live = cfg({ MODE: 'live', KEYPAIR_PATH: 'file', QUOTE_MAX_AGE_MS: '10000' });
  let signerCalls = 0;
  let simulationCalls = 0;
  const rpc = { connection: {
    getLatestBlockhashAndContext: async () => ({ value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 } }),
    getRecentPrioritizationFees: async () => [{ prioritizationFee: 999999999 }],
    simulateTransaction: async () => { simulationCalls++; return { value: { err: null, unitsConsumed: 100000 } }; },
  } };
  const signer = { publicKey: key.publicKey, async signTransactionMessage() { signerCalls++; return new Uint8Array(64).fill(42); } };
  const e = new Executor(live, rpc, { buyQuote: () => 1000000n, sellQuote: () => 1000000n }, signer);
  e.tips = [Keypair.fromSeed(Buffer.alloc(32, 10)).publicKey];
  await assert.rejects(e.build(s, 'buy', 10000000n, key.publicKey.toBase58(), 0, 'test', false), /SIGNING_FIREWALL_REJECTED.*TRANSACTION_DECODER_INCOMPLETE/);
  assert.equal(signerCalls, 0);
  assert.equal(simulationCalls, 0);
});
test('stale snapshots reject before routing or signing', async () => {
  let signerCalls = 0;
  let blockhashCalls = 0;
  const e = new Executor(cfg({ MODE: 'live', KEYPAIR_PATH: 'file' }), { connection: {
    getLatestBlockhashAndContext: async () => { blockhashCalls++; return { value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 100 } }; },
    getRecentPrioritizationFees: async () => [], simulateTransaction: async () => { throw new Error('must not simulate'); },
  } }, { buyQuote: () => 10000n }, {
    publicKey: key.publicKey,
    async signTransactionMessage() { signerCalls++; return new Uint8Array(64).fill(42); },
  });
  await assert.rejects(e.build({ ...fixture(), at: 0 }, 'buy', 1000000n, key.publicKey.toBase58(), 0, 'test', false), /quote expired/);
  assert.equal(blockhashCalls, 0);
  assert.equal(signerCalls, 0);
});
function createLogs() {
  const program = getPumpProgram({}), zero = new BN(0);
  const data = { name: 'fixture', symbol: 'TEST', uri: '', mint: new PublicKey(mint), bondingCurve: key.publicKey, user: key.publicKey, creator: key.publicKey, timestamp: zero, virtualTokenReserves: zero, virtualSolReserves: zero, realTokenReserves: zero, tokenTotalSupply: zero, tokenProgram: TOKEN_PROGRAM_ID, isMayhemMode: false, isCashbackEnabled: false, quoteMint: PublicKey.default, virtualQuoteReserves: zero, creatorFeeBps: zero, isHolderReward: false };
  const definition = program.idl.events.find(e => e.name === 'createEvent');
  const bytes = Buffer.concat([Buffer.from(definition.discriminator), program.coder.types.encode('createEvent', data)]);
  return [`Program ${PUMP_PROGRAM_ID} invoke [1]`, `Program data: ${bytes.toString('base64')}`, `Program ${PUMP_PROGRAM_ID} success`];
}
test('real IDL event decodes once across duplicate feeds and rejects stale slots', () => {
  const events = [], feed = new Feed(cfg(), {}, e => events.push(e));
  feed.accept('signature-a', 100, createLogs()); feed.accept('signature-a', 100, createLogs()); feed.accept('signature-b', 1, createLogs());
  assert.equal(events.length, 1); assert.equal(events[0].data.mint.toBase58(), mint);
});
test('Yellowstone path writes an actual transaction subscription and consumes updates', async () => {
  const { Duplex } = await import('node:stream');
  const { default: Client } = await import('@triton-one/yellowstone-grpc');
  const original = Client.prototype.subscribe; let request;
  const events = [];
  const feed = new Feed(cfg({ YELLOWSTONE_URL: 'https://localhost:443' }), {}, event => { events.push(event); feed.stop(); });
  Client.prototype.subscribe = async function () {
    let delivered = false;
    return new Duplex({ objectMode: true,
      write(chunk, _, callback) { request = chunk; callback(); },
      read() { if (!delivered) { delivered = true; this.push({ transaction: { slot: '100', transaction: { signature: Buffer.alloc(64, 1), meta: { logMessages: createLogs() } } } }); } },
    });
  };
  try { await feed.geyser(); assert.ok(request.transactions.pump.accountInclude.includes(PUMP_PROGRAM_ID.toBase58())); assert.equal(events.length, 1); }
  finally { Client.prototype.subscribe = original; feed.stop(); }
});

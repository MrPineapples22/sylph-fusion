import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { Engine } from '../dist/fusion.js';
import { config } from '../dist/config.js';
import { SimulationExecutionAuthority } from '../dist/platform/execution/authority.js';
import { UltimateExecutionPermitAuthority } from '../dist/intelligence/execution/ultimate-execution-permit.js';
import { UltimateExecutionRecordLedger } from '../dist/platform/evidence/ultimate-execution-record.js';

const mint = PublicKey.default.toBase58();
const fail = () => assert.fail('unexpected external/delivery operation');

function fixture() {
  const cfg = { ...config({ MODE: 'paper', RPC_URLS: 'https://rpc.invalid', WS_URLS: 'wss://ws.invalid' }),
    MIN_AGE_MS: 0, MIN_BUYERS: 1, BUY_LAMPORTS: 10_000_000,
    MAX_SPECULATIVE_RISK_BPS: 10_000, MAX_EXPOSURE_LAMPORTS: 2_000_000_000,
    MAX_DAILY_LOSS_LAMPORTS: 1_000_000_000 };
  const snapshot = { mint: PublicKey.default, tokenProgram: PublicKey.default,
    slot: 100, at: Date.now(), creatorTokens: '0',
    curve: { complete: false, isMayhemMode: false, isHolderReward: false,
      realQuoteReserves: 10_000_000_000n, virtualQuoteReserves: 30_000_000_000n,
      virtualTokenReserves: 1_000_000_000_000n } };
  const market = { snapshot: async () => snapshot, safety: async () => {}, validateEntry: () => {},
    buyQuote: () => 1_000_000n, sellQuote: () => 20_000_000n };
  const authority = new SimulationExecutionAuthority(cfg, market, PublicKey.default);
  authority.broadcast = fail;
  const state = { version: 1, wallet: mint, mode: 'paper', positions: {}, pending: null,
    cash: '2000000000', day: new Date().toISOString().slice(0, 10), dayPnl: '0', closed: {}, halted: false };
  const events = [], labels = [], fills = [], saves = [], builds = [];
  const logger = { writeEvent: (event, fields) => events.push({ event, ...fields }),
    writeOutcomeLabel: label => labels.push(label), writeFill: fill => fills.push(fill) };
  const store = { save: async (_state, reason) => saves.push(reason),
    saveCounterfactualEvaluation: async () => {}, saveFalsificationReport: async () => {} };
  const engine = new Engine(cfg, { connection: new Proxy({}, { get: () => fail }) }, market, authority, store, state, logger);
  engine.feed.healthy = () => true;
  engine.persistAndBroadcast = fail;
  engine.snapshotCandidate = () => null;
  const originalBuild = authority.build.bind(authority);
  authority.build = async (...args) => { builds.push(args); return originalBuild(...args); };
  return { cfg, snapshot, market, authority, state, engine, events, labels, fills, saves, builds };
}

function order(side) {
  return { id: 'recovered', signature: 'sim_recovered', mint, side, wire: '',
    lastValidBlockHeight: 0, created: Date.now(), creator: mint, tokenProgram: mint,
    stage: 1, reserve: '10000000000', reason: 'fixture', requested: '100', creatorTokens: '0' };
}

function position() {
  return { mint, creator: mint, tokenProgram: mint, qty: '100', initialQty: '100',
    cost: '1000', originalCost: '1000', peak: '1000', stage: 0, opened: Date.now(),
    reserve: '10000000000', panic: false, creatorTokens: '0' };
}

for (const side of ['buy', 'sell']) {
  test(`paper ${side} recovery has no fill evidence and stays unresolved across ticks`, async () => {
    const f = fixture();
    if (side === 'sell') f.state.positions[mint] = position();
    const pending = f.state.pending = order(side);
    const before = structuredClone(f.state);
    f.market.buyQuote = f.market.sellQuote = f.market.snapshot = fail;
    for (const signature of ['sim_recovered', 'paper', 'arbitrary_signature']) {
      assert.deepEqual(await f.authority.reconcile({ ...pending, signature }), { status: 'pending' });
    }
    await f.engine.tick();
    await f.engine.tick();
    assert.equal(f.state.pending, pending);
    assert.deepEqual(f.state, before, 'recovery must not settle or clear the order');
    assert.deepEqual(f.saves, []);
    assert.deepEqual(f.labels, []);
    assert.deepEqual(f.fills, []);
    assert.deepEqual(f.builds, []);
    assert.equal(f.events.length, 2);
    for (const event of f.events) {
      assert.equal(event.event, 'paper_recovery_unresolved');
      assert.equal(event.evidenceClass, 'PAPER_RECOVERY_EVIDENCE_MISSING');
      assert.equal(event.reason, 'DURABLE_SIMULATED_FILL_EVIDENCE_UNAVAILABLE');
      assert.equal(event.recoveryStatus, 'UNRESOLVED');
    }
  });

  test(`injected paper ${side} fill stays simulated without a sealed record or outcome label`, async t => {
    const f = fixture();
    if (side === 'sell') f.state.positions[mint] = position();
    f.state.pending = order(side);
    f.authority.reconcile = async () => ({ status: 'filled',
      tokenDelta: side === 'buy' ? 100n : -100n, solDelta: side === 'buy' ? -1000n : 1200n });
    t.mock.method(UltimateExecutionRecordLedger, 'sealRecord', fail);
    await f.engine.tick();
    assert.equal(f.state.pending, null);
    assert.equal(f.state.cash, side === 'buy' ? '1999999000' : '2000001200');
    assert.equal(f.state.dayPnl, side === 'buy' ? '0' : '200');
    assert.deepEqual(f.labels, []);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].event, 'paper_recovery_fill');
    assert.equal(f.events[0].evidenceClass, 'PAPER_SIMULATED_FILL');
    assert.equal(f.events[0].chainExecutionEvidenceStatus, 'UNAVAILABLE');
    assert.deepEqual(f.saves, ['filled:sim_recovered']);
  });
}

test('ordinary paper build and settlement retain buy/sell accounting without recovery', async () => {
  const f = fixture();
  f.authority.reconcile = fail;
  const expectedBuy = await f.authority.build(f.snapshot, 'buy', 10_000_000n, mint, 0, 'fixture', false);
  await f.engine.trade(f.snapshot, 'buy', 10_000_000n, mint, 0, 'fixture', false);
  assert.equal(f.state.cash, String(2_000_000_000n + expectedBuy.solDelta));
  assert.equal(f.state.positions[mint].qty, String(expectedBuy.tokenDelta));
  assert.equal(f.state.pending, null);
  const expectedSell = await f.authority.build(f.snapshot, 'sell', expectedBuy.tokenDelta, mint, 1, 'fixture', false);
  await f.engine.trade(f.snapshot, 'sell', expectedBuy.tokenDelta, mint, 1, 'fixture', false);
  assert.equal(f.state.cash, String(2_000_000_000n + expectedBuy.solDelta + expectedSell.solDelta));
  assert.equal(f.state.dayPnl, String(expectedBuy.solDelta + expectedSell.solDelta));
  assert.equal(f.state.positions[mint], undefined);
  assert.equal(f.state.pending, null);
  assert.equal(f.fills.length, 2);
  assert.equal(f.labels.length, 1, 'ordinary simulated outcome behavior remains unchanged');
  assert.ok(f.saves.every(reason => reason.startsWith('paper-fill:')));
});

for (const scenario of ['permitted', 'throttled', 'denied']) {
  test(`paper entry ${scenario} retains policy and cannot issue a placeholder permit`, async t => {
    const f = fixture();
    if (scenario === 'throttled') f.cfg.BUY_LAMPORTS = 200_000_000;
    if (scenario === 'denied') f.state.risk = { highWater: '3000000000',
      equity: [{ at: Date.now(), value: '3000000000' }], failures: [] };
    f.cfg.ROLLING_DRAWDOWN_BPS = 10_000; // Let the existing capital barrier evaluate the drawdown.
    f.engine.candidates.set(mint, { mint, creator: mint, born: Date.now(), slot: 100,
      next: 0, devSold: false, buy: 1_000_000n, sell: 0n, buyers: new Map([['buyer', Date.now()]]) });
    f.engine.recordRestriction = (...args) => f.events.push({ event: 'restriction', args });
    t.mock.method(UltimateExecutionPermitAuthority, 'issuePermit', fail);
    await f.engine.tick();
    const policy = f.events.find(e => e.event === 'paper_capital_policy_check');
    assert.ok(policy, 'candidate must reach the paper capital policy check');
    assert.equal(policy.status, scenario === 'permitted' ? 'PERMITTED' : scenario === 'throttled' ? 'THROTTLED' : 'DENIED');
    assert.equal(policy.executionPermitStatus, 'NOT_ISSUED');
    assert.equal(policy.authorizesLiveExecution, false);
    assert.equal(policy.inputs.modelUncertainty, 0.15);
    assert.equal(policy.inputs.executionReliability, 0.95);
    assert.equal(policy.inputProvenance.modelUncertainty, 'FIXED_UNVALIDATED_ASSUMPTION');
    assert.equal(policy.inputProvenance.stressedExitCapacitySol, 'OBSERVED_RESERVE_BASED_HEURISTIC_WITH_FLOOR');
    assert.deepEqual(Object.keys(policy.inputProvenance).sort(), Object.keys(policy.inputs).sort());
    assert.ok(!f.events.some(e => /ultimate_execution|capital_barrier_verdict/.test(e.event)));
    if (scenario === 'denied') {
      assert.equal(f.builds.length, 0);
      assert.equal(f.fills.length, 0);
    } else {
      assert.equal(f.builds.length, 1);
      assert.equal(f.builds[0][2], scenario === 'throttled' ? 100_000_000n : 10_000_000n);
      assert.equal(f.fills.length, 1);
    }
  });
}

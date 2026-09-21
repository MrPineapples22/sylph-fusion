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
import { executeModelGate } from '../dist/candidate-snapshot.js';
import { RpcPool, sanitizeRpcUrl } from '../dist/rpc.js';
import {
  readLatestSoakSession,
  readSessionEvents,
  exportSessionArtifact,
} from '../terminal/soak-reader.mjs';
import { aggregateSessionStats } from '../terminal/src/paper-baseline-eval.js';

const makeKey = (seed) => Keypair.fromSeed(Buffer.alloc(32, seed));
const key = makeKey(42);
const mintPub = makeKey(43).publicKey;
const creatorPub = makeKey(44).publicKey;
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const makeSnapshot = ({
  mint = mintPub,
  creator = creatorPub,
  realQuoteReserves = '2500000000',
  virtualQuoteReserves = '32500000000',
  virtualTokenReserves = '1073000000000000',
  realTokenReserves = '793100000000000',
  complete = false,
} = {}) => {
  const zero = new BN(0);
  return {
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    supply: 1_000_000_000_000_000n,
    curve: {
      complete,
      isMayhemMode: false,
      realQuoteReserves: new BN(realQuoteReserves),
      virtualQuoteReserves: new BN(virtualQuoteReserves),
      virtualTokenReserves: new BN(virtualTokenReserves),
      realTokenReserves: new BN(realTokenReserves),
      tokenTotalSupply: new BN('1000000000000000'),
      quoteMint: PublicKey.default,
      creator,
      creatorFeeBps: zero,
    },
    global: {
      feeRecipient: creator,
      feeRecipients: [creator],
      feeBasisPoints: new BN(100),
      creatorFeeBasisPoints: zero,
      creatorFeeConfigurable: false,
      initialRealTokenReserves: new BN('793100000000000'),
      initialVirtualSolReserves: new BN('30000000000'),
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

test('End-to-End Settlement Pipeline: Engine → JSONL/CSV → UI Stats & Artifacts', async () => {
  // 1. Setup temporary directory structure mimicking project/sessions/soak-*
  const rootDir = await mkdtemp(join(tmpdir(), 'fusion-e2e-project-'));
  const sessionsDir = join(rootDir, 'sessions');
  const sessionName = 'soak-2026-09-17-test-run';
  const sessionDir = join(sessionsDir, sessionName);
  let logger;
  let store;

  try {
    logger = new SessionLogger(sessionDir);
    await logger.init();

    const cfg = config({
      MODE: 'paper',
      BUY_LAMPORTS: 10_000_000,
      MAX_EXPOSURE_LAMPORTS: 100_000_000,
      MAX_DAILY_LOSS_LAMPORTS: 50_000_000,
      SLIPPAGE_BPS: 300,
      STOP_BPS: 1200,
      MIN_BUYERS: 5,
      MIN_AGE_MS: 10_000,
      MAX_AGE_MS: 300_000,
      RESERVE_LAMPORTS: 100_000_000,
      MAX_TIP_LAMPORTS: 500_000,
      MIN_TIP_LAMPORTS: 10_000,
      MAX_PRIORITY_LAMPORTS: 200_000,
      RPC_URLS: 'https://mainnet.helius-rpc.com/?api-key=super-secret-key-12345,https://api.mainnet-beta.solana.com',
      WS_URLS: 'wss://mainnet.helius-rpc.com/?api-key=secret-ws-token',
      KEYPAIR_PATH: 'test-key.json',
      DB_PATH: join(sessionDir, 'fusion.sqlite'),
    });

    // 2. Verify RPC URL redaction with host/provider labels
    const rpc = new RpcPool(cfg);
    const sanitizedEndpoints = rpc.getEndpointStats();
    assert.equal(sanitizedEndpoints[0].url, 'Helius (mainnet.helius-rpc.com)');
    assert.ok(!sanitizedEndpoints[0].url.includes('super-secret-key-12345'), 'RPC key must not leak');
    assert.equal(sanitizedEndpoints[1].url, 'Solana Public (api.mainnet-beta.solana.com)');

    // Mock RPC calls to track latency metrics
    rpc['latencies'][0] = 26;
    rpc['latencyHistories'][0].push(24, 26, 30);
    rpc['calls'][0] = 3;
    const rpcStats = rpc.getEndpointStats();
    assert.equal(rpcStats[0].calls, 3);
    assert.equal(rpcStats[0].p50LatencyMs, 26);

    store = new Store(cfg.DB_PATH);
    const initialCash = 1_000_000_000n; // 1 SOL
    const state = {
      version: 1,
      wallet: key.publicKey.toBase58(),
      mode: 'paper',
      positions: {},
      pending: null,
      cash: initialCash.toString(),
      day: new Date().toISOString().slice(0, 10),
      dayPnl: '0',
      closed: {},
      halted: false,
    };

    let quoteBuyOut = 1_000_000_000n; // 1,000,000,000 tokens
    let quoteSellOut = 8_000_000n;   // 8,000,000 lamports for 50%
    const mockMarket = {
      buyQuote: () => quoteBuyOut,
      sellQuote: () => quoteSellOut,
      snapshot: async () => makeSnapshot(),
      safety: async () => {},
      validateEntry: () => {},
    };

    const executor = new Executor(cfg, {}, mockMarket, key);

    // 3. Test Fail-Closed Model Gating: Missing evaluator in ml_gated mode must fail closed
    const mockCandidateSnap = {
      schemaVersion: '1.0.0',
      candidateId: 'test-cand-001',
      mint: mintPub.toBase58(),
      poolAddress: 'Pool1111111111111111111111111111111111111',
      slot: 100,
      eventSignature: 'sig-001',
      observedAtMs: Date.now() - 1000,
      decisionAtMs: Date.now(),
      policyContext: { policyVersion: 'fusion-v1.4', maxSlippageBps: 300, targetSizeLamports: '10000000', priorityFeeMultiplier: 1, exitLadderConfigHash: 'ladder-1' },
      evaluationDisposition: 'cleared',
      dispositionReason: null,
      featureSealHash: 'seal-001',
      microstructure: { buyerCount5m: 6, buyTransactionCount: 8, sellTransactionCount: 1, buySellRatio: 8.0, buyerArrivalVelocityPerSec: 0.1, creatorWalletHashed: 'creator' },
      curveState: { tokenAgeSeconds: 30, realSolReservesLamports: '2500000000', virtualSolReservesLamports: '32500000000', virtualTokenReserves: '1073000000000000', curveCompletionPct: 3.12, reserveDriftPct: 0.02, spotPriceUsd: 0.0000302 },
      transport: { quoteAgeMs: 5, leadingRpcLatencyMs: 26, trailingRpcDropRatePct: 0.0, inFlightOrderCount: 0, oldestPendingAgeMs: 0, reservedCashRatio: 0.1 },
    };

    const gateMissingEval = await executeModelGate(mockCandidateSnap, null, { mode: 'ml_gated' });
    assert.equal(gateMissingEval.accepted, false, 'Missing evaluator must fail closed');
    assert.equal(gateMissingEval.evaluationDisposition, 'modelUnavailable');
    assert.equal(gateMissingEval.rejectionReason, 'missing_model_evaluator');
    assert.equal(gateMissingEval.confidence, null);

    // 4. Initialize Engine in paper mode with deterministic gate
    const engine = new Engine(
      cfg,
      rpc,
      mockMarket,
      executor,
      store,
      state,
      logger,
      null, // evaluator
      'deterministic_only' // gateMode
    );

    // Mark feed as healthy and warmed up
    engine.feed.last = Date.now();
    engine.feed.readySince = Date.now() - 20_000;
    engine.feed.slot = 100;

    // Feed market events to create candidate with authentic microstructure
    const candidateMint = mintPub.toBase58();
    const cCreator = creatorPub.toBase58();
    const eventTime = Date.now() - 15_000;

    // Create event
    engine['onEvent']({
      name: 'create_event',
      signature: 'create-sig-1',
      slot: 100,
      received: eventTime,
      data: {
        mint: mintPub,
        user: creatorPub,
        timestamp: Math.floor(eventTime / 1000),
      },
    });

    // 6 Buy trade events from distinct buyers (not creator)
    for (let i = 1; i <= 6; i++) {
      const buyer = makeKey(50 + i).publicKey;
      engine['onEvent']({
        name: 'trade_event',
        signature: `buy-sig-${i}`,
        slot: 101 + i,
        received: eventTime + i * 10,
        data: {
          mint: mintPub,
          user: buyer,
          isBuy: true,
          solAmount: 2_000_000_000n,
        },
      });
    }

    const candidate = engine['candidates'].get(candidateMint);
    assert.ok(candidate, 'Candidate should be registered');
    assert.equal(candidate.buyCount, 6, 'Genuine buy count must be tracked');
    assert.equal(candidate.sellCount, 0, 'Genuine sell count must be tracked');
    assert.equal(candidate.buyers.size, 6, 'Genuine distinct buyers tracked');

    // Snapshot candidate with genuine features (no 85 SOL assumption, no $150 fixed price)
    const snap = makeSnapshot();
    const candSnapshot = engine.snapshotCandidate(candidate, 'cleared', null, { s: snap });
    assert.ok(candSnapshot);
    assert.equal(candSnapshot.microstructure.buyTransactionCount, 6);
    assert.equal(candSnapshot.microstructure.sellTransactionCount, 0);
    assert.equal(candSnapshot.transport.leadingRpcLatencyMs, 26, 'Uses genuine leading RPC latency');
    assert.ok(candSnapshot.curveState.curveCompletionPct >= 0, 'Computed real curve completion percentage');

    // 5. Execute BUY Trade
    const buyTargetLamports = 10_000_000n;
    await engine['trade'](snap, 'buy', buyTargetLamports, cCreator, 0, 'buyer-accumulation', false, candidate);

    const pos = engine.state.positions[candidateMint];
    assert.ok(pos, 'Position should exist after buy');
    assert.equal(pos.qty, '970000000');
    assert.equal(pos.initialQty, '970000000');
    const initialCost = BigInt(pos.cost);
    // Cost basis = requested 10_000_000 + rent 3_000_000 + priority 200_000 + base 5_000 + tip 10_000 = 13_215_000n
    assert.equal(initialCost, 13_215_000n);
    assert.equal(BigInt(engine.state.cash), initialCash - initialCost);
    assert.equal(engine.state.performance?.count, 1);

    // 6. Execute PARTIAL SELL (50% exit, 485,000,000 tokens)
    quoteSellOut = 8_000_000n;
    const partialSellQty = 485_000_000n;
    await engine['trade'](snap, 'sell', partialSellQty, cCreator, 1, 'take-profit-stage1', false);

    const posAfterPartial = engine.state.positions[candidateMint];
    assert.ok(posAfterPartial, 'Position still open after partial exit');
    assert.equal(posAfterPartial.qty, '485000000');
    // Exactly 50% cost basis allocated to partial exit, 50% remaining
    const expectedTranche1Cost = initialCost * partialSellQty / 970_000_000n;
    assert.equal(expectedTranche1Cost, 6_607_500n);
    assert.equal(BigInt(posAfterPartial.cost), initialCost - expectedTranche1Cost);

    // 7. Execute FULL SELL (remaining 50% exit, 485,000,000 tokens)
    quoteSellOut = 9_000_000n;
    const fullSellQty = 485_000_000n;
    await engine['trade'](snap, 'sell', fullSellQty, cCreator, 2, 'take-profit-stage2', false);

    assert.equal(engine.state.positions[candidateMint], undefined, 'Position completely cleaned up after full exit');
    assert.equal(engine.state.performance?.count, 3, 'Total 3 fills (1 buy, 2 sells)');

    // 8. Verify Engine Internal Realized PnL Accounting
    const engineRealizedLamports = BigInt(engine.state.performance?.realized || '0');

    // Checkpoint
    engine['emitCheckpoint']();

    // Close logger to ensure all file streams flush to disk
    await logger.close();

    // 9. Ingest artifacts via UI soak-reader
    const sessionData = await readLatestSoakSession(sessionsDir, sessionName);
    assert.ok(sessionData, 'soak-reader must read latest soak session');
    assert.equal(sessionData.available, true);
    assert.equal(sessionData.fills.count, 3, 'All 3 fills read from fills.csv');
    assert.ok(sessionData.latestCheckpoint !== null, 'Checkpoint captured');

    // Verify raw exported artifacts
    const exportedJsonl = await exportSessionArtifact(sessionsDir, sessionName, 'jsonl');
    assert.ok(exportedJsonl.content.includes('candidate_snapshot_v1'));
    assert.ok(exportedJsonl.content.includes('candidate_outcome_v1'));

    const exportedCsv = await exportSessionArtifact(sessionsDir, sessionName, 'csv');
    assert.ok(exportedCsv.content.includes('take-profit-stage1'));
    assert.ok(exportedCsv.content.includes('take-profit-stage2'));

    // 10. Ingest outcomes into UI aggregateSessionStats
    const sessionEvents = await readSessionEvents(sessionsDir, sessionName, 100);
    assert.equal(sessionEvents.events.filter(e => e.event === 'candidate_outcome_v1').length, 2);
    // Session events are summaries; complete financials live in outcomes.jsonl.
    const outcomeEvents = (await readFile(join(sessionDir, 'outcomes.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(outcomeEvents.length, 2, 'Two outcome events for two exit tranches');

    // Verify partial exit outcome accounting
    const o1 = outcomeEvents[0];
    assert.equal(o1.exitStage, 1);
    assert.equal(o1.candidateId, candSnapshot.candidateId, 'Partial exit preserves candidate identity');
    assert.equal(BigInt(o1.costBasisLamports), 6_607_500n, 'Tranche 1 cost basis is exact 50%');
    assert.equal(BigInt(o1.grossProceedsLamports), 8_000_000n, 'Gross proceeds recorded');

    // Verify full exit outcome accounting
    const o2 = outcomeEvents[1];
    assert.equal(o2.exitStage, 2);
    assert.equal(o2.candidateId, candSnapshot.candidateId, 'Full exit preserves candidate identity');
    assert.equal(o2.entrySnapshotSlot, candidate.slot);
    assert.equal(BigInt(o2.costBasisLamports), 6_607_500n, 'Tranche 2 cost basis matches remainder');
    assert.equal(BigInt(o2.grossProceedsLamports), 9_000_000n, 'Gross proceeds recorded');

    // Pass outcomes into UI aggregator
    const uiStats = aggregateSessionStats(outcomeEvents, sessionData.fills.recent, 150);

    // Exact reconciliation: UI net return must equal engine realized PnL to the exact lamport
    const totalOutcomesNetPnl = BigInt(o1.netReturnLamports) + BigInt(o2.netReturnLamports);
    assert.equal(
      BigInt(Math.round(uiStats.netReturnSol * 1e9)),
      totalOutcomesNetPnl,
      'UI netReturnLamports must match sum of outcome netReturnLamports'
    );
    assert.equal(
      BigInt(Math.round(uiStats.netReturnSol * 1e9)),
      engineRealizedLamports,
      'UI netReturnLamports must reconcile with engine realized PnL to the exact lamport'
    );

    // Friction breakdown reconciliation: fees deducted exactly once
    const totalFriction = BigInt(o1.frictionTotalLamports) + BigInt(o2.frictionTotalLamports);
    assert.equal(BigInt(Math.round(uiStats.frictionTotalSol * 1e9)), totalFriction);

    // Ensure no double counting: Gross proceeds - cost basis - total friction === net return
    const grossProceedsSum = BigInt(o1.grossProceedsLamports) + BigInt(o2.grossProceedsLamports);
    const costBasisSum = BigInt(o1.costBasisLamports) + BigInt(o2.costBasisLamports);
    assert.equal(
      grossProceedsSum - costBasisSum - totalFriction,
      BigInt(Math.round(uiStats.netReturnSol * 1e9)),
      'Zero fee double-counting across the entire pipeline'
    );
  } finally {
    // Release streams and the SQLite worker before removing the Windows fixture.
    const closed = await Promise.allSettled([logger?.close(), store?.close()]);
    const failure = closed.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    await rm(rootDir, { recursive: true, force: true });
  }
});

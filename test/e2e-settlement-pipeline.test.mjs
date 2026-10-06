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
import { SimulationExecutionAuthority } from '../dist/platform/execution/authority.js';
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
  let evidenceRecoveryStore;

  try {
    logger = new SessionLogger(sessionDir);
    await logger.init();

    const cfg = config({
      MODE: 'paper',
      BUY_LAMPORTS: 10_000_000,
      MAX_EXPOSURE_LAMPORTS: 200_000_000,
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
    let marketSafetyCalls = 0;
    const mockMarket = {
      buyQuote: () => quoteBuyOut,
      sellQuote: () => quoteSellOut,
      snapshot: async () => makeSnapshot(),
      safety: async () => { marketSafetyCalls++; },
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
      received: eventTime + 250,
      observation: {
        observationId: 'obs-create-sig-1',
        sourceId: 'test-provider',
        providerId: 'https://provider.example',
        transport: 'test.feed',
        receivedAt: eventTime + 250,
        slot: 100,
        commitment: 'confirmed',
        signature: 'create-sig-1',
        rawPayloadHash: 'a'.repeat(64),
        schemaVersion: 'solana-program-logs/v1',
        processingIntent: 'LIVE',
      },
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
    const discoveryAudit = await store.getAuditEvents('candidate_discovered_v1', 10);
    assert.equal(discoveryAudit.length, 1, 'initial candidate enters the durable audit denominator before evaluation');
    const discoveryRecord = JSON.parse(discoveryAudit[0].body);
    assert.equal(discoveryRecord.candidateId, candidate.candidateGenerationId);
    assert.equal(discoveryRecord.observedAtMs, eventTime + 250);
    assert.equal(discoveryRecord.sourceObservation.observationId, 'obs-create-sig-1');
    assert.equal(discoveryRecord.sourceObservation.rawPayloadHash, 'a'.repeat(64));
    assert.equal(candidate.buyCount, 6, 'Genuine buy count must be tracked');
    assert.equal(candidate.sellCount, 0, 'Genuine sell count must be tracked');
    assert.equal(candidate.buyers.size, 6, 'Genuine distinct buyers tracked');

    // Snapshot candidate with genuine features (no 85 SOL assumption, no $150 fixed price)
    const snap = makeSnapshot();
    const candSnapshot = engine.snapshotCandidate(candidate, 'cleared', null, { s: snap });
    assert.ok(candSnapshot);
    assert.equal(candSnapshot.observedAtMs, eventTime + 250, 'point-in-time observation uses feed receipt time');
    assert.notEqual(candSnapshot.observedAtMs, candidate.born, 'chain creation time is not a substitute for local knowledge time');
    assert.equal(candSnapshot.microstructure.buyTransactionCount, 6);
    assert.equal(candSnapshot.microstructure.sellTransactionCount, 0);
    assert.equal(candSnapshot.transport.leadingRpcLatencyMs, 26, 'Uses genuine leading RPC latency');
    assert.ok(candSnapshot.curveState.curveCompletionPct >= 0, 'Computed real curve completion percentage');
    assert.equal(candSnapshot.curveState.spotPriceUsd, 0, 'SOL-denominated spot price is not mislabeled as USD');
    assert.ok(candSnapshot.missingFeatureKeys.includes('spotPriceUsd'), 'USD price remains explicitly missing without an FX quote');
    const snapshotAudit = await store.getAuditEvents('candidate_snapshot_v1', 10);
    assert.equal(snapshotAudit.length, 1, 'point-in-time feature snapshot is durably linked to discovery provenance');
    const snapshotRecord = JSON.parse(snapshotAudit[0].body);
    assert.equal(snapshotRecord.candidateGenerationId, discoveryRecord.candidateId);
    assert.equal(snapshotRecord.snapshot.candidateId, candSnapshot.candidateId);
    assert.equal(snapshotRecord.sourceObservation.observationId, 'obs-create-sig-1');
    assert.equal(snapshotRecord.snapshot.featureSealHash, candSnapshot.featureSealHash);

    // Durable point-in-time storage must not depend on optional SESSION_DIR files.
    const configuredLogger = engine.sessionLogger;
    engine.sessionLogger = undefined;
    const noLoggerSnapshot = engine.snapshotCandidate(candidate, 'notEvaluated', 'logger_disabled');
    engine.sessionLogger = configuredLogger;
    assert.ok(noLoggerSnapshot, 'snapshot creation remains available without a session logger');
    const noLoggerAudit = await store.getAuditEvents('candidate_snapshot_v1', 10);
    assert.equal(noLoggerAudit.length, 2, 'SQLite evidence capture is independent of optional session logging');
    assert.equal(JSON.parse(noLoggerAudit[1].body).snapshot.dispositionReason, 'logger_disabled');

    // Counterfactual market sampling records near-miss prices without touching
    // paper cash, positions, or the performance ledger.
    const candidateBuyers = new Map(candidate.buyers);
    const candidateBuy = candidate.buy;
    candidate.buyers = new Map([...candidateBuyers].slice(0, 5));
    candidate.buy = 0n;
    const fillsBeforeShadow = engine.state.performance?.count ?? 0;
    await engine['sampleCounterfactualNearMiss']();
    await engine['sampleCounterfactualNearMiss'](); // scan cooldown prevents duplicate samples
    const shadowState = engine['counterfactualObservations'].get(candidateMint);
    assert.equal(shadowState.samples, 1, 'scan cooldown limits repeated market reads');
    for (let i = 0; i < 9; i++) {
      engine['nextCounterfactualScanAt'] = 0;
      shadowState.nextAt = 0;
      await engine['sampleCounterfactualNearMiss']();
    }
    assert.equal(shadowState.samples, 10, 'near-miss follow-up spans the candidate lifetime');
    assert.equal(marketSafetyCalls, 1, 'near-miss full safety is checked once without executing an order');
    assert.equal(engine.state.performance?.count ?? 0, fillsBeforeShadow);
    assert.equal(Object.keys(engine.state.positions).length, 0);
    candidate.buyers = candidateBuyers;
    candidate.buy = candidateBuy;

    // An executor build failure is a recorded attempt, not a missing candidate.
    const originalBuild = executor.build.bind(executor);
    executor.build = async () => { throw new Error('fixture quote unavailable'); };
    candidate.next = 0;
    engine['nextSafetyScanAt'] = 0;
    await engine['tick']();
    executor.build = originalBuild;
    const buildFailures = await store.getAuditEvents('candidate_order_build_failed_v1', 10);
    assert.equal(buildFailures.length, 1, 'failed quote/build attempt is durably captured');
    const failedAttempt = JSON.parse(buildFailures[0].body);
    assert.equal(failedAttempt.candidateGenerationId, discoveryRecord.candidateId);
    assert.match(failedAttempt.error, /fixture quote unavailable/);
    const startedAttempts = await store.getAuditEvents('candidate_order_build_started_v1', 10);
    assert.equal(startedAttempts.length, 1);
    assert.equal(JSON.parse(startedAttempts[0].body).attemptId, failedAttempt.attemptId);
    engine['nextSafetyScanAt'] = 0;
    candidate.next = 0;

    // 5. Execute BUY Trade
    // Exercise the full safety-to-paper-entry path. The safety cooldown is
    // scheduled before external checks and must be cleared when they pass.
    await engine['tick']();

    const pos = engine.state.positions[candidateMint];
    assert.ok(pos, 'Position should exist after all entry checks pass');
    const gatePasses = await store.getAuditEvents('candidate_entry_gates_passed_v1', 10);
    assert.equal(gatePasses.length, 2, 'each local entry-gate evaluation is durably observable, including attempts that later fail to build');
    const gatePass = JSON.parse(gatePasses[1].body);
    assert.equal(gatePass.candidateGenerationId, discoveryRecord.candidateId);
    assert.equal(gatePass.attemptNumber, 2);
    assert.notEqual(gatePass.attemptId, failedAttempt.attemptId, 'retry receives a distinct identity that does not depend on process-local counters');
    assert.equal(gatePass.executionAuthority, 'NOT_ASSERTED', 'research record does not imply execution authorization');
    const builtAttempts = await store.getAuditEvents('candidate_order_built_v1', 10);
    assert.equal(builtAttempts.length, 1, 'successful built order retains the second attempt identity');
    assert.equal(JSON.parse(builtAttempts[0].body).attemptId, gatePass.attemptId);
    const allStartedAttempts = await store.getAuditEvents('candidate_order_build_started_v1', 10);
    assert.equal(allStartedAttempts.length, 2);
    assert.equal(JSON.parse(allStartedAttempts[1].body).attemptId, gatePass.attemptId);
    assert.equal(pos.qty, '970000000');
    assert.equal(pos.initialQty, '970000000');
    assert.equal(pos.candidateGenerationId, discoveryRecord.candidateId, 'position retains stable generation identity for later exits');
    await store.save(engine.state, 'candidate-generation-recovery-fixture');
    const recoveryStore = new Store(cfg.DB_PATH);
    try {
      const recoveredState = await recoveryStore.load();
      assert.equal(recoveredState.positions[candidateMint].candidateGenerationId, discoveryRecord.candidateId,
        'stable candidate identity survives Store reopen for later exits');
    } finally { await recoveryStore.close(); }
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
    const paperFills = await store.getAuditEvents('candidate_paper_fill_v1', 10);
    assert.equal(paperFills.length, 3, 'buy and partial/full paper exits are durably attributed to the candidate');
    assert.ok(paperFills.every(row => JSON.parse(row.body).outcomeEvidenceClass === 'PAPER_SIMULATED_FILL_NOT_CHAIN_EVIDENCE'));
    const allBuiltAttempts = await store.getAuditEvents('candidate_order_built_v1', 10);
    const sellBuilds = allBuiltAttempts.map(row => JSON.parse(row.body)).filter(row => row.side === 'sell');
    assert.equal(sellBuilds.length, 2, 'partial and full exits retain candidate-linked build identities after their entry');
    assert.ok(sellBuilds.every(row => row.candidateGenerationId === discoveryRecord.candidateId));

    // 8. Verify Engine Internal Realized PnL Accounting
    const engineRealizedLamports = BigInt(engine.state.performance?.realized || '0');

    // Checkpoint
    engine['emitCheckpoint']();

    // Close logger to ensure all file streams flush to disk
    await logger.close();

    const rawSessionEvents = (await readFile(join(sessionDir, 'session.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const shadowObservations = rawSessionEvents.filter(event => event.event === 'paper_shadow_market_observation');
    assert.equal(shadowObservations.length, 10, 'near-miss follow-up is bounded and rate-limited');
    assert.equal(shadowObservations[0].buyerCount, 5);
    assert.equal(shadowObservations[0].mintSafetyFlagsPass, true);
    assert.equal(shadowObservations[0].shadowGateStatus, 'LOCAL_ENTRY_GATES_PASS_FULL_SAFETY_UNCHECKED');
    assert.equal(shadowObservations[0].creatorAndRugSafetyStatus, 'PASSED');
    assert.equal(shadowObservations[0].reserveDriftStatus, 'PASSED');
    assert.equal(shadowObservations[0].shadowNetPnlLamports, '-5850000');
    assert.equal(shadowObservations[0].shadowEquityPnlIfAtaRentReclaimedLamports, '-2850000');
    assert.equal(shadowObservations[0].realSolReservesLamports, '2500000000');
    assert.equal(shadowObservations[0].virtualAssetReserves, '1073000000000000');
    assert.ok(shadowObservations[0].spotSolPerAssetUnit > 0);
    assert.equal(shadowObservations[9].sampleIndex, 10);

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

    // A dropped evidence write must be visible in runtime health without affecting fills.
    const appendAuditEvent = store.appendAuditEvent.bind(store);
    store.appendAuditEvent = async () => { throw new Error('fixture audit storage unavailable'); };
    engine['persistResearchObservation']('candidate_test_failure_v1', {}, 'fixture-record');
    await new Promise(resolve => setImmediate(resolve));
    const evidenceHealth = engine.snapshot().researchEvidence;
    assert.equal(evidenceHealth.persistenceFailures, 1);
    assert.equal(evidenceHealth.lastPersistenceFailure.event, 'candidate_test_failure_v1');
    assert.equal(evidenceHealth.lastPersistenceFailure.reason, 'write_rejected');
    assert.equal(evidenceHealth.lossMarkerStatus, 'PENDING_STATE_SAVE');
    store.appendAuditEvent = appendAuditEvent;

    // The known loss is included in the next normal state commit and survives restart.
    await engine['saveState']('research-evidence-loss-marker');
    assert.equal(engine.snapshot().researchEvidence.lossMarkerStatus, 'PERSISTED');
    evidenceRecoveryStore = new Store(cfg.DB_PATH);
    const recoveredState = await evidenceRecoveryStore.load();
    assert.equal(recoveredState.researchEvidenceLoss.failureCount, 1);
    assert.equal(recoveredState.researchEvidenceLoss.lastEvent, 'candidate_test_failure_v1');
    assert.equal(recoveredState.researchEvidenceLoss.recoveryRequired, true);
    const recoveredEngine = new Engine(cfg, rpc, mockMarket, executor, evidenceRecoveryStore, recoveredState);
    assert.equal(recoveredEngine.snapshot().researchEvidence.persistenceFailures, 1);
    assert.equal(recoveredEngine.snapshot().researchEvidence.lossMarkerStatus, 'PERSISTED');

    // Corrupt prior markers remain visibly unknown; they are not reinterpreted as zero failures.
    const invalidMarkerEngine = new Engine(cfg, rpc, mockMarket, executor, evidenceRecoveryStore, {
      ...recoveredState,
      researchEvidenceLoss: { schemaVersion: 999, failureCount: 0 },
    });
    assert.equal(invalidMarkerEngine.snapshot().researchEvidence.persistenceFailures, null);
    assert.equal(invalidMarkerEngine.snapshot().researchEvidence.lossMarkerStatus, 'INVALID');
  } finally {
    // Release streams and the SQLite worker before removing the Windows fixture.
    const closed = await Promise.allSettled([logger?.close(), evidenceRecoveryStore?.close(), store?.close()]);
    const failure = closed.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('Engine paper marks match executable simulation sell proceeds and disappear on curve graduation', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'fusion-mark-regression-'));
  let store;
  try {
    const cfg = config({
      MODE: 'paper', BUY_LAMPORTS: 10_000_000, PAPER_CASH_LAMPORTS: 2_000_000_000,
      MAX_EXPOSURE_LAMPORTS: 2_000_000_000, MAX_DAILY_LOSS_LAMPORTS: 500_000_000,
      SLIPPAGE_BPS: 300, PANIC_SLIPPAGE_BPS: 1_000,
      MAX_TIP_LAMPORTS: 500_000, MIN_TIP_LAMPORTS: 10_000,
      MAX_PRIORITY_LAMPORTS: 200_000, DB_PATH: join(rootDir, 'fusion.sqlite'),
      RPC_URLS: 'https://rpc.example.invalid', WS_URLS: 'wss://rpc.example.invalid',
    });
    const mint = mintPub.toBase58();
    const qty = 1_000_000n;
    const proceeds = 1_000_000_000n;
    const liveSnapshot = makeSnapshot({ realQuoteReserves: '2500000000' });
    const market = {
      sellQuote: () => proceeds,
      snapshot: async () => liveSnapshot,
    };
    const rpc = {};
    const authority = new SimulationExecutionAuthority(cfg, market, key.publicKey);
    store = { save: async () => {} };

    const makeEngine = (position, initialCash = 1_000_000_000n) => {
      const state = {
        version: 1, wallet: key.publicKey.toBase58(), mode: 'paper',
        positions: { [mint]: position }, pending: null,
        cash: String(initialCash), day: new Date().toISOString().slice(0, 10),
        dayPnl: '0', closed: {}, halted: false,
      };
      const engine = new Engine(cfg, rpc, market, authority, store, state);
      engine.feed.last = Date.now();
      engine.feed.readySince = Date.now() - 20_000;
      engine.feed.slot = 100;
      return engine;
    };
    const position = (panic = false) => ({
      mint, creator: creatorPub.toBase58(), tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      qty: String(qty), initialQty: String(qty), cost: '900000000', originalCost: '900000000',
      peak: '900000000', stage: 5, opened: Date.now() - 1_000,
      reserve: '2500000000', panic, creatorTokens: '0',
    });

    const normalEngine = makeEngine(position(false));
    const normalFill = await authority.build(liveSnapshot, 'sell', qty, creatorPub.toBase58(), 5, 'mark-parity', false);
    await normalEngine['tick']();
    assert.equal(normalEngine['marks'].get(mint)?.value, String(normalFill.solDelta),
      'normal mark must equal the SimulationExecutionAuthority sell fill proceeds');

    const panicEngine = makeEngine(position(true));
    const panicFill = await authority.build(liveSnapshot, 'sell', qty, creatorPub.toBase58(), 5, 'mark-parity', true);
    await panicEngine['tick']();
    assert.equal(panicEngine['marks'].get(mint)?.value, String(panicFill.solDelta),
      'panic mark must include the same panic slippage and fees as the simulation sell fill');

    const graduatedSnapshot = makeSnapshot({ complete: true });
    const graduatedMarket = { ...market, snapshot: async () => graduatedSnapshot };
    const graduatedAuthority = new SimulationExecutionAuthority(cfg, graduatedMarket, key.publicKey);
    const graduatedEngine = makeEngine(position(false));
    graduatedEngine.market = graduatedMarket;
    graduatedEngine.executor = graduatedAuthority;
    graduatedEngine['marks'].set(mint, { value: '123456789', at: Date.now() - 1_000 });
    const fillsBefore = graduatedEngine.state.performance?.count ?? 0;
    await graduatedEngine['tick']();
    assert.equal(graduatedEngine['marks'].has(mint), false,
      'graduated curve must remove any stale mark when no executable venue quote is available');
    assert.ok(graduatedEngine.state.positions[mint], 'position remains open while graduated venue value is unknown');
    assert.equal(graduatedEngine.state.performance?.count ?? 0, fillsBefore,
      'no fabricated sell fill is recorded for an unavailable graduated-venue quote');
  } finally {
    if (typeof store?.close === 'function') store.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

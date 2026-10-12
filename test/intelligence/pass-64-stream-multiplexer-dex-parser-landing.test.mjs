import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamMultiplexer,
  StreamDeduplicator,
} from '../../dist/platform/ingestion/stream-multiplexer.js';
import {
  DEXStreamParser,
} from '../../dist/platform/ingestion/dex-stream-parser.js';
import {
  LandingBenchmarkEngine,
} from '../../dist/platform/execution/landing-benchmark.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 64: Stream Metrics, DEX Observation Envelope & Paired Landing Benchmark (REQ-080)', () => {
  test('Pass 64 Test 1: StreamMultiplexer Multi-Source Registration, Lowest-Latency Routing & Quorum (Richat & Yellowstone Invariants)', () => {
    const mux = new StreamMultiplexer({
      minQuorumCount: 3,
      maxAllowedLatencyMs: 150,
      maxAllowedSlotLag: 2,
    });

    const initialReport = mux.getReport();
    assert.equal(initialReport.activeProvider, null);
    assert.equal(initialReport.totalProviders, 0);
    assert.equal(initialReport.healthyProviders, 0);
    assert.equal(initialReport.quorumMet, false);
    assert.equal(initialReport.meanLatencyMs, null);

    const now = Date.now();
    mux.registerProvider({
      providerId: 'TRITON_YELLOWSTONE',
      endpointUrl: 'grpc://triton-mainnet.example.com:10000',
      isHealthy: true,
      latencyMs: 35,
      slotLag: 0,
      droppedFramesCount: 0,
      consecutiveErrors: 0,
      lastSeenAtMs: now,
    });

    mux.registerProvider({
      providerId: 'HELIUS_GEYSER',
      endpointUrl: 'grpc://helius-geyser.example.com:10000',
      isHealthy: true,
      latencyMs: 50,
      slotLag: 1,
      droppedFramesCount: 1,
      consecutiveErrors: 0,
      lastSeenAtMs: now,
    });

    // Lowest latency is TRITON_YELLOWSTONE (35ms < 50ms)
    assert.equal(mux.getActiveProvider(), 'TRITON_YELLOWSTONE');
    assert.equal(mux.getReport().quorumMet, false, 'Quorum requires 3 providers');

    // Register third provider with lowest latency (15ms)
    mux.registerProvider({
      providerId: 'RICHAT_PROXY',
      endpointUrl: 'grpc://richat-aggregator.example.com:10000',
      isHealthy: true,
      latencyMs: 15,
      slotLag: 0,
      droppedFramesCount: 0,
      consecutiveErrors: 0,
      lastSeenAtMs: now,
    });

    assert.equal(mux.getActiveProvider(), 'RICHAT_PROXY', 'RICHAT_PROXY must become active provider (15ms)');
    const quorumReport = mux.getReport();
    assert.equal(quorumReport.quorumMet, true, 'Quorum must be met with 3 healthy providers');
    assert.equal(quorumReport.healthyProviders, 3);
    assert.ok(quorumReport.meanLatencyMs !== null);
    assert.ok(Math.abs(quorumReport.meanLatencyMs - 33.33) < 1.0);
    assert.match(quorumReport.multiplexerDigest, /^[a-f0-9]{64}$/, 'Multiplexer digest must be valid SHA-256');

    // Degrade RICHAT_PROXY
    mux.registerProvider({
      providerId: 'RICHAT_PROXY',
      endpointUrl: 'grpc://richat-aggregator.example.com:10000',
      isHealthy: false,
      latencyMs: 500,
      slotLag: 10,
      droppedFramesCount: 50,
      consecutiveErrors: 5,
      lastSeenAtMs: now,
    });

    // Failover to next healthiest: TRITON_YELLOWSTONE (35ms)
    assert.equal(mux.getActiveProvider(), 'TRITON_YELLOWSTONE', 'Must failover to TRITON_YELLOWSTONE');
    assert.equal(mux.getReport().quorumMet, false, 'Quorum must drop when healthy count < 3');
  });

  test('Pass 64 Test 2: StreamDeduplicator Ring Buffer Invariants & Dedup Rate Accounting', () => {
    const dedup = new StreamDeduplicator(5);

    // Initial signatures
    assert.equal(dedup.isDuplicate('sig_1'), false);
    assert.equal(dedup.isDuplicate('sig_2'), false);
    assert.equal(dedup.isDuplicate('sig_3'), false);

    // Replay signature
    assert.equal(dedup.isDuplicate('sig_1'), true, 'sig_1 must be recognized as duplicate');
    assert.equal(dedup.isDuplicate('sig_2'), true, 'sig_2 must be recognized as duplicate');

    // Stats
    const stats = dedup.getStats();
    assert.equal(stats.totalSeen, 5);
    assert.equal(stats.totalDuplicates, 2);
    assert.equal(stats.dedupRatePct, 40.0);

    // Fill to capacity and cause eviction of oldest
    assert.equal(dedup.isDuplicate('sig_4'), false);
    assert.equal(dedup.isDuplicate('sig_5'), false);
    assert.equal(dedup.isDuplicate('sig_6'), false); // Capacity 5 reached, sig_1 evicted

    // sig_1 was evicted, so inserting it again should not be duplicate
    assert.equal(dedup.isDuplicate('sig_1'), false, 'Evicted signature must not be reported as duplicate');

    // Input bounds validation
    assert.throws(() => new StreamDeduplicator(0), /INVALID_DEDUP_CAPACITY/);
    assert.throws(() => new StreamDeduplicator(-5), /INVALID_DEDUP_CAPACITY/);
    assert.throws(() => dedup.isDuplicate(''), /INVALID_SIGNATURE/);
    assert.throws(() => dedup.isDuplicate(null), /INVALID_SIGNATURE/);
  });

  test('Pass 64 Test 3: Exact program identification leaves undecoded trade fields unknown', () => {
    const parser = new DEXStreamParser();

    // 1. Unknown / generic transaction
    const unknownTx = parser.parseTransaction({
      slot: 448300000,
      signature: 'generic_sig_1',
      logs: ['Program 11111111111111111111111111111111 invoke [1]'],
    });
    assert.equal(unknownTx.protocol, 'UNKNOWN_DEX');
    assert.equal(unknownTx.decodeStatus, 'NOT_DECODED');
    assert.equal(unknownTx.tradeType, 'UNKNOWN');
    assert.equal(unknownTx.isSuccess, null);

    // 2. Pump.fun Trade Execution Inspection
    const pumpFunTx = parser.parseTransaction({
      slot: 448300001,
      signature: 'pump_sig_alpha',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      accounts: [
        'Global11111111111111111111111111111111111111',
        'Fee11111111111111111111111111111111111111111',
        'MintPumpAlpha11111111111111111111111111111111',
        'BondingCurve111111111111111111111111111111111',
        'UserWalletAlpha111111111111111111111111111111',
      ],
      logs: [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program log: Instruction: Buy',
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
      ],
      err: null,
    });
    assert.equal(pumpFunTx.protocol, 'PUMP_FUN');
    assert.equal(pumpFunTx.decodeStatus, 'NOT_DECODED');
    assert.equal(pumpFunTx.tradeType, 'UNKNOWN');
    assert.equal(pumpFunTx.isSuccess, true);

    // 3. Raydium AMM V4 Trade Inspection
    const raydiumTx = parser.parseTransaction({
      slot: 448300002,
      signature: 'ray_sig_beta',
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      accounts: [
        'TokenProgram11111111111111111111111111111111',
        'AmmId111111111111111111111111111111111111111',
        'AmmAuthority11111111111111111111111111111111',
      ],
      logs: [
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
        'Program log: ray_log: SwapBaseIn',
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success',
      ],
      err: null,
    });
    assert.equal(raydiumTx.protocol, 'RAYDIUM_AMM_V4');
    assert.equal(raydiumTx.decodeStatus, 'NOT_DECODED');
    assert.equal(raydiumTx.tradeType, 'UNKNOWN');
    assert.equal(raydiumTx.isSuccess, true);

    // 4. Failed Transaction Handling
    const failedTx = parser.parseTransaction({
      slot: 448300003,
      signature: 'failed_tx_gamma',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      err: { InstructionError: [0, 'Custom(1)'] },
      logs: ['Program log: Slippage exceeded'],
    });
    assert.equal(failedTx.protocol, 'PUMP_FUN');
    assert.equal(failedTx.isSuccess, false);
    assert.equal(failedTx.decodeStatus, 'NOT_DECODED');
  });

  test('Pass 64 Test 4: LandingBenchmarkEngine Paired Trials, Non-Fabrication & Percentile Tip Schedule (Netticode & MOBIUS Invariants)', () => {
    const engine = new LandingBenchmarkEngine({ minimumPairedTrials: 2 });

    // Empty benchmark evaluation must never fabricate values
    const emptyCert = engine.evaluateBenchmark('empty_benchmark');
    assert.equal(emptyCert.observationLeaderForReview, null);
    assert.equal(emptyCert.pairedTrialCount, 0);
    assert.equal(emptyCert.evaluationStatus, 'INSUFFICIENT_PAIRED_EVIDENCE');
    assert.equal(emptyCert.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
    assert.equal(emptyCert.isLandingHealthy, null);
    assert.equal(emptyCert.overallLandingRatePct, null);
    assert.ok(emptyCert.evaluatedLanes.every((l) => l.landingRatePct === null && l.meanFirstShredLatencyMs === null));

    // Submit paired trials for benchmark 'bench_1'
    for (let i = 0; i < 2; i++) {
      const trialId = `trial_${i}`;
      // JITO_BUNDLE (landed, 15ms latency, 50k tip)
      engine.recordSubmissionAttempt({
        benchmarkId: 'bench_1',
        trialId,
        lane: 'JITO_BUNDLE',
        transactionDigest: `digest_${i}`,
        notionalLamports: 1_000_000n,
        targetSlot: 448300000 + i,
        submittedAtMs: 1000,
        outcome: 'LANDED',
        firstShredAtMs: 1015,
        includedSlot: 448300000 + i,
        tipLamports: 50_000n,
      });

      // DIRECT_TPU_QUIC (landed, 30ms latency, 10k tip)
      engine.recordSubmissionAttempt({
        benchmarkId: 'bench_1',
        trialId,
        lane: 'DIRECT_TPU_QUIC',
        transactionDigest: `digest_${i}`,
        notionalLamports: 1_000_000n,
        targetSlot: 448300000 + i,
        submittedAtMs: 1000,
        outcome: 'LANDED',
        firstShredAtMs: 1030,
        includedSlot: 448300000 + i,
        tipLamports: 10_000n,
      });

      // RPC_FALLBACK (failed)
      engine.recordSubmissionAttempt({
        benchmarkId: 'bench_1',
        trialId,
        lane: 'RPC_FALLBACK',
        transactionDigest: `digest_${i}`,
        notionalLamports: 1_000_000n,
        targetSlot: 448300000 + i,
        submittedAtMs: 1000,
        outcome: 'FAILED',
      });
    }

    const cert = engine.evaluateBenchmark('bench_1');
    assert.equal(cert.pairedTrialCount, 2);
    assert.equal(cert.pairedEvidenceSufficient, true);
    assert.equal(cert.evaluationStatus, 'OBSERVATIONS_ONLY');
    assert.equal(cert.observationLeaderForReview, 'JITO_BUNDLE', 'JITO_BUNDLE should lead with lowest shred latency');
    assert.equal(cert.isLandingHealthy, false, 'Overall landing rate (4/6 = 66.7%) is < 70% threshold');
    assert.equal(cert.overallLandingRatePct, 66.7);
    assert.ok(cert.dynamicTipSchedule);
    assert.equal(cert.dynamicTipSchedule.recommendedTipLamports, null, 'Dynamic tip schedule must never recommend without execution authority');
    assert.match(cert.certificateHash, /^[a-f0-9]{64}$/);
  });

  test('Pass 64 Test 5: Master Intelligence Engine Fail-Closed Gating, ViewModel Telemetry & Public Helpers (REQ-080)', async () => {
    const master = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(master);

    const mint = 'SoLStreamMasterGate11111111111111111111111111';
    const receivedAtMs = Date.now();
    const sourceAtMs = receivedAtMs - 40;

    const baseEvent = {
      eventId: 'evt_pass64_gate_01',
      eventType: 'TOKEN_CREATE',
      mint,
      slot: 448300200,
      timestampNs: BigInt(sourceAtMs) * 1_000_000n,
      sourceTimestampMs: sourceAtMs,
      receivedTimestampMs: receivedAtMs,
      sequenceId: 1,
      chainState: 'CONFIRMED',
      sourceConfidence: 0.99,
      freshnessMs: 10,
      provenance: ['PUMP_PORTAL_WS'],
      payload: {
        mint,
        amountSol: 30.0,
        priceSol: 0.00004,
        symbol: 'STR64',
        creator: 'CreatorWalletAlpha1111111111111111111111111',
        initialLiquiditySol: 30.0,
      },
    };

    const baseWallets = [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ];

    const baseContext = {
      tokenAgeSec: 40,
      marketCapSol: 120,
      liquiditySol: 35,
      txCount: 12,
      rawWallets: baseWallets,
      isMintRenounced: true,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 12,
    };

    // Subtest 5A: Gating blocked when stream multiplexer fails quorum under enforcement
    const muxBlockedResult = await master.processEvent(baseEvent, {
      ...baseContext,
      enforceStreamMultiplexerGating: true,
      maxAllowedStreamLatencyMs: 100,
    });
    assert.equal(muxBlockedResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(muxBlockedResult.whyExecutionBlocked || '', /STREAM MULTIPLEXER DEGRADED/);

    // Subtest 5B: Gating blocked when landing benchmark is sub-critical under enforcement
    const landingBlockedResult = await master.processEvent(baseEvent, {
      ...baseContext,
      enforceLandingBenchmarkGating: true,
      minLandingBenchmarkRatePct: 70.0,
    });
    assert.equal(landingBlockedResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(landingBlockedResult.whyExecutionBlocked || '', /INSUFFICIENT LANDING BENCHMARK/);

    // Subtest 5C: ViewModel telemetry verification
    assert.ok(landingBlockedResult.viewModel.multiplexerReport);
    assert.ok(landingBlockedResult.viewModel.decodedDexTrade);
    assert.ok(landingBlockedResult.viewModel.landingBenchmark);
    assert.equal(landingBlockedResult.viewModel.multiplexerReport.healthyProviders, 0);

    // Subtest 5D: Public helper methods
    assert.ok(master.getStreamMultiplexer() instanceof StreamMultiplexer);
    assert.ok(master.getDexStreamParser() instanceof DEXStreamParser);
    assert.ok(master.getLandingBenchmarkEngine() instanceof LandingBenchmarkEngine);

    const parsedDex = master.parseDexTransaction({
      slot: 448300200,
      signature: 'helper_test_sig',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    });
    assert.equal(parsedDex.protocol, 'PUMP_FUN');

    const benchmarkReport = master.evaluateLandingBenchmark(448300200, 0.50);
    assert.equal(benchmarkReport.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
    assert.equal(benchmarkReport.evaluationStatus, 'INSUFFICIENT_PAIRED_EVIDENCE');
  });
});

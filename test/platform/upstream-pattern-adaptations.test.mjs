import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamMultiplexer, shouldBlockStreamMultiplexer } from '../../src/platform/ingestion/stream-multiplexer.ts';
import { DEXStreamParser } from '../../src/platform/ingestion/dex-stream-parser.ts';
import { LandingBenchmarkEngine, shouldBlockLandingBenchmark } from '../../src/platform/execution/landing-benchmark.ts';

test('stream multiplexer starts unknown and only reports fresh supplied provider measurements', () => {
  const mux = new StreamMultiplexer();
  const empty = mux.getReport();
  assert.equal(empty.activeProvider, null);
  assert.equal(empty.healthyProviders, 0);
  assert.equal(empty.quorumMet, false);
  assert.equal(empty.observedSlot, null);
  assert.equal(empty.meanLatencyMs, null);
  assert.equal(empty.hasLiveTransportConnection, false);
  assert.equal(shouldBlockStreamMultiplexer(empty, 200), true);

  mux.registerProvider({
    providerId: 'TRITON_YELLOWSTONE', endpointUrl: 'grpc://provider.example', isHealthy: true,
    latencyMs: 25, slotLag: 0, droppedFramesCount: 0, consecutiveErrors: 0, lastSeenAtMs: Date.now(),
  });
  assert.equal(mux.getActiveProvider(), 'TRITON_YELLOWSTONE');
  assert.equal(mux.getReport().quorumMet, false);
  assert.throws(() => new StreamMultiplexer({ dedupCapacity: 0 }), { message: 'INVALID_DEDUP_CAPACITY' });
});

test('DEX envelope inspection does not infer a trade from generic logs or missing transaction fields', () => {
  const parser = new DEXStreamParser();
  const result = parser.parseTransaction({ slot: 10, signature: 'sig', logs: ['Program log: Instruction: Buy'], data: 'anything' });
  assert.equal(result.protocol, 'UNKNOWN_DEX');
  assert.equal(result.decodeStatus, 'NOT_DECODED');
  assert.equal(result.tradeType, 'UNKNOWN');
  assert.equal(result.mint, null);
  assert.equal(result.inAmountSol, null);
  assert.equal(result.outAmountTokens, null);
  assert.equal(result.isSuccess, null);

  const missingSignature = parser.parseTransaction({ slot: 11 });
  assert.equal(missingSignature.signature, null);

  const failed = parser.parseTransaction({ slot: 10, signature: 'sig-failed', programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', err: { InstructionError: [0, 'Custom'] } });
  assert.equal(failed.protocol, 'PUMP_FUN');
  assert.equal(failed.isSuccess, false);
});

test('Raydium SDK v2 program families are identified without claiming transaction decoding', () => {
  const parser = new DEXStreamParser();
  const cases = [
    ['5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', 'RAYDIUM_AMM_STABLE'],
    ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'RAYDIUM_CLMM'],
    ['CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', 'RAYDIUM_CPMM'],
    ['LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', 'RAYDIUM_LAUNCHPAD'],
  ];

  for (const [programId, expectedProtocol] of cases) {
    const result = parser.parseTransaction({ slot: 100, signature: `sig-${expectedProtocol}`, programId, err: null });
    assert.equal(result.protocol, expectedProtocol);
    assert.equal(result.decodeStatus, 'NOT_DECODED');
    assert.equal(result.tradeType, 'UNKNOWN');
    assert.equal(result.mint, null);
    assert.equal(result.inAmountSol, null);
    assert.equal(result.outAmountTokens, null);
  }
});

test('landing benchmark never fills empty samples with fabricated success, latency, or tip values', () => {
  const report = new LandingBenchmarkEngine().evaluateBenchmark('empty');
  assert.equal(report.observationLeaderForReview, null);
  assert.equal(report.pairedTrialCount, 0);
  assert.equal(report.evaluationStatus, 'INSUFFICIENT_PAIRED_EVIDENCE');
  assert.equal(report.overallLandingRatePct, null);
  assert.equal(report.isLandingHealthy, null);
  assert.equal(report.dynamicTipSchedule.recommendedTipLamports, null);
  assert.equal(report.evaluatedLanes.every((lane) => lane.landingRatePct === null && lane.meanFirstShredLatencyMs === null && lane.observedTipTotalLamports === null), true);
  assert.equal(report.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  assert.equal(shouldBlockLandingBenchmark(report, 70), true);
});

test('landing comparisons use only complete same-transaction, same-size, same-slot trials', () => {
  const engine = new LandingBenchmarkEngine();
  engine.recordSubmissionAttempt({ benchmarkId: 'campaign', trialId: 'incomplete', lane: 'JITO_BUNDLE', transactionDigest: 'digest-a', notionalLamports: 10n, targetSlot: 50, submittedAtMs: 1000, outcome: 'LANDED', firstShredAtMs: 1020, includedSlot: 50 });
  engine.recordSubmissionAttempt({ benchmarkId: 'campaign', trialId: 'incomplete', lane: 'DIRECT_TPU_QUIC', transactionDigest: 'digest-a', notionalLamports: 10n, targetSlot: 50, submittedAtMs: 1000, outcome: 'FAILED' });
  assert.throws(() => engine.recordSubmissionAttempt({ benchmarkId: 'campaign', trialId: 'incomplete', lane: 'RPC_FALLBACK', transactionDigest: 'other', notionalLamports: 10n, targetSlot: 50, submittedAtMs: 1000, outcome: 'FAILED' }), { message: 'UNPAIRED_BENCHMARK_MISMATCH' });

  const result = engine.evaluateBenchmark('campaign');
  assert.equal(result.pairedTrialCount, 0);
  assert.equal(result.excludedUnpairedAttemptCount, 2);
  assert.equal(result.observationLeaderForReview, null);
  assert.equal(result.evaluatedLanes.every((lane) => lane.totalSubmissions === 0), true);
});

test('landing candidate is exposed only as a review lead after the configured complete paired sample', () => {
  const engine = new LandingBenchmarkEngine({ minimumPairedTrials: 2 });
  for (let index = 0; index < 2; index += 1) {
    for (const [lane, outcome, offset] of [
      ['JITO_BUNDLE', 'LANDED', 10], ['DIRECT_TPU_QUIC', 'LANDED', 15], ['RPC_FALLBACK', 'FAILED', 0],
    ]) {
      engine.recordSubmissionAttempt({
        benchmarkId: 'campaign', trialId: `trial-${index}`, lane,
        transactionDigest: `digest-${index}`, notionalLamports: 100n, targetSlot: 500 + index,
        submittedAtMs: 1000, outcome,
        ...(outcome === 'LANDED' ? { firstShredAtMs: 1000 + offset, includedSlot: 500 + index } : {}),
        ...(lane === 'JITO_BUNDLE' ? { tipLamports: 20n } : {}),
      });
    }
  }
  const result = engine.evaluateBenchmark('campaign');
  assert.equal(result.pairedTrialCount, 2);
  assert.equal(result.evaluationStatus, 'OBSERVATIONS_ONLY');
  assert.equal(result.observationLeaderForReview, 'JITO_BUNDLE');
  assert.equal(result.overallLandingRatePct, 66.7);
  assert.equal(result.evaluatedLanes.find((lane) => lane.lane === 'JITO_BUNDLE').observedTipTotalLamports, '40');
  assert.equal(result.dynamicTipSchedule.p50TipLamports, '20');
  assert.equal(result.dynamicTipSchedule.recommendedTipLamports, null);
  assert.equal(result.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  assert.equal(shouldBlockLandingBenchmark(result, 70), true);
});

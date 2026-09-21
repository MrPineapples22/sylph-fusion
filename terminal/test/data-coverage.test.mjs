import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDataCoverage, HEALTH_TIERS } from '../src/data-coverage-eval.js';

test('evaluateDataCoverage categorizes resolved, censored, missing, and infraFailed correctly', () => {
  const candidates = [
    // 1. Resolved candidate (market reject with valid telemetry)
    {
      candidateId: 'cand-res-1',
      mint: 'MintResolved1111111111111111111111111111111',
      slot: 285001000,
      observedAtMs: 1726000000000,
      decisionAtMs: 1726000000020,
      featureSealHash: 'a'.repeat(64),
      microstructure: { buyerCount5m: 8 },
      curveState: { reserveDriftPct: 2.5 },
      rejectionReason: 'drift exceeded',
      evaluationDisposition: 'rejected',
    },
    // 2. Censored candidate (active at cutoff)
    {
      candidateId: 'cand-cens-1',
      mint: 'MintCensored1111111111111111111111111111111',
      slot: 285001010,
      observedAtMs: 1726000001000,
      decisionAtMs: 1726000001015,
      featureSealHash: 'b'.repeat(64),
      microstructure: { buyerCount5m: 12 },
      curveState: { reserveDriftPct: 0.2 },
      evaluationDisposition: 'cleared',
      censored: true,
    },
    // 3. Missing / malformed candidate (clock non-monotonicity)
    {
      candidateId: 'cand-miss-1',
      mint: 'MintMissing11111111111111111111111111111111',
      slot: 285001020,
      observedAtMs: 1726000002000,
      decisionAtMs: 1726000001900, // Non-monotonic! decision < observed
      featureSealHash: 'c'.repeat(64),
      microstructure: { buyerCount5m: 6 },
      curveState: { reserveDriftPct: 0.1 },
    },
    // 4. Infra-failed candidate (RPC 429 throttling)
    {
      candidateId: 'cand-infra-1',
      mint: 'MintInfra111111111111111111111111111111111',
      slot: 285001030,
      observedAtMs: 1726000003000,
      decisionAtMs: 1726000003010,
      featureSealHash: 'd'.repeat(64),
      microstructure: { buyerCount5m: 7 },
      curveState: { reserveDriftPct: 0.1 },
      rejectionReason: 'RPC rate limit 429 dropped',
      evaluationDisposition: 'rejected',
    },
    // 5. Infra-failed candidate (modelUnavailable fail-closed)
    {
      candidateId: 'cand-infra-2',
      mint: 'MintInfra222222222222222222222222222222222',
      slot: 285001040,
      observedAtMs: 1726000004000,
      decisionAtMs: 1726000004010,
      featureSealHash: 'e'.repeat(64),
      microstructure: { buyerCount5m: 9 },
      curveState: { reserveDriftPct: 0.1 },
      rejectionReason: 'modelUnavailable timeout',
      evaluationDisposition: 'modelUnavailable',
    },
  ];

  const outcomes = [
    {
      candidateId: 'cand-res-1',
      terminalState: 'take_profit',
      censored: false,
    },
    {
      candidateId: 'cand-cens-1',
      terminalState: 'censored',
      censored: true,
    },
  ];

  const coverage = evaluateDataCoverage({ candidates, outcomes });

  assert.strictEqual(coverage.totalCandidates, 5);
  assert.strictEqual(coverage.counts.resolved, 1);
  assert.strictEqual(coverage.counts.censored, 1);
  assert.strictEqual(coverage.counts.missing, 1);
  assert.strictEqual(coverage.counts.infraFailed, 2);

  // Percentages
  assert.strictEqual(coverage.percentages.resolvedPct, 20.0);
  assert.strictEqual(coverage.percentages.censoredPct, 20.0);
  assert.strictEqual(coverage.percentages.missingPct, 20.0);
  assert.strictEqual(coverage.percentages.infraFailedPct, 40.0);

  // Confidence score: (1 + 1) / 5 = 40.0%
  assert.strictEqual(coverage.confidenceScore, 40.0);
  assert.strictEqual(coverage.healthTier, HEALTH_TIERS.CRITICAL);
  assert.strictEqual(coverage.diagnostics.missingReasons.clockInconsistency, 1);
  assert.strictEqual(coverage.diagnostics.infraReasons.rpcThrottled, 1);
  assert.strictEqual(coverage.diagnostics.infraReasons.modelUnavailable, 1);
});

test('evaluateDataCoverage awards EXCELLENT tier when clean data passes 95% threshold', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    candidateId: `cand-clean-${i}`,
    mint: `MintClean${i}1111111111111111111111111111111`,
    slot: 285002000 + i,
    observedAtMs: 1726000000000 + i * 1000,
    decisionAtMs: 1726000000010 + i * 1000,
    featureSealHash: 'f'.repeat(64),
    microstructure: { buyerCount5m: 10 },
    curveState: { reserveDriftPct: 0.1 },
    evaluationDisposition: 'cleared',
  }));

  const outcomes = candidates.map(c => ({
    candidateId: c.candidateId,
    terminalState: 'take_profit',
    censored: false,
  }));

  const coverage = evaluateDataCoverage({ candidates, outcomes });

  assert.strictEqual(coverage.totalCandidates, 20);
  assert.strictEqual(coverage.counts.resolved, 20);
  assert.strictEqual(coverage.counts.missing, 0);
  assert.strictEqual(coverage.counts.infraFailed, 0);
  assert.strictEqual(coverage.confidenceScore, 100.0);
  assert.strictEqual(coverage.healthTier, HEALTH_TIERS.EXCELLENT);
});

test('evaluateDataCoverage flags DEGRADED when infra failures exceed 5% but missing is 0', () => {
  // 19 resolved, 1 infra failed -> 5% infraFailed
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    candidateId: `cand-${i}`,
    mint: `Mint${i}1111111111111111111111111111111111`,
    slot: 285003000 + i,
    observedAtMs: 1726000000000 + i * 1000,
    decisionAtMs: 1726000000010 + i * 1000,
    featureSealHash: '0'.repeat(64),
    microstructure: { buyerCount5m: 8 },
    curveState: { reserveDriftPct: 0.2 },
    evaluationDisposition: i === 0 ? 'rejected' : 'cleared',
    rejectionReason: i === 0 ? 'RPC rate limit 429' : null,
  }));

  // With 2 out of 20 infra failed (10%), it falls in DEGRADED
  candidates[1].evaluationDisposition = 'rejected';
  candidates[1].rejectionReason = 'RPC rate limit 429';

  const coverage = evaluateDataCoverage({ candidates, outcomes: [] });
  assert.strictEqual(coverage.counts.missing, 0);
  assert.strictEqual(coverage.counts.infraFailed, 2);
  assert.strictEqual(coverage.percentages.infraFailedPct, 10.0);
  assert.strictEqual(coverage.healthTier, HEALTH_TIERS.DEGRADED);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModelDisagreement, DISAGREEMENT_TYPES } from '../src/model-disagreement-eval.js';

test('evaluateModelDisagreement classifies candidates across 4 quadrants and fail-closed timeout', () => {
  const candidates = [
    // 1. Mutual Pass (Agreement): Deterministic pass, ML score 0.85 >= 0.70
    {
      candidateId: 'cand-pass-1',
      mint: 'MintMutualPass1111111111111111111111111111',
      slot: 285001000,
      evaluationDisposition: 'cleared',
      mlScore: 0.85,
      modelLatencyMs: 3.2,
      microstructure: { buyerCount5m: 10 },
      curveState: { reserveDriftPct: 0.1 },
      transport: { quoteAgeMs: 5 },
    },
    // 2. Mutual Reject (Agreement): Deterministic reject, ML score 0.25 < 0.70
    {
      candidateId: 'cand-reject-1',
      mint: 'MintMutualReject11111111111111111111111111',
      slot: 285001001,
      evaluationDisposition: 'rejected',
      rejectionReason: 'drift exceeded (+240 bps)',
      mlScore: 0.25,
      modelLatencyMs: 4.1,
      microstructure: { buyerCount5m: 2 },
      curveState: { reserveDriftPct: 2.4 },
      transport: { quoteAgeMs: 5 },
    },
    // 3. ML Filtered (Disagreement): Deterministic pass, ML score 0.45 < 0.70 (ML would reject)
    {
      candidateId: 'cand-ml-filtered-1',
      mint: 'MintMlFiltered1111111111111111111111111111',
      slot: 285001002,
      evaluationDisposition: 'cleared',
      mlScore: 0.45,
      modelLatencyMs: 2.8,
      microstructure: { buyerCount5m: 6 },
      curveState: { reserveDriftPct: 0.2 },
      transport: { quoteAgeMs: 4 },
    },
    // 4. ML Opportunity (Disagreement): Deterministic reject, ML score 0.92 >= 0.70 (ML sees upside)
    {
      candidateId: 'cand-ml-opp-1',
      mint: 'MintMlOpp1111111111111111111111111111111111',
      slot: 285001003,
      evaluationDisposition: 'rejected',
      rejectionReason: 'curve completion cap (>95%)',
      mlScore: 0.92,
      modelLatencyMs: 5.0,
      microstructure: { buyerCount5m: 25 },
      curveState: { reserveDriftPct: 0.1 },
      transport: { quoteAgeMs: 6 },
    },
    // 5. Model Unavailable (Fail-closed): Inference latency > 10ms
    {
      candidateId: 'cand-timeout-1',
      mint: 'MintTimeout11111111111111111111111111111111',
      slot: 285001004,
      evaluationDisposition: 'modelUnavailable',
      rejectionReason: 'modelUnavailable timeout',
      mlScore: 0.88,
      modelLatencyMs: 14.5, // Exceeds 10ms cap!
      microstructure: { buyerCount5m: 15 },
      curveState: { reserveDriftPct: 0.1 },
      transport: { quoteAgeMs: 4 },
    },
  ];

  const evalResult = evaluateModelDisagreement({
    candidates,
    shadowThreshold: 0.70,
    latencyCapMs: 10.0,
  });

  assert.strictEqual(evalResult.totalEvaluated, 5);
  assert.strictEqual(evalResult.quadrants.mutualPass.count, 1);
  assert.strictEqual(evalResult.quadrants.mutualReject.count, 1);
  assert.strictEqual(evalResult.quadrants.mlFiltered.count, 1);
  assert.strictEqual(evalResult.quadrants.mlOpportunity.count, 1);
  assert.strictEqual(evalResult.quadrants.modelUnavailable.count, 1);

  // Rates: 2 agreements / 5 = 40.0%, 2 disagreements / 5 = 40.0%
  assert.strictEqual(evalResult.agreementRatePct, 40.0);
  assert.strictEqual(evalResult.disagreementRatePct, 40.0);

  // Latency & Deadline
  assert.strictEqual(evalResult.latencyStats.deadlineBreaches, 1);
  assert.strictEqual(evalResult.latencyStats.maxMs, 14.5);
  assert.strictEqual(evalResult.featureCompletenessPct, 100.0);

  // Check candidate dispositions
  const timeoutCand = evalResult.comparisons.find(c => c.candidateId === 'cand-timeout-1');
  assert.strictEqual(timeoutCand.disagreementType, DISAGREEMENT_TYPES.MODEL_UNAVAILABLE);
  assert.strictEqual(timeoutCand.finalDisposition, 'modelUnavailable');
  assert.strictEqual(timeoutCand.latencyBreached, true);
});

test('evaluateModelDisagreement defaults gracefully when candidates array is empty', () => {
  const evalResult = evaluateModelDisagreement({ candidates: [] });
  assert.strictEqual(evalResult.totalEvaluated, 0);
  assert.strictEqual(evalResult.agreementRatePct, 100.0);
  assert.strictEqual(evalResult.disagreementRatePct, 0.0);
  assert.strictEqual(evalResult.latencyStats.deadlineBreaches, 0);
});

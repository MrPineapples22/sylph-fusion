/**
 * Model Disagreement & Shadow Evaluation Engine
 *
 * Compares deterministic gate verdicts against shadow ML scores without any execution control:
 * - 4-Quadrant Confusion / Disagreement Matrix:
 *   1. Mutual Pass (Agreement): Both deterministic and shadow ML passed.
 *   2. Mutual Reject (Agreement): Both deterministic and shadow ML rejected.
 *   3. ML Filtered (Disagreement): Deterministic passed, shadow ML rejected (potential filter alpha).
 *   4. ML Opportunity (Disagreement): Deterministic rejected, shadow ML scored high (potential false negative).
 * - Fail-closed tracking: Captures modelUnavailable occurrences and latency breaches (>10ms cap).
 */

export const DISAGREEMENT_TYPES = {
  MUTUAL_PASS: 'MUTUAL_PASS',
  MUTUAL_REJECT: 'MUTUAL_REJECT',
  ML_FILTERED: 'ML_FILTERED',
  ML_OPPORTUNITY: 'ML_OPPORTUNITY',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
};

export function evaluateModelDisagreement({
  candidates = [],
  shadowThreshold = 0.70,
  latencyCapMs = 10.0,
} = {}) {
  let mutualPassCount = 0;
  let mutualRejectCount = 0;
  let mlFilteredCount = 0;
  let mlOpportunityCount = 0;
  let modelUnavailableCount = 0;

  const latencies = [];
  let totalFeaturesExpected = 0;
  let totalFeaturesPresent = 0;

  const candidateComparisons = [];

  for (const c of candidates) {
    const candId = c.candidateId || c.id || c.mint;
    const isDeterministicPass = c.evaluationDisposition === 'cleared' ||
      c.disposition === 'cleared' ||
      c.status === 'filled' ||
      (!c.rejectionReason && c.drift?.passed);

    const deterministicVerdict = isDeterministicPass ? 'PASS' : 'REJECT';

    // Model telemetry
    const isExplicitUnavailable = c.evaluationDisposition === 'modelUnavailable' ||
      c.modelUnavailable === true ||
      c.rejectionReason?.toLowerCase().includes('modelunavailable');

    const latencyMs = c.modelLatencyMs ?? c.inferenceLatencyMs ?? null;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) latencies.push(latencyMs);

    const latencyBreached = latencyMs > latencyCapMs;
    const isTimedOut = latencyBreached || isExplicitUnavailable;

    // Feature completeness check
    const requiredFeatureKeys = ['microstructure', 'curveState', 'transport'];
    let featuresPresent = 0;
    for (const k of requiredFeatureKeys) {
      if (c[k] || (k === 'microstructure' && c.buyers) || (k === 'curveState' && c.curve)) {
        featuresPresent++;
      }
    }
    totalFeaturesExpected += requiredFeatureKeys.length;
    totalFeaturesPresent += featuresPresent;

    const rawScore = c.mlScore ?? c.modelPrediction?.score;
    const mlScore = Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 1 ? rawScore : null;
    const missingMeasurement = mlScore === null || !Number.isFinite(latencyMs) || latencyMs < 0;

    let mlStatus = 'REJECT';
    let type = DISAGREEMENT_TYPES.MUTUAL_REJECT;
    let disposition = c.evaluationDisposition || (isDeterministicPass ? 'accepted_paper' : 'rejected');

    if (isTimedOut || missingMeasurement) {
      mlStatus = 'UNAVAILABLE';
      type = DISAGREEMENT_TYPES.MODEL_UNAVAILABLE;
      modelUnavailableCount++;
      disposition = 'modelUnavailable';
    } else if (mlScore >= shadowThreshold) {
      mlStatus = 'PASS';
      if (isDeterministicPass) {
        type = DISAGREEMENT_TYPES.MUTUAL_PASS;
        mutualPassCount++;
      } else {
        type = DISAGREEMENT_TYPES.ML_OPPORTUNITY;
        mlOpportunityCount++;
      }
    } else {
      mlStatus = 'REJECT';
      if (isDeterministicPass) {
        type = DISAGREEMENT_TYPES.ML_FILTERED;
        mlFilteredCount++;
      } else {
        type = DISAGREEMENT_TYPES.MUTUAL_REJECT;
        mutualRejectCount++;
      }
    }

    candidateComparisons.push({
      candidateId: candId,
      mint: c.mint,
      slot: c.slot,
      deterministicVerdict,
      mlScore: mlScore === null ? null : Number(mlScore.toFixed(3)),
      mlStatus,
      disagreementType: type,
      finalDisposition: disposition,
      rejectionReason: c.rejectionReason || null,
      latencyMs: Number.isFinite(latencyMs) ? Number(latencyMs.toFixed(2)) : null,
      latencyBreached,
      featuresComplete: featuresPresent === requiredFeatureKeys.length,
    });
  }

  const total = candidates.length;
  const agreementCount = mutualPassCount + mutualRejectCount;
  const disagreementCount = mlFilteredCount + mlOpportunityCount;

  const agreementRatePct = total > 0 ? Number(((agreementCount / total) * 100).toFixed(1)) : 100.0;
  const disagreementRatePct = total > 0 ? Number(((disagreementCount / total) * 100).toFixed(1)) : 0.0;

  // Latency metrics
  latencies.sort((a, b) => a - b);
  const meanLatencyMs = latencies.length > 0
    ? Number((latencies.reduce((acc, v) => acc + v, 0) / latencies.length).toFixed(2))
    : 0;
  const p95LatencyMs = latencies.length > 0
    ? Number(latencies[Math.floor(latencies.length * 0.95)]?.toFixed(2) || '0')
    : 0;
  const maxLatencyMs = latencies.length > 0
    ? Number(latencies[latencies.length - 1].toFixed(2))
    : 0;
  const deadlineBreaches = latencies.filter(l => l > latencyCapMs).length;

  const featureCompletenessPct = totalFeaturesExpected > 0
    ? Number(((totalFeaturesPresent / totalFeaturesExpected) * 100).toFixed(1))
    : 100.0;

  return {
    totalEvaluated: total,
    shadowThreshold,
    latencyCapMs,
    quadrants: {
      mutualPass: {
        count: mutualPassCount,
        pct: total > 0 ? Number(((mutualPassCount / total) * 100).toFixed(1)) : 0,
        label: 'MUTUAL PASS (AGREEMENT)',
        desc: 'Both deterministic safety rules and shadow model approved the candidate.',
      },
      mutualReject: {
        count: mutualRejectCount,
        pct: total > 0 ? Number(((mutualRejectCount / total) * 100).toFixed(1)) : 0,
        label: 'MUTUAL REJECT (AGREEMENT)',
        desc: 'Both deterministic safety rules and shadow model rejected adverse candidate.',
      },
      mlFiltered: {
        count: mlFilteredCount,
        pct: total > 0 ? Number(((mlFilteredCount / total) * 100).toFixed(1)) : 0,
        label: 'SHADOW ML FILTER (DISAGREEMENT)',
        desc: 'Candidate met deterministic entry gates, but shadow ML scored below threshold.',
      },
      mlOpportunity: {
        count: mlOpportunityCount,
        pct: total > 0 ? Number(((mlOpportunityCount / total) * 100).toFixed(1)) : 0,
        label: 'SHADOW ML OPPORTUNITY (DISAGREEMENT)',
        desc: 'Deterministic hard filter blocked candidate, but shadow ML detected strong signal.',
      },
      modelUnavailable: {
        count: modelUnavailableCount,
        pct: total > 0 ? Number(((modelUnavailableCount / total) * 100).toFixed(1)) : 0,
        label: 'MODEL UNAVAILABLE (FAIL-CLOSED)',
        desc: 'Inference timed out (>10ms), aborted, or errored; entry strictly rejected.',
      },
    },
    agreementRatePct,
    disagreementRatePct,
    latencyStats: {
      meanMs: meanLatencyMs,
      p95Ms: p95LatencyMs,
      maxMs: maxLatencyMs,
      deadlineBreaches,
    },
    featureCompletenessPct,
    comparisons: candidateComparisons,
  };
}

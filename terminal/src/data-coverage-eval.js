/**
 * Data-Quality & Candidate Coverage Evaluator
 *
 * Categorizes all candidate records into four mutually exclusive classes:
 * 1. Resolved: Completed terminal trade/observation (TP fill, stop-loss, terminal curve state).
 * 2. Censored: Right-censored (active position at cutoff, observation window cut off).
 * 3. Missing: Malformed records (missing fields, clock non-monotonicity, unsealed snapshots).
 * 4. Infra-Failed: Infrastructure drops (RPC 429 throttling, drop rate limits, modelUnavailable).
 */

export const HEALTH_TIERS = {
  EXCELLENT: 'EXCELLENT',
  DEGRADED: 'DEGRADED',
  CRITICAL: 'CRITICAL',
};

export function evaluateDataCoverage({
  candidates = [],
  outcomes = [],
  rpcStats = null,
} = {}) {
  const outcomesByCandId = new Map();
  for (const o of outcomes) {
    if (o.candidateId) outcomesByCandId.set(o.candidateId, o);
    if (o.mint) outcomesByCandId.set(o.mint, o);
  }

  let resolvedCount = 0;
  let censoredCount = 0;
  let missingCount = 0;
  let infraFailedCount = 0;

  const missingReasons = {
    clockInconsistency: 0,
    missingMicrostructure: 0,
    missingCurveState: 0,
    unsealedFeatureSnapshot: 0,
    invalidSlot: 0,
  };

  const infraReasons = {
    rpcThrottled: 0,
    modelUnavailable: 0,
    transportTimeout: 0,
    feedStale: 0,
  };

  const classifiedCandidates = [];

  for (const c of candidates) {
    const candId = c.candidateId || c.id || c.mint;
    const outcome = outcomesByCandId.get(candId) || outcomesByCandId.get(c.mint);

    // 1. Check for missing / malformed records first
    const hasClockInconsistency = c.observedAtMs && c.decisionAtMs && c.decisionAtMs < c.observedAtMs;
    const missingMicro = !c.microstructure && !c.buyers;
    const missingCurve = !c.curveState && !c.curve;
    const unsealed = c.featureSealHash ? c.featureSealHash.length !== 64 : false;
    const invalidSlot = c.slot !== undefined && c.slot <= 0;

    if (hasClockInconsistency || missingMicro || missingCurve || unsealed || invalidSlot) {
      missingCount++;
      if (hasClockInconsistency) missingReasons.clockInconsistency++;
      if (missingMicro) missingReasons.missingMicrostructure++;
      if (missingCurve) missingReasons.missingCurveState++;
      if (unsealed) missingReasons.unsealedFeatureSnapshot++;
      if (invalidSlot) missingReasons.invalidSlot++;

      classifiedCandidates.push({
        candidateId: candId,
        mint: c.mint,
        slot: c.slot,
        classification: 'missing',
        reason: hasClockInconsistency
          ? 'Clock non-monotonicity (decisionAtMs < observedAtMs)'
          : unsealed
          ? 'Malformed feature seal hash'
          : invalidSlot
          ? 'Invalid slot identifier (<=0)'
          : 'Missing mandatory candidate feature fields',
      });
      continue;
    }

    // 2. Check for infrastructure failures
    const isModelUnavailable = c.evaluationDisposition === 'modelUnavailable' ||
      c.modelUnavailable ||
      c.rejectionReason?.toLowerCase().includes('modelunavailable') ||
      c.rejectionReason?.toLowerCase().includes('model timeout');

    const isRpcThrottled = c.rejectionReason?.toLowerCase().includes('rate limit') ||
      c.rejectionReason?.toLowerCase().includes('429') ||
      c.rejectionReason?.toLowerCase().includes('rpc drops');

    const isTransportTimeout = c.rejectionReason?.toLowerCase().includes('timeout') ||
      c.rejectionReason?.toLowerCase().includes('transport drop');

    const isFeedStale = c.rejectionReason?.toLowerCase().includes('stale') ||
      c.rejectionReason?.toLowerCase().includes('feed lag');

    if (isModelUnavailable || isRpcThrottled || isTransportTimeout || isFeedStale) {
      infraFailedCount++;
      if (isModelUnavailable) infraReasons.modelUnavailable++;
      if (isRpcThrottled) infraReasons.rpcThrottled++;
      if (isTransportTimeout) infraReasons.transportTimeout++;
      if (isFeedStale) infraReasons.feedStale++;

      classifiedCandidates.push({
        candidateId: candId,
        mint: c.mint,
        slot: c.slot,
        classification: 'infraFailed',
        reason: isModelUnavailable
          ? 'Fail-closed modelUnavailable timeout (>10ms)'
          : isRpcThrottled
          ? 'RPC 429 rate limit exceeded'
          : isFeedStale
          ? 'Feed stale latency breach'
          : 'Transport timeout / cluster lag',
      });
      continue;
    }

    // 3. Check for right-censoring
    const isCensored = Boolean(outcome?.censored) ||
      Boolean(c.censored) ||
      (outcome && outcome.terminalState === 'censored') ||
      (c.evaluationDisposition === 'cleared' && !outcome);

    if (isCensored) {
      censoredCount++;
      classifiedCandidates.push({
        candidateId: candId,
        mint: c.mint,
        slot: c.slot,
        classification: 'censored',
        reason: 'Observation window cut off before terminal resolution',
      });
      continue;
    }

    // 4. Otherwise, candidate is resolved (either through market rejection, take-profit, or stop-loss)
    resolvedCount++;
    classifiedCandidates.push({
      candidateId: candId,
      mint: c.mint,
      slot: c.slot,
      classification: 'resolved',
      reason: outcome ? `Resolved trade (${outcome.terminalState || 'fill'})` : `Resolved market filter (${c.rejectionReason || 'evaluated'})`,
    });
  }

  const total = candidates.length;
  const resolvedPct = total > 0 ? Number(((resolvedCount / total) * 100).toFixed(1)) : 0;
  const censoredPct = total > 0 ? Number(((censoredCount / total) * 100).toFixed(1)) : 0;
  const missingPct = total > 0 ? Number(((missingCount / total) * 100).toFixed(1)) : 0;
  const infraFailedPct = total > 0 ? Number(((infraFailedCount / total) * 100).toFixed(1)) : 0;

  // Coverage diagnostic score: heuristic operational metric representing share of valid candidate telemetry
  const validCount = resolvedCount + censoredCount;
  const coverageDiagnosticScore = total > 0 ? Number(((validCount / total) * 100).toFixed(1)) : 100.0;
  const coverageConfidenceScore = coverageDiagnosticScore; // Alias for backwards compatibility

  // Health tier classification
  let healthTier = HEALTH_TIERS.EXCELLENT;
  let statusMessage = `Coverage diagnostic: ${coverageDiagnosticScore}% (${resolvedCount} resolved, ${censoredCount} censored, ${infraFailedCount} infra, ${missingCount} missing).`;

  if (missingCount > 0 || coverageDiagnosticScore < 80.0 || infraFailedPct > 15.0) {
    healthTier = HEALTH_TIERS.CRITICAL;
    statusMessage = missingCount > 0
      ? `CRITICAL: ${missingCount} candidates have missing or malformed feature snapshots.`
      : `CRITICAL: High infrastructure failure rate (${infraFailedPct}%) degrades sample integrity.`;
  } else if (coverageDiagnosticScore < 95.0 || infraFailedPct > 5.0) {
    healthTier = HEALTH_TIERS.DEGRADED;
    statusMessage = `DEGRADED: Infrastructure failures (${infraFailedPct}%) exceed the 5% clean soak threshold.`;
  }

  return {
    totalCandidates: total,
    counts: {
      resolved: resolvedCount,
      censored: censoredCount,
      missing: missingCount,
      infraFailed: infraFailedCount,
    },
    percentages: {
      resolvedPct,
      censoredPct,
      missingPct,
      infraFailedPct,
    },
    confidenceScore: coverageConfidenceScore,
    coverageDiagnosticScore,
    metricType: 'coverage_diagnostic_heuristic',
    isHeuristic: true,
    healthTier,
    statusMessage,
    diagnostics: {
      missingReasons,
      infraReasons,
      rpcDropRatePct: rpcStats?.rateLimitPct ?? (infraFailedPct > 0 ? infraFailedPct : 0),
    },
    candidates: classifiedCandidates,
  };
}

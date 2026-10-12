export function buildLandingLaneResearchResponse(scorecards, minimumEvidenceThresholdAttempts) {
  const rows = Array.isArray(scorecards) ? scorecards : [];
  return {
    ok: true,
    evidenceStatus: rows.length > 0 ? 'UNVERIFIED_LOCAL_OBSERVATIONS' : 'NO_OBSERVATIONS',
    sourceConnection: 'IN_MEMORY_SCORECARD_ONLY',
    minimumEvidenceThresholdAttempts,
    scorecards: rows,
    authority: 'RESEARCH_ONLY_NO_LANE_SELECTION_AUTHORITY',
    invariant: 'ACK != LANDED. Signature returned != LANDED. Only Terminality Authority decides terminality.',
  };
}

export function buildRunnerSearchCostUnavailableResponse() {
  return {
    ok: true,
    evidenceStatus: 'UNAVAILABLE',
    report: null,
    reason: 'SOURCE_ATTRIBUTED_OUTCOMES_NOT_CONNECTED',
    authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY',
  };
}

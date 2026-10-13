const VALID_STATUSES = new Set(['NO_OBSERVATIONS', 'UNVERIFIED_LOCAL_OBSERVATIONS']);

export function parseLandingLaneResearchResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {status: 'UNAVAILABLE', scorecards: [], error: 'The landing-lane endpoint returned an invalid response.'};
  }
  if (value.ok !== true || value.sourceConnection !== 'IN_MEMORY_SCORECARD_ONLY'
    || value.authority !== 'RESEARCH_ONLY_NO_LANE_SELECTION_AUTHORITY'
    || !Number.isSafeInteger(value.minimumEvidenceThresholdAttempts) || value.minimumEvidenceThresholdAttempts < 1
    || !VALID_STATUSES.has(value.evidenceStatus) || !Array.isArray(value.scorecards)) {
    return {status: 'UNAVAILABLE', scorecards: [], error: 'The endpoint did not identify its evidence source and status; scorecard values are hidden.'};
  }
  if (value.evidenceStatus === 'NO_OBSERVATIONS') {
    if (value.scorecards.length !== 0) {
      return {status: 'UNAVAILABLE', scorecards: [], error: 'The endpoint marked observations absent but returned scorecard rows.'};
    }
    return {status: 'NO_OBSERVATIONS', scorecards: [], error: null};
  }
  const scorecards = value.scorecards;
  const seenLaneIds = new Set();
  const malformed = scorecards.some(card => {
    if (!card || typeof card !== 'object' || Array.isArray(card)
      || typeof card.laneId !== 'string' || card.laneId.length === 0 || card.laneId.length > 80
      || seenLaneIds.has(card.laneId)
      || !Number.isSafeInteger(card.resolvedAttempts) || card.resolvedAttempts < 1
      || !Number.isFinite(card.landingRate) || card.landingRate < 0 || card.landingRate > 1
      || !Number.isFinite(card.p95LandingMs) || card.p95LandingMs < 0
      || !Number.isFinite(card.averageFeeUsd) || card.averageFeeUsd < 0
      || !Number.isFinite(card.averageTipUsd) || card.averageTipUsd < 0
      || typeof card.eligibleForOptimization !== 'boolean') return true;
    seenLaneIds.add(card.laneId);
    const expectedEligibility = card.resolvedAttempts >= value.minimumEvidenceThresholdAttempts && card.landingRate >= 0.70;
    return card.eligibleForOptimization !== expectedEligibility;
  });
  if (malformed) {
    return {status: 'UNAVAILABLE', scorecards: [], error: 'One or more lane rows are malformed; all scorecard values are hidden.'};
  }
  return {status: 'UNVERIFIED_LOCAL_OBSERVATIONS', scorecards, error: null};
}

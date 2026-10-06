export function readSoakSessionEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    gatePassed: typeof value.gatePassed === 'boolean' ? value.gatePassed : null,
    rateLimitPct: typeof value.rateLimitPct === 'number' && Number.isFinite(value.rateLimitPct) && value.rateLimitPct >= 0
      ? value.rateLimitPct
      : null,
    failedRpcCount: Number.isSafeInteger(value.failedRpcCount) && value.failedRpcCount >= 0
      ? value.failedRpcCount
      : null,
    alert: typeof value.alert === 'string' && value.alert.trim() ? value.alert : null,
  };
}

export function getSoakSessionGateLabel(gatePassed) {
  if (gatePassed === true) return 'PASSED · SESSION RESULT';
  if (gatePassed === false) return 'BLOCKED · SESSION RESULT';
  return 'UNVERIFIED';
}

export function readSoakQualityScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export const FLIGHT_RECORDER_STAGES = Object.freeze([
  'DISCOVERED', 'FILTER_EVALUATED', 'DECISION_CREATED', 'QUOTE_CAPTURED',
  'BUILD_STARTED', 'BUILD_COMPLETED', 'SIMULATED', 'AUTHORIZED', 'SIGNED',
  'SUBMITTED', 'ACKNOWLEDGED', 'UNKNOWN', 'LANDED_SUCCESS', 'LANDED_FAILURE',
  'NOLAND', 'FINALIZED', 'SETTLED', 'OUTCOME_MATURE',
]);

const keyOf = record => `${record.economicFactId}\u0000${record.executionGenerationId}`;

export function parseFlightRecorderResponse(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.attempts)) {
    return { status: 'UNKNOWN', revisions: [] };
  }

  const revisions = data.attempts;
  if (!Number.isSafeInteger(data.revisionCount) || data.revisionCount !== revisions.length) {
    return { status: 'UNKNOWN', revisions: [] };
  }
  if (revisions.some(record => !record || typeof record !== 'object'
    || typeof record.economicFactId !== 'string' || record.economicFactId.length === 0
    || typeof record.executionGenerationId !== 'string' || record.executionGenerationId.length === 0
    || !Number.isSafeInteger(record.revision) || record.revision < 0
    || !FLIGHT_RECORDER_STAGES.includes(record.stage))) {
    return { status: 'UNKNOWN', revisions: [] };
  }

  if (data.recordStatus === 'EMPTY' && revisions.length === 0) {
    return { status: 'EMPTY', revisions };
  }
  if (data.recordStatus === 'RECORDED' && revisions.length > 0) {
    return { status: 'RECORDED', revisions };
  }
  return { status: 'UNKNOWN', revisions: [] };
}

export function latestFlightRecords(records = []) {
  const latest = new Map();
  for (const record of records) {
    const key = keyOf(record);
    const previous = latest.get(key);
    if (!previous || Number(record.revision) > Number(previous.revision)) latest.set(key, record);
  }
  return [...latest.values()];
}

export function revisionsForFlight(records = [], selected) {
  if (!selected) return [];
  return records
    .filter(record => record.economicFactId === selected.economicFactId && record.executionGenerationId === selected.executionGenerationId)
    .slice()
    .sort((a, b) => Number(a.revision) - Number(b.revision));
}

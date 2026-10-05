export const FLIGHT_RECORDER_STAGES = Object.freeze([
  'DISCOVERED', 'FILTER_EVALUATED', 'DECISION_CREATED', 'QUOTE_CAPTURED',
  'BUILD_STARTED', 'BUILD_COMPLETED', 'SIMULATED', 'AUTHORIZED', 'SIGNED',
  'SUBMITTED', 'ACKNOWLEDGED', 'UNKNOWN', 'LANDED_SUCCESS', 'LANDED_FAILURE',
  'NOLAND', 'FINALIZED', 'SETTLED', 'OUTCOME_MATURE',
]);

const keyOf = record => `${record.economicFactId}\u0000${record.executionGenerationId}`;

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

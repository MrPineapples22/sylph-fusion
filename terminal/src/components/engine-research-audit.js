export const ENGINE_RESEARCH_AUDIT_EVENTS = Object.freeze([
  'candidate_discovered_v1',
  'candidate_tracking_ended_v1',
  'candidate_restriction_v1',
  'candidate_entry_gates_passed_v1',
  'candidate_submission_blocked_v1',
  'candidate_order_build_started_v1',
  'candidate_order_build_failed_v1',
  'candidate_order_built_v1',
  'candidate_order_build_abandoned_v1',
  'candidate_paper_fill_v1',
]);

const FIELD_NAMES = new Set([
  'candidateGenerationId', 'candidateId', 'attemptId', 'attemptNumber', 'mint', 'side', 'requestedAmountRaw',
  'requestedAmountUnit', 'quotedOutputUnit',
  'slot', 'signature', 'sourceObservationId', 'snapshotId', 'observedAtMs',
  'chainCreatedAtMs', 'decisionAtMs', 'blockedAtMs', 'blockReason', 'requestedLamports',
  'requestedAmountLamports', 'startedAtMs', 'marketSnapshotAtMs', 'failedAtMs',
  'failureClass', 'pendingOrderId', 'builtAtMs', 'quotedOutput', 'quoteTimestampMs', 'quoteAgeMs',
  'scope', 'effect', 'reasonCode',
  'baseFeeLamports', 'priorityFeeLamports', 'jitoTipLamports', 'rentLamports', 'slippageLamports',
  'estimatedSellSlippageLamports', 'slippageBps', 'modeledSlippageBps', 'costEvidenceClass',
  'marketSnapshotAgeMs',
  'abandonedAtMs', 'reason', 'settledAtMs', 'simulatedLamportDelta', 'executionAuthority',
  'outcomeEvidenceClass', 'endedAtMs', 'lastObservedSlot', 'outcomeStatus',
]);
const REQUIRED_IDENTITY_FIELDS = Object.freeze({
  candidate_discovered_v1: ['mint', 'candidateId'],
  candidate_tracking_ended_v1: ['mint', 'candidateGenerationId'],
  candidate_restriction_v1: ['mint', 'candidateGenerationId'],
  candidate_entry_gates_passed_v1: ['mint', 'candidateGenerationId', 'attemptId'],
  candidate_submission_blocked_v1: ['mint', 'candidateGenerationId'],
  candidate_order_build_started_v1: ['mint', 'candidateGenerationId', 'attemptId'],
  candidate_order_build_failed_v1: ['mint', 'candidateGenerationId', 'attemptId'],
  candidate_order_built_v1: ['mint', 'candidateGenerationId', 'attemptId'],
  candidate_order_build_abandoned_v1: ['mint', 'candidateGenerationId', 'attemptId'],
  candidate_paper_fill_v1: ['mint', 'candidateGenerationId', 'attemptId'],
});
const BUILD_FAILURE_CLASSES = new Set([
  'STALE_MARKET_SNAPSHOT', 'ENTRY_DISABLED_AFTER_GRADUATION', 'ROUTE_NOT_CONFIGURED',
  'QUOTE_REJECTED', 'ROUTE_ASSEMBLY_REJECTED', 'LOCAL_QUOTE_INPUT_INVALID', 'UNCLASSIFIED_BUILD_FAILURE',
]);
const CANDIDATE_TRACKING_END_REASONS = new Set([
  'INVALID_CHAIN_TIMESTAMP', 'FUTURE_CHAIN_TIMESTAMP', 'STALE_AT_DISCOVERY',
  'TRACKING_CAPACITY_EVICTION', 'MAX_AGE_EXPIRED',
]);
const RESTRICTION_SCOPES = new Set(['ACTOR', 'VENUE', 'MARKET', 'STRATEGY', 'PORTFOLIO', 'EXECUTION', 'MODEL', 'SYSTEM']);
const RESTRICTION_EFFECTS = new Set(['WAIT', 'QUARANTINE', 'BLOCK_NEW_ENTRY']);
const RESTRICTION_REASON_CODES = new Set([
  'insufficient_buyers', 'insufficient_buy_volume_ratio', 'CURVE_COMPLETED', 'ZERO_RESERVES',
  'EXCESSIVE_LIQUIDITY_DROP', 'EXCESSIVE_PRICE_DRIFT', 'reserve_drift', 'curve_complete_transition',
  'mayhem_mode', 'developer_disposition_unverified', 'feed_unhealthy', 'engine_stopped',
  'insufficient_cash_or_reserve', 'reconciliation_blocked', 'entry_guard_rejected',
  'capital_barrier_denied', 'model_rejected', 'candidate_evaluation_error', 'other',
  'TRUTH_DEBT_BREACH', 'MAX_DRAWDOWN_BREACH', 'DAILY_LOSS_BREACH', 'CLUSTER_EXPOSURE_BREACH',
  'ROUTE_SATURATION_BREACH', 'ZERO_STRESSED_EXIT_CAPACITY', 'ECONOMIC_MINIMUM_UNMET',
]);
const LAMPORT_STRING_FIELDS = new Set([
  'quotedOutput', 'requestedLamports', 'requestedAmountLamports', 'requestedAmountRaw',
  'baseFeeLamports', 'priorityFeeLamports', 'jitoTipLamports', 'rentLamports', 'slippageLamports',
  'estimatedSellSlippageLamports',
]);
const SIGNED_LAMPORT_STRING_FIELDS = new Set(['simulatedLamportDelta']);

const unknown = () => ({status: 'UNKNOWN', events: [], returnedEventCount: 0, invalidEventCount: 0, truncated: false,
  knownPrunedAuditRows: null, researchEvidenceLossMarker: 'UNAVAILABLE'});

function validFields(value, eventType) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, field] of Object.entries(value)) {
    if (!FIELD_NAMES.has(key)) return false;
    if (typeof field === 'string' && field.length <= 256) {
      if (LAMPORT_STRING_FIELDS.has(key) && !/^(?:0|[1-9][0-9]*)$/.test(field)) return false;
      if (SIGNED_LAMPORT_STRING_FIELDS.has(key) && !/^(?:0|-?[1-9][0-9]*)$/.test(field)) return false;
      continue;
    }
    if (typeof field === 'number' && Number.isSafeInteger(field)) continue;
    if (typeof field === 'boolean' || field === null) continue;
    return false;
  }
  if (Object.hasOwn(value, 'failureClass') && !BUILD_FAILURE_CLASSES.has(value.failureClass)) return false;
  if (Object.hasOwn(value, 'scope') && !RESTRICTION_SCOPES.has(value.scope)) return false;
  if (Object.hasOwn(value, 'effect') && !RESTRICTION_EFFECTS.has(value.effect)) return false;
  if (Object.hasOwn(value, 'reasonCode') && !RESTRICTION_REASON_CODES.has(value.reasonCode)) return false;
  if (eventType === 'candidate_restriction_v1' && Object.hasOwn(value, 'reason')) return false;
  for (const key of ['requestedAmountUnit', 'quotedOutputUnit']) {
    if (Object.hasOwn(value, key) && !['LAMPORTS', 'TOKEN_RAW'].includes(value[key])) return false;
  }
  if (Object.hasOwn(value, 'side')) {
    const expectedInputUnit = value.side === 'buy' ? 'LAMPORTS' : value.side === 'sell' ? 'TOKEN_RAW' : null;
    const expectedOutputUnit = value.side === 'buy' ? 'TOKEN_RAW' : value.side === 'sell' ? 'LAMPORTS' : null;
    if ((value.requestedAmountUnit && value.requestedAmountUnit !== expectedInputUnit) ||
        (value.quotedOutputUnit && value.quotedOutputUnit !== expectedOutputUnit)) return false;
  }
  if (Object.hasOwn(value, 'slippageBps') &&
      (!Number.isSafeInteger(value.slippageBps) || value.slippageBps < 0 || value.slippageBps > 10_000)) return false;
  if (Object.hasOwn(value, 'modeledSlippageBps') &&
      (!Number.isSafeInteger(value.modeledSlippageBps) || value.modeledSlippageBps < 0 || value.modeledSlippageBps > 10_000)) return false;
  for (const key of ['marketSnapshotAgeMs', 'quoteAgeMs']) {
    if (Object.hasOwn(value, key) && (!Number.isSafeInteger(value[key]) || value[key] < 0)) return false;
  }
  if (Object.hasOwn(value, 'costEvidenceClass') &&
      !((eventType === 'candidate_order_built_v1' && value.costEvidenceClass === 'PAPER_BUILD_ESTIMATE') ||
        (eventType === 'candidate_paper_fill_v1' && value.costEvidenceClass === 'PAPER_SIMULATED_FILL'))) return false;
  if (eventType === 'candidate_tracking_ended_v1' &&
      (!CANDIDATE_TRACKING_END_REASONS.has(value.reason) || value.outcomeStatus !== 'UNRESOLVED'
       || !Number.isSafeInteger(value.endedAtMs) || value.endedAtMs < 0)) return false;
  return true;
}

export function parseEngineResearchAuditResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.source !== 'ENGINE_AUDIT_STORE'
    || data.completeness !== 'UNKNOWN' || !Array.isArray(data.events)
    || !Number.isSafeInteger(data.returnedEventCount) || data.returnedEventCount !== data.events.length
    || data.events.length > 250 || typeof data.truncated !== 'boolean'
    || !Number.isSafeInteger(data.invalidEventCount) || data.invalidEventCount < 0
    || data.invalidEventCount > data.returnedEventCount
    || !(data.knownPrunedAuditRows === null || (Number.isSafeInteger(data.knownPrunedAuditRows) && data.knownPrunedAuditRows >= 0))
    || !['RECORDED', 'NONE_RECORDED', 'INVALID', 'UNAVAILABLE'].includes(data.researchEvidenceLossMarker)) return unknown();

  if ((data.recordStatus === 'UNKNOWN' && data.ok !== false)
    || (data.recordStatus !== 'UNKNOWN' && data.ok !== true)
    || (data.truncated && data.events.length !== 250)) return unknown();

  const valid = data.events.every(event => event && typeof event === 'object' && !Array.isArray(event)
    && typeof event.sequence === 'string' && /^\d{1,20}$/.test(event.sequence)
    && Number.isSafeInteger(event.recordedAtMs) && event.recordedAtMs >= 0 && event.recordedAtMs <= 8_640_000_000_000_000
    && ENGINE_RESEARCH_AUDIT_EVENTS.includes(event.eventType)
    && ['PROJECTABLE', 'UNPROJECTABLE'].includes(event.payloadStatus)
    && validFields(event.fields, event.eventType)
    && (event.payloadStatus !== 'UNPROJECTABLE' || Object.keys(event.fields).length === 0)
    && (event.payloadStatus !== 'PROJECTABLE' || REQUIRED_IDENTITY_FIELDS[event.eventType].every(key =>
      typeof event.fields[key] === 'string' && event.fields[key].trim().length > 0)));
  if (!valid || data.invalidEventCount !== data.events.filter(event => event.payloadStatus === 'UNPROJECTABLE').length
    || (data.recordStatus === 'EMPTY' && data.events.length !== 0)
    || (data.recordStatus === 'RECORDED' && data.events.length === 0)
    || !['EMPTY', 'RECORDED', 'UNKNOWN'].includes(data.recordStatus)) return unknown();

  return {
    status: data.recordStatus,
    events: data.events,
    returnedEventCount: data.returnedEventCount,
    invalidEventCount: data.invalidEventCount,
    truncated: data.truncated,
    knownPrunedAuditRows: data.knownPrunedAuditRows,
    researchEvidenceLossMarker: data.researchEvidenceLossMarker,
  };
}

export function summarizeEngineResearchCosts(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return '';
  const parts = [];
  if (fields.costEvidenceClass === 'PAPER_BUILD_ESTIMATE') parts.push('Paper quote estimate');
  else if (fields.costEvidenceClass === 'PAPER_SIMULATED_FILL') parts.push('Simulated paper fill');
  if (typeof fields.requestedAmountRaw === 'string') {
    parts.push(`Input ${fields.requestedAmountRaw} ${fields.requestedAmountUnit ?? 'unit unknown'}`);
  }
  if (typeof fields.quotedOutput === 'string') {
    parts.push(`Quoted output ${fields.quotedOutput} ${fields.quotedOutputUnit ?? 'unit unknown'}`);
  }
  if (Number.isSafeInteger(fields.marketSnapshotAgeMs) && fields.marketSnapshotAgeMs >= 0) parts.push(`Market snapshot age ${fields.marketSnapshotAgeMs} ms`);
  else if (Number.isSafeInteger(fields.quoteAgeMs) && fields.quoteAgeMs >= 0) parts.push(`Quote age ${fields.quoteAgeMs} ms`);
  for (const [field, label] of [
    ['baseFeeLamports', 'Base fee'], ['priorityFeeLamports', 'Priority fee'],
    ['jitoTipLamports', 'Tip'], ['rentLamports', 'Rent'],
  ]) if (typeof fields[field] === 'string') parts.push(`${label} ${fields[field]} lamports`);
  if (Number.isSafeInteger(fields.modeledSlippageBps)) parts.push(`Modeled slippage ${fields.modeledSlippageBps} bps`);
  else if (Number.isSafeInteger(fields.slippageBps)) parts.push(`Slippage ${fields.slippageBps} bps`);
  if (typeof fields.estimatedSellSlippageLamports === 'string') {
    parts.push(`Estimated sell slippage ${fields.estimatedSellSlippageLamports} lamports`);
  } else if (typeof fields.slippageLamports === 'string') parts.push(`Slippage amount ${fields.slippageLamports} lamports`);
  if (typeof fields.simulatedLamportDelta === 'string') parts.push(`Simulated SOL delta ${fields.simulatedLamportDelta} lamports`);
  return parts.join(' · ');
}

const UNKNOWN_RUNTIME_IDENTITY = Object.freeze({
  status: 'UNKNOWN',
  startupFingerprint: null,
  currentFingerprint: null,
  changedArtifactCount: null,
  changedArtifacts: [],
  changedArtifactsTruncated: false,
});
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parseRuntimeIdentityResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== 1
    || !Number.isSafeInteger(data.capturedAtMs) || data.capturedAtMs < 0
    || !isDigest(data.startupFingerprint)
    || !['UNCHANGED_SINCE_STARTUP', 'CHANGED_SINCE_STARTUP', 'UNKNOWN'].includes(data.status)) {
    return UNKNOWN_RUNTIME_IDENTITY;
  }
  if (data.status === 'UNKNOWN') {
    return data.reason === 'RUNTIME_ARTIFACT_SCAN_FAILED' && data.currentFingerprint === null
      && data.changedArtifactCount === null && Array.isArray(data.changedArtifacts)
      && data.changedArtifacts.length === 0 && data.changedArtifactsTruncated === false
      ? UNKNOWN_RUNTIME_IDENTITY : UNKNOWN_RUNTIME_IDENTITY;
  }
  if (!isDigest(data.currentFingerprint)
    || !Number.isSafeInteger(data.changedArtifactCount) || data.changedArtifactCount < 0
    || !Array.isArray(data.changedArtifacts) || data.changedArtifacts.length > 50
    || typeof data.changedArtifactsTruncated !== 'boolean'
    || data.changedArtifacts.some(path => typeof path !== 'string' || path.length === 0 || path.length > 512
      || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..'))
    || new Set(data.changedArtifacts).size !== data.changedArtifacts.length) return UNKNOWN_RUNTIME_IDENTITY;

  if (data.status === 'UNCHANGED_SINCE_STARTUP'
    && (data.currentFingerprint !== data.startupFingerprint || data.changedArtifactCount !== 0
      || data.changedArtifacts.length !== 0 || data.changedArtifactsTruncated)) return UNKNOWN_RUNTIME_IDENTITY;
  if (data.status === 'CHANGED_SINCE_STARTUP'
    && (data.currentFingerprint === data.startupFingerprint || data.changedArtifactCount < 1
      || (data.changedArtifactsTruncated ? data.changedArtifacts.length !== 50
        || data.changedArtifactCount <= data.changedArtifacts.length
        : data.changedArtifactCount !== data.changedArtifacts.length))) return UNKNOWN_RUNTIME_IDENTITY;

  return Object.freeze({
    status: data.status,
    startupFingerprint: data.startupFingerprint,
    currentFingerprint: data.currentFingerprint,
    changedArtifactCount: data.changedArtifactCount,
    changedArtifacts: Object.freeze([...data.changedArtifacts]),
    changedArtifactsTruncated: data.changedArtifactsTruncated,
  });
}

import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {parseEnv} from 'node:util';

const EVENT_TYPES = Object.freeze([
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
const EVENT_SET = new Set(EVENT_TYPES);
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
const FIELD_NAMES = Object.freeze([
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
const MAX_EVENTS = 250;
const MAX_FIELD_STRING = 256;
const LAMPORT_STRING_FIELDS = new Set([
  'quotedOutput', 'requestedLamports', 'requestedAmountLamports', 'requestedAmountRaw',
  'baseFeeLamports', 'priorityFeeLamports', 'jitoTipLamports', 'rentLamports', 'slippageLamports',
  'estimatedSellSlippageLamports',
]);
const SIGNED_LAMPORT_STRING_FIELDS = new Set(['simulatedLamportDelta']);

function safeCounter(value) {
  if (typeof value === 'bigint') return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function markerState(body) {
  if (typeof body !== 'string') return 'INVALID';
  let state;
  try { state = JSON.parse(body); } catch { return 'INVALID'; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'INVALID';
  if (!Object.hasOwn(state, 'researchEvidenceLoss')) return 'NONE_RECORDED';
  const marker = state.researchEvidenceLoss;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) ||
    marker.schemaVersion !== 1 || !Number.isSafeInteger(marker.failureCount) || marker.failureCount < 1 ||
    !Number.isSafeInteger(marker.firstFailureAtMs) || marker.firstFailureAtMs < 1 ||
    !Number.isSafeInteger(marker.lastFailureAtMs) || marker.lastFailureAtMs < marker.firstFailureAtMs ||
    typeof marker.lastEvent !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(marker.lastEvent) ||
    typeof marker.lastReason !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(marker.lastReason) ||
    marker.recoveryRequired !== true) return 'INVALID';
  return 'RECORDED';
}

function safeFields(body, eventType) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const fields = Object.create(null);
  for (const key of FIELD_NAMES) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (typeof value === 'string' && value.length <= MAX_FIELD_STRING) {
      if (LAMPORT_STRING_FIELDS.has(key) && !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
      if (SIGNED_LAMPORT_STRING_FIELDS.has(key) && !/^(?:0|-?[1-9][0-9]*)$/.test(value)) return null;
      fields[key] = value;
    }
    else if (typeof value === 'number' && Number.isSafeInteger(value)) fields[key] = value;
    else if (typeof value === 'boolean') fields[key] = value;
    else if (value === null) fields[key] = null;
    else return null;
  }
  // Restriction payloads retain legacy free-form `reason` internally. The
  // read-only projection emits only its bounded reasonCode counterpart.
  if (eventType === 'candidate_restriction_v1') delete fields.reason;
  const required = REQUIRED_IDENTITY_FIELDS[eventType];
  if (!required || required.some(key => typeof fields[key] !== 'string' || fields[key].trim().length === 0)) return null;
  if (Object.hasOwn(fields, 'failureClass') && !BUILD_FAILURE_CLASSES.has(fields.failureClass)) return null;
  if (Object.hasOwn(fields, 'scope') && !RESTRICTION_SCOPES.has(fields.scope)) return null;
  if (Object.hasOwn(fields, 'effect') && !RESTRICTION_EFFECTS.has(fields.effect)) return null;
  if (Object.hasOwn(fields, 'reasonCode') && !RESTRICTION_REASON_CODES.has(fields.reasonCode)) return null;
  for (const key of ['requestedAmountUnit', 'quotedOutputUnit']) {
    if (Object.hasOwn(fields, key) && !['LAMPORTS', 'TOKEN_RAW'].includes(fields[key])) return null;
  }
  if (Object.hasOwn(fields, 'side')) {
    const expectedInputUnit = fields.side === 'buy' ? 'LAMPORTS' : fields.side === 'sell' ? 'TOKEN_RAW' : null;
    const expectedOutputUnit = fields.side === 'buy' ? 'TOKEN_RAW' : fields.side === 'sell' ? 'LAMPORTS' : null;
    if ((fields.requestedAmountUnit && fields.requestedAmountUnit !== expectedInputUnit) ||
        (fields.quotedOutputUnit && fields.quotedOutputUnit !== expectedOutputUnit)) return null;
  }
  if (Object.hasOwn(fields, 'slippageBps') &&
      (!Number.isSafeInteger(fields.slippageBps) || fields.slippageBps < 0 || fields.slippageBps > 10_000)) return null;
  if (Object.hasOwn(fields, 'modeledSlippageBps') &&
      (!Number.isSafeInteger(fields.modeledSlippageBps) || fields.modeledSlippageBps < 0 || fields.modeledSlippageBps > 10_000)) return null;
  for (const key of ['marketSnapshotAgeMs', 'quoteAgeMs']) {
    if (Object.hasOwn(fields, key) && (!Number.isSafeInteger(fields[key]) || fields[key] < 0)) return null;
  }
  if (Object.hasOwn(fields, 'costEvidenceClass') &&
      !((eventType === 'candidate_order_built_v1' && fields.costEvidenceClass === 'PAPER_BUILD_ESTIMATE') ||
        (eventType === 'candidate_paper_fill_v1' && fields.costEvidenceClass === 'PAPER_SIMULATED_FILL'))) return null;
  if (eventType === 'candidate_tracking_ended_v1' &&
      (!CANDIDATE_TRACKING_END_REASONS.has(fields.reason) || fields.outcomeStatus !== 'UNRESOLVED' ||
       !Number.isSafeInteger(fields.endedAtMs) || fields.endedAtMs < 0)) return null;
  return fields;
}

function unknown(reason) {
  return Object.freeze({
    ok: false,
    recordStatus: 'UNKNOWN',
    completeness: 'UNKNOWN',
    source: 'ENGINE_AUDIT_STORE',
    reason,
    returnedEventCount: 0,
    invalidEventCount: 0,
    truncated: false,
    knownPrunedAuditRows: null,
    researchEvidenceLossMarker: 'UNAVAILABLE',
    events: Object.freeze([]),
  });
}

export function sqliteReadOnlyOptionSupported(nodeVersion = process.versions.node) {
  if (typeof nodeVersion !== 'string') return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(nodeVersion);
  if (!match) return false;
  const [major, minor] = match.slice(1, 3).map(Number);
  return major > 24 || (major === 24 && minor >= 4);
}

/** Resolve the same project-root-relative DB_PATH used by the normal project launchers. */
export function resolveEngineDatabasePath(projectRoot, env = process.env) {
  let configured = typeof env.SYLPH_ENGINE_DB_PATH === 'string' && env.SYLPH_ENGINE_DB_PATH.trim()
    ? env.SYLPH_ENGINE_DB_PATH.trim()
    : typeof env.DB_PATH === 'string' && env.DB_PATH.trim() ? env.DB_PATH.trim() : '';
  if (!configured) {
    try { configured = parseEnv(readFileSync(resolve(projectRoot, '.env'), 'utf8')).DB_PATH || ''; }
    catch { /* missing project .env uses the engine's documented code default */ }
  }
  if (!configured) configured = 'fusion.sqlite';
  return isAbsolute(configured) ? resolve(configured) : resolve(projectRoot, configured);
}

/**
 * Read the Engine's retained candidate/attempt audit rows without writing to or
 * migrating its database. These are source events, not a canonical lifecycle.
 */
export function readEngineResearchAudit(databasePath, {limit = MAX_EVENTS} = {}) {
  if (typeof databasePath !== 'string' || databasePath.length === 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
    return unknown('INVALID_READER_CONFIGURATION');
  }
  if (!sqliteReadOnlyOptionSupported()) return unknown('READ_ONLY_SQLITE_UNSUPPORTED');

  let db;
  try {
    db = new DatabaseSync(databasePath, {readOnly: true});
    db.exec('BEGIN');
    try {
      const hasTable = name => Boolean(db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=?").get(name));
      if (!hasTable('audit')) throw new Error('AUDIT_SCHEMA_UNAVAILABLE');

      const placeholders = EVENT_TYPES.map(() => '?').join(',');
      const query = db.prepare(`SELECT CAST(id AS TEXT) AS id, CAST(at AS TEXT) AS at, event,
        CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=65536 THEN body ELSE NULL END AS body
        FROM audit WHERE event IN (${placeholders}) ORDER BY id DESC LIMIT ?`);
      const fetched = query.all(...EVENT_TYPES, limit + 1);
      const truncated = fetched.length > limit;
      const rows = fetched.slice(0, limit);

      let knownPrunedAuditRows = null;
      if (hasTable('audit_prune_ledger')) {
        const pruned = db.prepare('SELECT coalesce(sum(deleted_row_count),0) AS n FROM audit_prune_ledger');
        pruned.setReadBigInts(true);
        knownPrunedAuditRows = safeCounter(pruned.get()?.n);
      }

      let researchEvidenceLossMarker = 'UNAVAILABLE';
      if (hasTable('state')) {
        const stateRow = db.prepare("SELECT CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=65536 THEN body ELSE NULL END AS body FROM state WHERE id=1").get();
        researchEvidenceLossMarker = stateRow ? markerState(stateRow.body) : 'NONE_RECORDED';
      }

      const events = rows.map(row => {
        const sequence = typeof row.id === 'string' && /^\d{1,20}$/.test(row.id) ? row.id : null;
        const recordedAtMs = typeof row.at === 'string' && /^\d{1,20}$/.test(row.at) && Number.isSafeInteger(Number(row.at))
          ? Number(row.at) : null;
        const typeValid = typeof row.event === 'string' && EVENT_SET.has(row.event);
        let payload;
        try { payload = JSON.parse(row.body); } catch { payload = null; }
        const fields = safeFields(payload, typeValid ? row.event : 'UNKNOWN_EVENT');
        return Object.freeze({
          sequence,
          recordedAtMs,
          eventType: typeValid ? row.event : 'UNKNOWN_EVENT',
          payloadStatus: sequence && recordedAtMs !== null && typeValid && fields ? 'PROJECTABLE' : 'UNPROJECTABLE',
          fields: Object.freeze(fields ?? Object.create(null)),
        });
      });
      const invalidCount = events.filter(event => event.payloadStatus === 'UNPROJECTABLE').length;
      db.exec('COMMIT');
      return Object.freeze({
        ok: true,
        recordStatus: rows.length === 0 ? 'EMPTY' : 'RECORDED',
        completeness: 'UNKNOWN',
        source: 'ENGINE_AUDIT_STORE',
        reason: null,
        returnedEventCount: rows.length,
        truncated,
        invalidEventCount: invalidCount,
        knownPrunedAuditRows,
        researchEvidenceLossMarker,
        events: Object.freeze(events),
      });
    } catch (error) {
      if (db.isTransaction) {
        try { db.exec('ROLLBACK'); }
        catch { throw new Error('AUDIT_READ_ROLLBACK_FAILED'); }
      }
      throw error;
    }
  } catch (error) {
    const reason = error instanceof Error && error.message === 'AUDIT_SCHEMA_UNAVAILABLE'
      ? 'AUDIT_SCHEMA_UNAVAILABLE'
      : 'ENGINE_DATABASE_UNAVAILABLE';
    return unknown(reason);
  } finally {
    try { db?.close(); } catch { /* this connection is read-only and request-scoped */ }
  }
}

export const ENGINE_RESEARCH_AUDIT_EVENT_TYPES = EVENT_TYPES;

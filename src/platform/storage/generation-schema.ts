// Internal worker schema. No runtime caller can select SQL or migration hooks.
export const legacySigningSchema = `CREATE TABLE IF NOT EXISTS signing_intents(
  economic_intent_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  message_sha256 TEXT NOT NULL,
  control_epoch INTEGER NOT NULL,
  revocation_epoch INTEGER DEFAULT 0,
  prepared_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','SIGNED')),
  signature_base64 TEXT
) STRICT;`;
export const generationSigningSchema = `CREATE TABLE signing_intents_v1 (
  economic_intent_id TEXT NOT NULL PRIMARY KEY,
  grant_id TEXT UNIQUE,
  wallet TEXT,
  message_sha256 TEXT,
  control_epoch INTEGER,
  revocation_epoch INTEGER DEFAULT 0,
  prepared_at INTEGER,
  state TEXT NOT NULL,
  signature_base64 TEXT,
  record_kind TEXT NOT NULL DEFAULT 'LEGACY_SIGNING'
    CHECK (record_kind IN ('LEGACY_SIGNING','INITIAL_GENERATION')),
  generation INTEGER,
  registration_request_id TEXT UNIQUE,
  intent_sha256 TEXT,
  registered_at INTEGER,
  CHECK (
    (record_kind='LEGACY_SIGNING'
      AND state IN ('PREPARED','SIGNED')
      AND grant_id IS NOT NULL AND wallet IS NOT NULL
      AND message_sha256 IS NOT NULL AND control_epoch IS NOT NULL
      AND prepared_at IS NOT NULL
      AND generation IS NULL AND registration_request_id IS NULL
      AND intent_sha256 IS NULL AND registered_at IS NULL)
    OR
    (record_kind='INITIAL_GENERATION' AND state='REGISTERED'
      AND generation IS NOT NULL AND generation=1
      AND registration_request_id IS NOT NULL
      AND instr(economic_intent_id,char(0))=0
      AND instr(registration_request_id,char(0))=0
      AND length(economic_intent_id) BETWEEN 1 AND 256
      AND substr(economic_intent_id,1,1) GLOB '[A-Za-z0-9]'
      AND economic_intent_id NOT GLOB '*[^A-Za-z0-9._:-]*'
      AND lower(economic_intent_id) NOT IN ('__proto__','constructor','prototype')
      AND length(registration_request_id) BETWEEN 1 AND 256
      AND substr(registration_request_id,1,1) GLOB '[A-Za-z0-9]'
      AND registration_request_id NOT GLOB '*[^A-Za-z0-9._:-]*'
      AND lower(registration_request_id) NOT IN ('__proto__','constructor','prototype')
      AND intent_sha256 IS NOT NULL
      AND instr(intent_sha256,char(0))=0
      AND length(intent_sha256)=64
      AND intent_sha256 NOT GLOB '*[^0-9a-f]*'
      AND registered_at IS NOT NULL
      AND registered_at BETWEEN 0 AND 9007199254740991
      AND grant_id IS NULL AND wallet IS NULL AND message_sha256 IS NULL
      AND control_epoch IS NULL AND revocation_epoch IS NULL
      AND prepared_at IS NULL AND signature_base64 IS NULL)
  )
) STRICT;`;
export const generationTriggers = `CREATE TRIGGER initial_generation_no_update BEFORE UPDATE ON signing_intents
WHEN OLD.record_kind='INITIAL_GENERATION'
BEGIN SELECT RAISE(ABORT,'GENERATION_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER initial_generation_no_delete BEFORE DELETE ON signing_intents
WHEN OLD.record_kind='INITIAL_GENERATION'
BEGIN SELECT RAISE(ABORT,'GENERATION_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER signing_intent_no_kind_change BEFORE UPDATE ON signing_intents
WHEN OLD.record_kind != NEW.record_kind
BEGIN SELECT RAISE(ABORT,'INTENT_KIND_IMMUTABLE'); END;`;
export const otherStoreSchema = `CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_prune_ledger(
  id INTEGER PRIMARY KEY,
  pruned_at_ms INTEGER NOT NULL,
  cutoff_at_ms INTEGER NOT NULL,
  deleted_row_count INTEGER NOT NULL CHECK(deleted_row_count > 0),
  first_id INTEGER NOT NULL,
  last_id INTEGER NOT NULL,
  id_ranges_json TEXT NOT NULL,
  event_counts_json TEXT NOT NULL,
  first_audit_at_ms INTEGER NOT NULL,
  last_audit_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS capital_events(
  sequence_number INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  delta_lamports TEXT NOT NULL,
  balance_after_lamports TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS capital_commits(
  intent_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  certificate_id TEXT NOT NULL,
  capital_state_root TEXT NOT NULL,
  certificate_hash TEXT NOT NULL,
  committed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS recovery_certificates(
  certificate_id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL,
  from_slot INTEGER NOT NULL,
  to_slot INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  recovered_events_count INTEGER NOT NULL,
  skipped_slots_json TEXT NOT NULL,
  dead_fork_slots_json TEXT NOT NULL,
  coverage_root TEXT NOT NULL,
  state_root TEXT NOT NULL,
  resolved_at_ms INTEGER NOT NULL,
  signature TEXT NOT NULL,
  certificate_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS coverage_frontiers(
  lane TEXT PRIMARY KEY,
  continuous_slot INTEGER NOT NULL,
  sealed_slot INTEGER,
  coverage_root TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS contract_canaries(
  provider_id TEXT PRIMARY KEY,
  transport_health TEXT NOT NULL,
  schema_health TEXT NOT NULL,
  semantic_health TEXT NOT NULL,
  freshness_health TEXT NOT NULL,
  quota_health TEXT NOT NULL,
  is_quarantined INTEGER NOT NULL,
  last_validated_slot INTEGER NOT NULL,
  last_validated_at_ms INTEGER NOT NULL,
  failure_reason TEXT,
  contract_epoch_id TEXT,
  contract_fingerprint TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS provider_quotas(
  provider_id TEXT PRIMARY KEY,
  rate_limited_until_ms INTEGER NOT NULL,
  circuit_state TEXT NOT NULL,
  circuit_tripped_at_ms INTEGER NOT NULL,
  consecutive_recovery INTEGER NOT NULL,
  last_failure_reason TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS counterfactual_regrets(
  evaluation_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  slot INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  action_taken TEXT NOT NULL,
  realized_pnl_bps INTEGER NOT NULL,
  best_counterfactual_scenario TEXT NOT NULL,
  max_counterfactual_pnl_bps INTEGER NOT NULL,
  overall_regret_bps INTEGER NOT NULL,
  discovery_regret_bps INTEGER NOT NULL,
  pricing_regret_bps INTEGER NOT NULL,
  execution_regret_bps INTEGER NOT NULL,
  exit_regret_bps INTEGER NOT NULL,
  primary_failure_subsystem TEXT NOT NULL,
  actionable_policy_tuning TEXT NOT NULL,
  evaluation_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS falsification_reports(
  report_id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  slot INTEGER NOT NULL,
  is_thesis_falsified INTEGER NOT NULL,
  falsification_confidence REAL NOT NULL,
  survivability_index REAL NOT NULL,
  minimum_plausible_break_capital_sol REAL NOT NULL,
  lethal_attack_vector TEXT NOT NULL,
  is_veto_recommended INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS entity_control_evaluations(
  mint TEXT PRIMARY KEY,
  raw_wallet_count INTEGER NOT NULL,
  resolved_entity_count INTEGER NOT NULL,
  deception_gap REAL NOT NULL,
  entity_entropy REAL NOT NULL,
  normalized_entity_entropy REAL NOT NULL,
  dominant_entity_supply_fraction REAL NOT NULL,
  latent_inventory_fraction REAL NOT NULL,
  supply_avalanche_risk REAL NOT NULL,
  is_entropy_collapsed INTEGER NOT NULL,
  evaluation_json TEXT NOT NULL,
  evaluated_at_ms INTEGER NOT NULL
) STRICT;`;


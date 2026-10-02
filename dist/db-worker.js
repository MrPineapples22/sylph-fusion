import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL);');
db.exec(`CREATE TABLE IF NOT EXISTS signing_intents(
  economic_intent_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  message_sha256 TEXT NOT NULL,
  control_epoch INTEGER NOT NULL,
  revocation_epoch INTEGER DEFAULT 0,
  prepared_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','SIGNED')),
  signature_base64 TEXT
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
) STRICT;`);
parentPort.on('message', (m) => {
    try {
        if (m.op === 'load') {
            const row = db.prepare('SELECT body FROM state WHERE id=1').get();
            parentPort.postMessage({ id: m.id, value: row?.body ?? null });
        }
        else if (m.op === 'save') {
            db.exec('BEGIN IMMEDIATE');
            try {
                db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.body);
                if (m.event)
                    db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body);
                db.exec('COMMIT');
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'prepare-signing') {
            const intent = JSON.parse(m.body);
            if (!intent.economicIntentId || !intent.grantId || !intent.wallet || !/^[a-f0-9]{64}$/.test(intent.messageSha256) ||
                !Number.isSafeInteger(intent.controlEpoch) || !Number.isSafeInteger(intent.preparedAtMs))
                throw new Error('invalid signing intent');
            const revEpoch = Number.isSafeInteger(intent.revocationEpoch) ? intent.revocationEpoch : 0;
            db.prepare(`INSERT INTO signing_intents(economic_intent_id,grant_id,wallet,message_sha256,control_epoch,revocation_epoch,prepared_at,state)
        VALUES(?,?,?,?,?,?,?,'PREPARED')`).run(intent.economicIntentId, intent.grantId, intent.wallet, intent.messageSha256, intent.controlEpoch, revEpoch, intent.preparedAtMs);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'mark-signed') {
            const signed = JSON.parse(m.body);
            if (!signed.economicIntentId || !/^[a-f0-9]{64}$/.test(signed.messageSha256) ||
                typeof signed.signatureBase64 !== 'string' || Buffer.from(signed.signatureBase64, 'base64').byteLength !== 64) {
                throw new Error('invalid signed intent');
            }
            const result = db.prepare(`UPDATE signing_intents SET state='SIGNED',signature_base64=?
        WHERE economic_intent_id=? AND message_sha256=? AND state='PREPARED'`).run(signed.signatureBase64, signed.economicIntentId, signed.messageSha256);
            if (result.changes !== 1)
                throw new Error('signing intent missing, altered, or already finalized');
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'save-capital-commit') {
            const commit = JSON.parse(m.body);
            db.prepare(`INSERT INTO capital_commits(intent_id, reservation_id, certificate_id, capital_state_root, certificate_hash, committed_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET certificate_hash=excluded.certificate_hash`).run(commit.intentId, commit.reservationId, commit.certificateId, commit.capitalStateRoot, commit.certificateHash, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'append-capital-event') {
            const ev = JSON.parse(m.body);
            db.prepare(`INSERT INTO capital_events(sequence_number, event_type, timestamp_ms, slot, entity_id, delta_lamports, balance_after_lamports, previous_event_hash, event_hash, payload_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(ev.sequence_number, ev.event_type, ev.timestamp_ms, ev.slot, ev.entity_id, String(ev.delta_lamports), String(ev.balance_after_lamports), ev.previous_event_hash, ev.event_hash, JSON.stringify(ev.payload || {}));
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'backup') {
            const dest = m.body;
            if (!dest)
                throw new Error('backup destination path required');
            const safeDest = dest.replace(/'/g, "''");
            db.exec(`VACUUM INTO '${safeDest}';`);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'save-recovery-certificate') {
            const cert = JSON.parse(m.body);
            db.prepare(`INSERT INTO recovery_certificates(certificate_id, gap_id, from_slot, to_slot, provider_id, recovered_events_count, skipped_slots_json, dead_fork_slots_json, coverage_root, state_root, resolved_at_ms, signature, certificate_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(certificate_id) DO UPDATE SET certificate_json=excluded.certificate_json, state_root=excluded.state_root`).run(cert.certificateId, cert.gapId, cert.fromSlot, cert.toSlot, cert.providerId, cert.recoveredEventIds?.length ?? 0, JSON.stringify(cert.skippedSlots ?? []), JSON.stringify(cert.deadForkSlots ?? []), cert.coverageRoot ?? null, cert.stateRoot ?? null, cert.resolvedAtMs ?? Date.now(), cert.signature ?? null, JSON.stringify(cert));
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-recovery-certificate') {
            const id = m.body;
            const row = db.prepare('SELECT certificate_json FROM recovery_certificates WHERE certificate_id=? OR gap_id=?').get(id, id);
            parentPort.postMessage({ id: m.id, value: row?.certificate_json ?? null });
        }
        else if (m.op === 'save-coverage-frontier') {
            const frontier = JSON.parse(m.body);
            db.prepare(`INSERT INTO coverage_frontiers(lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms)
        VALUES(?,?,?,?,?)
        ON CONFLICT(lane) DO UPDATE SET continuous_slot=excluded.continuous_slot, sealed_slot=excluded.sealed_slot, coverage_root=excluded.coverage_root, updated_at_ms=excluded.updated_at_ms`).run(frontier.lane, frontier.continuousSlot ?? frontier.continuous_slot, frontier.sealedSlot ?? frontier.sealed_slot ?? null, frontier.coverageRoot ?? frontier.coverage_root ?? null, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-coverage-frontier') {
            const lane = m.body;
            const row = db.prepare('SELECT lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms FROM coverage_frontiers WHERE lane=?').get(lane);
            parentPort.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
        }
        else if (m.op === 'save-contract-canary') {
            const canary = JSON.parse(m.body);
            db.prepare(`INSERT INTO contract_canaries(
        provider_id, transport_health, schema_health, semantic_health, freshness_health, quota_health,
        is_quarantined, last_validated_slot, last_validated_at_ms, failure_reason, contract_epoch_id, contract_fingerprint, updated_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider_id) DO UPDATE SET
        transport_health=excluded.transport_health,
        schema_health=excluded.schema_health,
        semantic_health=excluded.semantic_health,
        freshness_health=excluded.freshness_health,
        quota_health=excluded.quota_health,
        is_quarantined=excluded.is_quarantined,
        last_validated_slot=excluded.last_validated_slot,
        last_validated_at_ms=excluded.last_validated_at_ms,
        failure_reason=excluded.failure_reason,
        contract_epoch_id=excluded.contract_epoch_id,
        contract_fingerprint=excluded.contract_fingerprint,
        updated_at_ms=excluded.updated_at_ms`).run(canary.providerId ?? canary.provider_id, canary.transportHealth ?? canary.transport_health ?? 'HEALTHY', canary.schemaHealth ?? canary.schema_health ?? 'HEALTHY', canary.semanticHealth ?? canary.semantic_health ?? 'HEALTHY', canary.freshnessHealth ?? canary.freshness_health ?? 'HEALTHY', canary.quotaHealth ?? canary.quota_health ?? 'HEALTHY', canary.isQuarantined || canary.is_quarantined ? 1 : 0, canary.lastValidatedSlot ?? canary.last_validated_slot ?? 0, canary.lastValidatedAtMs ?? canary.last_validated_at_ms ?? Date.now(), canary.failureReason ?? canary.failure_reason ?? null, canary.contractEpochId ?? canary.contract_epoch_id ?? null, canary.contractFingerprint ?? canary.contract_fingerprint ?? null, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-contract-canary') {
            const providerId = m.body;
            const row = db.prepare('SELECT * FROM contract_canaries WHERE provider_id=?').get(providerId);
            parentPort.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
        }
        else if (m.op === 'get-all-contract-canaries') {
            const rows = db.prepare('SELECT * FROM contract_canaries').all();
            parentPort.postMessage({ id: m.id, value: JSON.stringify(rows) });
        }
        else if (m.op === 'save-provider-quota') {
            const q = JSON.parse(m.body);
            db.prepare(`INSERT INTO provider_quotas(provider_id, rate_limited_until_ms, circuit_state, circuit_tripped_at_ms, consecutive_recovery, last_failure_reason, updated_at_ms)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET
          rate_limited_until_ms=excluded.rate_limited_until_ms,
          circuit_state=excluded.circuit_state,
          circuit_tripped_at_ms=excluded.circuit_tripped_at_ms,
          consecutive_recovery=excluded.consecutive_recovery,
          last_failure_reason=excluded.last_failure_reason,
          updated_at_ms=excluded.updated_at_ms`).run(q.providerId ?? q.provider_id, q.rateLimitedUntilMs ?? q.rate_limited_until_ms ?? 0, q.circuitState ?? q.circuit_state ?? 'CLOSED', q.circuitTrippedAtMs ?? q.circuit_tripped_at_ms ?? 0, q.consecutiveRecovery ?? q.consecutive_recovery ?? 0, q.lastFailureReason ?? q.last_failure_reason ?? null, Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-provider-quota') {
            const providerId = m.body;
            const row = db.prepare('SELECT * FROM provider_quotas WHERE provider_id=?').get(providerId);
            parentPort.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
        }
        else if (m.op === 'get-all-provider-quotas') {
            const rows = db.prepare('SELECT * FROM provider_quotas').all();
            parentPort.postMessage({ id: m.id, value: JSON.stringify(rows) });
        }
        else if (m.op === 'save-counterfactual-evaluation') {
            const ev = JSON.parse(m.body);
            db.prepare(`INSERT INTO counterfactual_regrets(
        evaluation_id, decision_id, opportunity_id, token_id, strategy_version, slot, timestamp_ms,
        action_taken, realized_pnl_bps, best_counterfactual_scenario, max_counterfactual_pnl_bps,
        overall_regret_bps, discovery_regret_bps, pricing_regret_bps, execution_regret_bps, exit_regret_bps,
        primary_failure_subsystem, actionable_policy_tuning, evaluation_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(evaluation_id) DO UPDATE SET evaluation_json=excluded.evaluation_json`).run(ev.evaluationId, ev.decisionId, ev.opportunityId, ev.tokenId, ev.strategyVersion, ev.slot, ev.timestamp, ev.actionTaken, ev.realizedPnlBps, ev.bestCounterfactualScenario, ev.maxCounterfactualPnlBps, ev.overallRegretBps, ev.alphaDecomposition?.discoveryRegretBps ?? 0, ev.alphaDecomposition?.pricingRegretBps ?? 0, ev.alphaDecomposition?.executionRegretBps ?? 0, ev.alphaDecomposition?.exitRegretBps ?? 0, ev.primaryFailureSubsystem, ev.actionablePolicyTuning, JSON.stringify(ev));
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-counterfactual-evaluation') {
            const id = m.body;
            const row = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE evaluation_id=?').get(id);
            parentPort.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
        }
        else if (m.op === 'get-counterfactual-evaluations-for-token') {
            const tokenId = m.body;
            const rows = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE token_id=? ORDER BY slot ASC').all(tokenId);
            parentPort.postMessage({ id: m.id, value: JSON.stringify(rows.map(r => JSON.parse(r.evaluation_json))) });
        }
        else if (m.op === 'save-falsification-report') {
            const rep = JSON.parse(m.body);
            db.prepare(`INSERT INTO falsification_reports(
        report_id, mint, slot, is_thesis_falsified, falsification_confidence, survivability_index,
        minimum_plausible_break_capital_sol, lethal_attack_vector, is_veto_recommended, rationale, report_json, created_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(report_id) DO UPDATE SET report_json=excluded.report_json`).run(rep.reportId, rep.mint, rep.slot, rep.isThesisFalsified ? 1 : 0, rep.falsificationConfidence, rep.survivabilityIndex, rep.minimumPlausibleBreakCapitalSol, rep.lethalAttackVector, rep.isVetoRecommended ? 1 : 0, rep.rationale, JSON.stringify(rep), Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-falsification-report') {
            const id = m.body;
            const row = db.prepare('SELECT report_json FROM falsification_reports WHERE report_id=?').get(id);
            parentPort.postMessage({ id: m.id, value: row?.report_json ?? null });
        }
        else if (m.op === 'save-entity-control-evaluation') {
            const evalResult = JSON.parse(m.body);
            db.prepare(`INSERT INTO entity_control_evaluations(
        mint, raw_wallet_count, resolved_entity_count, deception_gap, entity_entropy,
        normalized_entity_entropy, dominant_entity_supply_fraction, latent_inventory_fraction,
        supply_avalanche_risk, is_entropy_collapsed, evaluation_json, evaluated_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mint) DO UPDATE SET evaluation_json=excluded.evaluation_json, evaluated_at_ms=excluded.evaluated_at_ms`).run(evalResult.mint, evalResult.rawWalletCount, evalResult.resolvedEntityCount, evalResult.deceptionGap, evalResult.entityEntropy, evalResult.normalizedEntityEntropy, evalResult.dominantEntitySupplyFraction, evalResult.latentInventoryFraction, evalResult.supplyAvalancheRisk, evalResult.isEntropyCollapsed ? 1 : 0, JSON.stringify(evalResult), Date.now());
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'get-entity-control-evaluation') {
            const mint = m.body;
            const row = db.prepare('SELECT evaluation_json FROM entity_control_evaluations WHERE mint=?').get(mint);
            parentPort.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
        }
        else if (m.op === 'prune') {
            const maxAgeMs = Number(m.body) || (7 * 86_400_000);
            const cutoff = Date.now() - maxAgeMs;
            db.prepare('DELETE FROM audit WHERE at < ?').run(cutoff);
            parentPort.postMessage({ id: m.id, value: null });
        }
        else if (m.op === 'close') {
            db.close();
            parentPort.postMessage({ id: m.id, value: null });
            parentPort.close();
        }
        else
            throw new Error('unknown database operation');
    }
    catch (e) {
        parentPort.postMessage({ id: m.id, error: String(e) });
    }
});
//# sourceMappingURL=db-worker.js.map
import { parentPort, workerData } from 'node:worker_threads';
import { openGenerationDatabase, registerInitialGenerationSync, readGenerationIdentitySync, sqliteDiagnostic } from './platform/storage/generation-sqlite.js';
import { GenerationStorageError } from './platform/storage/generation-identity.js';
const initialized = (() => {
  try { return openGenerationDatabase(workerData.path); }
  catch (error) {
    const failure = error instanceof GenerationStorageError ? error : new GenerationStorageError('STORAGE_FAILURE');
    parentPort!.postMessage({ fatal: true, error: failure.message, code: failure.code, sqliteCode: failure.sqliteCode });
    throw failure;
  }
})();
const { db, registrationCapable } = initialized;
parentPort!.on('message', (m: { id: number; op: string; body?: string; event?: string }) => {
  try {
    if (m.op === 'register-initial-generation') {
      const result = registerInitialGenerationSync(db, registrationCapable, m.body);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(result) });
    } else if (m.op === 'read-generation-identity') {
      const result = readGenerationIdentitySync(db, registrationCapable, m.body);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(result) });
    } else if (m.op === 'load') {
      const row = db.prepare('SELECT body FROM state WHERE id=1').get();
      parentPort!.postMessage({ id: m.id, value: row?.body ?? null });
    } else if (m.op === 'save') {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(m.body!);
        if (m.event !== undefined && (typeof m.event !== 'string' || m.event.length < 1 || m.event.length > 256)) throw new Error('invalid state audit event');
        if (m.event) db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body!);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'append-audit-event') {
      if (typeof m.event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(m.event) ||
          typeof m.body !== 'string' || Buffer.byteLength(m.body) > 65_536) throw new Error('invalid audit event');
      const payload = JSON.parse(m.body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid audit event payload');
      db.prepare('INSERT INTO audit(at,event,body) VALUES(?,?,?)').run(Date.now(), m.event, m.body);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-audit-events') {
      const query = JSON.parse(m.body!);
      if (!query || typeof query.event !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(query.event) ||
          !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 10_000) throw new Error('invalid audit query');
      const rows = db.prepare('SELECT id,at,event,body FROM audit WHERE event=? ORDER BY id ASC LIMIT ?').all(query.event, query.limit);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'prepare-signing') {
      const intent = JSON.parse(m.body!);
      if (!intent.economicIntentId || !intent.grantId || !intent.wallet || !/^[a-f0-9]{64}$/.test(intent.messageSha256) ||
          !Number.isSafeInteger(intent.controlEpoch) || !Number.isSafeInteger(intent.preparedAtMs)) throw new Error('invalid signing intent');
      const revEpoch = Number.isSafeInteger(intent.revocationEpoch) ? intent.revocationEpoch : 0;
      db.prepare(`INSERT INTO signing_intents(economic_intent_id,grant_id,wallet,message_sha256,control_epoch,revocation_epoch,prepared_at,state)
        VALUES(?,?,?,?,?,?,?,'PREPARED')`).run(intent.economicIntentId, intent.grantId, intent.wallet,
          intent.messageSha256, intent.controlEpoch, revEpoch, intent.preparedAtMs);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'mark-signed') {
      const signed = JSON.parse(m.body!);
      if (!signed.economicIntentId || !/^[a-f0-9]{64}$/.test(signed.messageSha256) ||
          typeof signed.signatureBase64 !== 'string' || Buffer.from(signed.signatureBase64, 'base64').byteLength !== 64) {
        throw new Error('invalid signed intent');
      }
      const result = db.prepare(`UPDATE signing_intents SET state='SIGNED',signature_base64=?
        WHERE economic_intent_id=? AND message_sha256=? AND state='PREPARED'`).run(
          signed.signatureBase64, signed.economicIntentId, signed.messageSha256);
      if (result.changes !== 1) throw new Error('signing intent missing, altered, or already finalized');
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'save-capital-commit') {
      const commit = JSON.parse(m.body!);
      db.prepare(`INSERT INTO capital_commits(intent_id, reservation_id, certificate_id, capital_state_root, certificate_hash, committed_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET certificate_hash=excluded.certificate_hash`).run(
          commit.intentId, commit.reservationId, commit.certificateId, commit.capitalStateRoot, commit.certificateHash, Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'append-capital-event') {
      const ev = JSON.parse(m.body!);
      db.prepare(`INSERT INTO capital_events(sequence_number, event_type, timestamp_ms, slot, entity_id, delta_lamports, balance_after_lamports, previous_event_hash, event_hash, payload_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          ev.sequence_number, ev.event_type, ev.timestamp_ms, ev.slot, ev.entity_id,
          String(ev.delta_lamports), String(ev.balance_after_lamports), ev.previous_event_hash, ev.event_hash, JSON.stringify(ev.payload || {})
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'backup') {
      const dest = m.body;
      if (!dest) throw new Error('backup destination path required');
      const safeDest = dest.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${safeDest}';`);
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'save-recovery-certificate') {
      const cert = JSON.parse(m.body!);
      db.prepare(`INSERT INTO recovery_certificates(certificate_id, gap_id, from_slot, to_slot, provider_id, recovered_events_count, skipped_slots_json, dead_fork_slots_json, coverage_root, state_root, resolved_at_ms, signature, certificate_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(certificate_id) DO UPDATE SET certificate_json=excluded.certificate_json, state_root=excluded.state_root`).run(
          cert.certificateId, cert.gapId, cert.fromSlot, cert.toSlot, cert.providerId,
          cert.recoveredEventIds?.length ?? 0, JSON.stringify(cert.skippedSlots ?? []), JSON.stringify(cert.deadForkSlots ?? []),
          cert.coverageRoot ?? null, cert.stateRoot ?? null, cert.resolvedAtMs ?? Date.now(), cert.signature ?? null, JSON.stringify(cert)
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-recovery-certificate') {
      const id = m.body!;
      const row: any = db.prepare('SELECT certificate_json FROM recovery_certificates WHERE certificate_id=? OR gap_id=?').get(id, id);
      parentPort!.postMessage({ id: m.id, value: row?.certificate_json ?? null });
    } else if (m.op === 'save-coverage-frontier') {
      const frontier = JSON.parse(m.body!);
      db.prepare(`INSERT INTO coverage_frontiers(lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms)
        VALUES(?,?,?,?,?)
        ON CONFLICT(lane) DO UPDATE SET continuous_slot=excluded.continuous_slot, sealed_slot=excluded.sealed_slot, coverage_root=excluded.coverage_root, updated_at_ms=excluded.updated_at_ms`).run(
          frontier.lane,
          frontier.continuousSlot ?? frontier.continuous_slot,
          frontier.sealedSlot ?? frontier.sealed_slot ?? null,
          frontier.coverageRoot ?? frontier.coverage_root ?? null,
          Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-coverage-frontier') {
      const lane = m.body!;
      const row: any = db.prepare('SELECT lane, continuous_slot, sealed_slot, coverage_root, updated_at_ms FROM coverage_frontiers WHERE lane=?').get(lane);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'save-contract-canary') {
      const canary = JSON.parse(m.body!);
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
        updated_at_ms=excluded.updated_at_ms`).run(
          canary.providerId ?? canary.provider_id,
          canary.transportHealth ?? canary.transport_health ?? 'HEALTHY',
          canary.schemaHealth ?? canary.schema_health ?? 'HEALTHY',
          canary.semanticHealth ?? canary.semantic_health ?? 'HEALTHY',
          canary.freshnessHealth ?? canary.freshness_health ?? 'HEALTHY',
          canary.quotaHealth ?? canary.quota_health ?? 'HEALTHY',
          canary.isQuarantined || canary.is_quarantined ? 1 : 0,
          canary.lastValidatedSlot ?? canary.last_validated_slot ?? 0,
          canary.lastValidatedAtMs ?? canary.last_validated_at_ms ?? Date.now(),
          canary.failureReason ?? canary.failure_reason ?? null,
          canary.contractEpochId ?? canary.contract_epoch_id ?? null,
          canary.contractFingerprint ?? canary.contract_fingerprint ?? null,
          Date.now()
        );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-contract-canary') {
      const providerId = m.body!;
      const row: any = db.prepare('SELECT * FROM contract_canaries WHERE provider_id=?').get(providerId);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'get-all-contract-canaries') {
      const rows: any[] = db.prepare('SELECT * FROM contract_canaries').all();
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'save-provider-quota') {
      const q = JSON.parse(m.body!);
      db.prepare(`INSERT INTO provider_quotas(provider_id, rate_limited_until_ms, circuit_state, circuit_tripped_at_ms, consecutive_recovery, last_failure_reason, updated_at_ms)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET
          rate_limited_until_ms=excluded.rate_limited_until_ms,
          circuit_state=excluded.circuit_state,
          circuit_tripped_at_ms=excluded.circuit_tripped_at_ms,
          consecutive_recovery=excluded.consecutive_recovery,
          last_failure_reason=excluded.last_failure_reason,
          updated_at_ms=excluded.updated_at_ms`).run(
        q.providerId ?? q.provider_id,
        q.rateLimitedUntilMs ?? q.rate_limited_until_ms ?? 0,
        q.circuitState ?? q.circuit_state ?? 'CLOSED',
        q.circuitTrippedAtMs ?? q.circuit_tripped_at_ms ?? 0,
        q.consecutiveRecovery ?? q.consecutive_recovery ?? 0,
        q.lastFailureReason ?? q.last_failure_reason ?? null,
        Date.now()
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-provider-quota') {
      const providerId = m.body!;
      const row: any = db.prepare('SELECT * FROM provider_quotas WHERE provider_id=?').get(providerId);
      parentPort!.postMessage({ id: m.id, value: row ? JSON.stringify(row) : null });
    } else if (m.op === 'get-all-provider-quotas') {
      const rows: any[] = db.prepare('SELECT * FROM provider_quotas').all();
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows) });
    } else if (m.op === 'save-counterfactual-evaluation') {
      const ev = JSON.parse(m.body!);
      db.prepare(`INSERT INTO counterfactual_regrets(
        evaluation_id, decision_id, opportunity_id, token_id, strategy_version, slot, timestamp_ms,
        action_taken, realized_pnl_bps, best_counterfactual_scenario, max_counterfactual_pnl_bps,
        overall_regret_bps, discovery_regret_bps, pricing_regret_bps, execution_regret_bps, exit_regret_bps,
        primary_failure_subsystem, actionable_policy_tuning, evaluation_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(evaluation_id) DO UPDATE SET evaluation_json=excluded.evaluation_json`).run(
        ev.evaluationId, ev.decisionId, ev.opportunityId, ev.tokenId, ev.strategyVersion, ev.slot, ev.timestamp,
        ev.actionTaken, ev.realizedPnlBps, ev.bestCounterfactualScenario, ev.maxCounterfactualPnlBps,
        ev.overallRegretBps, ev.alphaDecomposition?.discoveryRegretBps ?? 0, ev.alphaDecomposition?.pricingRegretBps ?? 0,
        ev.alphaDecomposition?.executionRegretBps ?? 0, ev.alphaDecomposition?.exitRegretBps ?? 0,
        ev.primaryFailureSubsystem, ev.actionablePolicyTuning, JSON.stringify(ev)
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-counterfactual-evaluation') {
      const id = m.body!;
      const row: any = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE evaluation_id=?').get(id);
      parentPort!.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
    } else if (m.op === 'get-counterfactual-evaluations-for-token') {
      const tokenId = m.body!;
      const rows: any[] = db.prepare('SELECT evaluation_json FROM counterfactual_regrets WHERE token_id=? ORDER BY slot ASC').all(tokenId);
      parentPort!.postMessage({ id: m.id, value: JSON.stringify(rows.map(r => JSON.parse(r.evaluation_json))) });
    } else if (m.op === 'save-falsification-report') {
      const rep = JSON.parse(m.body!);
      db.prepare(`INSERT INTO falsification_reports(
        report_id, mint, slot, is_thesis_falsified, falsification_confidence, survivability_index,
        minimum_plausible_break_capital_sol, lethal_attack_vector, is_veto_recommended, rationale, report_json, created_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(report_id) DO UPDATE SET report_json=excluded.report_json`).run(
        rep.reportId, rep.mint, rep.slot, rep.isThesisFalsified ? 1 : 0, rep.falsificationConfidence,
        rep.survivabilityIndex, rep.minimumPlausibleBreakCapitalSol, rep.lethalAttackVector,
        rep.isVetoRecommended ? 1 : 0, rep.rationale, JSON.stringify(rep), Date.now()
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-falsification-report') {
      const id = m.body!;
      const row: any = db.prepare('SELECT report_json FROM falsification_reports WHERE report_id=?').get(id);
      parentPort!.postMessage({ id: m.id, value: row?.report_json ?? null });
    } else if (m.op === 'save-entity-control-evaluation') {
      const evalResult = JSON.parse(m.body!);
      db.prepare(`INSERT INTO entity_control_evaluations(
        mint, raw_wallet_count, resolved_entity_count, deception_gap, entity_entropy,
        normalized_entity_entropy, dominant_entity_supply_fraction, latent_inventory_fraction,
        supply_avalanche_risk, is_entropy_collapsed, evaluation_json, evaluated_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mint) DO UPDATE SET evaluation_json=excluded.evaluation_json, evaluated_at_ms=excluded.evaluated_at_ms`).run(
        evalResult.mint, evalResult.rawWalletCount, evalResult.resolvedEntityCount,
        evalResult.deceptionGap, evalResult.entityEntropy, evalResult.normalizedEntityEntropy,
        evalResult.dominantEntitySupplyFraction, evalResult.latentInventoryFraction,
        evalResult.supplyAvalancheRisk, evalResult.isEntropyCollapsed ? 1 : 0, JSON.stringify(evalResult), Date.now()
      );
      parentPort!.postMessage({ id: m.id, value: null });
    } else if (m.op === 'get-entity-control-evaluation') {
      const mint = m.body!;
      const row: any = db.prepare('SELECT evaluation_json FROM entity_control_evaluations WHERE mint=?').get(mint);
      parentPort!.postMessage({ id: m.id, value: row?.evaluation_json ?? null });
    } else if (m.op === 'prune') {
      const maxAgeMs = m.body === undefined ? 7 * 86_400_000 : Number(m.body);
      if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10 * 365 * 86_400_000) throw new Error('invalid audit retention age');
      const cutoff = Date.now() - maxAgeMs;
      db.exec('BEGIN IMMEDIATE');
      try {
        const select = db.prepare('SELECT id,at,substr(event,1,256) AS event FROM audit WHERE at < ? ORDER BY id LIMIT 50000');
        select.setReadBigInts(true);
        const rows = select.all(cutoff) as { id: bigint; at: bigint; event: string }[];
        if (!rows.length) {
          db.exec('COMMIT');
          parentPort!.postMessage({ id: m.id, value: JSON.stringify({ prunedRowCount: 0, idRanges: [], limitReached: false }) });
        } else {
          const idRanges: [number, number][] = [];
          let start = rows[0].id, end = rows[0].id;
          const eventCounts: Record<string, number> = Object.create(null);
          for (const row of rows) {
            if (row.id < 0n || row.id > BigInt(Number.MAX_SAFE_INTEGER) || row.at < 0n || row.at > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('audit retention integer out of range');
            if (row.id > end + 1n) { idRanges.push([Number(start), Number(end)]); start = row.id; }
            end = row.id;
            const eventClass = row.event.split(':', 1)[0].slice(0, 64);
            const category = /^[A-Za-z][A-Za-z0-9_.-]*$/.test(eventClass) ? eventClass : 'other';
            eventCounts[category] = (eventCounts[category] ?? 0) + 1;
            if (Object.keys(eventCounts).length > 1000) throw new Error('audit prune event category limit exceeded');
          }
          idRanges.push([Number(start), Number(end)]);
          const deletedAt = Date.now();
          db.prepare(`INSERT INTO audit_prune_ledger(pruned_at_ms,cutoff_at_ms,deleted_row_count,first_id,last_id,id_ranges_json,event_counts_json,first_audit_at_ms,last_audit_at_ms)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(deletedAt, cutoff, rows.length, Number(rows[0].id), Number(rows[rows.length - 1].id),
            JSON.stringify(idRanges), JSON.stringify(eventCounts), Number(rows.reduce((a, row) => a < row.at ? a : row.at, rows[0].at)),
            Number(rows.reduce((a, row) => a > row.at ? a : row.at, rows[0].at)));
          const remove = db.prepare('DELETE FROM audit WHERE id=?');
          for (const row of rows) remove.run(Number(row.id));
          db.exec('COMMIT');
          parentPort!.postMessage({ id: m.id, value: JSON.stringify({ prunedRowCount: rows.length, idRanges, limitReached: rows.length === 50_000 }) });
        }
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (m.op === 'close') { db.close(); parentPort!.postMessage({ id: m.id, value: null }); parentPort!.close(); }
    else throw new Error('unknown database operation');
  } catch (e) {
    const generationOp = m.op === 'register-initial-generation' || m.op === 'read-generation-identity';
    const failure = e instanceof GenerationStorageError ? e : generationOp ? new GenerationStorageError('STORAGE_FAILURE', sqliteDiagnostic(e)) : null;
    parentPort!.postMessage({ id: m.id, error: failure?.message ?? String(e), code: failure?.code, sqliteCode: failure?.sqliteCode });
    if ((e as { poisoned?: boolean })?.poisoned) {
      parentPort!.postMessage({ fatal: true, error: 'STORAGE_OUTCOME_UNKNOWN', code: 'STORAGE_OUTCOME_UNKNOWN' });
      parentPort!.close();
    }
  }
});

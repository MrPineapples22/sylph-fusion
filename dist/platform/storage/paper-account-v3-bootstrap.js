import { randomUUID } from 'node:crypto';
import { canonicalSylphJcs1Snapshot, parseSylphJcs1, paperAccountV2EventHash, paperAccountV2GenesisHash, serializeSylphJcs1, verifyPaperAccountV2BootstrapPrefix } from './paper-account-v3-codec.js';
import { verifyPaperAccountV3WritePreconditions } from './paper-account-v3-schema.js';
const noop = () => { };
const ZERO_HASH = '0'.repeat(64);
const GENESIS_KEYS = ['accountId', 'accountingPolicyHash', 'configHash', 'conversionPolicyHash', 'createdAtMs', 'createdBy', 'generationId', 'initialCapitalUsdMicro',
    'initialCashAvailableUsdMicro', 'openingCashUsdMicro', 'origin', 'priorGenerationId', 'reason', 'riskPolicyHash', 'schemaVersion', 'simulatorBuildHash',
    'simulatorReportSchema', 'tokenMetadataPolicyHash'];
const fail = (code) => { throw new Error(code); };
function validateGenesis(genesis, operatorAuthorization, recordedAtMs) {
    const keys = Reflect.ownKeys(genesis);
    if (keys.some(key => typeof key !== 'string') || JSON.stringify(keys.sort()) !== JSON.stringify([...GENESIS_KEYS].sort()))
        fail('PAPER_ACCOUNT_V3_GENESIS_SHAPE_INVALID');
    if (typeof operatorAuthorization !== 'string' || operatorAuthorization.length === 0)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_AUTHORIZATION_IDENTITY_INVALID');
    if (typeof recordedAtMs !== 'number' || !Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0 || recordedAtMs >= Number.MAX_SAFE_INTEGER)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_RECORDED_TIME_INVALID');
    if (genesis.schemaVersion !== 2 || typeof genesis.accountId !== 'string' || !genesis.accountId || typeof genesis.generationId !== 'string' || !genesis.generationId ||
        !Number.isSafeInteger(genesis.createdAtMs) || genesis.createdAtMs < 0 || typeof genesis.createdBy !== 'string' || !genesis.createdBy || typeof genesis.reason !== 'string' || !genesis.reason ||
        genesis.priorGenerationId !== null || genesis.origin !== 'EXPLICIT_OPERATOR_GENESIS' ||
        !/^(0|[1-9][0-9]*)$/.test(String(genesis.initialCapitalUsdMicro)) || !/^(0|[1-9][0-9]*)$/.test(String(genesis.openingCashUsdMicro)) ||
        !/^(0|[1-9][0-9]*)$/.test(String(genesis.initialCashAvailableUsdMicro)) ||
        ![genesis.accountingPolicyHash, genesis.riskPolicyHash, genesis.configHash, genesis.conversionPolicyHash, genesis.simulatorBuildHash, genesis.tokenMetadataPolicyHash].every(value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) ||
        typeof genesis.simulatorReportSchema !== 'string' || !genesis.simulatorReportSchema)
        fail('PAPER_ACCOUNT_V3_GENESIS_INVALID');
}
function makeJournalEvent(envelope) {
    const hashes = paperAccountV2EventHash(envelope);
    return { ...envelope, ...hashes };
}
function insertEvent(db, event) {
    db.prepare(`INSERT INTO pa2_events(account_id,generation_id,event_id,account_sequence,generation_sequence,event_type,payload_version,command_id,owner_epoch,
    occurred_at_ms,recorded_at_ms,payload_bytes,payload_sha256,previous_event_sha256,event_sha256)
    VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)`).run(event.accountId, event.generationId, event.eventId, event.accountSequence, event.generationSequence, event.eventType, event.payloadVersion, event.ownerEpoch, event.occurredAtMs, event.recordedAtMs, Buffer.from(event.payloadBytes), event.payloadSha256, event.previousEventSha256, event.eventSha256);
}
function payload(event) { return parseSylphJcs1(event.payloadBytes); }
function makeEvents(genesis, genesisBytes, operatorAuthorization, recordedAtMs) {
    const genesisSha256 = paperAccountV2GenesisHash(genesisBytes);
    const firstPayload = serializeSylphJcs1({ accountId: genesis.accountId, bootstrapOrigin: genesis.origin, generationId: genesis.generationId,
        genesisFingerprint: genesisSha256, operatorAuthorization });
    const first = makeJournalEvent({ accountId: genesis.accountId, generationId: genesis.generationId, eventId: randomUUID().toLowerCase(), eventType: 'ACCOUNT_BOOTSTRAPPED',
        payloadVersion: 1, accountSequence: 1, generationSequence: 1, ownerEpoch: 0, occurredAtMs: genesis.createdAtMs, recordedAtMs, payloadBytes: firstPayload, previousEventSha256: ZERO_HASH });
    const secondPayload = serializeSylphJcs1({ accountingPolicyHash: genesis.accountingPolicyHash, configHash: genesis.configHash, conversionPolicyHash: genesis.conversionPolicyHash,
        createdBy: genesis.createdBy, genesisSha256: genesisSha256, initialCapitalUsdMicro: genesis.initialCapitalUsdMicro, openingCashUsdMicro: genesis.openingCashUsdMicro,
        origin: genesis.origin, priorGenerationId: genesis.priorGenerationId, reason: genesis.reason, riskPolicyHash: genesis.riskPolicyHash, schemaVersion: 2,
        simulatorBuildHash: genesis.simulatorBuildHash, simulatorReportSchema: genesis.simulatorReportSchema, tokenMetadataPolicyHash: genesis.tokenMetadataPolicyHash });
    const second = makeJournalEvent({ accountId: genesis.accountId, generationId: genesis.generationId, eventId: randomUUID().toLowerCase(), eventType: 'GENERATION_CREATED',
        payloadVersion: 1, accountSequence: 2, generationSequence: 2, ownerEpoch: 0, occurredAtMs: genesis.createdAtMs, recordedAtMs: recordedAtMs + 1, payloadBytes: secondPayload, previousEventSha256: first.eventSha256 });
    verifyPaperAccountV2BootstrapPrefix(genesisBytes, [first, second]);
    return [first, second];
}
function resultFrom(events, genesisSha256, created) {
    return { accountId: events[0].accountId, generationId: events[0].generationId, genesisSha256, firstEventId: events[0].eventId, secondEventId: events[1].eventId,
        lastAccountSequence: 2, lastGenerationSequence: 2, lastEventSha256: events[1].eventSha256, admissionState: 'BLOCKED', generationState: 'PENDING', ownerEpoch: 0, created };
}
/** Re-reads and validates only the inert bootstrap prefix; this does not recover or admit an account. */
export function verifyPaperAccountV3Bootstrap(db, genesisBytes, operatorAuthorization) {
    const stable = canonicalSylphJcs1Snapshot(genesisBytes);
    const genesis = stable.value;
    validateGenesis(genesis, operatorAuthorization, 0);
    const genesisSha256 = paperAccountV2GenesisHash(stable.bytes);
    const accounts = db.prepare('SELECT * FROM pa2_accounts ORDER BY account_id').all();
    if (accounts.length !== 1 || accounts[0].account_id !== genesis.accountId)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_CONFLICT');
    const account = accounts[0];
    if (account.active_generation_id !== null || account.admission_state !== 'BLOCKED' || account.owner_id !== null || account.owner_epoch !== 0 || account.lease_id !== null ||
        account.lease_until_ms !== null || account.lease_renewed_at_ms !== null || account.stop_epoch !== 0 || account.emergency_stop_id !== null || account.emergency_stop_sha256 !== null)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_STATE_INVALID');
    if (account.state_version !== 2)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_STATE_INVALID');
    const generations = db.prepare('SELECT * FROM pa2_generations WHERE account_id=? ORDER BY generation_id').all(genesis.accountId);
    if (generations.length !== 1)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_STATE_INVALID');
    const generation = generations[0];
    const bytesValue = canonicalSylphJcs1Snapshot(generation.genesis_json).bytes;
    if (generation.generation_id !== genesis.generationId || !bytesValue.equals(stable.bytes) || generation.genesis_sha256 !== genesisSha256 || generation.schema_version !== 2 ||
        generation.created_at_ms !== genesis.createdAtMs || generation.created_by !== genesis.createdBy || generation.reason !== genesis.reason || generation.prior_generation_id !== null ||
        generation.origin !== genesis.origin || generation.initial_capital_usd_micro !== genesis.initialCapitalUsdMicro || generation.opening_cash_usd_micro !== genesis.openingCashUsdMicro ||
        generation.initial_cash_available_usd_micro !== genesis.initialCashAvailableUsdMicro || generation.accounting_policy_hash !== genesis.accountingPolicyHash ||
        generation.risk_policy_hash !== genesis.riskPolicyHash || generation.config_hash !== genesis.configHash || generation.conversion_policy_hash !== genesis.conversionPolicyHash ||
        generation.simulator_build_hash !== genesis.simulatorBuildHash || generation.simulator_report_schema !== genesis.simulatorReportSchema ||
        generation.token_metadata_policy_hash !== genesis.tokenMetadataPolicyHash || generation.generation_state !== 'PENDING')
        fail('PAPER_ACCOUNT_V3_GENESIS_ROW_MISMATCH');
    const allEvents = db.prepare('SELECT * FROM pa2_events WHERE account_id=? ORDER BY account_sequence').all(genesis.accountId);
    if (allEvents.length !== 2)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_EVENT_COUNT_INVALID');
    if (allEvents.some(row => row.command_id !== null))
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_EVENT_COMMAND_SCOPE_INVALID');
    const events = allEvents.map(row => ({ accountId: row.account_id, generationId: row.generation_id, eventId: row.event_id,
        eventType: row.event_type, payloadVersion: row.payload_version, accountSequence: row.account_sequence,
        generationSequence: row.generation_sequence, ownerEpoch: row.owner_epoch, occurredAtMs: row.occurred_at_ms,
        recordedAtMs: row.recorded_at_ms, payloadBytes: canonicalSylphJcs1Snapshot(row.payload_bytes).bytes, payloadSha256: row.payload_sha256,
        previousEventSha256: row.previous_event_sha256, eventSha256: row.event_sha256 }));
    const projection = verifyPaperAccountV2BootstrapPrefix(stable.bytes, events);
    const firstPayload = payload(events[0]);
    if (firstPayload.operatorAuthorization !== operatorAuthorization)
        fail('PAPER_ACCOUNT_V3_BOOTSTRAP_AUTHORIZATION_IDENTITY_MISMATCH');
    for (const table of ['pa2_commands', 'pa2_simulation_reports', 'pa2_reservations', 'pa2_position_lots', 'pa2_risk_watermarks', 'pa2_fills', 'pa2_projection_snapshots', 'pa2_outbox']) {
        if (Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_id=?`).get(genesis.accountId)?.n) !== 0)
            fail('PAPER_ACCOUNT_V3_BOOTSTRAP_HAS_NONBOOTSTRAP_STATE');
    }
    return resultFrom(events, projection.genesisSha256, false);
}
/**
 * Explicit one-time blocked bootstrap. Production callers must hold the same-host startup OS process lock;
 * BEGIN IMMEDIATE serializes SQLite writers and prevents duplicate DB commits, but is not a substitute for
 * that lifecycle lock. The optional hook exists only for disposable crash tests.
 */
export function bootstrapPaperAccountV3(db, genesisBytes, operatorAuthorization, recordedAtMs, hook = noop) {
    verifyPaperAccountV3WritePreconditions(db);
    const stable = canonicalSylphJcs1Snapshot(genesisBytes);
    const genesis = stable.value;
    validateGenesis(genesis, operatorAuthorization, recordedAtMs);
    const events = makeEvents(genesis, stable.bytes, operatorAuthorization, recordedAtMs);
    const genesisSha256 = paperAccountV2GenesisHash(stable.bytes);
    db.exec('BEGIN IMMEDIATE');
    let active = true;
    try {
        const existing = db.prepare('SELECT account_id FROM pa2_accounts ORDER BY account_id').all();
        if (existing.length > 0) {
            if (existing.length !== 1 || existing[0].account_id !== genesis.accountId)
                fail('PAPER_ACCOUNT_V3_BOOTSTRAP_CONFLICT');
            const existingGeneration = db.prepare('SELECT genesis_json,genesis_sha256 FROM pa2_generations WHERE account_id=? AND generation_id=?').get(genesis.accountId, genesis.generationId);
            if (!existingGeneration || existingGeneration.genesis_sha256 !== genesisSha256 || !canonicalSylphJcs1Snapshot(existingGeneration.genesis_json).bytes.equals(stable.bytes))
                fail('PAPER_ACCOUNT_V3_BOOTSTRAP_CONFLICT');
            const prior = verifyPaperAccountV3Bootstrap(db, stable.bytes, operatorAuthorization);
            db.exec('COMMIT');
            active = false;
            hook('after-commit-before-ack');
            return prior;
        }
        for (const table of ['pa2_generations', 'pa2_events', 'pa2_commands', 'pa2_simulation_reports', 'pa2_reservations', 'pa2_position_lots', 'pa2_risk_watermarks', 'pa2_fills', 'pa2_projection_snapshots', 'pa2_outbox']) {
            if (Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) !== 0)
                fail('PAPER_ACCOUNT_V3_BOOTSTRAP_DATABASE_NOT_EMPTY');
        }
        db.prepare(`INSERT INTO pa2_accounts(account_id,active_generation_id,admission_state,owner_id,owner_epoch,lease_id,lease_until_ms,lease_renewed_at_ms,
      state_version,stop_epoch,emergency_stop_id,emergency_stop_sha256) VALUES(?,NULL,'BLOCKED',NULL,0,NULL,NULL,NULL,2,0,NULL,NULL)`).run(genesis.accountId);
        hook('after-account-before-commit');
        db.prepare(`INSERT INTO pa2_generations(account_id,generation_id,genesis_json,genesis_sha256,schema_version,created_at_ms,created_by,reason,prior_generation_id,origin,
      initial_capital_usd_micro,opening_cash_usd_micro,initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,
      simulator_build_hash,simulator_report_schema,token_metadata_policy_hash,generation_state)
      VALUES(?,?,?,?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`).run(genesis.accountId, genesis.generationId, stable.bytes, genesisSha256, genesis.createdAtMs, genesis.createdBy, genesis.reason, genesis.priorGenerationId, genesis.origin, genesis.initialCapitalUsdMicro, genesis.openingCashUsdMicro, genesis.initialCashAvailableUsdMicro, genesis.accountingPolicyHash, genesis.riskPolicyHash, genesis.configHash, genesis.conversionPolicyHash, genesis.simulatorBuildHash, genesis.simulatorReportSchema, genesis.tokenMetadataPolicyHash);
        hook('after-generation-before-commit');
        insertEvent(db, events[0]);
        hook('after-first-event-before-commit');
        insertEvent(db, events[1]);
        hook('after-second-event-before-commit');
        const verified = verifyPaperAccountV3Bootstrap(db, stable.bytes, operatorAuthorization);
        db.exec('COMMIT');
        active = false;
        hook('after-commit-before-ack');
        return { ...verified, firstEventId: events[0].eventId, secondEventId: events[1].eventId, lastEventSha256: events[1].eventSha256, created: true };
    }
    catch (error) {
        if (active) {
            try {
                db.exec('ROLLBACK');
            }
            catch (rollbackError) {
                // The transaction outcome is unknown. Poison this handle; callers must reopen and verify before use.
                try {
                    db.close();
                }
                catch { }
                const fatal = new Error('PAPER_ACCOUNT_V3_ROLLBACK_FAILED', { cause: rollbackError });
                fatal.code = 'PAPER_ACCOUNT_V3_ROLLBACK_FAILED';
                throw fatal;
            }
        }
        throw error;
    }
}
//# sourceMappingURL=paper-account-v3-bootstrap.js.map
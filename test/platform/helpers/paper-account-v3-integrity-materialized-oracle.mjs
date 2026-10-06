import { canonicalSylphJcs1Snapshot, paperAccountV2EventHash, serializeSylphJcs1, verifyPaperAccountV2BootstrapPrefix, verifyPaperAccountV2GenesisDocument } from '../../../dist/platform/storage/paper-account-v3-codec.js';
import { verifyPaperAccountV3Schema } from '../../../dist/platform/storage/paper-account-v3-schema.js';
const ZERO_HASH = '0'.repeat(64);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN_EVENT_TYPES = new Set([
    'ACCOUNT_BOOTSTRAPPED', 'GENERATION_CREATED', 'ACTIVATION_AUTHORIZATION_RESERVED', 'GENERATION_ACTIVATED', 'GENERATION_SEALED',
    'OWNER_ACQUIRED', 'OWNER_RENEWED', 'OWNER_RELEASED', 'OWNER_FENCED', 'RECOVERY_HOLD', 'RECOVERY_RELEASED', 'COMMAND_ACCEPTED',
    'COMMAND_REJECTED', 'SIMULATED', 'SIMULATION_OUTCOME_UNRESOLVED', 'SIMULATION_REJECTED', 'SETTLEMENT', 'RISK_WATERMARK_OBSERVED',
    'RISK_WATERMARK_UNRESOLVED', 'COMMAND_MANUALLY_RESOLVED', 'CAPITAL_ADJUSTED', 'EMERGENCY_STOP_LATCHED',
    'EMERGENCY_STOP_CLEAR_INTENT', 'EMERGENCY_STOP_CLEARED', 'RISK_REPAIR', 'COMMAND_CANCELLED_BEFORE_SIMULATION'
]);
const BOOTSTRAP_EVENT_TYPES = new Set(['ACCOUNT_BOOTSTRAPPED', 'GENERATION_CREATED']);
const fail = (code) => { throw new Error(code); };
function safeInteger(value, code, min = 0) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
        return fail(code);
    const parsed = BigInt(value);
    if (parsed < BigInt(min) || parsed > BigInt(Number.MAX_SAFE_INTEGER))
        return fail(code);
    return Number(parsed);
}
function text(value, code) {
    if (typeof value !== 'string' || value.length === 0)
        return fail(code);
    return value;
}
function hash(value, code) {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
        return fail(code);
    return value;
}
function bytes(value, code) {
    if (!(value instanceof Uint8Array))
        return fail(code);
    try {
        return canonicalSylphJcs1Snapshot(value).bytes;
    }
    catch {
        return fail(code);
    }
}
function equalBytes(left, right) { return Buffer.from(left).equals(Buffer.from(right)); }
function validateGenerationRow(row) {
    const accountId = text(row.account_id, 'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
    const generationId = text(row.generation_id, 'PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ROW_INVALID');
    const genesisBytes = bytes(row.genesis_json, 'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_BYTES_INVALID');
    let verified;
    try {
        verified = verifyPaperAccountV2GenesisDocument(genesisBytes);
    }
    catch {
        return fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_INVALID');
    }
    const g = verified.genesis;
    const priorGenerationId = g.priorGenerationId;
    if (g.origin !== 'EXPLICIT_OPERATOR_GENESIS' || g.accountId !== accountId || g.generationId !== generationId ||
        hash(row.genesis_sha256, 'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH') !== verified.genesisSha256 ||
        safeInteger(row.schema_version_text, 'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH') !== g.schemaVersion ||
        safeInteger(row.created_at_ms_text, 'PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH') !== g.createdAtMs ||
        row.created_by !== g.createdBy || row.reason !== g.reason || row.prior_generation_id !== priorGenerationId || row.origin !== g.origin ||
        row.initial_capital_usd_micro !== g.initialCapitalUsdMicro || row.opening_cash_usd_micro !== g.openingCashUsdMicro ||
        row.initial_cash_available_usd_micro !== g.initialCashAvailableUsdMicro || row.accounting_policy_hash !== g.accountingPolicyHash ||
        row.risk_policy_hash !== g.riskPolicyHash || row.config_hash !== g.configHash || row.conversion_policy_hash !== g.conversionPolicyHash ||
        row.simulator_build_hash !== g.simulatorBuildHash || row.simulator_report_schema !== g.simulatorReportSchema ||
        row.token_metadata_policy_hash !== g.tokenMetadataPolicyHash)
        fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROW_MISMATCH');
    return { accountId, generationId, genesisBytes, genesisSha256: verified.genesisSha256, priorGenerationId };
}
function eventFromRow(row) {
    const accountId = text(row.account_id, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const generationId = text(row.generation_id, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const eventId = text(row.event_id, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const eventType = text(row.event_type, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    if (!UUID.test(eventId))
        fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ID_INVALID');
    if (row.command_id !== null && typeof row.command_id !== 'string')
        fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID');
    const payloadBytes = bytes(row.payload_bytes, 'PAPER_ACCOUNT_V3_JOURNAL_PAYLOAD_NONCANONICAL');
    return { accountId, generationId, eventId, eventType, payloadVersion: safeInteger(row.payload_version_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID', 1),
        accountSequence: safeInteger(row.account_sequence_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID', 1),
        generationSequence: safeInteger(row.generation_sequence_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID', 1),
        ownerEpoch: safeInteger(row.owner_epoch_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
        occurredAtMs: safeInteger(row.occurred_at_ms_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
        recordedAtMs: safeInteger(row.recorded_at_ms_text, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'), payloadBytes,
        previousEventSha256: hash(row.previous_event_sha256, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'),
        payloadSha256: hash(row.payload_sha256, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID'), eventSha256: hash(row.event_sha256, 'PAPER_ACCOUNT_V3_JOURNAL_EVENT_ROW_INVALID') };
}
function generationCreatedPayload(generation) {
    const genesis = parseGeneration(generation.genesisBytes);
    return Buffer.from(serializeSylphJcs1({ accountingPolicyHash: genesis.accountingPolicyHash, configHash: genesis.configHash,
        conversionPolicyHash: genesis.conversionPolicyHash, createdBy: genesis.createdBy, genesisSha256: generation.genesisSha256,
        initialCapitalUsdMicro: genesis.initialCapitalUsdMicro, openingCashUsdMicro: genesis.openingCashUsdMicro, origin: genesis.origin,
        priorGenerationId: genesis.priorGenerationId, reason: genesis.reason, riskPolicyHash: genesis.riskPolicyHash, schemaVersion: 2,
        simulatorBuildHash: genesis.simulatorBuildHash, simulatorReportSchema: genesis.simulatorReportSchema,
        tokenMetadataPolicyHash: genesis.tokenMetadataPolicyHash }));
}
function parseGeneration(genesisBytes) {
    return verifyPaperAccountV2GenesisDocument(genesisBytes).genesis;
}
/**
 * Verifies persisted v3 journal bytes and immutable genesis commitments only.
 * It performs SELECT/PRAGMA integrity reads; it does not fold account state, validate
 * transition legality, authorize an owner, or establish recovery/readiness.
 */
export function verifyPaperAccountV3JournalIntegrity(db) {
    verifyPaperAccountV3Schema(db);
    const accountRows = db.prepare('SELECT account_id FROM pa2_accounts ORDER BY account_id').all();
    const accountIds = new Set();
    for (const row of accountRows) {
        const id = text(row.account_id, 'PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_ROW_INVALID');
        if (accountIds.has(id))
            fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_DUPLICATE');
        accountIds.add(id);
    }
    const generationRows = db.prepare(`SELECT account_id,generation_id,genesis_json,genesis_sha256,CAST(schema_version AS TEXT) schema_version_text,
    CAST(created_at_ms AS TEXT) created_at_ms_text,created_by,reason,prior_generation_id,origin,initial_capital_usd_micro,opening_cash_usd_micro,
    initial_cash_available_usd_micro,accounting_policy_hash,risk_policy_hash,config_hash,conversion_policy_hash,simulator_build_hash,
    simulator_report_schema,token_metadata_policy_hash FROM pa2_generations ORDER BY account_id,generation_id`).all();
    const generations = new Map();
    for (const row of generationRows) {
        const value = validateGenerationRow(row);
        const key = `${value.accountId}\0${value.generationId}`;
        if (!accountIds.has(value.accountId) || generations.has(key))
            fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_IDENTITY_INVALID');
        generations.set(key, value);
    }
    const eventRows = db.prepare(`SELECT account_id,generation_id,event_id,CAST(account_sequence AS TEXT) account_sequence_text,
    CAST(generation_sequence AS TEXT) generation_sequence_text,event_type,CAST(payload_version AS TEXT) payload_version_text,command_id,
    CAST(owner_epoch AS TEXT) owner_epoch_text,CAST(occurred_at_ms AS TEXT) occurred_at_ms_text,CAST(recorded_at_ms AS TEXT) recorded_at_ms_text,
    payload_bytes,payload_sha256,previous_event_sha256,event_sha256 FROM pa2_events ORDER BY account_id,account_sequence`).all();
    const eventsByAccount = new Map();
    const eventsByGeneration = new Map();
    const rawCommandIdByEvent = new Map();
    const unsupported = new Map();
    for (const row of eventRows) {
        const event = eventFromRow(row);
        const generationKey = `${event.accountId}\0${event.generationId}`;
        if (!accountIds.has(event.accountId) || !generations.has(generationKey))
            fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_SCOPE_INVALID');
        if (event.ownerEpoch === 0 && !BOOTSTRAP_EVENT_TYPES.has(event.eventType))
            fail('PAPER_ACCOUNT_V3_JOURNAL_ZERO_OWNER_EPOCH_INVALID');
        if (event.eventType === 'ACCOUNT_BOOTSTRAPPED' && event.ownerEpoch !== 0)
            fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_OWNER_EPOCH_INVALID');
        if (!BOOTSTRAP_EVENT_TYPES.has(event.eventType)) {
            const classification = KNOWN_EVENT_TYPES.has(event.eventType) && event.payloadVersion === 1 ? 'KNOWN_SEMANTICS_UNVERIFIED' : 'UNKNOWN_UNSUPPORTED';
            const entry = { eventType: event.eventType, payloadVersion: event.payloadVersion, classification };
            unsupported.set(`${event.eventType}\0${event.payloadVersion}`, entry);
        }
        const accountEvents = eventsByAccount.get(event.accountId) ?? [];
        accountEvents.push(event);
        eventsByAccount.set(event.accountId, accountEvents);
        const generationEvents = eventsByGeneration.get(generationKey) ?? [];
        generationEvents.push(event);
        eventsByGeneration.set(generationKey, generationEvents);
        rawCommandIdByEvent.set(`${event.accountId}\0${event.eventId}`, row.command_id);
    }
    if (accountIds.size !== accountRows.length)
        fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_DUPLICATE');
    for (const accountId of accountIds) {
        const generationsForAccount = [...generations.values()].filter(g => g.accountId === accountId);
        const events = eventsByAccount.get(accountId) ?? [];
        if (generationsForAccount.length === 0 || events.length < 2)
            fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_PREFIX_MISSING');
        let previous = ZERO_HASH;
        const perGenerationNext = new Map();
        const createdEvents = new Map();
        const seenEventIds = new Set();
        for (let index = 0; index < events.length; index++) {
            const event = events[index];
            const expectedAccountSequence = index + 1;
            if (event.accountSequence !== expectedAccountSequence || event.previousEventSha256 !== previous)
                fail('PAPER_ACCOUNT_V3_JOURNAL_ACCOUNT_CHAIN_GAP');
            if (seenEventIds.has(event.eventId))
                fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_ID_DUPLICATE');
            seenEventIds.add(event.eventId);
            const key = `${event.accountId}\0${event.generationId}`;
            const expectedGenerationSequence = perGenerationNext.get(key) ?? 1;
            if (event.generationSequence !== expectedGenerationSequence)
                fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_SEQUENCE_GAP');
            perGenerationNext.set(key, expectedGenerationSequence + 1);
            const calculated = paperAccountV2EventHash({ accountId: event.accountId, generationId: event.generationId, eventId: event.eventId, eventType: event.eventType,
                payloadVersion: event.payloadVersion, accountSequence: event.accountSequence, generationSequence: event.generationSequence, ownerEpoch: event.ownerEpoch,
                occurredAtMs: event.occurredAtMs, recordedAtMs: event.recordedAtMs, payloadBytes: event.payloadBytes, previousEventSha256: event.previousEventSha256 });
            if (calculated.payloadSha256 !== event.payloadSha256 || calculated.eventSha256 !== event.eventSha256)
                fail('PAPER_ACCOUNT_V3_JOURNAL_EVENT_HASH_MISMATCH');
            previous = event.eventSha256;
            if (event.eventType === 'ACCOUNT_BOOTSTRAPPED') {
                if (event.accountSequence !== 1 || event.generationSequence !== 1 || event.ownerEpoch !== 0 || rawCommandIdByEvent.get(`${event.accountId}\0${event.eventId}`) !== null)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
            }
            if (event.eventType === 'GENERATION_CREATED') {
                if (event.payloadVersion !== 1)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATED_VERSION_UNSUPPORTED');
                const prior = createdEvents.get(event.generationId);
                if (prior)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_DUPLICATE_GENERATION_CREATED');
                createdEvents.set(event.generationId, event);
                const generation = generations.get(key);
                if (event.ownerEpoch === 0) {
                    if (event.accountSequence !== 2 || event.generationSequence !== 2 || generation.priorGenerationId !== null ||
                        rawCommandIdByEvent.get(`${event.accountId}\0${event.eventId}`) !== null)
                        fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
                }
                else if (event.generationSequence !== 1)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATED_SEQUENCE_INVALID');
                if (!equalBytes(event.payloadBytes, generationCreatedPayload(generation)))
                    fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_COMMITMENT_MISMATCH');
            }
        }
        const rootGenerations = generationsForAccount.filter(g => g.priorGenerationId === null);
        if (rootGenerations.length !== 1)
            fail('PAPER_ACCOUNT_V3_JOURNAL_GENESIS_ROOT_INVALID');
        const root = rootGenerations[0];
        const rootEvents = eventsByGeneration.get(`${accountId}\0${root.generationId}`) ?? [];
        if (events[0].eventType !== 'ACCOUNT_BOOTSTRAPPED' || events[1].eventType !== 'GENERATION_CREATED' ||
            events[0].generationId !== root.generationId || events[1].generationId !== root.generationId)
            fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_PREFIX_INVALID');
        if (rawCommandIdByEvent.get(`${accountId}\0${events[0].eventId}`) !== null || rawCommandIdByEvent.get(`${accountId}\0${events[1].eventId}`) !== null)
            fail('PAPER_ACCOUNT_V3_JOURNAL_BOOTSTRAP_EVENT_INVALID');
        verifyPaperAccountV2BootstrapPrefix(root.genesisBytes, rootEvents.slice(0, 2));
        for (const generation of generationsForAccount) {
            const key = `${accountId}\0${generation.generationId}`;
            const generationEvents = eventsByGeneration.get(key) ?? [];
            if (generationEvents.length === 0 || !createdEvents.has(generation.generationId))
                fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_CREATION_MISSING');
            if (generation.priorGenerationId !== null) {
                const prior = generations.get(`${accountId}\0${generation.priorGenerationId}`);
                if (prior === undefined)
                    throw new Error('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_PARENT_INVALID');
                if (prior.generationId === generation.generationId)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_PARENT_INVALID');
                const priorCreated = createdEvents.get(prior.generationId);
                const created = createdEvents.get(generation.generationId);
                if (priorCreated.accountSequence >= created.accountSequence)
                    fail('PAPER_ACCOUNT_V3_JOURNAL_GENERATION_ORDER_INVALID');
            }
        }
    }
    const unsupportedEventTypes = [...unsupported.values()].sort((a, b) => a.eventType < b.eventType ? -1 : a.eventType > b.eventType ? 1 : a.payloadVersion - b.payloadVersion);
    const accounts = [...accountIds].sort().map(accountId => {
        const events = eventsByAccount.get(accountId);
        return { accountId, eventCount: events.length, generationCount: [...generations.values()].filter(g => g.accountId === accountId).length,
            firstAccountSequence: 1, lastAccountSequence: events.length, lastEventSha256: events[events.length - 1].eventSha256 };
    });
    return { schemaVersion: 3, integrityVerified: true, semanticsVerified: false, admissionEligible: false, held: true,
        accountCount: accountIds.size, eventCount: eventRows.length, accounts, unsupportedEventTypes };
}
//# sourceMappingURL=paper-account-v3-integrity.js.map
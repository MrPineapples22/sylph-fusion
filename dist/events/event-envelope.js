/**
 * SOL-SYLPH Canonical Event Contract & Quality State Framework
 * Specifications: Sections 6, 7, 8, 9, 10.
 */
import { createHash } from 'node:crypto';
export function computePayloadHash(payload) {
    const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return createHash('sha256').update(serialized).digest('hex');
}
export function evaluateDataQuality(sourceTimestamp, now = Date.now(), freshTtlMs = 3000, staleTtlMs = 10_000) {
    if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0)
        return 'UNKNOWN';
    const age = now - sourceTimestamp;
    if (age < 0)
        return 'CONFLICTED'; // clock drift or future timestamp
    if (age <= freshTtlMs)
        return 'FRESH';
    if (age <= staleTtlMs)
        return 'AGING';
    return 'STALE';
}
export function createEventEnvelope(params) {
    const now = Date.now();
    const freshnessDeadline = now + (params.freshness_deadline_ms ?? 5000);
    const quality = evaluateDataQuality(params.source_timestamp, now);
    const payloadHash = computePayloadHash(params.payload);
    return {
        event_id: params.event_id,
        event_type: params.event_type,
        schema_version: '2.0.0',
        source: params.source,
        provider_instance: params.provider_instance ?? 'primary',
        cluster: params.cluster ?? 'mainnet-beta',
        mint: params.mint,
        pool: params.pool,
        wallet: params.wallet,
        transaction_signature: params.transaction_signature,
        source_timestamp: params.source_timestamp,
        received_timestamp: now,
        processed_timestamp: now,
        slot: params.slot,
        commitment: params.commitment ?? 'confirmed',
        sequence_number: params.sequence_number ?? 1,
        payload: params.payload,
        payload_hash: payloadHash,
        freshness_deadline: freshnessDeadline,
        quality_state: quality,
        correlation_id: params.correlation_id ?? `corr_${params.event_id}`,
        causation_id: params.causation_id,
        config_version: params.config_version ?? '1.0.0',
        producer_version: params.producer_version ?? 'sylph-v2.5',
    };
}
//# sourceMappingURL=event-envelope.js.map
/**
 * SOL-SYLPH Canonical Event Contract & Quality State Framework
 * Specifications: Sections 6, 7, 8, 9, 10.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

export type QualityState = 'FRESH' | 'AGING' | 'STALE' | 'CONFLICTED' | 'UNKNOWN' | 'UNAVAILABLE';

export type OperationalMode =
  | 'NORMAL'
  | 'OPEN_LOCKED'
  | 'REDUCE_ONLY'
  | 'EMERGENCY_UNWIND'
  | 'ALL_EXECUTION_HALTED';

export interface EventEnvelope<T = unknown> {
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: string;

  readonly source: string;
  readonly provider_instance: string;

  readonly cluster: 'mainnet-beta' | 'devnet' | 'localnet' | 'synthetic';
  readonly mint?: string;
  readonly pool?: string;
  readonly wallet?: string;
  readonly transaction_signature?: string;

  readonly source_timestamp: number;
  readonly received_timestamp: number;
  readonly processed_timestamp: number;

  readonly slot: number;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly sequence_number: number;

  readonly payload: T;
  readonly payload_hash: string;

  readonly freshness_deadline: number;
  readonly quality_state: QualityState;

  readonly correlation_id: string;
  readonly causation_id?: string;

  readonly config_version: string;
  readonly producer_version: string;
}

export function computePayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  return createHash('sha256').update(serialized).digest('hex');
}

export function evaluateDataQuality(
  sourceTimestamp: number,
  now = Date.now(),
  freshTtlMs = 3000,
  staleTtlMs = 10_000
): QualityState {
  if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0) return 'UNKNOWN';
  const age = now - sourceTimestamp;
  if (age < 0) return 'CONFLICTED'; // clock drift or future timestamp
  if (age <= freshTtlMs) return 'FRESH';
  if (age <= staleTtlMs) return 'AGING';
  return 'STALE';
}

export function createEventEnvelope<T>(params: {
  event_id: string;
  event_type: string;
  source: string;
  provider_instance?: string;
  cluster?: 'mainnet-beta' | 'devnet' | 'localnet' | 'synthetic';
  mint?: string;
  pool?: string;
  wallet?: string;
  transaction_signature?: string;
  source_timestamp: number;
  slot: number;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  sequence_number?: number;
  payload: T;
  freshness_deadline_ms?: number;
  correlation_id?: string;
  causation_id?: string;
  config_version?: string;
  producer_version?: string;
}): EventEnvelope<T> {
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

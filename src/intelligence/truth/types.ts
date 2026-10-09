/**
 * SOL-SYLPH Master Production Intelligence - Truth & Temporal Integrity Types
 * Specifications: Sections 5 (Canonical Data Truth), 6 (Chain Truth Engine),
 * 7 (RPC Provider Pool), 8 (Temporal Firewall), 9 (Point-in-Time Feature Store).
 */

export type ChainCommitment = 'processed' | 'confirmed' | 'finalized';

export type CanonicalChainState =
  | 'TENTATIVE'
  | 'CONFIRMED'
  | 'FINAL'
  | 'ORPHANED'
  | 'REPLACED';

export type CanonicalEventType =
  | 'SWAP_BUY'
  | 'SWAP_SELL'
  | 'POOL_CREATE'
  | 'LIQUIDITY_ADD'
  | 'LIQUIDITY_REMOVE'
  | 'TOKEN_MINT'
  | 'TOKEN_BURN'
  | 'ACCOUNT_UPDATE'
  | 'BLOCK_SLOT_UPDATE';

export interface CanonicalEventProvenance {
  readonly endpointId: string;
  readonly transport: 'websocket' | 'rpc_poll' | 'geyser_grpc';
  readonly rawPayloadHash: string;
  readonly ingestedByWorkerId: string;
  readonly wireEncoding?: 'RAW_WIRE_BYTES' | 'DECODED_PROTOBUF_JSON_CANONICAL' | 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES';
}

export interface CanonicalEvent<TPayload = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: CanonicalEventType | string;
  readonly mint: string;
  readonly wallet?: string;
  readonly program?: string;
  readonly signature?: string;
  readonly instructionIndex?: number;
  readonly innerInstructionIndex?: number;
  readonly source: string; // e.g. 'pump_portal', 'solana_rpc', 'dex_screener'
  readonly sourceEventId?: string;
  readonly sourceTimestampMs: number;
  readonly receivedTimestampMs: number;
  readonly monotonicTimestamp?: number | bigint;
  readonly monotonicTimestampNs?: bigint;
  readonly normalizedTime?: number;
  readonly slot: number;
  readonly parentSlot?: number;
  readonly blockhash?: string;
  readonly commitment: ChainCommitment;
  readonly transactionVersion?: 'legacy' | 0;
  readonly sequenceId?: bigint | number;
  readonly schemaVersion?: string;
  chainState: CanonicalChainState;
  readonly payload: TPayload;
  readonly payloadHash?: string;
  readonly sourceConfidence: number; // 0.0 to 1.0
  readonly confidence?: number;
  readonly freshnessMs: number;
  readonly provenance: CanonicalEventProvenance | readonly string[];
}

export interface SourceHealthMetrics {
  readonly providerId: string;
  readonly technicalHealth: {
    readonly isAvailable: boolean;
    readonly latencyP50Ms: number;
    readonly latencyP95Ms: number;
    readonly latencyP99Ms: number;
    readonly errorRatePct: number;
    readonly connectionState: 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
  };
  readonly semanticHealth: {
    readonly eventFreshnessMs: number;
    readonly missingEventRatePct: number;
    readonly duplicateRatePct: number;
    readonly disagreementRatePct: number;
    readonly isSemanticallyUsable: boolean;
  };
}

export interface RpcEndpointHealth {
  readonly endpointId: string;
  readonly url: string;
  readonly latencyMs: number;
  readonly slotLag: number;
  readonly currentSlot: number;
  readonly blockhash: string;
  readonly errorRateBps: number;
  readonly rateLimitCount429: number;
  readonly consecutiveTimeouts: number;
  readonly isHealthy: boolean;
  readonly lastCheckedAtMs: number;
}

export interface FeatureSnapshot {
  readonly snapshotId: string;
  readonly mint: string;
  readonly slot: number;
  readonly timestampMs: number;
  readonly tokenAgeSeconds: number;
  readonly featureSchemaVersion: string;
  readonly features: Readonly<Record<string, number | string | boolean>>;
  readonly dataQualityScore: number; // 0.0 to 1.0
  readonly freshnessMs: number;
  readonly snapshotHash: string;
}

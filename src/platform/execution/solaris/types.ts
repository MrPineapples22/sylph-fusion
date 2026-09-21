/**
 * SOLARIS-NEXUS: Types & Contracts
 * Solana Leader-Aware Adaptive Routing & High-Frequency Ingestion Infrastructure
 */

export interface LeaderSlotInfo {
  readonly slot: number;
  readonly leaderPubkey: string;
  readonly isJitoLeader: boolean;
  readonly stakeWeightLamports: bigint;
  readonly epochSlotIndex: number;
  readonly clusterStakeShareBps: number;
}

export type BimodalRouteType = 'JITO_BUNDLE' | 'DIRECT_TPU_QUIC' | 'ABSTAIN_CONGESTION';

export interface BimodalRoutePlan {
  readonly routeType: BimodalRouteType;
  readonly targetSlot: number;
  readonly targetLeaderPubkey: string;
  readonly isJitoLeader: boolean;
  readonly recommendedJitoTipLamports: bigint;
  readonly recommendedPriorityMicroLamports: bigint;
  readonly computeUnitLimit: number;
  readonly rationale: string;
  readonly evaluatedAtMs: number;
}

export interface TipFloorSnapshot {
  readonly p25Lamports: bigint;
  readonly p50Lamports: bigint;
  readonly p75Lamports: bigint;
  readonly p95Lamports: bigint;
  readonly polledAtMs: number;
  readonly isFresh: boolean;
  readonly source: 'LIVE_API' | 'CACHE' | 'FALLBACK_MANDATE';
}

export type ContentionTier = 'NOMINAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface AccountContentionEstimate {
  readonly writeLockedAccounts: string[];
  readonly medianFeeMicroLamports: bigint;
  readonly p75FeeMicroLamports: bigint;
  readonly p95FeeMicroLamports: bigint;
  readonly recommendedMicroLamportsPerCu: bigint;
  readonly contentionTier: ContentionTier;
  readonly polledAtMs: number;
}

export type GraduationStatus =
  | 'BONDING_CURVE'
  | 'MIGRATION_PENDING'
  | 'SNIPER_COOLDOWN'
  | 'RAYDIUM_ACTIVE'
  | 'AMM_STABILIZED';

export interface GraduatedTokenState {
  readonly mint: string;
  readonly status: GraduationStatus;
  readonly migrationTriggeredAtSlot: number;
  readonly migrationTriggeredAtMs: number;
  readonly sniperCooldownExpiresAtMs: number;
  readonly raydiumPoolAddress?: string;
  readonly initialPoolSolLamports?: bigint;
  readonly currentPoolSolLamports?: bigint;
  readonly sniperDumpObserved: boolean;
  readonly fairPriceSol?: number;
}

export interface ReconcilerSlotGap {
  readonly startSlot: number;
  readonly endSlot: number;
  readonly missingSlotCount: number;
  readonly detectedAtMs: number;
  readonly reconciledSlotCount: number;
  readonly isResolved: boolean;
}

export interface SolarisTelemetrySnapshot {
  readonly currentSlot: number;
  readonly activeLeaderPubkey: string;
  readonly activeLeaderIsJito: boolean;
  readonly activeLeaderStakeBps: number;
  readonly remainingSlotsInChunk: number;
  readonly nextLeaderPubkey: string;
  readonly nextLeaderIsJito: boolean;
  readonly tipFloor: {
    readonly p25: string;
    readonly p50: string;
    readonly p75: string;
    readonly p95: string;
  };
  readonly contentionTier: ContentionTier;
  readonly recommendedPriorityMicroLamports: string;
  readonly activeGraduationCount: number;
  readonly resolvedGapsCount: number;
  readonly timestampMs: number;
  readonly helios?: {
    readonly directTransmissionsCount: number;
    readonly pipelinedTransmissionsCount: number;
    readonly fallbackTransmissionsCount: number;
    readonly avgTransmissionDurationMs: number;
    readonly activeTpuEndpointsCount: number;
  };
}

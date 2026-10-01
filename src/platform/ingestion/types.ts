export type ProcessingIntent =
  | 'LIVE'
  | 'HISTORICAL_REPAIR'
  | 'DETERMINISTIC_REPLAY'
  | 'SHADOW_REPLAY';

export type SlotGapClassification =
  | 'SKIPPED_SLOT'
  | 'DEAD_FORK'
  | 'MISSING_OBSERVATION'
  | 'PROVIDER_LOSS'
  | 'UNAVAILABLE_HISTORY'
  | 'PARTIAL_RECOVERY'
  | 'PROVIDER_DISAGREEMENT'
  | 'UNKNOWN';

export type CoverageLane =
  | 'CHAIN_BLOCK'
  | 'PUMP_TRANSACTION'
  | 'ACCOUNT_WRITE'
  | 'ENTRY'
  | 'FORK_LINEAGE'
  | 'BLOCK_FOOTER';

/** Immutable provenance for one provider observation. This is not proof of
 * transaction execution: log-only sources remain observations until decoded
 * transaction metadata and balance effects are independently verified. */
export interface RawObservationEnvelope {
  readonly observationId: string;
  readonly sourceId: string;
  readonly providerId: string;
  readonly transport: string;
  readonly receivedAt: number;
  readonly observedAt?: number;
  readonly slot?: number;
  readonly blockHeight?: number;
  readonly commitment?: 'processed' | 'confirmed' | 'finalized' | 'unknown';
  readonly signature?: string;
  readonly transactionVersion?: number | 'legacy' | 'unknown';
  readonly rawPayloadHash: string;
  readonly schemaVersion: string;
  readonly processingIntent?: ProcessingIntent;
}

export interface SlotReceipt {
  readonly slot: number;
  readonly signatureCount: number;
  readonly receivedAtMs: number;
  readonly isBackfilled: boolean;
  readonly processingIntent?: ProcessingIntent;
}

export interface SlotGap {
  readonly gapId?: string;
  readonly startSlot: number;
  readonly endSlot: number;
  readonly missingSlotCount: number;
  readonly detectedAtMs: number;
  readonly resolvedAtMs?: number;
  readonly isResolved: boolean;
  readonly providerId?: string;
  readonly classification?: SlotGapClassification;
  readonly lane?: CoverageLane;
  readonly bankHash?: string;
}

export interface RecoveryCertificate {
  readonly certificateId: string;
  readonly gapId: string;
  readonly startSlot: number;
  readonly endSlot: number;
  readonly providerId: string;
  readonly classification: SlotGapClassification;
  readonly lane: CoverageLane;
  readonly recoveredEventIds: readonly string[];
  readonly perSlotStatus: Readonly<Record<number, 'RECOVERED' | 'SKIPPED' | 'DEAD_FORK' | 'EMPTY' | 'UNAVAILABLE'>>;
  readonly stateRoot: string;
  readonly coverageRoot: string;
  readonly isVerified: boolean;
  readonly certifiedAtMs: number;
}

export type BackfillResult = boolean | RecoveryCertificate;
export type BackfillHandler = (gap: SlotGap) => Promise<BackfillResult>;

export interface ReconciliationReport {
  readonly unresolvedHistoryTruncated: boolean;
  readonly backfillFailures: number;
  readonly pendingBackfills: number;
  readonly gapsDetected: number;
  readonly gapsResolved: number;
  readonly totalSlotsBackfilled: number;
  readonly latestContinuousSlot: number;
  readonly circularBufferSize: number;
}


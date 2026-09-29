/**
 * Ingestion Gap-Fill & Continuity Types
 */

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
}

export interface SlotReceipt {
  readonly slot: number;
  readonly signatureCount: number;
  readonly receivedAtMs: number;
  readonly isBackfilled: boolean;
}

export interface SlotGap {
  readonly startSlot: number;
  readonly endSlot: number;
  readonly missingSlotCount: number;
  readonly detectedAtMs: number;
  readonly resolvedAtMs?: number;
  readonly isResolved: boolean;
}

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

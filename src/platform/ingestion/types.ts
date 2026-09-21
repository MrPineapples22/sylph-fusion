/**
 * Ingestion Gap-Fill & Continuity Types
 */

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
  readonly gapsDetected: number;
  readonly gapsResolved: number;
  readonly totalSlotsBackfilled: number;
  readonly latestContinuousSlot: number;
  readonly circularBufferSize: number;
}

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

export type SpooledResearchEventType =
  | 'AUDIT_EVENT'
  | 'JOURNAL_COUNTERFACTUAL'
  | 'JOURNAL_FALSIFICATION';

export interface SpooledResearchRecord {
  readonly eventId: string;
  readonly eventType: SpooledResearchEventType;
  readonly eventName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly queuedAtMs: number;
  attempts: number;
  lastErrorReason?: string;
}

export interface DurableResearchSpoolOptions {
  readonly spoolFilePath: string;
  readonly maxCapacity?: number;
  readonly maxPayloadBytes?: number;
  readonly maxAggregateBytes?: number;
  readonly maxDrainedHistory?: number;
}

export interface ReplayDrainTarget {
  appendAuditEvent?(event: string, payload: Readonly<Record<string, unknown>>): Promise<void>;
  saveCounterfactualEvaluation?(evaluation: Readonly<Record<string, unknown>>): Promise<void>;
  saveFalsificationReport?(report: Readonly<Record<string, unknown>>): Promise<void>;
}

export type EnqueueResult =
  | { readonly accepted: true; readonly eventId: string; readonly pendingCount: number }
  | { readonly accepted: false; readonly eventId: string; readonly reason: 'DUPLICATE_ALREADY_SPOOLED' | 'DUPLICATE_ALREADY_DRAINED' | 'SPOOL_CAPACITY_EXCEEDED' | 'PAYLOAD_OVERSIZED' | 'SPOOL_BYTES_EXCEEDED' | 'DISK_WRITE_FAILED'; readonly error?: string };

export interface ReplayBatchResult {
  readonly replayedCount: number;
  readonly remainingCount: number;
  readonly failedEventId?: string;
  readonly error?: string;
}

export interface SpoolStatusSnapshot {
  readonly pendingCount: number;
  readonly totalSpooledCount: number;
  readonly totalDrainedCount: number;
  readonly totalDroppedCount: number;
  readonly diskFailureCount: number;
  readonly lastDrainedAtMs: number | null;
  readonly lastSpoolError: string | null;
  readonly spoolFilePath: string;
}

export const DEFAULT_MAX_CAPACITY = 1000;
export const DEFAULT_MAX_PAYLOAD_BYTES = 65_536; // 64 KiB
export const DEFAULT_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const DEFAULT_MAX_DRAINED_HISTORY = 10_000;

function computeStableEventId(
  eventType: SpooledResearchEventType,
  eventName: string,
  payload: Readonly<Record<string, unknown>>,
  recordId?: string
): string {
  if (recordId && typeof recordId === 'string' && /^[a-zA-Z0-9_\-:]{1,128}$/.test(recordId)) {
    return recordId;
  }
  const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  const digest = createHash('sha256').update(`${eventType}:${eventName}:${serialized}`).digest('hex');
  return `spool_${digest.slice(0, 24)}`;
}

export class DurableResearchSpool {
  private readonly spoolFilePath: string;
  private readonly maxCapacity: number;
  private readonly maxPayloadBytes: number;
  private readonly maxAggregateBytes: number;
  private readonly maxDrainedHistory: number;

  private pendingRecords: SpooledResearchRecord[] = [];
  private readonly pendingIndex = new Set<string>();
  private readonly drainedIndex = new Set<string>();

  private totalSpooledCount = 0;
  private totalDrainedCount = 0;
  private totalDroppedCount = 0;
  private diskFailureCount = 0;
  private lastDrainedAtMs: number | null = null;
  private lastSpoolError: string | null = null;
  private aggregateBytes = 0;

  constructor(options: DurableResearchSpoolOptions) {
    if (!options.spoolFilePath || typeof options.spoolFilePath !== 'string') {
      throw new Error('DURABLE_RESEARCH_SPOOL_PATH_REQUIRED');
    }
    this.spoolFilePath = resolve(options.spoolFilePath);
    this.maxCapacity = Math.max(1, options.maxCapacity ?? DEFAULT_MAX_CAPACITY);
    this.maxPayloadBytes = Math.max(1024, options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES);
    this.maxAggregateBytes = Math.max(this.maxPayloadBytes, options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES);
    this.maxDrainedHistory = Math.max(100, options.maxDrainedHistory ?? DEFAULT_MAX_DRAINED_HISTORY);

    this.recoverFromDisk();
  }

  public getSnapshot(): SpoolStatusSnapshot {
    return {
      pendingCount: this.pendingRecords.length,
      totalSpooledCount: this.totalSpooledCount,
      totalDrainedCount: this.totalDrainedCount,
      totalDroppedCount: this.totalDroppedCount,
      diskFailureCount: this.diskFailureCount,
      lastDrainedAtMs: this.lastDrainedAtMs,
      lastSpoolError: this.lastSpoolError,
      spoolFilePath: this.spoolFilePath,
    };
  }

  public enqueue(
    eventType: SpooledResearchEventType,
    eventName: string,
    payload: Readonly<Record<string, unknown>>,
    recordId?: string
  ): EnqueueResult {
    const eventId = computeStableEventId(eventType, eventName, payload, recordId);

    // Duplicate suppression
    if (this.pendingIndex.has(eventId)) {
      return { accepted: false, eventId, reason: 'DUPLICATE_ALREADY_SPOOLED' };
    }
    if (this.drainedIndex.has(eventId)) {
      return { accepted: false, eventId, reason: 'DUPLICATE_ALREADY_DRAINED' };
    }

    // Capacity checks
    if (this.pendingRecords.length >= this.maxCapacity) {
      this.totalDroppedCount++;
      return { accepted: false, eventId, reason: 'SPOOL_CAPACITY_EXCEEDED' };
    }

    let serializedPayload: string;
    try {
      serializedPayload = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch (err: unknown) {
      this.totalDroppedCount++;
      return { accepted: false, eventId, reason: 'PAYLOAD_OVERSIZED', error: (err as Error).message };
    }

    const payloadByteLength = Buffer.byteLength(serializedPayload, 'utf8');
    if (payloadByteLength > this.maxPayloadBytes) {
      this.totalDroppedCount++;
      return { accepted: false, eventId, reason: 'PAYLOAD_OVERSIZED' };
    }

    if (this.aggregateBytes + payloadByteLength > this.maxAggregateBytes) {
      this.totalDroppedCount++;
      return { accepted: false, eventId, reason: 'SPOOL_BYTES_EXCEEDED' };
    }

    const record: SpooledResearchRecord = {
      eventId,
      eventType,
      eventName,
      payload: Object.freeze(JSON.parse(serializedPayload)),
      queuedAtMs: Date.now(),
      attempts: 0,
    };

    // Durable on-disk append before updating memory
    try {
      const line = `${JSON.stringify(record)}\n`;
      appendFileSync(this.spoolFilePath, line, 'utf8');
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.totalDroppedCount++;
      const message = (err as Error).message;
      this.lastSpoolError = message;
      return { accepted: false, eventId, reason: 'DISK_WRITE_FAILED', error: message };
    }

    this.pendingRecords.push(record);
    this.pendingIndex.add(eventId);
    this.aggregateBytes += payloadByteLength;
    this.totalSpooledCount++;

    return { accepted: true, eventId, pendingCount: this.pendingRecords.length };
  }

  public async replay(drainTarget: ReplayDrainTarget, maxBatch = 100): Promise<ReplayBatchResult> {
    if (this.pendingRecords.length === 0) {
      return { replayedCount: 0, remainingCount: 0 };
    }

    const batchSize = Math.min(Math.max(1, maxBatch), this.pendingRecords.length);
    let replayed = 0;
    let failedId: string | undefined;
    let failureError: string | undefined;

    const remaining: SpooledResearchRecord[] = [];

    for (let i = 0; i < this.pendingRecords.length; i++) {
      const record = this.pendingRecords[i];
      if (i < batchSize && !failedId) {
        try {
          await this.dispatchToTarget(drainTarget, record);
          // Success
          replayed++;
          this.totalDrainedCount++;
          this.lastDrainedAtMs = Date.now();
          this.pendingIndex.delete(record.eventId);
          this.drainedIndex.add(record.eventId);
          if (this.drainedIndex.size > this.maxDrainedHistory) {
            const first = this.drainedIndex.values().next().value;
            if (first !== undefined) this.drainedIndex.delete(first);
          }
          continue;
        } catch (err: unknown) {
          record.attempts++;
          const reason = (err as Error).message || 'drain_target_rejected';
          record.lastErrorReason = reason;
          failedId = record.eventId;
          failureError = reason;
          this.lastSpoolError = reason;
          // Record remains pending
          remaining.push(record);
        }
      } else {
        remaining.push(record);
      }
    }

    this.pendingRecords = remaining;
    this.recomputeAggregateBytes();

    // Compact on-disk journal to reflect only un-drained records
    this.flushToDisk();

    return {
      replayedCount: replayed,
      remainingCount: this.pendingRecords.length,
      failedEventId: failedId,
      error: failureError,
    };
  }

  private async dispatchToTarget(drainTarget: ReplayDrainTarget, record: SpooledResearchRecord): Promise<void> {
    switch (record.eventType) {
      case 'AUDIT_EVENT': {
        if (typeof drainTarget.appendAuditEvent !== 'function') {
          throw new Error('DRAIN_TARGET_AUDIT_UNAVAILABLE');
        }
        await drainTarget.appendAuditEvent(record.eventName, record.payload);
        break;
      }
      case 'JOURNAL_COUNTERFACTUAL': {
        if (typeof drainTarget.saveCounterfactualEvaluation !== 'function') {
          throw new Error('DRAIN_TARGET_COUNTERFACTUAL_UNAVAILABLE');
        }
        await drainTarget.saveCounterfactualEvaluation(record.payload);
        break;
      }
      case 'JOURNAL_FALSIFICATION': {
        if (typeof drainTarget.saveFalsificationReport !== 'function') {
          throw new Error('DRAIN_TARGET_FALSIFICATION_UNAVAILABLE');
        }
        await drainTarget.saveFalsificationReport(record.payload);
        break;
      }
      default:
        throw new Error(`UNSUPPORTED_SPOOL_EVENT_TYPE: ${(record as SpooledResearchRecord).eventType}`);
    }
  }

  private recoverFromDisk(): void {
    if (!existsSync(this.spoolFilePath)) return;

    try {
      const content = readFileSync(this.spoolFilePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as SpooledResearchRecord;
          if (
            parsed &&
            typeof parsed.eventId === 'string' &&
            typeof parsed.eventName === 'string' &&
            typeof parsed.eventType === 'string' &&
            parsed.payload &&
            typeof parsed.payload === 'object' &&
            !this.pendingIndex.has(parsed.eventId)
          ) {
            this.pendingRecords.push(parsed);
            this.pendingIndex.add(parsed.eventId);
          }
        } catch {
          // Trailing or corrupted partial line ignored during crash recovery
        }
      }
      this.recomputeAggregateBytes();
      this.totalSpooledCount = this.pendingRecords.length;
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.lastSpoolError = (err as Error).message;
    }
  }

  private flushToDisk(): void {
    if (this.pendingRecords.length === 0) {
      try {
        if (existsSync(this.spoolFilePath)) {
          unlinkSync(this.spoolFilePath);
        }
      } catch (err: unknown) {
        this.diskFailureCount++;
        this.lastSpoolError = (err as Error).message;
      }
      return;
    }

    const tempFile = `${this.spoolFilePath}.${randomUUID()}.tmp`;
    try {
      const content = this.pendingRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(tempFile, content, 'utf8');
      renameSync(tempFile, this.spoolFilePath);
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.lastSpoolError = (err as Error).message;
      try {
        if (existsSync(tempFile)) unlinkSync(tempFile);
      } catch {
        // ignore cleanup error
      }
    }
  }

  private recomputeAggregateBytes(): void {
    let bytes = 0;
    for (const record of this.pendingRecords) {
      bytes += Buffer.byteLength(JSON.stringify(record.payload), 'utf8');
    }
    this.aggregateBytes = bytes;
  }
}

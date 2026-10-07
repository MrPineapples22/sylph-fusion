import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, writeFileSync, appendFileSync, truncateSync, unlinkSync, renameSync } from 'node:fs';
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
  readonly maxRecordAgeMs?: number;
}

export interface ReplayDrainTarget {
  appendAuditEvent?(event: string, payload: Readonly<Record<string, unknown>>, stableEventId?: string): Promise<any>;
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
  readonly pendingPayloadBytes: number;
  readonly capacityLimit: number;
  readonly aggregateByteLimit: number;
  readonly totalSpooledCount: number;
  readonly totalDrainedCount: number;
  readonly totalDroppedCount: number;
  readonly diskFailureCount: number;
  readonly durableAppendCount: number;
  readonly durableAppendTotalMs: number;
  readonly durableAppendMaxMs: number;
  readonly durableAppendP50UpperBoundMs: number | null;
  readonly durableAppendP95UpperBoundMs: number | null;
  readonly durableAppendP99UpperBoundMs: number | null;
  readonly durableAppendLatencyOverflowCount: number;
  readonly lastDrainedAtMs: number | null;
  readonly lastSpoolError: string | null;
  readonly spoolFilePath: string;
}

export interface DurableAppendIntervalSnapshot {
  readonly sampleCount: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly p50UpperBoundMs: number | null;
  readonly p95UpperBoundMs: number | null;
  readonly p99UpperBoundMs: number | null;
  readonly overflowCount: number;
  readonly windowDurationMs: number;
}

export const DEFAULT_MAX_CAPACITY = 1000;
export const DEFAULT_MAX_PAYLOAD_BYTES = 65_536; // 64 KiB
export const DEFAULT_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024; // 16 MiB
export const DEFAULT_MAX_DRAINED_HISTORY = 10_000;
export const DEFAULT_MAX_RECORD_AGE_MS = 7 * 86_400_000; // 7 days
const MAX_CAPACITY_LIMIT = 100_000;
const MAX_PAYLOAD_BYTES_LIMIT = 1_048_576;
const MAX_AGGREGATE_BYTES_LIMIT = 256 * 1024 * 1024;
const MAX_DRAINED_HISTORY_LIMIT = 100_000;
// 40 logarithmic buckets represent upper bounds from 1 microsecond through
// 2^39 microseconds (~6.36 days) with fixed memory and no retained samples.
const DURABLE_APPEND_LATENCY_BUCKETS = 40;

function configuredBound(name: string, value: number | undefined, fallback: number, min: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new Error(`INVALID_DURABLE_RESEARCH_SPOOL_${name}`);
  return resolved;
}

function boundedSpoolError(value: string, maxBytes = 1024): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const marker = '...[truncated]';
  const prefixLimit = maxBytes - Buffer.byteLength(marker, 'utf8');
  let prefix = Buffer.from(value, 'utf8').subarray(0, prefixLimit).toString('utf8');
  while (Buffer.byteLength(prefix, 'utf8') > prefixLimit) prefix = prefix.slice(0, -1);
  return `${prefix}${marker}`;
}

export function stableResearchEventId(
  eventType: SpooledResearchEventType,
  eventName: string,
  payload: Readonly<Record<string, unknown>>,
  recordId?: string
): string {
  if (!['AUDIT_EVENT', 'JOURNAL_COUNTERFACTUAL', 'JOURNAL_FALSIFICATION'].includes(eventType) ||
      typeof eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(eventName) ||
      (recordId !== undefined && (typeof recordId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(recordId)))) {
    throw new Error('INVALID_RESEARCH_EVENT_IDENTITY');
  }
  const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (typeof serialized !== 'string') throw new Error('INVALID_RESEARCH_EVENT_PAYLOAD');
  const digest = createHash('sha256').update(`${eventType}\0${eventName}\0${recordId ?? ''}\0${serialized}`).digest('hex');
  return `research_${digest}`;
}

/**
 * Single-writer only: callers must ensure one instance/process owns a spool
 * path. Append rollback and compaction are not protected by an interprocess lock.
 * Production composition must enforce this before constructing a spool.
 */
export class DurableResearchSpool {
  private readonly spoolFilePath: string;
  private readonly maxCapacity: number;
  private readonly maxPayloadBytes: number;
  private readonly maxAggregateBytes: number;
  private readonly maxDrainedHistory: number;
  private readonly maxRecordAgeMs: number;

  private pendingRecords: SpooledResearchRecord[] = [];
  private readonly pendingIndex = new Set<string>();
  private readonly drainedIndex = new Set<string>();
  private isDraining = false;

  private totalSpooledCount = 0;
  private totalDrainedCount = 0;
  private totalDroppedCount = 0;
  private diskFailureCount = 0;
  private durableAppendCount = 0;
  private durableAppendTotalMs = 0;
  private durableAppendMaxMs = 0;
  private readonly durableAppendLatencyBuckets = new Array<number>(DURABLE_APPEND_LATENCY_BUCKETS).fill(0);
  private durableAppendLatencyOverflowCount = 0;
  private intervalAppendCount = 0;
  private intervalAppendTotalMs = 0;
  private intervalAppendMaxMs = 0;
  private readonly intervalAppendLatencyBuckets = new Array<number>(DURABLE_APPEND_LATENCY_BUCKETS).fill(0);
  private intervalAppendLatencyOverflowCount = 0;
  private intervalSnapshotStartedAt = process.hrtime.bigint();
  private lastDrainedAtMs: number | null = null;
  private lastSpoolError: string | null = null;
  private aggregateBytes = 0;
  private poisoned = false;

  constructor(options: DurableResearchSpoolOptions) {
    if (!options.spoolFilePath || typeof options.spoolFilePath !== 'string') {
      throw new Error('DURABLE_RESEARCH_SPOOL_PATH_REQUIRED');
    }
    this.spoolFilePath = resolve(options.spoolFilePath);
    this.maxCapacity = configuredBound('CAPACITY', options.maxCapacity, DEFAULT_MAX_CAPACITY, 1, MAX_CAPACITY_LIMIT);
    this.maxPayloadBytes = configuredBound('PAYLOAD_BYTES', options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, 1024, MAX_PAYLOAD_BYTES_LIMIT);
    this.maxAggregateBytes = configuredBound('AGGREGATE_BYTES', options.maxAggregateBytes, DEFAULT_MAX_AGGREGATE_BYTES, this.maxPayloadBytes, MAX_AGGREGATE_BYTES_LIMIT);
    this.maxDrainedHistory = configuredBound('DRAINED_HISTORY', options.maxDrainedHistory, DEFAULT_MAX_DRAINED_HISTORY, 100, MAX_DRAINED_HISTORY_LIMIT);
    this.maxRecordAgeMs = configuredBound('RECORD_AGE_MS', options.maxRecordAgeMs, DEFAULT_MAX_RECORD_AGE_MS, 1000, 365 * 86_400_000);

    this.recoverFromDisk();
  }

  public getSnapshot(): SpoolStatusSnapshot {
    return {
      pendingCount: this.pendingRecords.length,
      pendingPayloadBytes: this.aggregateBytes,
      capacityLimit: this.maxCapacity,
      aggregateByteLimit: this.maxAggregateBytes,
      totalSpooledCount: this.totalSpooledCount,
      totalDrainedCount: this.totalDrainedCount,
      totalDroppedCount: this.totalDroppedCount,
      diskFailureCount: this.diskFailureCount,
      durableAppendCount: this.durableAppendCount,
      durableAppendTotalMs: this.durableAppendTotalMs,
      durableAppendMaxMs: this.durableAppendMaxMs,
      durableAppendP50UpperBoundMs: this.durableAppendPercentileUpperBoundMs(0.50),
      durableAppendP95UpperBoundMs: this.durableAppendPercentileUpperBoundMs(0.95),
      durableAppendP99UpperBoundMs: this.durableAppendPercentileUpperBoundMs(0.99),
      durableAppendLatencyOverflowCount: this.durableAppendLatencyOverflowCount,
      lastDrainedAtMs: this.lastDrainedAtMs,
      lastSpoolError: this.lastSpoolError,
      spoolFilePath: this.spoolFilePath,
    };
  }

  /** Checkpoint-only read. Dashboard reads must use getSnapshot(). */
  public getAppendLatencyIntervalSnapshot(): DurableAppendIntervalSnapshot {
    const now = process.hrtime.bigint();
    const windowDurationMs = Number(now - this.intervalSnapshotStartedAt) / 1_000_000;
    return {
      sampleCount: this.intervalAppendCount,
      totalMs: this.intervalAppendTotalMs,
      maxMs: this.intervalAppendMaxMs,
      p50UpperBoundMs: this.intervalAppendPercentileUpperBoundMs(0.50),
      p95UpperBoundMs: this.intervalAppendPercentileUpperBoundMs(0.95),
      p99UpperBoundMs: this.intervalAppendPercentileUpperBoundMs(0.99),
      overflowCount: this.intervalAppendLatencyOverflowCount,
      windowDurationMs,
    };
  }

  /** Consume an interval only after its checkpoint has been persisted successfully. */
  public resetAppendLatencyIntervalSnapshot(): void {
    this.intervalSnapshotStartedAt = process.hrtime.bigint();
    this.intervalAppendCount = 0;
    this.intervalAppendTotalMs = 0;
    this.intervalAppendMaxMs = 0;
    this.intervalAppendLatencyBuckets.fill(0);
    this.intervalAppendLatencyOverflowCount = 0;
  }

  public enqueue(
    eventType: SpooledResearchEventType,
    eventName: string,
    payload: Readonly<Record<string, unknown>>,
    recordId?: string
  ): EnqueueResult {
    const eventId = stableResearchEventId(eventType, eventName, payload, recordId);
    if (this.poisoned) {
      this.totalDroppedCount++;
      return { accepted: false, eventId, reason: 'DISK_WRITE_FAILED', error: this.lastSpoolError ?? 'SPOOL_POISONED' };
    }

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
    const line = `${JSON.stringify(record)}\n`;
    const fileExisted = existsSync(this.spoolFilePath);
    let priorFileBytes = 0;
    try {
      if (fileExisted) {
        const stats = statSync(this.spoolFilePath);
        if (stats.nlink > 1) throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
        priorFileBytes = stats.size;
      }
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.totalDroppedCount++;
      this.poisoned = true;
      this.lastSpoolError = (err as Error).message || 'SPOOL_FILE_STAT_FAILED';
      return { accepted: false, eventId, reason: 'DISK_WRITE_FAILED', error: this.lastSpoolError };
    }
    const appendStartedAt = process.hrtime.bigint();
    try {
      // Node 24 supports flush=true, which fsyncs file content before close.
      // This is the spool's acceptance boundary; directory-entry durability
      // across sudden power loss remains filesystem/platform dependent.
      this.appendDurably(line);
    } catch (err: unknown) {
      this.recordDurableAppendDuration(process.hrtime.bigint() - appendStartedAt);
      this.diskFailureCount++;
      this.totalDroppedCount++;
      const message = (err as Error).message || 'SPOOL_APPEND_FAILED';
      let rollbackError: string | undefined;
      try { this.rollbackAppend(fileExisted, priorFileBytes); }
      catch (rollback: unknown) {
        rollbackError = (rollback as Error).message || 'SPOOL_APPEND_ROLLBACK_FAILED';
        this.poisoned = true;
      }
      this.lastSpoolError = rollbackError ? `${message}; rollback failed: ${rollbackError}` : message;
      return { accepted: false, eventId, reason: 'DISK_WRITE_FAILED', error: this.lastSpoolError };
    }
    this.recordDurableAppendDuration(process.hrtime.bigint() - appendStartedAt);

    this.pendingRecords.push(record);
    this.pendingIndex.add(eventId);
    this.aggregateBytes += payloadByteLength;
    this.totalSpooledCount++;

    return { accepted: true, eventId, pendingCount: this.pendingRecords.length };
  }

  public async replay(drainTarget: ReplayDrainTarget, maxBatch = 100): Promise<ReplayBatchResult> {
    if (this.isDraining) {
      return { replayedCount: 0, remainingCount: this.pendingRecords.length, error: 'DRAIN_IN_PROGRESS' };
    }
    this.isDraining = true;
    try {
      if (this.pendingRecords.length === 0) {
        return { replayedCount: 0, remainingCount: 0 };
      }

      const batchSize = Math.min(Math.max(1, maxBatch), this.pendingRecords.length);
      let replayed = 0;
      let failedId: string | undefined;
      let failureError: string | undefined;

      const remaining: SpooledResearchRecord[] = [];
      const drained: SpooledResearchRecord[] = [];
      const now = Date.now();

      for (let i = 0; i < this.pendingRecords.length; i++) {
        const record = this.pendingRecords[i];
        if (now - record.queuedAtMs > this.maxRecordAgeMs) {
          // Research evidence does not become disposable merely because its
          // retry window elapsed. Hold the queue for explicit operator review.
          failedId = record.eventId;
          failureError = 'SPOOL_RECORD_EXPIRED_HELD';
          this.lastSpoolError = failureError;
          remaining.push(record, ...this.pendingRecords.slice(i + 1));
          break;
        }
        if (i < batchSize && !failedId) {
          try {
            await this.dispatchToTarget(drainTarget, record);
            // Target acceptance is not enough to retire this record. Keep the
            // durable spool copy until its replacement journal commits.
            drained.push(record);
            continue;
          } catch (err: unknown) {
            record.attempts++;
            const reason = boundedSpoolError((err as Error).message || 'drain_target_rejected');
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

      // Compact on-disk journal to reflect only un-drained records
      const flushOk = this.flushToDisk(remaining);
      if (!flushOk) {
        // The destination may have accepted some records, but the old journal
        // remains the retry authority. Stable IDs make replay idempotent.
        failedId ??= drained[0]?.eventId;
        failureError = this.lastSpoolError ?? 'SPOOL_COMPACTION_FAILED';
        replayed = 0;
      } else {
        this.pendingRecords = remaining;
        this.recomputeAggregateBytes();
        for (const record of drained) {
          replayed++;
          this.totalDrainedCount++;
          this.lastDrainedAtMs = Date.now();
          this.pendingIndex.delete(record.eventId);
          this.drainedIndex.add(record.eventId);
          if (this.drainedIndex.size > this.maxDrainedHistory) {
            const first = this.drainedIndex.values().next().value;
            if (first !== undefined) this.drainedIndex.delete(first);
          }
        }
      }

      return {
        replayedCount: replayed,
        remainingCount: this.pendingRecords.length,
        failedEventId: failedId,
        error: failureError,
      };
    } finally {
      this.isDraining = false;
    }
  }

  private async dispatchToTarget(drainTarget: ReplayDrainTarget, record: SpooledResearchRecord): Promise<void> {
    switch (record.eventType) {
      case 'AUDIT_EVENT': {
        if (typeof drainTarget.appendAuditEvent !== 'function') {
          throw new Error('DRAIN_TARGET_AUDIT_UNAVAILABLE');
        }
        await drainTarget.appendAuditEvent(record.eventName, record.payload, record.eventId);
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
      const stats = statSync(this.spoolFilePath);
      if (stats.nlink > 1) throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
      const fileBytes = stats.size;
      const maxFileBytes = this.maxAggregateBytes + this.maxCapacity * 4096;
      if (fileBytes > maxFileBytes) throw new Error('DURABLE_RESEARCH_SPOOL_FILE_TOO_LARGE');
      const content = readFileSync(this.spoolFilePath, 'utf8');
      const lines = content.split('\n');
      const hasTrailingPartialLine = lines.at(-1) === '' ? false : true;
      const completeLines = hasTrailingPartialLine ? lines.slice(0, -1) : lines.slice(0, -1);
      if (hasTrailingPartialLine) {
        throw new Error('DURABLE_RESEARCH_SPOOL_TRUNCATED_TAIL');
      }
      if (completeLines.length > this.maxCapacity) throw new Error('DURABLE_RESEARCH_SPOOL_CAPACITY_EXCEEDED');
      for (const line of completeLines) {
        if (!line) throw new Error('DURABLE_RESEARCH_SPOOL_EMPTY_RECORD');
        let parsed: unknown;
        try { parsed = JSON.parse(line); }
        catch { throw new Error('DURABLE_RESEARCH_SPOOL_INVALID_JSON'); }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          if (typeof record.lastErrorReason === 'string') record.lastErrorReason = boundedSpoolError(record.lastErrorReason);
        }
        if (!this.isRecoveredRecord(parsed)) throw new Error('DURABLE_RESEARCH_SPOOL_INVALID_RECORD');
        const record = parsed;
        if (this.pendingIndex.has(record.eventId)) throw new Error('DURABLE_RESEARCH_SPOOL_DUPLICATE_ID');
        this.pendingRecords.push(record);
        this.pendingIndex.add(record.eventId);
      }
      this.recomputeAggregateBytes();
      if (this.aggregateBytes > this.maxAggregateBytes) throw new Error('DURABLE_RESEARCH_SPOOL_BYTES_EXCEEDED');
      this.totalSpooledCount = this.pendingRecords.length;
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.lastSpoolError = (err as Error).message;
      throw new Error('DURABLE_RESEARCH_SPOOL_RECOVERY_FAILED', { cause: err });
    }
  }

  private flushToDisk(records: readonly SpooledResearchRecord[] = this.pendingRecords): boolean {
    try {
      if (existsSync(this.spoolFilePath) && statSync(this.spoolFilePath).nlink > 1) {
        throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
      }
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.lastSpoolError = (err as Error).message || 'SPOOL_FILE_STAT_FAILED';
      return false;
    }

    if (records.length === 0) {
      try {
        if (existsSync(this.spoolFilePath)) {
          unlinkSync(this.spoolFilePath);
        }
        return true;
      } catch (err: unknown) {
        this.diskFailureCount++;
        this.lastSpoolError = (err as Error).message;
        return false;
      }
    }

    const tempFile = `${this.spoolFilePath}.${randomUUID()}.tmp`;
    try {
      const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(tempFile, content, { encoding: 'utf8', flag: 'wx', flush: true });
      renameSync(tempFile, this.spoolFilePath);
      return true;
    } catch (err: unknown) {
      this.diskFailureCount++;
      this.lastSpoolError = (err as Error).message;
      try {
        if (existsSync(tempFile)) unlinkSync(tempFile);
      } catch {
        // ignore cleanup error
      }
      return false;
    }
  }

  private recomputeAggregateBytes(): void {
    let bytes = 0;
    for (const record of this.pendingRecords) {
      bytes += Buffer.byteLength(JSON.stringify(record.payload), 'utf8');
    }
    this.aggregateBytes = bytes;
  }

  private isRecoveredRecord(value: unknown): value is SpooledResearchRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Partial<SpooledResearchRecord>;
    const acceptedEventId = typeof record.eventId === 'string' &&
      (/^research_[a-f0-9]{64}$/.test(record.eventId) || /^spool_[a-f0-9]{24}$/.test(record.eventId) || /^[a-zA-Z0-9_\-:]{1,128}$/.test(record.eventId));
    if (!acceptedEventId ||
        typeof record.eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(record.eventName) ||
        !['AUDIT_EVENT', 'JOURNAL_COUNTERFACTUAL', 'JOURNAL_FALSIFICATION'].includes(record.eventType as string) ||
        !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
        !Number.isSafeInteger(record.queuedAtMs) || (record.queuedAtMs as number) <= 0 ||
        !Number.isSafeInteger(record.attempts) || (record.attempts as number) < 0 ||
        (record.lastErrorReason !== undefined &&
          (typeof record.lastErrorReason !== 'string' || Buffer.byteLength(record.lastErrorReason) > 1024))) return false;
    const payloadBytes = Buffer.byteLength(JSON.stringify(record.payload), 'utf8');
    if (payloadBytes > this.maxPayloadBytes) return false;
    const envelopeBytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
    return envelopeBytes <= this.maxPayloadBytes + 4096;
  }

  private appendDurably(line: string): void {
    appendFileSync(this.spoolFilePath, line, { encoding: 'utf8', flush: true });
  }

  private recordDurableAppendDuration(elapsedNanoseconds: bigint): void {
    const elapsedMs = Number(elapsedNanoseconds) / 1_000_000;
    this.durableAppendCount++;
    this.durableAppendTotalMs += elapsedMs;
    this.durableAppendMaxMs = Math.max(this.durableAppendMaxMs, elapsedMs);
    this.intervalAppendCount++;
    this.intervalAppendTotalMs += elapsedMs;
    this.intervalAppendMaxMs = Math.max(this.intervalAppendMaxMs, elapsedMs);
    const elapsedMicroseconds = Math.max(1, Math.ceil(Number(elapsedNanoseconds) / 1_000));
    let bucketIndex = 0;
    let bucketUpperBoundMicroseconds = 1;
    while (elapsedMicroseconds > bucketUpperBoundMicroseconds && bucketIndex < this.durableAppendLatencyBuckets.length - 1) {
      bucketIndex++;
      bucketUpperBoundMicroseconds *= 2;
    }
    if (elapsedMicroseconds > bucketUpperBoundMicroseconds) {
      this.durableAppendLatencyOverflowCount++;
      this.intervalAppendLatencyOverflowCount++;
    } else {
      this.durableAppendLatencyBuckets[bucketIndex]++;
      this.intervalAppendLatencyBuckets[bucketIndex]++;
    }
  }

  private durableAppendPercentileUpperBoundMs(percentile: number): number | null {
    if (this.durableAppendCount === 0) return null;
    const targetRank = Math.ceil(this.durableAppendCount * percentile);
    let seen = 0;
    for (let i = 0; i < this.durableAppendLatencyBuckets.length; i++) {
      seen += this.durableAppendLatencyBuckets[i];
      if (seen >= targetRank) return (2 ** i) / 1000;
    }
    // Null makes a percentile that falls into the open overflow bucket explicit.
    return null;
  }

  private intervalAppendPercentileUpperBoundMs(percentile: number): number | null {
    if (this.intervalAppendCount === 0) return null;
    const targetRank = Math.ceil(this.intervalAppendCount * percentile);
    let seen = 0;
    for (let i = 0; i < this.intervalAppendLatencyBuckets.length; i++) {
      seen += this.intervalAppendLatencyBuckets[i];
      if (seen >= targetRank) return (2 ** i) / 1000;
    }
    return null;
  }

  private rollbackAppend(fileExisted: boolean, priorFileBytes: number): void {
    if (!existsSync(this.spoolFilePath)) {
      if (fileExisted) throw new Error('SPOOL_FILE_DISAPPEARED_DURING_APPEND');
      return;
    }
    truncateSync(this.spoolFilePath, fileExisted ? priorFileBytes : 0);
    const fd = openSync(this.spoolFilePath, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (!fileExisted) unlinkSync(this.spoolFilePath);
  }
}

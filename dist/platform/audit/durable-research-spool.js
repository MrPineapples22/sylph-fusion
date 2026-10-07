import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, writeFileSync, appendFileSync, truncateSync, unlinkSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
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
function configuredBound(name, value, fallback, min, max) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max)
        throw new Error(`INVALID_DURABLE_RESEARCH_SPOOL_${name}`);
    return resolved;
}
function boundedSpoolError(value, maxBytes = 1024) {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes)
        return value;
    const marker = '...[truncated]';
    const prefixLimit = maxBytes - Buffer.byteLength(marker, 'utf8');
    let prefix = Buffer.from(value, 'utf8').subarray(0, prefixLimit).toString('utf8');
    while (Buffer.byteLength(prefix, 'utf8') > prefixLimit)
        prefix = prefix.slice(0, -1);
    return `${prefix}${marker}`;
}
export function stableResearchEventId(eventType, eventName, payload, recordId) {
    if (!['AUDIT_EVENT', 'JOURNAL_COUNTERFACTUAL', 'JOURNAL_FALSIFICATION'].includes(eventType) ||
        typeof eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(eventName) ||
        (recordId !== undefined && (typeof recordId !== 'string' || !/^[a-zA-Z0-9_\-:]{1,128}$/.test(recordId)))) {
        throw new Error('INVALID_RESEARCH_EVENT_IDENTITY');
    }
    const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    if (typeof serialized !== 'string')
        throw new Error('INVALID_RESEARCH_EVENT_PAYLOAD');
    const digest = createHash('sha256').update(`${eventType}\0${eventName}\0${recordId ?? ''}\0${serialized}`).digest('hex');
    return `research_${digest}`;
}
/**
 * Single-writer only: callers must ensure one instance/process owns a spool
 * path. Append rollback and compaction are not protected by an interprocess lock.
 * Production composition must enforce this before constructing a spool.
 */
export class DurableResearchSpool {
    spoolFilePath;
    maxCapacity;
    maxPayloadBytes;
    maxAggregateBytes;
    maxDrainedHistory;
    maxRecordAgeMs;
    pendingRecords = [];
    pendingIndex = new Set();
    drainedIndex = new Set();
    isDraining = false;
    totalSpooledCount = 0;
    totalDrainedCount = 0;
    totalDroppedCount = 0;
    diskFailureCount = 0;
    durableAppendCount = 0;
    durableAppendTotalMs = 0;
    durableAppendMaxMs = 0;
    durableAppendLatencyBuckets = new Array(DURABLE_APPEND_LATENCY_BUCKETS).fill(0);
    durableAppendLatencyOverflowCount = 0;
    intervalAppendCount = 0;
    intervalAppendTotalMs = 0;
    intervalAppendMaxMs = 0;
    intervalAppendLatencyBuckets = new Array(DURABLE_APPEND_LATENCY_BUCKETS).fill(0);
    intervalAppendLatencyOverflowCount = 0;
    intervalSnapshotStartedAt = process.hrtime.bigint();
    lastDrainedAtMs = null;
    lastSpoolError = null;
    aggregateBytes = 0;
    poisoned = false;
    constructor(options) {
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
    getSnapshot() {
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
    getAppendLatencyIntervalSnapshot() {
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
    resetAppendLatencyIntervalSnapshot() {
        this.intervalSnapshotStartedAt = process.hrtime.bigint();
        this.intervalAppendCount = 0;
        this.intervalAppendTotalMs = 0;
        this.intervalAppendMaxMs = 0;
        this.intervalAppendLatencyBuckets.fill(0);
        this.intervalAppendLatencyOverflowCount = 0;
    }
    enqueue(eventType, eventName, payload, recordId) {
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
        let serializedPayload;
        try {
            serializedPayload = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
        }
        catch (err) {
            this.totalDroppedCount++;
            return { accepted: false, eventId, reason: 'PAYLOAD_OVERSIZED', error: err.message };
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
        const record = {
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
                if (stats.nlink > 1)
                    throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
                priorFileBytes = stats.size;
            }
        }
        catch (err) {
            this.diskFailureCount++;
            this.totalDroppedCount++;
            this.poisoned = true;
            this.lastSpoolError = err.message || 'SPOOL_FILE_STAT_FAILED';
            return { accepted: false, eventId, reason: 'DISK_WRITE_FAILED', error: this.lastSpoolError };
        }
        const appendStartedAt = process.hrtime.bigint();
        try {
            // Node 24 supports flush=true, which fsyncs file content before close.
            // This is the spool's acceptance boundary; directory-entry durability
            // across sudden power loss remains filesystem/platform dependent.
            this.appendDurably(line);
        }
        catch (err) {
            this.recordDurableAppendDuration(process.hrtime.bigint() - appendStartedAt);
            this.diskFailureCount++;
            this.totalDroppedCount++;
            const message = err.message || 'SPOOL_APPEND_FAILED';
            let rollbackError;
            try {
                this.rollbackAppend(fileExisted, priorFileBytes);
            }
            catch (rollback) {
                rollbackError = rollback.message || 'SPOOL_APPEND_ROLLBACK_FAILED';
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
    async replay(drainTarget, maxBatch = 100) {
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
            let failedId;
            let failureError;
            const remaining = [];
            const drained = [];
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
                    }
                    catch (err) {
                        record.attempts++;
                        const reason = boundedSpoolError(err.message || 'drain_target_rejected');
                        record.lastErrorReason = reason;
                        failedId = record.eventId;
                        failureError = reason;
                        this.lastSpoolError = reason;
                        // Record remains pending
                        remaining.push(record);
                    }
                }
                else {
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
            }
            else {
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
                        if (first !== undefined)
                            this.drainedIndex.delete(first);
                    }
                }
            }
            return {
                replayedCount: replayed,
                remainingCount: this.pendingRecords.length,
                failedEventId: failedId,
                error: failureError,
            };
        }
        finally {
            this.isDraining = false;
        }
    }
    async dispatchToTarget(drainTarget, record) {
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
                throw new Error(`UNSUPPORTED_SPOOL_EVENT_TYPE: ${record.eventType}`);
        }
    }
    recoverFromDisk() {
        if (!existsSync(this.spoolFilePath))
            return;
        try {
            const stats = statSync(this.spoolFilePath);
            if (stats.nlink > 1)
                throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
            const fileBytes = stats.size;
            const maxFileBytes = this.maxAggregateBytes + this.maxCapacity * 4096;
            if (fileBytes > maxFileBytes)
                throw new Error('DURABLE_RESEARCH_SPOOL_FILE_TOO_LARGE');
            const content = readFileSync(this.spoolFilePath, 'utf8');
            const lines = content.split('\n');
            const hasTrailingPartialLine = lines.at(-1) === '' ? false : true;
            const completeLines = hasTrailingPartialLine ? lines.slice(0, -1) : lines.slice(0, -1);
            if (hasTrailingPartialLine) {
                throw new Error('DURABLE_RESEARCH_SPOOL_TRUNCATED_TAIL');
            }
            if (completeLines.length > this.maxCapacity)
                throw new Error('DURABLE_RESEARCH_SPOOL_CAPACITY_EXCEEDED');
            for (const line of completeLines) {
                if (!line)
                    throw new Error('DURABLE_RESEARCH_SPOOL_EMPTY_RECORD');
                let parsed;
                try {
                    parsed = JSON.parse(line);
                }
                catch {
                    throw new Error('DURABLE_RESEARCH_SPOOL_INVALID_JSON');
                }
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const record = parsed;
                    if (typeof record.lastErrorReason === 'string')
                        record.lastErrorReason = boundedSpoolError(record.lastErrorReason);
                }
                if (!this.isRecoveredRecord(parsed))
                    throw new Error('DURABLE_RESEARCH_SPOOL_INVALID_RECORD');
                const record = parsed;
                if (this.pendingIndex.has(record.eventId))
                    throw new Error('DURABLE_RESEARCH_SPOOL_DUPLICATE_ID');
                this.pendingRecords.push(record);
                this.pendingIndex.add(record.eventId);
            }
            this.recomputeAggregateBytes();
            if (this.aggregateBytes > this.maxAggregateBytes)
                throw new Error('DURABLE_RESEARCH_SPOOL_BYTES_EXCEEDED');
            this.totalSpooledCount = this.pendingRecords.length;
        }
        catch (err) {
            this.diskFailureCount++;
            this.lastSpoolError = err.message;
            throw new Error('DURABLE_RESEARCH_SPOOL_RECOVERY_FAILED', { cause: err });
        }
    }
    flushToDisk(records = this.pendingRecords) {
        try {
            if (existsSync(this.spoolFilePath) && statSync(this.spoolFilePath).nlink > 1) {
                throw new Error('DURABLE_RESEARCH_SPOOL_HARDLINK_UNSUPPORTED');
            }
        }
        catch (err) {
            this.diskFailureCount++;
            this.lastSpoolError = err.message || 'SPOOL_FILE_STAT_FAILED';
            return false;
        }
        if (records.length === 0) {
            try {
                if (existsSync(this.spoolFilePath)) {
                    unlinkSync(this.spoolFilePath);
                }
                return true;
            }
            catch (err) {
                this.diskFailureCount++;
                this.lastSpoolError = err.message;
                return false;
            }
        }
        const tempFile = `${this.spoolFilePath}.${randomUUID()}.tmp`;
        try {
            const content = records.map(r => JSON.stringify(r)).join('\n') + '\n';
            writeFileSync(tempFile, content, { encoding: 'utf8', flag: 'wx', flush: true });
            renameSync(tempFile, this.spoolFilePath);
            return true;
        }
        catch (err) {
            this.diskFailureCount++;
            this.lastSpoolError = err.message;
            try {
                if (existsSync(tempFile))
                    unlinkSync(tempFile);
            }
            catch {
                // ignore cleanup error
            }
            return false;
        }
    }
    recomputeAggregateBytes() {
        let bytes = 0;
        for (const record of this.pendingRecords) {
            bytes += Buffer.byteLength(JSON.stringify(record.payload), 'utf8');
        }
        this.aggregateBytes = bytes;
    }
    isRecoveredRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const record = value;
        const acceptedEventId = typeof record.eventId === 'string' &&
            (/^research_[a-f0-9]{64}$/.test(record.eventId) || /^spool_[a-f0-9]{24}$/.test(record.eventId) || /^[a-zA-Z0-9_\-:]{1,128}$/.test(record.eventId));
        if (!acceptedEventId ||
            typeof record.eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(record.eventName) ||
            !['AUDIT_EVENT', 'JOURNAL_COUNTERFACTUAL', 'JOURNAL_FALSIFICATION'].includes(record.eventType) ||
            !record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload) ||
            !Number.isSafeInteger(record.queuedAtMs) || record.queuedAtMs <= 0 ||
            !Number.isSafeInteger(record.attempts) || record.attempts < 0 ||
            (record.lastErrorReason !== undefined &&
                (typeof record.lastErrorReason !== 'string' || Buffer.byteLength(record.lastErrorReason) > 1024)))
            return false;
        const payloadBytes = Buffer.byteLength(JSON.stringify(record.payload), 'utf8');
        if (payloadBytes > this.maxPayloadBytes)
            return false;
        const envelopeBytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
        return envelopeBytes <= this.maxPayloadBytes + 4096;
    }
    appendDurably(line) {
        appendFileSync(this.spoolFilePath, line, { encoding: 'utf8', flush: true });
    }
    recordDurableAppendDuration(elapsedNanoseconds) {
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
        }
        else {
            this.durableAppendLatencyBuckets[bucketIndex]++;
            this.intervalAppendLatencyBuckets[bucketIndex]++;
        }
    }
    durableAppendPercentileUpperBoundMs(percentile) {
        if (this.durableAppendCount === 0)
            return null;
        const targetRank = Math.ceil(this.durableAppendCount * percentile);
        let seen = 0;
        for (let i = 0; i < this.durableAppendLatencyBuckets.length; i++) {
            seen += this.durableAppendLatencyBuckets[i];
            if (seen >= targetRank)
                return (2 ** i) / 1000;
        }
        // Null makes a percentile that falls into the open overflow bucket explicit.
        return null;
    }
    intervalAppendPercentileUpperBoundMs(percentile) {
        if (this.intervalAppendCount === 0)
            return null;
        const targetRank = Math.ceil(this.intervalAppendCount * percentile);
        let seen = 0;
        for (let i = 0; i < this.intervalAppendLatencyBuckets.length; i++) {
            seen += this.intervalAppendLatencyBuckets[i];
            if (seen >= targetRank)
                return (2 ** i) / 1000;
        }
        return null;
    }
    rollbackAppend(fileExisted, priorFileBytes) {
        if (!existsSync(this.spoolFilePath)) {
            if (fileExisted)
                throw new Error('SPOOL_FILE_DISAPPEARED_DURING_APPEND');
            return;
        }
        truncateSync(this.spoolFilePath, fileExisted ? priorFileBytes : 0);
        const fd = openSync(this.spoolFilePath, 'r+');
        try {
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        if (!fileExisted)
            unlinkSync(this.spoolFilePath);
    }
}
//# sourceMappingURL=durable-research-spool.js.map
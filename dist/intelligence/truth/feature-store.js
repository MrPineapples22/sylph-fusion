/**
 * SOL-SYLPH Master Production Intelligence - Point-in-Time Feature Store
 * Specifications: Section 9 (Point-in-Time Feature Store).
 *
 * Rules:
 * 1. Immutable feature snapshots referenced by snapshot_hash.
 * 2. Every decision/prediction must reference the exact snapshot used.
 * 3. Historical retrieval reproduces exactly what SYLPH could have known at that moment.
 */
import { createHash } from 'node:crypto';
import { TemporalFirewall } from './temporal-firewall.js';
/** Clone JSON data in canonical key order without retaining caller-owned objects. */
function immutableJson(value, ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value === 0 ? 0 : value;
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('Feature snapshots require finite, JSON-safe values');
    }
    if (ancestors.has(value))
        throw new TypeError('Feature snapshots cannot contain cycles');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TypeError('Feature snapshots require plain JSON objects');
    }
    ancestors.add(value);
    try {
        const copy = Array.isArray(value)
            ? Array.from(value, (item) => immutableJson(item, ancestors))
            : Object.fromEntries(Object.keys(value).sort().map((key) => [
                key, immutableJson(value[key], ancestors),
            ]));
        return Object.freeze(copy);
    }
    finally {
        ancestors.delete(value);
    }
}
function assertTemporalCoordinates(timestampMs, slot) {
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > Number.MAX_SAFE_INTEGER) {
        throw new TypeError('Feature snapshot timestamp must be a finite, nonnegative safe millisecond value');
    }
    if (!Number.isSafeInteger(slot) || slot < 0) {
        throw new TypeError('Feature snapshot slot must be a nonnegative safe integer');
    }
}
function compareSnapshots(a, b) {
    return a.slot - b.slot || a.timestampMs - b.timestampMs ||
        (a.snapshotId < b.snapshotId ? -1 : a.snapshotId > b.snapshotId ? 1 : 0);
}
export class PointInTimeFeatureStore {
    maxSnapshots;
    snapshots = new Map();
    snapshotsByMint = new Map();
    validityRecords = new Map();
    /** Retain the most recently recorded unique snapshots; retries do not renew retention. */
    constructor(maxSnapshots = 10_000) {
        this.maxSnapshots = maxSnapshots;
        if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots <= 0) {
            throw new TypeError('Feature snapshot capacity must be a positive safe integer');
        }
    }
    /**
     * Save an immutable feature snapshot with cryptographic SHA-256 seal.
     */
    recordSnapshot(params) {
        // Select the schema fields once so the seal covers exactly the data retained.
        const data = {
            snapshotId: params.snapshotId,
            mint: params.mint,
            slot: params.slot,
            timestampMs: params.timestampMs,
            tokenAgeSeconds: params.tokenAgeSeconds,
            featureSchemaVersion: params.featureSchemaVersion,
            features: params.features,
            dataQualityScore: params.dataQualityScore,
            freshnessMs: params.freshnessMs,
        };
        assertTemporalCoordinates(data.timestampMs, data.slot);
        for (const key of ['snapshotId', 'mint', 'featureSchemaVersion']) {
            if (typeof data[key] !== 'string' || !data[key].trim()) {
                throw new TypeError(`Feature snapshot ${key} must be a nonempty string`);
            }
        }
        if (!data.features || typeof data.features !== 'object' || Array.isArray(data.features)) {
            throw new TypeError('Feature snapshot features must be a JSON object');
        }
        for (const key of ['tokenAgeSeconds', 'dataQualityScore', 'freshnessMs']) {
            if (!Number.isFinite(data[key]) || data[key] < 0) {
                throw new TypeError(`Feature snapshot ${key} must be finite and nonnegative`);
            }
        }
        if (data.dataQualityScore > 1)
            throw new TypeError('Feature snapshot dataQualityScore must be between 0 and 1');
        const sealedData = immutableJson(data);
        const hash = createHash('sha256')
            .update(JSON.stringify(sealedData))
            .digest('hex');
        const existing = this.snapshots.get(sealedData.snapshotId);
        if (existing) {
            if (existing.snapshotHash !== hash) {
                throw new Error(`Conflicting feature snapshot ID: ${sealedData.snapshotId}`);
            }
            return existing;
        }
        const snapshot = Object.freeze({
            ...sealedData,
            snapshotHash: hash,
        });
        this.snapshots.set(snapshot.snapshotId, snapshot);
        this.validityRecords.set(snapshot.snapshotId, {
            snapshotId: snapshot.snapshotId,
            status: 'ACTIVE',
            contractEpochId: params.contractEpochId,
        });
        const list = this.snapshotsByMint.get(snapshot.mint) ?? [];
        list.push(snapshot);
        // Preserve slot precedence, resolving equal-slot arrivals deterministically.
        list.sort(compareSnapshots);
        this.snapshotsByMint.set(snapshot.mint, list);
        if (this.snapshots.size > this.maxSnapshots) {
            const oldest = this.snapshots.values().next().value;
            this.snapshots.delete(oldest.snapshotId);
            this.validityRecords.delete(oldest.snapshotId);
            const retained = this.snapshotsByMint.get(oldest.mint)
                .filter((item) => item.snapshotId !== oldest.snapshotId);
            if (retained.length)
                this.snapshotsByMint.set(oldest.mint, retained);
            else
                this.snapshotsByMint.delete(oldest.mint);
        }
        return snapshot;
    }
    getSnapshot(snapshotId) {
        return this.snapshots.get(snapshotId);
    }
    /**
     * Invalidate or contaminate a feature snapshot with audit reason and optional replacement.
     */
    invalidateSnapshot(params) {
        const existing = this.validityRecords.get(params.snapshotId);
        const updated = {
            snapshotId: params.snapshotId,
            status: params.status,
            reason: params.reason,
            invalidatedBy: params.invalidatedBy ?? 'CONTRACT_CANARY_AUTHORITY',
            invalidatedAtMs: Date.now(),
            replacementSnapshotId: params.replacementSnapshotId,
            contractEpochId: existing?.contractEpochId,
        };
        this.validityRecords.set(params.snapshotId, updated);
        return updated;
    }
    /**
     * Invalidates all snapshots associated with a compromised contract epoch.
     */
    invalidateSnapshotsForContractEpoch(contractEpochId, reason, invalidatedBy = 'CONTRACT_CANARY_AUTHORITY') {
        let count = 0;
        const now = Date.now();
        for (const [snapId, record] of this.validityRecords.entries()) {
            if (record.contractEpochId === contractEpochId && record.status === 'ACTIVE') {
                this.validityRecords.set(snapId, {
                    ...record,
                    status: 'INVALIDATED',
                    reason,
                    invalidatedBy,
                    invalidatedAtMs: now,
                });
                count++;
            }
        }
        return count;
    }
    getSnapshotValidity(snapshotId) {
        return this.validityRecords.get(snapshotId) ?? {
            snapshotId,
            status: 'ACTIVE',
        };
    }
    /**
     * Retrieve the latest feature snapshot for a mint strictly as-of decision point (T, slot),
     * enforcing zero lookahead leakage and epistemic snapshot validity.
     *
     * Replay Modes:
     * - 'CORRECTED_TRUTH' (default): Purges CONTAMINATED and INVALIDATED snapshots; follows replacement snapshots if available.
     * - 'AS_KNOWN_THEN': Returns snapshot as believed at time T, regardless of subsequent retroactive invalidation.
     */
    getSnapshotAsOf(mint, decisionTimeMs, decisionSlot, replayMode = 'CORRECTED_TRUTH') {
        assertTemporalCoordinates(decisionTimeMs, decisionSlot);
        const list = this.snapshotsByMint.get(mint);
        if (!list || list.length === 0)
            return undefined;
        // Filter with Temporal Firewall
        let eligible = list.filter((s) => s.timestampMs <= decisionTimeMs && s.slot <= decisionSlot);
        if (replayMode === 'CORRECTED_TRUTH') {
            eligible = eligible.filter((s) => {
                const val = this.validityRecords.get(s.snapshotId);
                if (!val)
                    return true;
                // In CORRECTED_TRUTH, exclude invalidated or contaminated snapshots
                return val.status === 'ACTIVE' || val.status === 'SUPERSEDED';
            });
        }
        if (eligible.length === 0)
            return undefined;
        // The latest eligible snapshot
        const latest = eligible[eligible.length - 1];
        TemporalFirewall.assertAvailableBeforeDecision({
            artifactId: latest.snapshotId,
            availableTimestampMs: latest.timestampMs,
            availableSlot: latest.slot,
        }, { decisionTimestampMs: decisionTimeMs, decisionSlot });
        return latest;
    }
    getAllSnapshotsForMint(mint) {
        return Object.freeze([...(this.snapshotsByMint.get(mint) ?? [])]);
    }
}
//# sourceMappingURL=feature-store.js.map
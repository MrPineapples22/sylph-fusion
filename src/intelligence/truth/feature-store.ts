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
import type { FeatureSnapshot } from './types.js';
import { TemporalFirewall } from './temporal-firewall.js';

export class PointInTimeFeatureStore {
  private readonly snapshots = new Map<string, FeatureSnapshot>();
  private readonly snapshotsByMint = new Map<string, FeatureSnapshot[]>();

  /**
   * Save an immutable feature snapshot with cryptographic SHA-256 seal.
   */
  public recordSnapshot(params: Omit<FeatureSnapshot, 'snapshotHash'>): FeatureSnapshot {
    const serializedFeatures = JSON.stringify(params.features, Object.keys(params.features).sort());
    const hash = createHash('sha256')
      .update(params.snapshotId)
      .update(params.mint)
      .update((params.slot ?? 0).toString())
      .update((params.timestampMs ?? Date.now()).toString())
      .update(params.featureSchemaVersion)
      .update(serializedFeatures)
      .digest('hex');

    const snapshot: FeatureSnapshot = {
      ...params,
      snapshotHash: hash,
    };

    this.snapshots.set(snapshot.snapshotId, snapshot);

    const list = this.snapshotsByMint.get(snapshot.mint) ?? [];
    list.push(snapshot);
    // Keep chronologically sorted by slot
    list.sort((a, b) => a.slot - b.slot);
    this.snapshotsByMint.set(snapshot.mint, list);

    return snapshot;
  }

  public getSnapshot(snapshotId: string): FeatureSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Retrieve the latest feature snapshot for a mint strictly as-of decision point (T, slot),
   * enforcing zero lookahead leakage.
   */
  public getSnapshotAsOf(
    mint: string,
    decisionTimeMs: number,
    decisionSlot: number
  ): FeatureSnapshot | undefined {
    const list = this.snapshotsByMint.get(mint);
    if (!list || list.length === 0) return undefined;

    // Filter with Temporal Firewall
    const eligible = list.filter(
      (s) => s.timestampMs <= decisionTimeMs && s.slot <= decisionSlot
    );

    if (eligible.length === 0) return undefined;

    // The latest eligible snapshot
    const latest = eligible[eligible.length - 1];

    TemporalFirewall.assertAvailableBeforeDecision(
      {
        artifactId: latest.snapshotId,
        availableTimestampMs: latest.timestampMs,
        availableSlot: latest.slot,
      },
      { decisionTimestampMs: decisionTimeMs, decisionSlot }
    );

    return latest;
  }

  public getAllSnapshotsForMint(mint: string): readonly FeatureSnapshot[] {
    return this.snapshotsByMint.get(mint) ?? [];
  }
}

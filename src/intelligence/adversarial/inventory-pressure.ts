/**
 * SOL-SYLPH Actor Inventory Pressure Engine
 * Blueprint Part XXI
 *
 * Estimates economic cluster inventory, cost basis, unrealized gain,
 * and distribution pressure to feed into the Phase Engine.
 */

export interface ClusterInventoryState {
  readonly clusterId: string;
  readonly totalTokens: number;
  readonly supplySharePct: number;
  readonly estimatedBasisSol: number;
  readonly currentValuationSol: number;
  readonly unrealizedPnLPct: number;
  readonly distributionTrend: 'ACCUMULATING' | 'HOLDING' | 'DISTRIBUTING';
  readonly distributionVelocityTokensPerSec: number;
  readonly confidence: number;
}

export interface InventoryPressureReport {
  readonly mint: string;
  readonly aggregateDistributionPressureScore: number; // 0.0 (safe) to 1.0 (extreme sell wall impending)
  readonly clusters: readonly ClusterInventoryState[];
  readonly topClusterSharePct: number;
  readonly top3ClustersSharePct: number;
  readonly highestUnrealizedGainPct: number;
  readonly hasPendingLiquidationWall: boolean;
}

export class InventoryPressureEngine {
  public evaluateInventory(mint: string, clusters: readonly ClusterInventoryState[]): InventoryPressureReport {
    if (!clusters || clusters.length === 0) {
      return {
        mint,
        aggregateDistributionPressureScore: 0,
        clusters: [],
        topClusterSharePct: 0,
        top3ClustersSharePct: 0,
        highestUnrealizedGainPct: 0,
        hasPendingLiquidationWall: false,
      };
    }

    const sortedByShare = [...clusters].sort((a, b) => b.supplySharePct - a.supplySharePct);
    const topShare = sortedByShare[0]?.supplySharePct ?? 0;
    const top3Share = sortedByShare.slice(0, 3).reduce((acc, c) => acc + c.supplySharePct, 0);

    let maxGain = 0;
    let distributionPressureSum = 0;

    for (const c of clusters) {
      if (c.unrealizedPnLPct > maxGain) maxGain = c.unrealizedPnLPct;

      // Distribution pressure model: share * unrealized gain multiplier * distribution trend
      const gainMultiplier = c.unrealizedPnLPct > 500 ? 2.5 : c.unrealizedPnLPct > 200 ? 1.8 : c.unrealizedPnLPct > 50 ? 1.2 : 0.8;
      const trendMultiplier = c.distributionTrend === 'DISTRIBUTING' ? 2.0 : c.distributionTrend === 'HOLDING' ? 1.0 : 0.5;
      const clusterPressure = (c.supplySharePct / 100) * gainMultiplier * trendMultiplier;
      distributionPressureSum += clusterPressure;
    }

    const normalizedPressure = Math.min(1.0, distributionPressureSum / 1.5);
    const hasWall = normalizedPressure > 0.65 || (topShare > 25 && maxGain > 200);

    return {
      mint,
      aggregateDistributionPressureScore: Number(normalizedPressure.toFixed(3)),
      clusters,
      topClusterSharePct: Number(topShare.toFixed(1)),
      top3ClustersSharePct: Number(top3Share.toFixed(1)),
      highestUnrealizedGainPct: Number(maxGain.toFixed(1)),
      hasPendingLiquidationWall: hasWall,
    };
  }
}

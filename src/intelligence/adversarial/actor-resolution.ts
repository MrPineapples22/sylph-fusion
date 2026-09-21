/**
 * SOL-SYLPH Economic Actor Resolution & First-Buyer Intelligence
 * Blueprint Parts X, XI
 *
 * Resolves raw wallets into probabilistic economic clusters:
 * RELATED_CLUSTER, LIKELY_RELATED, POSSIBLY_RELATED, UNRESOLVED.
 * Upgrades raw first_buyers into economic first buyers.
 */

export type ClusterRelationshipConfidence =
  | 'RELATED_CLUSTER'
  | 'LIKELY_RELATED'
  | 'POSSIBLY_RELATED'
  | 'UNRESOLVED';

export interface RawBuyerInfo {
  readonly address: string;
  readonly fundingSource?: string;
  readonly buyVolumeSol: number;
  readonly firstSeenMs: number;
  readonly txSignature: string;
  readonly isAutomationSuspect: boolean;
}

export interface EconomicCluster {
  readonly clusterId: string;
  readonly relationship: ClusterRelationshipConfidence;
  readonly memberWallets: string[];
  readonly totalVolumeSol: number;
  readonly commonFunder?: string;
  readonly confidenceScore: number; // 0.0 - 1.0
}

export interface FirstBuyerReport {
  readonly mint: string;
  readonly rawBuyerCount: number;
  readonly estimatedIndependentActors: number;
  readonly relatedWalletCount: number;
  readonly automatedClusterCount: number;
  readonly unresolvedCount: number;
  readonly topClusters: readonly EconomicCluster[];
  readonly sniperSaturationPct: number;
  readonly independenceScore: number; // 0.0 - 1.0
}

export class EconomicActorResolver {
  public resolveFirstBuyers(mint: string, rawBuyers: readonly RawBuyerInfo[]): FirstBuyerReport {
    if (!rawBuyers || rawBuyers.length === 0) {
      return {
        mint,
        rawBuyerCount: 0,
        estimatedIndependentActors: 0,
        relatedWalletCount: 0,
        automatedClusterCount: 0,
        unresolvedCount: 0,
        topClusters: [],
        sniperSaturationPct: 0,
        independenceScore: 1.0,
      };
    }

    const clustersByFunder = new Map<string, string[]>();
    const unclustered: string[] = [];
    let automatedCount = 0;

    for (const b of rawBuyers) {
      if (b.isAutomationSuspect) automatedCount++;
      if (b.fundingSource) {
        const list = clustersByFunder.get(b.fundingSource) ?? [];
        list.push(b.address);
        clustersByFunder.set(b.fundingSource, list);
      } else {
        unclustered.push(b.address);
      }
    }

    const clusters: EconomicCluster[] = [];
    let relatedCount = 0;

    let cIndex = 1;
    for (const [funder, wallets] of clustersByFunder.entries()) {
      if (wallets.length > 1) {
        relatedCount += wallets.length;
        clusters.push({
          clusterId: `cluster_fund_${funder.slice(0, 6)}_${cIndex++}`,
          relationship: wallets.length >= 3 ? 'RELATED_CLUSTER' : 'LIKELY_RELATED',
          memberWallets: wallets,
          totalVolumeSol: wallets.length * 1.5,
          commonFunder: funder,
          confidenceScore: wallets.length >= 3 ? 0.9 : 0.75,
        });
      } else {
        unclustered.push(wallets[0]);
      }
    }

    const estimatedIndependent = unclustered.length + clusters.length;
    const independenceScore = Number((estimatedIndependent / Math.max(1, rawBuyers.length)).toFixed(2));
    const sniperSaturationPct = Math.round((automatedCount / Math.max(1, rawBuyers.length)) * 100);

    return {
      mint,
      rawBuyerCount: rawBuyers.length,
      estimatedIndependentActors: estimatedIndependent,
      relatedWalletCount: relatedCount,
      automatedClusterCount: clusters.length,
      unresolvedCount: unclustered.length,
      topClusters: clusters,
      sniperSaturationPct,
      independenceScore,
    };
  }
}

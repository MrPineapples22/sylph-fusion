/**
 * SOL-SYLPH Master Production Intelligence - Wallet Intelligence & Effective Participants
 * Specifications: Sections 13 (Wallet Intelligence), 14 (Effective Economic Participants).
 *
 * Rules:
 * 1. Track funding ancestry, entry timing, cluster membership, and reputation.
 * 2. Calculate effective_independent_participants vs raw wallet count.
 * 3. 50 addresses funded by 2 common ancestors = 2 effective entities, not 50.
 */

export interface WalletIdentityNode {
  readonly address: string;
  readonly fundingParent?: string;
  readonly firstSeenSlot: number;
  readonly clusterId?: string;
  readonly reputationScore: number; // 0 (malicious/throwaway) to 100 (veteran)
}

export class WalletIntelligenceEngine {
  private readonly nodes = new Map<string, WalletIdentityNode>();
  private readonly clusterMembers = new Map<string, Set<string>>();

  public registerWallet(node: WalletIdentityNode): void {
    this.nodes.set(node.address, node);

    const cluster = node.fundingParent ?? node.clusterId ?? node.address;
    let members = this.clusterMembers.get(cluster);
    if (!members) {
      members = new Set();
      this.clusterMembers.set(cluster, members);
    }
    members.add(node.address);
  }

  /**
   * Calculates effective independent participants from a list of buyer addresses.
   */
  public calculateEffectiveParticipants(buyerAddresses: readonly string[]): {
    rawBuyerCount: number;
    effectiveIndependentCount: number;
    uniqueFundingClustersCount: number;
    clusterDispersalRatio: number; // 1.0 = completely independent, 0.1 = heavily bundled
  } {
    const rawCount = buyerAddresses.length;
    if (rawCount === 0) {
      return { rawBuyerCount: 0, effectiveIndependentCount: 0, uniqueFundingClustersCount: 0, clusterDispersalRatio: 1.0 };
    }

    const observedClusters = new Set<string>();

    for (const addr of buyerAddresses) {
      const node = this.nodes.get(addr);
      const cluster = node?.fundingParent ?? node?.clusterId ?? addr;
      observedClusters.add(cluster);
    }

    const effective = observedClusters.size;
    const dispersal = effective / rawCount;

    return {
      rawBuyerCount: rawCount,
      effectiveIndependentCount: effective,
      uniqueFundingClustersCount: observedClusters.size,
      clusterDispersalRatio: Number(dispersal.toFixed(3)),
    };
  }
}

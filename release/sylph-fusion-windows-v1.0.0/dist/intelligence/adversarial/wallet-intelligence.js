/**
 * SOL-SYLPH Master Production Intelligence - Wallet Intelligence & Effective Participants
 * Specifications: Sections 13 (Wallet Intelligence), 14 (Effective Economic Participants).
 *
 * Rules:
 * 1. Track funding ancestry, entry timing, cluster membership, and reputation.
 * 2. Calculate effective_independent_participants vs raw wallet count.
 * 3. 50 addresses funded by 2 common ancestors = 2 effective entities, not 50.
 */
export class WalletIntelligenceEngine {
    nodes = new Map();
    clusterMembers = new Map();
    registerWallet(node) {
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
    calculateEffectiveParticipants(buyerAddresses) {
        const rawCount = buyerAddresses.length;
        if (rawCount === 0) {
            return { rawBuyerCount: 0, effectiveIndependentCount: 0, uniqueFundingClustersCount: 0, clusterDispersalRatio: 1.0 };
        }
        const observedClusters = new Set();
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
//# sourceMappingURL=wallet-intelligence.js.map
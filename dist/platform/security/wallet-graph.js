export class WalletRelationshipGraph {
    nodes = new Map();
    tokenToCreator = new Map();
    tokenToBuyers = new Map();
    registerToken(mint, creator, funder) {
        this.tokenToCreator.set(mint, creator);
        let creatorNode = this.nodes.get(creator);
        if (!creatorNode) {
            creatorNode = {
                address: creator,
                type: 'CREATOR',
                tokensAssociated: new Set(),
                fundingParent: funder,
                knownIncidentCount: 0,
                totalVolumeLamports: 0n,
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            };
            this.nodes.set(creator, creatorNode);
        }
        creatorNode.tokensAssociated.add(mint);
        creatorNode.lastSeenAt = Date.now();
        if (funder) {
            creatorNode.fundingParent = funder;
            let funderNode = this.nodes.get(funder);
            if (!funderNode) {
                funderNode = {
                    address: funder,
                    type: 'FUNDER',
                    tokensAssociated: new Set(),
                    knownIncidentCount: 0,
                    totalVolumeLamports: 0n,
                    firstSeenAt: Date.now(),
                    lastSeenAt: Date.now(),
                };
                this.nodes.set(funder, funderNode);
            }
            funderNode.tokensAssociated.add(mint);
        }
    }
    recordIncident(address) {
        const node = this.nodes.get(address);
        if (node) {
            node.knownIncidentCount++;
        }
    }
    recordBuyer(mint, buyer) {
        let buyers = this.tokenToBuyers.get(mint);
        if (!buyers) {
            buyers = new Set();
            this.tokenToBuyers.set(mint, buyers);
        }
        buyers.add(buyer);
        let buyerNode = this.nodes.get(buyer);
        if (!buyerNode) {
            buyerNode = {
                address: buyer,
                type: 'BUYER',
                tokensAssociated: new Set(),
                knownIncidentCount: 0,
                totalVolumeLamports: 0n,
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            };
            this.nodes.set(buyer, buyerNode);
        }
        buyerNode.tokensAssociated.add(mint);
    }
    /**
     * Analyzes the graph for serial cluster relationships:
     * 1. Common funding source with prior rugged tokens.
     * 2. Overlapping early buyers across multiple creator launches.
     */
    assessClusterRisk(mint, creator) {
        const creatorNode = this.nodes.get(creator);
        const funder = creatorNode?.fundingParent ?? null;
        let historicalIncidentCount = creatorNode?.knownIncidentCount ?? 0;
        let suspiciousConnectionScore = 0;
        let sharedFunder = null;
        let collusionConfidence = 0.0;
        // Check shared funder across historical tokens
        if (funder) {
            const funderNode = this.nodes.get(funder);
            if (funderNode) {
                historicalIncidentCount += funderNode.knownIncidentCount;
                if (funderNode.tokensAssociated.size > 3) {
                    suspiciousConnectionScore += 25; // Serial token factory
                }
                if (funderNode.knownIncidentCount > 0) {
                    suspiciousConnectionScore += 50;
                    collusionConfidence = 0.85;
                    sharedFunder = funder;
                }
            }
        }
        // Check creator launch frequency
        if (creatorNode && creatorNode.tokensAssociated.size > 5) {
            suspiciousConnectionScore += 30; // High-frequency deployer
        }
        suspiciousConnectionScore = Math.min(100, suspiciousConnectionScore);
        const reason = suspiciousConnectionScore > 50
            ? `High cluster risk: Connected to funder ${sharedFunder ?? 'cluster'} with ${historicalIncidentCount} recorded incidents`
            : 'Cluster relationships within acceptable distribution boundaries';
        return {
            clusterId: funder ?? creator,
            suspiciousConnectionScore,
            sharedFunder,
            historicalIncidentCount,
            collusionConfidence,
            reason,
        };
    }
    /**
     * Detects Sybil clustering and circular wash trading where multiple buyer wallets
     * were funded by the same root wallet or creator.
     */
    detectWashTrading(mint) {
        const buyers = this.tokenToBuyers.get(mint);
        if (!buyers || buyers.size < 2) {
            return {
                mint,
                isWashTradingSuspected: false,
                sybilClusterCount: 0,
                sharedFundingRatio: 0,
                suspiciousWallets: [],
                reason: 'Insufficient buyer count for Sybil analysis',
            };
        }
        const creator = this.tokenToCreator.get(mint);
        const creatorNode = creator ? this.nodes.get(creator) : undefined;
        const creatorFunder = creatorNode?.fundingParent;
        const funderCounts = new Map();
        const suspicious = [];
        for (const buyer of buyers) {
            const buyerNode = this.nodes.get(buyer);
            const funder = buyerNode?.fundingParent;
            if (funder) {
                if (!funderCounts.has(funder))
                    funderCounts.set(funder, []);
                funderCounts.get(funder).push(buyer);
            }
            // Direct funding from creator or creator's funder
            if (funder && (funder === creator || funder === creatorFunder)) {
                suspicious.push(buyer);
            }
        }
        let maxClusterSize = 0;
        let dominantFunder = null;
        for (const [funder, list] of funderCounts.entries()) {
            if (list.length > maxClusterSize) {
                maxClusterSize = list.length;
                dominantFunder = funder;
            }
            if (list.length >= 3) {
                suspicious.push(...list);
            }
        }
        const uniqueSuspicious = [...new Set(suspicious)];
        const sharedFundingRatio = uniqueSuspicious.length / buyers.size;
        const isWash = sharedFundingRatio >= 0.35 || (maxClusterSize >= 3 && buyers.size <= 10);
        return {
            mint,
            isWashTradingSuspected: isWash,
            sybilClusterCount: maxClusterSize,
            sharedFundingRatio,
            suspiciousWallets: Object.freeze(uniqueSuspicious),
            reason: isWash
                ? `Wash trading suspected: ${uniqueSuspicious.length}/${buyers.size} (${(sharedFundingRatio * 100).toFixed(1)}%) buyers share common funder (${dominantFunder?.slice(0, 8)})`
                : 'Organic buyer dispersion observed',
        };
    }
}
//# sourceMappingURL=wallet-graph.js.map
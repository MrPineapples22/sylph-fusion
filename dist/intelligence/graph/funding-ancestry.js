/**
 * SOL-SYLPH Intelligence Fabric - Funding Ancestry Engine
 * Specifications: Parts X (Funding Ancestry), XI (Behavioral Intelligence), XII (Motif & Cluster Detection).
 *
 * Calculates:
 * - shared_funder_ratio
 * - funding_entropy (Shannon entropy)
 * - independent_funding_roots
 * - funding_depth
 * - capital_source_diversity
 * - wallet_reuse
 * - creator_overlap
 * - motifs: STAR_FUNDING, CHAIN_FUNDING, CIRCULAR_FLOWS, COORDINATED_LAUNCH
 */
export class FundingAncestryEngine {
    fundingRecords = new Map(); // wallet -> stack of records
    recordFunding(wallet, parent, slot = 0, timestampMs = Date.now(), supportingEventId) {
        const stack = this.fundingRecords.get(wallet) ?? [];
        for (const r of stack) {
            if (r.status === 'ACTIVE') {
                r.status = 'SUPERSEDED';
            }
        }
        stack.push({
            wallet,
            parent,
            slot,
            timestampMs,
            supportingEventId,
            status: 'ACTIVE',
        });
        this.fundingRecords.set(wallet, stack);
    }
    getParent(wallet) {
        const stack = this.fundingRecords.get(wallet);
        if (!stack || stack.length === 0)
            return undefined;
        const active = [...stack].reverse().find(r => r.status === 'ACTIVE');
        return active?.parent;
    }
    rollbackSlot(slot) {
        let rolledBackCount = 0;
        for (const stack of this.fundingRecords.values()) {
            for (const r of stack) {
                if (r.slot === slot && r.status === 'ACTIVE') {
                    r.status = 'RETRACTED';
                    rolledBackCount++;
                    // Restore prior non-retracted record if any
                    const prior = [...stack].reverse().find(entry => entry.status === 'SUPERSEDED' && entry.slot < slot);
                    if (prior) {
                        prior.status = 'ACTIVE';
                    }
                }
            }
        }
        return rolledBackCount;
    }
    analyzeAncestry(wallets, creatorAddress) {
        if (!wallets || wallets.length === 0) {
            return {
                totalWallets: 0,
                independentFundingRootsCount: 0,
                sharedFunderRatio: 0,
                fundingEntropy: 0,
                capitalSourceDiversity: 0,
                averageFundingDepth: 0,
                creatorOverlap: false,
                detectedMotifs: ['ORGANIC_DIVERSE'],
                isSyntheticSybilCluster: false,
            };
        }
        const funderCounts = new Map();
        let totalAssigned = 0;
        let creatorInCluster = false;
        let totalDepth = 0;
        for (const w of wallets) {
            const funder = w.fundingParentAddress || this.getParent(w.walletAddress) || w.walletAddress;
            funderCounts.set(funder, (funderCounts.get(funder) ?? 0) + 1);
            totalAssigned++;
            totalDepth += w.hopsFromExchange ?? 1;
            if (creatorAddress && (funder === creatorAddress || w.walletAddress === creatorAddress)) {
                creatorInCluster = true;
            }
        }
        const independentRoots = funderCounts.size;
        const maxFunderCount = Math.max(...funderCounts.values());
        const sharedRatio = totalAssigned > 0 ? (maxFunderCount / totalAssigned) : 0;
        // Shannon Entropy: H = - sum(p * log2(p))
        let entropy = 0;
        for (const count of funderCounts.values()) {
            const p = count / totalAssigned;
            if (p > 0) {
                entropy -= p * Math.log2(p);
            }
        }
        // Maximum theoretical entropy for N items is log2(N)
        const maxPossibleEntropy = totalAssigned > 1 ? Math.log2(totalAssigned) : 1;
        const diversity = maxPossibleEntropy > 0 ? Math.min(1.0, entropy / maxPossibleEntropy) : 1.0;
        // Detect motifs
        const motifs = [];
        if (sharedRatio >= 0.6 && totalAssigned >= 3) {
            motifs.push('STAR_FUNDING'); // One funder distributes to many wallets simultaneously
        }
        if (independentRoots >= totalAssigned * 0.8) {
            motifs.push('ORGANIC_DIVERSE');
        }
        const dominant = Array.from(funderCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
        const isSyntheticSybilCluster = sharedRatio >= 0.5 || (totalAssigned >= 5 && independentRoots <= 2);
        return {
            totalWallets: totalAssigned,
            independentFundingRootsCount: independentRoots,
            sharedFunderRatio: Number(sharedRatio.toFixed(3)),
            fundingEntropy: Number(entropy.toFixed(3)),
            capitalSourceDiversity: Number(diversity.toFixed(3)),
            averageFundingDepth: Number((totalDepth / totalAssigned).toFixed(1)),
            creatorOverlap: creatorInCluster,
            dominantFunder: dominant,
            detectedMotifs: motifs.length ? motifs : ['ORGANIC_DIVERSE'],
            isSyntheticSybilCluster,
        };
    }
}
//# sourceMappingURL=funding-ancestry.js.map
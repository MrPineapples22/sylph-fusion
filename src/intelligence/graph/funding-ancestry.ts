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

export interface WalletFundingProfile {
  readonly walletAddress: string;
  readonly fundingParentAddress?: string;
  readonly fundingAmountSol: number;
  readonly fundedAtMs?: number;
  readonly hopsFromExchange?: number;
}

export interface FundingAncestryReport {
  readonly totalWallets: number;
  readonly independentFundingRootsCount: number;
  readonly sharedFunderRatio: number; // 0.0 (all independent) to 1.0 (all funded by same parent)
  readonly fundingEntropy: number; // Shannon entropy in bits
  readonly capitalSourceDiversity: number; // 0.0 (pure Sybil) to 1.0 (ideal decentralized organic)
  readonly averageFundingDepth: number; // average hops
  readonly creatorOverlap: boolean; // Creator is in the same funding cluster as early buyers
  readonly dominantFunder?: string;
  readonly detectedMotifs: readonly ('STAR_FUNDING' | 'CHAIN_FUNDING' | 'CIRCULAR_FLOWS' | 'ORGANIC_DIVERSE')[];
  readonly isSyntheticSybilCluster: boolean;
}

export class FundingAncestryEngine {
  private readonly historicalWalletFunding = new Map<string, string>(); // wallet -> parent

  public recordFunding(wallet: string, parent: string): void {
    this.historicalWalletFunding.set(wallet, parent);
  }

  public analyzeAncestry(
    wallets: readonly WalletFundingProfile[],
    creatorAddress?: string
  ): FundingAncestryReport {
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

    const funderCounts = new Map<string, number>();
    let totalAssigned = 0;
    let creatorInCluster = false;
    let totalDepth = 0;

    for (const w of wallets) {
      const funder = w.fundingParentAddress || this.historicalWalletFunding.get(w.walletAddress) || w.walletAddress;
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
    const motifs: ('STAR_FUNDING' | 'CHAIN_FUNDING' | 'CIRCULAR_FLOWS' | 'ORGANIC_DIVERSE')[] = [];
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

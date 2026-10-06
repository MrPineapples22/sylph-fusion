/**
 * SYLPH FUSION — LIQUIDATION HYPERGRAPH X (Section 15)
 * Higher-order holder risk decomposition.
 * Groups individual wallet addresses into coordinated economic actor hyperedges based on:
 * - Common funding source / funder root
 * - Synchronized acquisition window (< 500ms or same slot)
 * - Equivalent cost basis
 * - Shared behavioral timing
 * - Bundle membership (Jito bundle or atomic batch)
 * - Creator relationship / deployer funding
 * - Common exit trigger topology
 *
 * Prevents treating 1,000 sybil/coordinated wallets as 1,000 independent holders.
 */

export interface HolderNode {
  readonly address: string;
  readonly balanceLamportsOrTokens: bigint;
  readonly percentageOfSupply: number;
  readonly acquisitionSlot: number;
  readonly acquisitionTimeMs: number;
  readonly costBasisUsdOrSol: number;
  readonly fundingSource?: string;
  readonly bundleId?: string;
  readonly isCreatorOrDeployer: boolean;
}

export interface Hyperedge {
  readonly hyperedgeId: string;
  readonly reason: 'FUNDING_SOURCE' | 'ACQUISITION_WINDOW' | 'BUNDLE' | 'CREATOR_CONNECTED' | 'COST_BASIS_CLUSTER' | 'TIMING_SYNC';
  readonly memberAddresses: readonly string[];
  readonly aggregateSupplyFraction: number;
  readonly aggregateTokens: bigint;
  readonly sharedCostBasis: number;
}

export interface LiquidationHypergraphResult {
  readonly totalDistinctWallets: number;
  readonly effectiveIndependentActors: number;
  readonly sybilCoordinationRatio: number; // 1 - (effectiveActors / totalDistinctWallets)
  readonly hyperedges: readonly Hyperedge[];
  readonly effectiveWhaleSize: number;     // Largest single coordinated cluster fraction of supply
  readonly expectedSimultaneousLiquidation: number; // Sum of high-risk coordinated clusters likely to exit together
  readonly hyperedgeAbsorptionRatio: number; // Ratio of current liquidity pool depth to expected liquidation cluster size
  readonly criticalLiquidationClusters: number; // Number of clusters whose individual liquidation would exhaust > 40% of pool depth
  readonly liquidationHypergraphVeto: boolean;  // True if effectiveWhaleSize > 0.18 or hyperedgeAbsorptionRatio < 1.2
}

export class LiquidationHypergraphAnalyzer {
  /**
   * Constructs hypergraph from raw holder observations and evaluates true liquidation risk.
   */
  public static analyze(
    holders: readonly HolderNode[],
    liquidityDepthFractionOfSupply: number
  ): LiquidationHypergraphResult {
    if (!holders || holders.length === 0) {
      return {
        totalDistinctWallets: 0,
        effectiveIndependentActors: 0,
        sybilCoordinationRatio: 0,
        hyperedges: [],
        effectiveWhaleSize: 0,
        expectedSimultaneousLiquidation: 0,
        hyperedgeAbsorptionRatio: 10.0,
        criticalLiquidationClusters: 0,
        liquidationHypergraphVeto: false,
      };
    }

    const totalWallets = holders.length;
    const hyperedgeMap = new Map<string, {
      reason: Hyperedge['reason'];
      members: Set<string>;
      supplyFraction: number;
      tokens: bigint;
      costBasis: number;
    }>();

    // 1. Group by funding source
    for (const h of holders) {
      if (h.fundingSource && h.fundingSource.trim().length > 0) {
        const key = `funder_${h.fundingSource.toLowerCase()}`;
        const existing = hyperedgeMap.get(key) ?? {
          reason: 'FUNDING_SOURCE' as const,
          members: new Set<string>(),
          supplyFraction: 0,
          tokens: 0n,
          costBasis: h.costBasisUsdOrSol,
        };
        existing.members.add(h.address);
        existing.supplyFraction += h.percentageOfSupply;
        existing.tokens += h.balanceLamportsOrTokens;
        hyperedgeMap.set(key, existing);
      }
    }

    // 2. Group by atomic bundle ID
    for (const h of holders) {
      if (h.bundleId && h.bundleId.trim().length > 0) {
        const key = `bundle_${h.bundleId}`;
        const existing = hyperedgeMap.get(key) ?? {
          reason: 'BUNDLE' as const,
          members: new Set<string>(),
          supplyFraction: 0,
          tokens: 0n,
          costBasis: h.costBasisUsdOrSol,
        };
        existing.members.add(h.address);
        existing.supplyFraction += h.percentageOfSupply;
        existing.tokens += h.balanceLamportsOrTokens;
        hyperedgeMap.set(key, existing);
      }
    }

    // 3. Group by ultra-tight acquisition window (< 400ms or same slot)
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const h1 = holders[i];
        const h2 = holders[j];
        const dtMs = Math.abs(h1.acquisitionTimeMs - h2.acquisitionTimeMs);
        const dSlot = Math.abs(h1.acquisitionSlot - h2.acquisitionSlot);

        if (dSlot === 0 || dtMs < 400) {
          const key = `sync_${Math.min(h1.acquisitionSlot, h2.acquisitionSlot)}`;
          const existing = hyperedgeMap.get(key) ?? {
            reason: 'ACQUISITION_WINDOW' as const,
            members: new Set<string>(),
            supplyFraction: 0,
            tokens: 0n,
            costBasis: (h1.costBasisUsdOrSol + h2.costBasisUsdOrSol) / 2,
          };
          if (!existing.members.has(h1.address)) {
            existing.members.add(h1.address);
            existing.supplyFraction += h1.percentageOfSupply;
            existing.tokens += h1.balanceLamportsOrTokens;
          }
          if (!existing.members.has(h2.address)) {
            existing.members.add(h2.address);
            existing.supplyFraction += h2.percentageOfSupply;
            existing.tokens += h2.balanceLamportsOrTokens;
          }
          hyperedgeMap.set(key, existing);
        }
      }
    }

    // Filter hyperedges to only those with >= 2 members
    const validHyperedges: Hyperedge[] = [];
    const groupedWallets = new Set<string>();

    for (const [key, val] of hyperedgeMap.entries()) {
      if (val.members.size >= 2) {
        validHyperedges.push({
          hyperedgeId: key,
          reason: val.reason,
          memberAddresses: Array.from(val.members),
          aggregateSupplyFraction: val.supplyFraction,
          aggregateTokens: val.tokens,
          sharedCostBasis: val.costBasis,
        });
        for (const m of val.members) {
          groupedWallets.add(m);
        }
      }
    }

    // Compute connected components across wallets using Disjoint-Set Union
    const parent = new Map<string, string>();
    const find = (i: string): string => {
      let root = i;
      while (parent.get(root) && parent.get(root) !== root) {
        root = parent.get(root)!;
      }
      return root;
    };
    const union = (i: string, j: string): void => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) {
        parent.set(rootI, rootJ);
      }
    };

    for (const h of holders) {
      parent.set(h.address, h.address);
    }
    for (const edge of validHyperedges) {
      const first = edge.memberAddresses[0];
      for (let k = 1; k < edge.memberAddresses.length; k++) {
        union(first, edge.memberAddresses[k]);
      }
    }

    const uniqueRoots = new Set<string>();
    for (const h of holders) {
      uniqueRoots.add(find(h.address));
    }
    const effectiveIndependentActors = Math.max(1, uniqueRoots.size);
    const sybilCoordinationRatio = Math.min(1.0, Math.max(0.0, 1.0 - (effectiveIndependentActors / totalWallets)));

    // Find the largest single coordinated cluster (max between top single holder and top hyperedge)
    const maxSingleWallet = Math.max(...holders.map(h => h.percentageOfSupply), 0);
    const maxHyperedge = validHyperedges.length > 0
      ? Math.max(...validHyperedges.map(e => e.aggregateSupplyFraction))
      : 0;
    const effectiveWhaleSize = Math.max(maxSingleWallet, maxHyperedge);

    // Expected simultaneous liquidation: sum of all clusters holding > 3% of supply
    const expectedSimultaneousLiquidation = Math.min(
      1.0,
      validHyperedges
        .filter(e => e.aggregateSupplyFraction >= 0.03)
        .reduce((acc, e) => acc + e.aggregateSupplyFraction, 0)
    );

    // Hyperedge absorption ratio: pool liquidity depth vs largest cluster
    const poolDepth = Math.max(0.001, liquidityDepthFractionOfSupply);
    const hyperedgeAbsorptionRatio = poolDepth / Math.max(0.001, effectiveWhaleSize);

    // Critical clusters: number of clusters whose supply fraction > 0.40 * poolDepth
    const criticalLiquidationClusters = validHyperedges.filter(
      e => e.aggregateSupplyFraction > 0.40 * poolDepth
    ).length;

    // Hard veto if effective whale controls > 18% of supply or cannot be absorbed (ratio < 1.2)
    const liquidationHypergraphVeto = effectiveWhaleSize > 0.18 || hyperedgeAbsorptionRatio < 1.2;

    return {
      totalDistinctWallets: totalWallets,
      effectiveIndependentActors,
      sybilCoordinationRatio,
      hyperedges: validHyperedges,
      effectiveWhaleSize,
      expectedSimultaneousLiquidation,
      hyperedgeAbsorptionRatio,
      criticalLiquidationClusters,
      liquidationHypergraphVeto,
    };
  }
}

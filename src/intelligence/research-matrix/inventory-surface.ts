/**
 * SYLPH FUSION — INVENTORY SURFACE X (Section 16)
 * Models expected sell inventory release as a continuous function of price multiple m:
 * A(m) = expected inventory activated near price multiple m.
 *
 * Core Principle:
 * Extreme continuation requires absorption capacity to grow faster than newly activated sell liability.
 * Tracks MarginalRepricingPower vs MarginalInventoryRelease.
 */

export interface CostBasisBucket {
  readonly multipleFloor: number; // e.g. 1.0x, 1.5x, 2.0x, 3.0x, etc.
  readonly multipleCeil: number;
  readonly tokenVolume: number;
  readonly fractionOfSupply: number;
  readonly holderCount: number;
}

export interface InventorySurfaceEvaluation {
  readonly multiple: number; // Target multiple being evaluated (e.g. 2.0, 3.0, 5.0, 10.0)
  readonly activatedSellLiability: number; // A(m): fraction of supply expected to dump near m
  readonly embeddedSellLiability: number;  // Total unresolved profit sitting in holders awaiting liquidation
  readonly profitReservoirSol: number;    // Cumulative unrealized profit in existing holders
  readonly marginalInventoryRelease: number; // dA/dm
  readonly marginalRepricingPower: number;   // d(Absorption)/dm
  readonly inventoryCliffDetected: boolean;  // True if dA/dm spikes violently at this multiple
  readonly costBasisResetQuality: number;   // 0.0 to 1.0 (how well ownership has turned over at higher basis)
  readonly runwayRegenerationRatio: number; // marginalRepricingPower / marginalInventoryRelease
  readonly continuationPermitted: boolean;  // True if runwayRegenerationRatio >= 1.0
}

export class InventorySurfaceAnalyzer {
  /**
   * Constructs the inventory activation curve A(m) and evaluates sell liability surfaces.
   *
   * @param costBasisBuckets Holder supply distribution stratified by cost-basis entry multiples
   * @param currentMultiple Current market price multiple relative to launch
   * @param targetMultiple The price milestone being tested for continuation (e.g. 2.0, 3.0, 5.0)
   * @param currentAbsorptionCapacitySol Estimated Sol buying capacity available in pool and orderbook
   */
  public static evaluate(
    costBasisBuckets: readonly CostBasisBucket[],
    currentMultiple: number,
    targetMultiple: number,
    currentAbsorptionCapacitySol: number
  ): InventorySurfaceEvaluation {
    if (costBasisBuckets.length === 0 || targetMultiple <= 0) {
      return {
        multiple: targetMultiple,
        activatedSellLiability: 1.0,
        embeddedSellLiability: 1.0,
        profitReservoirSol: 0,
        marginalInventoryRelease: 1.0,
        marginalRepricingPower: 0,
        inventoryCliffDetected: true,
        costBasisResetQuality: 0,
        runwayRegenerationRatio: 0,
        continuationPermitted: false,
      };
    }

    let activatedSupply = 0;
    let totalUnrealizedProfitFraction = 0;

    // A(m): Sum of supply for all buckets whose entry was below m, weighted by take-profit propensities
    for (const b of costBasisBuckets) {
      const avgEntry = (b.multipleFloor + b.multipleCeil) / 2;
      if (avgEntry <= targetMultiple) {
        const paperGainMultiple = targetMultiple / Math.max(0.1, avgEntry);
        // Probability of activation increases as paper gains reach 2x, 3x, 5x
        const activationProb = Math.min(0.95, Math.max(0.05, 1.0 - Math.exp(-0.6 * (paperGainMultiple - 1.0))));
        activatedSupply += b.fractionOfSupply * activationProb;

        if (paperGainMultiple > 1.0) {
          totalUnrealizedProfitFraction += b.fractionOfSupply * (paperGainMultiple - 1.0);
        }
      }
    }

    const activatedSellLiability = Math.min(1.0, Math.max(0.0, activatedSupply));
    const embeddedSellLiability = Math.min(1.0, totalUnrealizedProfitFraction);
    const profitReservoirSol = totalUnrealizedProfitFraction * currentAbsorptionCapacitySol;

    // Marginal inventory release: difference in activated supply between targetMultiple and targetMultiple * 0.9
    const dm = Math.max(0.1, targetMultiple * 0.1);
    let activatedSupplySlightlyLower = 0;
    for (const b of costBasisBuckets) {
      const avgEntry = (b.multipleFloor + b.multipleCeil) / 2;
      if (avgEntry <= targetMultiple - dm) {
        const paperGainLower = (targetMultiple - dm) / Math.max(0.1, avgEntry);
        const probLower = Math.min(0.95, Math.max(0.05, 1.0 - Math.exp(-0.6 * (paperGainLower - 1.0))));
        activatedSupplySlightlyLower += b.fractionOfSupply * probLower;
      }
    }

    const marginalInventoryRelease = Math.max(0.001, (activatedSupply - activatedSupplySlightlyLower) / dm);

    // Marginal repricing power: rate at which new bids/liquidity expand with higher multiple
    // Assuming constant elasticity with liquidity growth
    const marginalRepricingPower = Math.max(0.001, (currentAbsorptionCapacitySol / 100) / dm);

    const runwayRegenerationRatio = marginalRepricingPower / marginalInventoryRelease;
    const inventoryCliffDetected = marginalInventoryRelease > 0.40; // Over 40% of supply activating per 1.0x multiple move

    // Cost basis reset quality: fraction of supply held in the top 30% of price range
    const highBasisSupply = costBasisBuckets
      .filter(b => b.multipleFloor >= currentMultiple * 0.7)
      .reduce((acc, b) => acc + b.fractionOfSupply, 0);
    const costBasisResetQuality = Math.min(1.0, Math.max(0.0, highBasisSupply / 0.6));

    const continuationPermitted = !inventoryCliffDetected && runwayRegenerationRatio >= 0.85;

    return {
      multiple: targetMultiple,
      activatedSellLiability,
      embeddedSellLiability,
      profitReservoirSol,
      marginalInventoryRelease,
      marginalRepricingPower,
      inventoryCliffDetected,
      costBasisResetQuality,
      runwayRegenerationRatio,
      continuationPermitted,
    };
  }
}

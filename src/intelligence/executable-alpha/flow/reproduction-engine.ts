/**
 * SYLPH FUSION — REPRODUCTION ENGINE
 * Studies: BUY-REPRODUCTION-X, SELL-REPRODUCTION-X (Section XIII)
 *
 * Implements epidemiological branching process models for order flow:
 * R_buy: Expected number of secondary buyers induced by each primary buyer.
 * R_sell: Expected number of secondary sellers triggered by each sell event.
 *
 * Candidate runner condition: R_buy > 1.0 > R_sell
 * (Necessary but never sufficient on its own).
 */

export interface ReproductionReport {
  readonly rBuy: number; // Effective reproduction number for buy order flow
  readonly rSell: number; // Effective reproduction number for sell order flow
  readonly isSuperCriticalBuy: boolean; // R_buy > 1.0
  readonly isSubCriticalSell: boolean; // R_sell < 1.0
  readonly isFlowHealthy: boolean; // R_buy > 1.0 && R_sell < 1.0
  readonly branchingFactor: number;
}

export class FlowReproductionEngine {
  public static computeReproduction(params: {
    uniqueBuyersT1: number;
    uniqueBuyersT0: number;
    uniqueSellersT1: number;
    uniqueSellersT0: number;
    secondaryBuyerFraction: number; // Fraction of buyers joining after seeing external buys
    cascadingSellFraction: number; // Fraction of sellers triggered by stop-loss or panic
  }): ReproductionReport {
    const {
      uniqueBuyersT1,
      uniqueBuyersT0,
      uniqueSellersT1,
      uniqueSellersT0,
      secondaryBuyerFraction,
      cascadingSellFraction,
    } = params;

    const baseBuyerRatio = uniqueBuyersT0 > 0 ? uniqueBuyersT1 / uniqueBuyersT0 : 0.5;
    const baseSellerRatio = uniqueSellersT0 > 0 ? uniqueSellersT1 / uniqueSellersT0 : 1.2;

    const rBuy = Math.max(0.01, baseBuyerRatio * Math.max(0.2, secondaryBuyerFraction * 1.5));
    const rSell = Math.max(0.01, baseSellerRatio * Math.max(0.2, cascadingSellFraction * 1.5));

    const isSuperCriticalBuy = rBuy > 1.0;
    const isSubCriticalSell = rSell < 1.0;
    const isFlowHealthy = isSuperCriticalBuy && isSubCriticalSell;
    const branchingFactor = rBuy / Math.max(0.01, rSell);

    return {
      rBuy,
      rSell,
      isSuperCriticalBuy,
      isSubCriticalSell,
      isFlowHealthy,
      branchingFactor,
    };
  }
}

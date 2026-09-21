/**
 * SOL-SYLPH Intelligence Fabric - Flow Toxicity & Adverse Selection Engine
 * Specifications: Major Update #4 (Flow Toxicity & Adverse Selection Model).
 *
 * Rules:
 * 1. Tracks order arrival rate and directional imbalances across multi-timescale horizons (250ms to 30s).
 * 2. High toxicity = aggressive informed selling absorbing liquidity (adverse selection danger).
 */

export interface TradeTick {
  readonly timestampMs: number;
  readonly isBuy: boolean;
  readonly amountSol: number;
}

export interface HorizonFlowMetrics {
  readonly horizonMs: number;
  readonly buyNotionalSol: number;
  readonly sellNotionalSol: number;
  readonly netFlowSol: number;
  readonly tradeArrivalRatePerSec: number;
  readonly toxicityScore: number; // 0.0 (safe retail flow) to 1.0 (extreme adverse selection)
}

export class FlowToxicityEngine {
  /**
   * Evaluate flow metrics and toxicity across standard horizons.
   */
  public evaluateFlow(
    trades: readonly TradeTick[],
    asOfTimeMs = Date.now(),
    horizonsMs: readonly number[] = [250, 1_000, 5_000, 30_000]
  ): Record<number, HorizonFlowMetrics> {
    const results: Record<number, HorizonFlowMetrics> = {};

    for (const h of horizonsMs) {
      const windowStart = asOfTimeMs - h;
      const windowTrades = trades.filter((t) => t.timestampMs >= windowStart && t.timestampMs <= asOfTimeMs);

      let buyNotional = 0;
      let sellNotional = 0;

      for (const t of windowTrades) {
        if (t.isBuy) buyNotional += t.amountSol;
        else sellNotional += t.amountSol;
      }

      const netFlow = buyNotional - sellNotional;
      const totalVolume = buyNotional + sellNotional;
      const arrivalRate = (windowTrades.length / h) * 1000;

      // Toxicity rises when heavy sell pressure dominates during rapid arrivals
      let toxicity = 0;
      if (totalVolume > 0 && sellNotional > buyNotional) {
        const sellRatio = sellNotional / totalVolume;
        toxicity = Math.min(1.0, sellRatio * (1.0 + Math.min(1.0, arrivalRate / 10)));
      }

      results[h] = {
        horizonMs: h,
        buyNotionalSol: Number(buyNotional.toFixed(3)),
        sellNotionalSol: Number(sellNotional.toFixed(3)),
        netFlowSol: Number(netFlow.toFixed(3)),
        tradeArrivalRatePerSec: Number(arrivalRate.toFixed(2)),
        toxicityScore: Number(toxicity.toFixed(3)),
      };
    }

    return results;
  }
}

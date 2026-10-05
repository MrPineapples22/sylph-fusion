/**
 * SYLPH FUSION — ANTI-PORTFOLIO & REJECTED-TRADE ECONOMY
 * Specifications: Blueprint Section 51
 *
 * Invariant:
 * 1. Every rejected near-miss opportunity is durably recorded with its exact filter attribution.
 * 2. Simulates shadow execution and matured PnL for rejected candidates.
 * 3. Computes opportunity cost, loss avoided, filter precision, and regret to distinguish
 *    protective filters from profit-destroying restrictions.
 */

export interface RejectedTradeRecord {
  readonly candidateId: string;
  readonly tokenMint: string;
  readonly filterName: string;
  readonly rejectionReason: string;
  readonly rejectedAt: number;
  readonly knowledgeCutRoot: string;
  readonly shadowEntryPriceLamports: bigint;
  readonly shadowEntryFeasible: boolean;
  readonly shadowSafetyOutcome: 'SAFE' | 'RUGGED' | 'LIQUIDITY_TRAP' | 'EXPIRED';
  readonly shadowExecutableExitFeasible: boolean;
  readonly shadowMaturedPnLBps: number;
  readonly shadowHoldingDurationMs: number;
}

export interface FilterPerformanceSummary {
  readonly filterName: string;
  readonly totalRejections: number;
  readonly catastrophicLossesAvoidedCount: number;
  readonly lossAvoidedTotalLamports: bigint;
  readonly profitableTradesMissedCount: number;
  readonly opportunityCostTotalLamports: bigint;
  readonly filterPrecisionScore: number; // LossesAvoided / (LossesAvoided + ProfitableMisses)
  readonly filterRegretScore: number;    // ProfitableMisses / TotalRejections
  readonly netEconomicValueContributionLamports: bigint; // LossAvoided - OpportunityCost
  readonly status: 'HIGH_VALUE' | 'ACCEPTABLE' | 'SUSPECT_REDUNDANT' | 'DESTRUCTIVE';
}

export class AntiPortfolioLedger {
  private readonly rejectedTrades: RejectedTradeRecord[] = [];

  public recordRejection(record: RejectedTradeRecord): void {
    this.rejectedTrades.push(record);
  }

  public getRejections(): readonly RejectedTradeRecord[] {
    return this.rejectedTrades;
  }

  /**
   * Evaluates economic efficacy and regret for each safety filter.
   */
  public evaluateFilterPerformance(notionalPerTradeLamports = 1_000_000_000n): readonly FilterPerformanceSummary[] {
    const byFilter = new Map<string, RejectedTradeRecord[]>();
    for (const r of this.rejectedTrades) {
      let list = byFilter.get(r.filterName);
      if (!list) {
        list = [];
        byFilter.set(r.filterName, list);
      }
      list.push(r);
    }

    const summaries: FilterPerformanceSummary[] = [];

    for (const [filterName, records] of byFilter) {
      let avoidedLossesCount = 0;
      let missedProfitsCount = 0;
      let lossAvoidedTotalLamports = 0n;
      let opportunityCostTotalLamports = 0n;

      for (const rec of records) {
        if (rec.shadowSafetyOutcome === 'RUGGED' || rec.shadowSafetyOutcome === 'LIQUIDITY_TRAP' || rec.shadowMaturedPnLBps < -500) {
          avoidedLossesCount++;
          const lossBps = Math.abs(Math.min(-10_000, rec.shadowMaturedPnLBps));
          lossAvoidedTotalLamports += (notionalPerTradeLamports * BigInt(lossBps)) / 10_000n;
        } else if (rec.shadowMaturedPnLBps > 100 && rec.shadowExecutableExitFeasible) {
          missedProfitsCount++;
          opportunityCostTotalLamports += (notionalPerTradeLamports * BigInt(rec.shadowMaturedPnLBps)) / 10_000n;
        }
      }

      const total = records.length;
      const deciderTotal = avoidedLossesCount + missedProfitsCount;
      const filterPrecisionScore = deciderTotal > 0 ? Number((avoidedLossesCount / deciderTotal).toFixed(4)) : 1.0;
      const filterRegretScore = total > 0 ? Number((missedProfitsCount / total).toFixed(4)) : 0.0;
      const netContribution = lossAvoidedTotalLamports - opportunityCostTotalLamports;

      let status: 'HIGH_VALUE' | 'ACCEPTABLE' | 'SUSPECT_REDUNDANT' | 'DESTRUCTIVE' = 'ACCEPTABLE';
      if (filterPrecisionScore > 0.8 && netContribution > 0n) {
        status = 'HIGH_VALUE';
      } else if (netContribution < 0n && filterRegretScore > 0.4) {
        status = 'DESTRUCTIVE';
      } else if (avoidedLossesCount === 0 && missedProfitsCount === 0) {
        status = 'SUSPECT_REDUNDANT';
      }

      summaries.push({
        filterName,
        totalRejections: total,
        catastrophicLossesAvoidedCount: avoidedLossesCount,
        lossAvoidedTotalLamports,
        profitableTradesMissedCount: missedProfitsCount,
        opportunityCostTotalLamports,
        filterPrecisionScore,
        filterRegretScore,
        netEconomicValueContributionLamports: netContribution,
        status,
      });
    }

    return summaries;
  }
}

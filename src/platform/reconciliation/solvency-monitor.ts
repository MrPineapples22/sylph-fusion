/**
 * SOL-SYLPH Multi-User Platform - Real-Time Solvency & Settlement Readiness Monitor
 * Specifications: Sections XLVII (Solvency Monitoring), XLIX (Liability Maturity Schedule),
 * L (Settlement Readiness Score), LI (Liquidity Coverage).
 */

import type {
  LiabilityMaturitySchedule,
  LiquidityCoverageRatio,
  SettlementReadinessScore,
  SolvencyReport,
} from './types.js';

export interface VaultMaturityInfo {
  readonly vaultId: string;
  readonly remainingTimeMs: number;
  readonly estimatedSettlementObligationLamports: bigint;
  readonly liquidSolLamports: bigint;
  readonly openPositionsCount: number;
  readonly openPositionsEstimatedExitLamports: bigint;
  readonly pendingTxCount: number;
  readonly isReconciliationClean: boolean;
}

export class SolvencyMonitor {
  /**
   * Produce solvency report.
   */
  public generateSolvencyReport(
    controlledAssetsLamports: bigint,
    customerLiabilitiesLamports: bigint,
    platformTreasuryLamports: bigint
  ): SolvencyReport {
    const totalObligations = customerLiabilitiesLamports;
    const solvencyRatio = totalObligations > 0n
      ? Number((controlledAssetsLamports * 10_000n) / totalObligations) / 10_000
      : 1.0;

    const unexplained = controlledAssetsLamports - (customerLiabilitiesLamports + platformTreasuryLamports);

    return {
      timestamp: Date.now(),
      controlledAssetsLamports,
      customerLiabilitiesLamports,
      platformTreasuryLamports,
      solvencyRatio,
      isFullySolvent: controlledAssetsLamports >= customerLiabilitiesLamports,
      unexplainedDiscrepancyLamports: unexplained,
    };
  }

  /**
   * Aggregate upcoming liabilities into maturity buckets.
   */
  public calculateLiabilityMaturity(vaults: readonly VaultMaturityInfo[]): LiabilityMaturitySchedule {
    const H6_MS = 6 * 3600 * 1000;
    const H12_MS = 12 * 3600 * 1000;
    const H24_MS = 24 * 3600 * 1000;
    const H48_MS = 48 * 3600 * 1000;

    let dueUnder6h = 0n;
    let due6to12h = 0n;
    let due12to24h = 0n;
    let due24to48h = 0n;
    let dueOver48h = 0n;

    for (const v of vaults) {
      const amt = v.estimatedSettlementObligationLamports;
      if (v.remainingTimeMs <= H6_MS) {
        dueUnder6h += amt;
      } else if (v.remainingTimeMs <= H12_MS) {
        due6to12h += amt;
      } else if (v.remainingTimeMs <= H24_MS) {
        due12to24h += amt;
      } else if (v.remainingTimeMs <= H48_MS) {
        due24to48h += amt;
      } else {
        dueOver48h += amt;
      }
    }

    const totalNearTerm = dueUnder6h + due6to12h + due12to24h;

    return {
      timestamp: Date.now(),
      dueUnder6hLamports: dueUnder6h,
      due6to12hLamports: due6to12h,
      due12to24hLamports: due12to24h,
      due24to48hLamports: due24to48h,
      dueOver48hLamports: dueOver48h,
      totalNearTermDueLamports: totalNearTerm,
    };
  }

  /**
   * Calculate settlement readiness score for a specific vault.
   */
  public calculateSettlementReadiness(vault: VaultMaturityInfo): SettlementReadinessScore {
    let score = 1.0;

    // Reconciliation unclean drops score to 0
    if (!vault.isReconciliationClean) {
      score = 0.0;
    }

    // Pending transactions drop score significantly
    if (vault.pendingTxCount > 0) {
      score -= 0.4;
    }

    // Open positions must be liquidated before settlement
    if (vault.openPositionsCount > 0) {
      score -= Math.min(0.5, vault.openPositionsCount * 0.25);
    }

    // Liquid asset coverage vs estimated obligation
    if (vault.estimatedSettlementObligationLamports > 0n && vault.liquidSolLamports < vault.estimatedSettlementObligationLamports) {
      const liquidFraction = Number((vault.liquidSolLamports * 100n) / vault.estimatedSettlementObligationLamports) / 100;
      score *= liquidFraction;
    }

    score = Math.max(0.0, Math.min(1.0, Number(score.toFixed(3))));

    const isReadyToSettle = score >= 0.95 && vault.openPositionsCount === 0 && vault.pendingTxCount === 0 && vault.isReconciliationClean;

    return {
      vaultId: vault.vaultId,
      liquidSolLamports: vault.liquidSolLamports,
      openPositionsCount: vault.openPositionsCount,
      openPositionsEstimatedExitLamports: vault.openPositionsEstimatedExitLamports,
      pendingTxCount: vault.pendingTxCount,
      isReconciliationClean: vault.isReconciliationClean,
      remainingCycleTimeMs: vault.remainingTimeMs,
      readinessScore: score,
      isReadyToSettle,
    };
  }

  /**
   * Calculate platform-wide liquidity coverage ratio.
   */
  public calculateLiquidityCoverage(
    immediatelyAvailableLiquidLamports: bigint,
    nearTermDueLamports: bigint
  ): LiquidityCoverageRatio {
    if (nearTermDueLamports === 0n) {
      return {
        immediatelyAvailableLamports: immediatelyAvailableLiquidLamports,
        nearTermObligationsLamports: 0n,
        coverageRatio: 999.0,
        isCoverageAdequate: true,
      };
    }

    const ratio = Number((immediatelyAvailableLiquidLamports * 10_000n) / nearTermDueLamports) / 10_000;
    const isCoverageAdequate = ratio >= 1.2; // Minimum 120% coverage

    return {
      immediatelyAvailableLamports: immediatelyAvailableLiquidLamports,
      nearTermObligationsLamports: nearTermDueLamports,
      coverageRatio: Number(ratio.toFixed(3)),
      isCoverageAdequate,
    };
  }
}

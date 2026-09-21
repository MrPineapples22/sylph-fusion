/**
 * SOL-SYLPH Multi-User Platform - Continuous Reconciliation & Solvency Types
 * Specifications: Sections VI (Double-Entry Invariance), XLVI (Continuous Reconciliation),
 * XLVII (Proof-of-Reserves / Solvency), XLIX (Liability Maturity Schedule),
 * L (Settlement Readiness Score), LI (Liquidity Coverage).
 */

export interface MultiWayReconciliationInputs {
  readonly onChainBalanceLamports: bigint;
  readonly signerConfirmedTotalLamports: bigint;
  readonly ledgerControlledAssetsLamports: bigint;
  readonly vaultCustomerLiabilitiesLamports: bigint;
  readonly platformTreasuryLamports: bigint;
  readonly explicitDiscrepancyLamports: bigint;
}

export interface ReconciliationAlert {
  readonly alertId: string;
  readonly timestamp: number;
  readonly severity: 'WARNING' | 'CRITICAL' | 'FATAL';
  readonly discrepancyLamports: bigint;
  readonly explanation: string;
  readonly affectedDomains: readonly string[];
}

export interface ReconciliationRunResult {
  readonly runId: string;
  readonly timestamp: number;
  readonly isClean: boolean;
  readonly deltaLamports: bigint;
  readonly inputs: MultiWayReconciliationInputs;
  readonly alerts: readonly ReconciliationAlert[];
}

export interface SolvencyReport {
  readonly timestamp: number;
  readonly controlledAssetsLamports: bigint;
  readonly customerLiabilitiesLamports: bigint;
  readonly platformTreasuryLamports: bigint;
  readonly solvencyRatio: number; // controlled / liabilities
  readonly isFullySolvent: boolean;
  readonly unexplainedDiscrepancyLamports: bigint;
}

export interface LiabilityMaturitySchedule {
  readonly timestamp: number;
  readonly dueUnder6hLamports: bigint;
  readonly due6to12hLamports: bigint;
  readonly due12to24hLamports: bigint;
  readonly due24to48hLamports: bigint;
  readonly dueOver48hLamports: bigint;
  readonly totalNearTermDueLamports: bigint; // Under 24h
}

export interface SettlementReadinessScore {
  readonly vaultId: string;
  readonly liquidSolLamports: bigint;
  readonly openPositionsCount: number;
  readonly openPositionsEstimatedExitLamports: bigint;
  readonly pendingTxCount: number;
  readonly isReconciliationClean: boolean;
  readonly remainingCycleTimeMs: number;
  readonly readinessScore: number; // 0.0 to 1.0
  readonly isReadyToSettle: boolean;
}

export interface LiquidityCoverageRatio {
  readonly immediatelyAvailableLamports: bigint;
  readonly nearTermObligationsLamports: bigint; // e.g. < 24h
  readonly coverageRatio: number; // e.g. 1.5 = 150% coverage
  readonly isCoverageAdequate: boolean; // >= 1.2
}

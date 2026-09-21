/**
 * SOL-SYLPH Multi-User Autonomous Trading Platform - Universal Types & Correlation Identifiers
 */

export interface CorrelationContext {
  userId?: string;
  vaultId?: string;
  cycleId?: string;
  strategyId?: string;
  strategyVersion?: string;
  signalId?: string;
  cohortId?: string;
  orderId?: string;
  transactionId?: string;
  settlementId?: string;
  incidentId?: string;
}

export type AssetCategory =
  | 'CUSTOMER_ASSETS'
  | 'PLATFORM_TREASURY'
  | 'PLATFORM_OPERATING_FUNDS'
  | 'OPERATIONAL_SECURITY_RESERVE'
  | 'SETTLEMENT_FUNDS'
  | 'TRADING_CAPITAL';

export type OperationalLossClassification =
  | 'MARKET_LOSS'
  | 'STRATEGY_LOSS'
  | 'SLIPPAGE'
  | 'NETWORK_COST'
  | 'EXECUTION_FAILURE'
  | 'PLATFORM_ERROR'
  | 'SECURITY_INCIDENT'
  | 'RECONCILIATION_ERROR'
  | 'SETTLEMENT_ERROR';

export type OperationalLossType = OperationalLossClassification;

export type UserRiskMandateType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type RiskMandateType = UserRiskMandateType;

export interface UserRiskMandate {
  type: UserRiskMandateType;
  maxActiveExposureBps: number; // e.g. 5000 = 50% max active exposure
  reservePercentageBps: number; // e.g. 3000 = 30% cash/SOL reserve floor
  maxPositions: number;         // e.g. 2 for conservative, 5 for aggressive
  maxPositionSizeBps: number;   // e.g. 2500 = 25% max single position
  maxCycleDrawdownBps: number;  // e.g. 800 = 8% drawdown limit per 72h cycle
  minLiquidityLamports: bigint; // minimum pool liquidity to enter
  maxPriceImpactBps: number;    // maximum allowable price impact
  maxSlippageBps: number;       // maximum allowable slippage
}

export interface SegregatedVaultBalances {
  customerAssetsLamports: bigint;
  platformTreasuryLamports: bigint;
  platformOperatingFundsLamports: bigint;
  operationalReserveLamports: bigint;
  settlementFundsLamports: bigint;
  tradingCapitalLamports: bigint;
  lockedInPositionsLamports: bigint;
}

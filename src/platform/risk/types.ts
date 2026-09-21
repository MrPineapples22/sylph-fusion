import { UserRiskMandate } from '../types.js';

export type RiskDisposition = 'APPROVE' | 'REDUCE' | 'REJECT';

export interface TradeProposal {
  proposalId: string;
  vaultId: string;
  userId: string;
  cycleId: string;
  strategyId: string;
  strategyVersion: string;
  mint: string;
  creator: string;
  side: 'buy' | 'sell';
  requestedAmountLamports: bigint;
  expectedSlippageBps: number;
  expectedPriceImpactBps: number;
  poolLiquidityLamports: bigint;
  timestamp: number;
}

export interface RiskAuthorization {
  disposition: RiskDisposition;
  authorizedAmountLamports: bigint;
  rejectionReason: string | null;
  appliedConstraints: string[];
  maxAllowableLossLamports: bigint;
  cycleDrawdownBps: number;
  globalTokenExposureBps: number;
  timestamp: number;
}

export interface CrossCycleRiskMemory {
  vaultId: string;
  consecutiveLossStreak: number;
  peakCycleDrawdownBps: number;
  lifetimeCompletedCycles: number;
  rolling3CycleLossLamports: bigint;
  governorState: 'NORMAL' | 'REDUCED' | 'PRESERVATION' | 'NO_NEW_ENTRIES';
  lastEvaluatedAt: number;
}

export interface SystemicPlatformRiskConfig {
  maxPlatformTotalDeployedBps: number;      // e.g. 7000 = max 70% of all customer assets deployed
  maxSingleTokenPlatformConcentrationBps: number; // e.g. 500 = max 5% of total platform NAV in 1 token
  maxSingleCreatorPlatformExposureBps: number;    // e.g. 300 = max 3% of total platform NAV in 1 creator
  minGlobalLiquidityReserveLamports: bigint;      // e.g. 50 SOL floor for platform liquidity buffer
}

/**
 * SOL-SYLPH Multi-User Platform - AI Risk Sentinel & Market Safety Types
 * Specifications: Sections XXXVIII (AI Risk Sentinel), XXXIX (Behavioral Fingerprinting),
 * XL (Systemic Market Safety Engine), LVII (Operational Loss Classification),
 * LVIII (Incident Flight Recorder).
 */

import type { OperationalLossType } from '../types.js';

export type SystemicSafetyState = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'RECOVERY';

export interface SystemicMarketInputs {
  readonly solVolatilityBps: number;
  readonly rpcFailureRateBps: number;
  readonly recentRugCount: number;
  readonly dexLiquidityDropBps: number;
  readonly reconciliationClean: boolean;
}

export interface SentinelAnomalyFinding {
  readonly findingId: string;
  readonly timestamp: number;
  readonly type: 'BURST_TRADING' | 'SLIPPAGE_CLUSTER' | 'LATENCY_SPIKE' | 'FAILURE_STREAK' | 'BEHAVIORAL_DRIFT';
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly targetStrategyId?: string;
  readonly targetVaultId?: string;
  readonly description: string;
  readonly suggestedMitigation: 'NONE' | 'REDUCE_SIZE' | 'ISOLATE_STRATEGY' | 'HALT_ENTRIES';
}

export interface StrategyBehaviorProfile {
  readonly strategyId: string;
  readonly version: string;
  readonly baselineAvgHoldingTimeSec: number;
  readonly baselineAvgSlippageBps: number;
  readonly baselineWinRateBps: number;
  readonly maxObservedTradeBurstPerMin: number;
}

export interface IncidentContextSnapshot {
  readonly incidentId: string;
  readonly timestamp: number;
  readonly lossType: OperationalLossType;
  readonly vaultId?: string;
  readonly strategyId?: string;
  readonly marketState: Record<string, unknown>;
  readonly riskState: Record<string, unknown>;
  readonly ledgerStateHash: string;
  readonly stackTrace?: string;
}

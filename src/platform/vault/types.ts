import { UserRiskMandate, SegregatedVaultBalances } from '../types.js';

export type VaultLifecycleState =
  | 'CREATED'
  | 'AWAITING_DEPOSIT'
  | 'DEPOSIT_DETECTED'
  | 'CONFIRMING'
  | 'FUNDED'
  | 'ACTIVATION_PENDING'
  | 'ACTIVE'
  | 'PRESERVATION'
  | 'EXITING'
  | 'RECONCILING'
  | 'SETTLEMENT_READY'
  | 'SETTLEMENT_SUBMITTED'
  | 'SETTLED'
  | 'CLOSED'
  | 'PAUSED'
  | 'RISK_FROZEN'
  | 'SECURITY_HOLD'
  | 'RECONCILIATION_FAILED'
  | 'SETTLEMENT_FAILED'
  | 'RECOVERY_REQUIRED';

export interface UserAccount {
  userId: string;
  confirmedDestinationAddress: string;
  createdAt: number;
  kycVerified: boolean;
  notes?: string;
}

export interface UserVault {
  vaultId: string;
  userId: string;
  state: VaultLifecycleState;
  mandate: UserRiskMandate;
  currentCycleId: string | null;
  cycleStartedAt: number | null;
  cycleEndsAt: number | null;
  balances: SegregatedVaultBalances;
  authorizedRiskCapitalLamports: bigint;
  highWaterMarkLamports: bigint;
  startingNavLamports: bigint;
  currentNavLamports: bigint;
  peakNavLamports: bigint;
  lifetimeRealizedPnlLamports: bigint;
  lifetimeFeesPaidLamports: bigint;
  createdAt: number;
  updatedAt: number;
}

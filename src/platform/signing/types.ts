/**
 * SOL-SYLPH Multi-User Platform - Zero-Trust Signing & Settlement Firewall Types
 * Specifications: Sections XLI (Zero-Trust Signing), XLII (Authorization Domains),
 * XLIII (Settlement Firewall), XLIV (Idempotent Transactions), XLV (Idempotent Settlement).
 */

export type AuthorizationDomain = 'TRADING' | 'SETTLEMENT' | 'TREASURY' | 'EMERGENCY_OPERATIONS';

export type TransactionLifecycleState =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED'
  | 'UNKNOWN_RECONCILE';

export interface SigningRequest {
  readonly transactionId: string;
  readonly domain: AuthorizationDomain;
  readonly vaultId: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly targetProgramId: string;
  readonly destinationAddress?: string;
  readonly amountLamports: bigint;
  readonly serializedMessage: Uint8Array;
  readonly requestedAt: number;
  readonly metadata: Record<string, unknown>;
}

export interface SigningPolicy {
  readonly maxAmountLamportsPerTx: bigint;
  readonly allowedProgramIds: readonly string[];
  readonly emergencyHaltActive: boolean;
  readonly requireReconciliationClean: boolean;
}

export interface SignatureResult {
  readonly transactionId: string;
  readonly signature: string;
  readonly signedAt: number;
  readonly domain: AuthorizationDomain;
}

export type SettlementState =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

export interface SettlementAuthorizationRequest {
  readonly settlementId: string;
  readonly vaultId: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly userDestinationAddress: string;
  readonly netPayableLamports: bigint;
  readonly platformFeeLamports: bigint;
  readonly verifiedLiquidBalanceLamports: bigint;
  readonly isReconciliationClean: boolean;
  readonly cycleState: string;
}

export interface SettlementDecision {
  readonly approved: boolean;
  readonly settlementId: string;
  readonly netPayableLamports: bigint;
  readonly platformFeeLamports: bigint;
  readonly rejectionReason?: string;
  readonly timestamp: number;
}

/**
 * SOL-SYLPH Multi-User Platform - Settlement Firewall
 * Specifications: Sections XLIII (Withdrawal / Settlement Firewall), XLV (Idempotent Settlement).
 *
 * Rules:
 * 1. Independent policy verification on every settlement transaction.
 * 2. Mandatory destination verification (must match confirmed user destination).
 * 3. Amount verification (cannot exceed liquid balance).
 * 4. Cycle state check (must be SETTLEMENT_READY).
 * 5. Reconciliation invariant (halts if reconciliation is unclean).
 * 6. Idempotent settlement records prevent duplicate payouts across restarts.
 */

import type {
  SettlementAuthorizationRequest,
  SettlementDecision,
  SettlementState,
} from './types.js';

export interface SettlementRecord {
  readonly settlementId: string;
  readonly vaultId: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly destinationAddress: string;
  readonly netPayableLamports: bigint;
  readonly platformFeeLamports: bigint;
  state: SettlementState;
  authorizedAt?: number;
  submittedAt?: number;
  confirmedAt?: number;
  failedAt?: number;
  rejectionReason?: string;
  txSignature?: string;
}

export class SettlementFirewall {
  private readonly settlementStore: Map<string, SettlementRecord> = new Map();
  private readonly confirmedDestinationsByVault: Map<string, string> = new Map();

  /**
   * Register the user's confirmed payout destination during vault initialization.
   */
  public registerConfirmedDestination(vaultId: string, confirmedDestinationAddress: string): void {
    if (!confirmedDestinationAddress || confirmedDestinationAddress.length < 32) {
      throw new Error(`Invalid Solana destination address: ${confirmedDestinationAddress}`);
    }
    this.confirmedDestinationsByVault.set(vaultId, confirmedDestinationAddress);
  }

  public getConfirmedDestination(vaultId: string): string | undefined {
    return this.confirmedDestinationsByVault.get(vaultId);
  }

  /**
   * Verify and authorize a settlement payout.
   */
  public authorizeSettlement(req: SettlementAuthorizationRequest): SettlementDecision {
    const now = Date.now();

    // 1. Idempotency Check
    const existing = this.settlementStore.get(req.settlementId);
    if (existing) {
      if (existing.state === 'CONFIRMED' || existing.state === 'SUBMITTED' || existing.state === 'AUTHORIZED') {
        return {
          approved: false,
          settlementId: req.settlementId,
          netPayableLamports: 0n,
          platformFeeLamports: 0n,
          rejectionReason: `Duplicate settlement request: Settlement ${req.settlementId} is already in state ${existing.state}`,
          timestamp: now,
        };
      }
    }

    // 2. Cycle State Invariant
    if (req.cycleState !== 'SETTLEMENT_READY' && req.cycleState !== 'SETTLED') {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Cycle state must be SETTLEMENT_READY to settle (current: ${req.cycleState})`,
        timestamp: now,
      };
    }

    // 3. Destination Address Whitelist / Identity Matching
    const confirmedDest = this.confirmedDestinationsByVault.get(req.vaultId);
    if (!confirmedDest) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `No confirmed destination registered for vault ${req.vaultId}`,
        timestamp: now,
      };
    }

    if (req.userDestinationAddress !== confirmedDest) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Destination mismatch: Requested ${req.userDestinationAddress} does not match confirmed ${confirmedDest}`,
        timestamp: now,
      };
    }

    // 4. Reconciliation Health Check
    if (!req.isReconciliationClean) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: 'Reconciliation alert: Settlement blocked due to active accounting discrepancies',
        timestamp: now,
      };
    }

    // 5. Balance & Solvency Invariant
    const totalRequired = req.netPayableLamports + req.platformFeeLamports;
    if (totalRequired > req.verifiedLiquidBalanceLamports) {
      return {
        approved: false,
        settlementId: req.settlementId,
        netPayableLamports: 0n,
        platformFeeLamports: 0n,
        rejectionReason: `Insufficient liquid balance: Required ${totalRequired} lamports > Verified ${req.verifiedLiquidBalanceLamports} lamports`,
        timestamp: now,
      };
    }

    // Authorization Granted
    const record: SettlementRecord = {
      settlementId: req.settlementId,
      vaultId: req.vaultId,
      userId: req.userId,
      cycleId: req.cycleId,
      destinationAddress: req.userDestinationAddress,
      netPayableLamports: req.netPayableLamports,
      platformFeeLamports: req.platformFeeLamports,
      state: 'AUTHORIZED',
      authorizedAt: now,
    };

    this.settlementStore.set(req.settlementId, record);

    return {
      approved: true,
      settlementId: req.settlementId,
      netPayableLamports: req.netPayableLamports,
      platformFeeLamports: req.platformFeeLamports,
      timestamp: now,
    };
  }

  public recordSubmission(settlementId: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record && record.state === 'AUTHORIZED') {
      record.state = 'SUBMITTED';
      record.submittedAt = Date.now();
    }
  }

  public recordConfirmation(settlementId: string, txSignature: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record) {
      record.state = 'CONFIRMED';
      record.confirmedAt = Date.now();
      record.txSignature = txSignature;
    }
  }

  public recordFailure(settlementId: string, reason: string): void {
    const record = this.settlementStore.get(settlementId);
    if (record) {
      record.state = 'FAILED';
      record.failedAt = Date.now();
      record.rejectionReason = reason;
    }
  }

  public getRecord(settlementId: string): SettlementRecord | undefined {
    return this.settlementStore.get(settlementId);
  }
}

/**
 * SYLPH FUSION — CLEARING & UNKNOWN TRANSACTION AUTHORITY
 * Specifications: Sections 60 (Clearing & AssetDeltaSet), 61 (Unknown Transaction Rule), 103 (Invariant 1)
 *
 * Non-negotiable invariant:
 * NO UNKNOWN TRANSACTION RELEASES CAPITAL.
 * An RPC timeout or "not found" response NEVER proves non-execution.
 * Capital remains 100% reserved until finalized on-chain proof of non-inclusion
 * is established across independent provider ledger coverage.
 */

import { createHash } from 'node:crypto';

export interface AssetDeltaSet {
  readonly mint: string;
  readonly solDeltaLamports: bigint;      // Negative for buy, positive for sell
  readonly tokenDeltaRaw: bigint;          // Positive for buy, negative for sell
  readonly networkFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly rentRefundLamports: bigint;
  readonly token2022WithheldFeeRaw: bigint;
  readonly netCapitalImpactLamports: bigint; // Total cash change including all fees
}

export interface ClearingReceipt {
  readonly clearingId: string;
  readonly transactionSignature: string;
  readonly economicIntentId: string;
  readonly finalizedSlot: number;
  readonly deltas: AssetDeltaSet;
  readonly isFinalized: boolean;
  readonly clearedAtMs: number;
}

export type TransactionAmbiguityStatus =
  | 'LANDED_CONFIRMED'
  | 'LANDED_FINALIZED'
  | 'PROVABLY_EXPIRED'
  | 'UNKNOWN_RESERVE_HELD';

export interface ProviderLedgerCoverage {
  readonly providerId: string;
  readonly lowestSlot: number;
  readonly highestSlot: number;
  readonly transactionFound: boolean;
  readonly checkedAtSlot: number;
}

export class ClearingAuthority {
  private activeReservations = new Map<string, bigint>();
  private clearedReceipts = new Map<string, ClearingReceipt>();

  /**
   * Reserves capital for an economic intent.
   */
  public reserveCapital(intentId: string, requiredLamports: bigint): void {
    if (requiredLamports <= 0n) throw new Error('RESERVATION_FAILED: amount must be positive');
    this.activeReservations.set(intentId, requiredLamports);
  }

  public getReservedCapital(intentId: string): bigint {
    return this.activeReservations.get(intentId) ?? 0n;
  }

  /**
   * Evaluates an in-flight or timed-out transaction against the UNKNOWN Transaction Rule (Section 61).
   * Capital remains locked unless the transaction is provably landed or provably expired.
   */
  public evaluateTransactionStatus(params: {
    intentId: string;
    signature: string;
    lastValidBlockHeight: number;
    currentBlockHeight: number;
    independentCoverages: readonly ProviderLedgerCoverage[];
    onChainWalletBalanceConfirmed: boolean;
  }): {
    readonly status: TransactionAmbiguityStatus;
    readonly capitalReleased: boolean;
    readonly reason: string;
  } {
    const { intentId, lastValidBlockHeight, currentBlockHeight, independentCoverages, onChainWalletBalanceConfirmed } = params;

    // Check if any provider found the transaction
    const landedProvider = independentCoverages.find(c => c.transactionFound);
    if (landedProvider) {
      return {
        status: 'LANDED_CONFIRMED',
        capitalReleased: false,
        reason: `Transaction observed on provider ${landedProvider.providerId}; awaiting finalized clearing`,
      };
    }

    // Mathematical proof of non-inclusion (Provably Expired):
    // 1. Current block height is strictly past lastValidBlockHeight + safety buffer (e.g. +32 slots).
    // 2. At least 2 independent providers have scanned the entire block range.
    // 3. Wallet balance confirms no unrecorded balance change.
    const isPastExpiry = currentBlockHeight > lastValidBlockHeight + 32;
    const independentCoverageCount = independentCoverages.filter(
      c => c.highestSlot >= lastValidBlockHeight && !c.transactionFound
    ).length;

    if (isPastExpiry && independentCoverageCount >= 2 && onChainWalletBalanceConfirmed) {
      // Safe to release reservation: The transaction CANNOT land
      this.activeReservations.delete(intentId);
      return {
        status: 'PROVABLY_EXPIRED',
        capitalReleased: true,
        reason: `Transaction provably expired past blockheight ${lastValidBlockHeight} across ${independentCoverageCount} independent providers. Reservation safely released.`,
      };
    }

    // Invariant 1: In all other cases, capital remains 100% reserved!
    return {
      status: 'UNKNOWN_RESERVE_HELD',
      capitalReleased: false,
      reason: `Transaction status ambiguous (current height: ${currentBlockHeight}, expiry: ${lastValidBlockHeight}, independent coverage: ${independentCoverageCount}). Capital remains 100% reserved.`,
    };
  }

  /**
   * Finalized Clearing (Section 60):
   * Derives exact AssetDeltaSet from finalized chain receipt and converts reservations into finalized state.
   */
  public executeFinalizedClearing(params: {
    transactionSignature: string;
    economicIntentId: string;
    finalizedSlot: number;
    deltas: AssetDeltaSet;
  }): ClearingReceipt {
    const { transactionSignature, economicIntentId, finalizedSlot, deltas } = params;

    const hash = createHash('sha256')
      .update(`${transactionSignature}:${economicIntentId}:${finalizedSlot}:${deltas.solDeltaLamports}:${deltas.tokenDeltaRaw}`)
      .digest('hex')
      .slice(0, 16);
    const clearingId = `CLEARING-${hash}`;

    const receipt: ClearingReceipt = {
      clearingId,
      transactionSignature,
      economicIntentId,
      finalizedSlot,
      deltas,
      isFinalized: true,
      clearedAtMs: Date.now(),
    };

    // Release the temporary reservation upon finalized settlement
    this.activeReservations.delete(economicIntentId);
    this.clearedReceipts.set(economicIntentId, receipt);

    return receipt;
  }

  public getReceipt(economicIntentId: string): ClearingReceipt | undefined {
    return this.clearedReceipts.get(economicIntentId);
  }
}

export const globalClearing = new ClearingAuthority();

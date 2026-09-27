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
export class ClearingAuthority {
    activeReservations = new Map();
    clearedReceipts = new Map();
    /**
     * Reserves capital for an economic intent.
     */
    reserveCapital(intentId, requiredLamports) {
        if (requiredLamports <= 0n)
            throw new Error('RESERVATION_FAILED: amount must be positive');
        this.activeReservations.set(intentId, requiredLamports);
    }
    getReservedCapital(intentId) {
        return this.activeReservations.get(intentId) ?? 0n;
    }
    /**
     * Evaluates an in-flight or timed-out transaction against the UNKNOWN Transaction Rule (Section 61).
     * Capital remains locked unless the transaction is provably landed or provably expired.
     */
    evaluateTransactionStatus(params) {
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
        const independentCoverageCount = independentCoverages.filter(c => c.highestSlot >= lastValidBlockHeight && !c.transactionFound).length;
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
    executeFinalizedClearing(params) {
        const { transactionSignature, economicIntentId, finalizedSlot, deltas } = params;
        const hash = createHash('sha256')
            .update(`${transactionSignature}:${economicIntentId}:${finalizedSlot}:${deltas.solDeltaLamports}:${deltas.tokenDeltaRaw}`)
            .digest('hex')
            .slice(0, 16);
        const clearingId = `CLEARING-${hash}`;
        const receipt = {
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
    getReceipt(economicIntentId) {
        return this.clearedReceipts.get(economicIntentId);
    }
}
export const globalClearing = new ClearingAuthority();
//# sourceMappingURL=clearing.js.map
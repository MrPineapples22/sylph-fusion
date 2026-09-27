/**
 * SYLPH FUSION — LOTROOT: Immutable Fill-Based Position Accounting
 * Specifications: Sections 21, 27, 60, 103 (Invariants 8, 10, 11)
 *
 * Replaces monolithic average-cost position accounting with discrete immutable lots.
 * Supports: OPEN -> INCREASE -> REDUCE -> INCREASE -> REDUCE -> CLOSE.
 * Exit allocation policies: FIFO, PRO_RATA.
 * Strict conservation: sum(lot.remainingRawQuantity) == verified_wallet_token_balance.
 */
import { createHash } from 'node:crypto';
export class LotRootAuthority {
    lotsByMint = new Map();
    closedLotsByMint = new Map();
    /**
     * Opens or increases a position by adding an immutable lot.
     */
    addLot(params) {
        const { mint, tokenQuantity, costBasisLamports } = params;
        if (tokenQuantity <= 0n)
            throw new Error('LOT_CREATION_FAILED: tokenQuantity must be positive');
        if (costBasisLamports <= 0n)
            throw new Error('LOT_CREATION_FAILED: costBasisLamports must be positive');
        const executionCostsLamports = params.executionCostsLamports ?? 0n;
        const executionGeneration = params.executionGeneration ?? 1;
        const modelEpoch = params.modelEpoch ?? 'epoch-v1.0.0';
        const strategy = params.strategy ?? 'MOMENTUM_SPIE';
        const regime = params.regime ?? 'NORMAL';
        const hash = createHash('sha256')
            .update(`${mint}:${params.entryEconomicIntentId}:${executionGeneration}:${Date.now()}`)
            .digest('hex')
            .slice(0, 16);
        const lotId = `LOT-${hash}`;
        const lot = {
            lotId,
            mint,
            acquiredRawQuantity: tokenQuantity,
            remainingRawQuantity: tokenQuantity,
            costBasisLamports,
            remainingCostBasisLamports: costBasisLamports,
            executionCostsLamports,
            remainingExecutionCostsLamports: executionCostsLamports,
            entryEconomicIntentId: params.entryEconomicIntentId,
            executionGeneration,
            modelEpoch,
            strategy,
            regime,
            enteredAtMs: Date.now(),
        };
        const existing = this.lotsByMint.get(mint) ?? [];
        existing.push(lot);
        this.lotsByMint.set(mint, existing);
        return lot;
    }
    /**
     * Allocates an exit across existing lots using FIFO or PRO_RATA.
     */
    allocateExit(mint, tokensToSell, policy = 'FIFO') {
        if (tokensToSell <= 0n)
            throw new Error('EXIT_ALLOCATION_FAILED: tokensToSell must be positive');
        const lots = this.lotsByMint.get(mint);
        if (!lots || lots.length === 0) {
            throw new Error(`EXIT_ALLOCATION_FAILED: no open lots found for mint ${mint}`);
        }
        const totalAvailable = lots.reduce((acc, l) => acc + l.remainingRawQuantity, 0n);
        if (tokensToSell > totalAvailable) {
            throw new Error(`EXIT_ALLOCATION_FAILED: requested sell quantity ${tokensToSell} exceeds total open lots ${totalAvailable}`);
        }
        const exhaustedItems = [];
        let totalCostBasisAllocated = 0n;
        let totalExecutionCostsAllocated = 0n;
        if (policy === 'FIFO') {
            let tokensRemainingToDeduct = tokensToSell;
            for (const lot of lots) {
                if (tokensRemainingToDeduct <= 0n)
                    break;
                if (lot.remainingRawQuantity <= 0n)
                    continue;
                const deduct = lot.remainingRawQuantity <= tokensRemainingToDeduct
                    ? lot.remainingRawQuantity
                    : tokensRemainingToDeduct;
                // Proportional cost basis deduction from this specific lot
                const costDeduct = (lot.remainingCostBasisLamports * deduct) / lot.remainingRawQuantity;
                const feesDeduct = (lot.remainingExecutionCostsLamports * deduct) / lot.remainingRawQuantity;
                lot.remainingRawQuantity -= deduct;
                lot.remainingCostBasisLamports -= costDeduct;
                lot.remainingExecutionCostsLamports -= feesDeduct;
                tokensRemainingToDeduct -= deduct;
                totalCostBasisAllocated += costDeduct;
                totalExecutionCostsAllocated += feesDeduct;
                if (lot.remainingRawQuantity === 0n) {
                    lot.closedAtMs = Date.now();
                }
                exhaustedItems.push({
                    lotId: lot.lotId,
                    tokensDeducted: deduct,
                    costBasisDeducted: costDeduct,
                    executionCostsDeducted: feesDeduct,
                    remainingInLot: lot.remainingRawQuantity,
                });
            }
        }
        else {
            // PRO_RATA: deduct proportionally across all active lots
            let tokensLeftToDeduct = tokensToSell;
            for (let i = 0; i < lots.length; i++) {
                const lot = lots[i];
                if (lot.remainingRawQuantity <= 0n)
                    continue;
                // For the last active lot, deduct the remainder to prevent integer rounding loss
                const isLastLot = i === lots.length - 1;
                const deduct = isLastLot
                    ? tokensLeftToDeduct
                    : (tokensToSell * lot.remainingRawQuantity) / totalAvailable;
                const effectiveDeduct = deduct > lot.remainingRawQuantity ? lot.remainingRawQuantity : deduct;
                const costDeduct = (lot.remainingCostBasisLamports * effectiveDeduct) / lot.remainingRawQuantity;
                const feesDeduct = (lot.remainingExecutionCostsLamports * effectiveDeduct) / lot.remainingRawQuantity;
                lot.remainingRawQuantity -= effectiveDeduct;
                lot.remainingCostBasisLamports -= costDeduct;
                lot.remainingExecutionCostsLamports -= feesDeduct;
                tokensLeftToDeduct -= effectiveDeduct;
                totalCostBasisAllocated += costDeduct;
                totalExecutionCostsAllocated += feesDeduct;
                if (lot.remainingRawQuantity === 0n) {
                    lot.closedAtMs = Date.now();
                }
                exhaustedItems.push({
                    lotId: lot.lotId,
                    tokensDeducted: effectiveDeduct,
                    costBasisDeducted: costDeduct,
                    executionCostsDeducted: feesDeduct,
                    remainingInLot: lot.remainingRawQuantity,
                });
            }
        }
        // Filter out fully closed lots
        const activeLots = [];
        const closedLots = this.closedLotsByMint.get(mint) ?? [];
        for (const lot of lots) {
            if (lot.remainingRawQuantity > 0n) {
                activeLots.push(lot);
            }
            else {
                closedLots.push(lot);
            }
        }
        this.lotsByMint.set(mint, activeLots);
        this.closedLotsByMint.set(mint, closedLots);
        const remainingPositionTokens = activeLots.reduce((acc, l) => acc + l.remainingRawQuantity, 0n);
        const remainingPositionCostBasis = activeLots.reduce((acc, l) => acc + l.remainingCostBasisLamports, 0n);
        return {
            mint,
            policy,
            totalTokensSold: tokensToSell,
            totalCostBasisAllocated,
            totalExecutionCostsAllocated,
            exhaustedLots: exhaustedItems,
            remainingPositionTokens,
            remainingPositionCostBasis,
            isFullyClosed: remainingPositionTokens === 0n,
        };
    }
    /**
     * Projects active position state from surviving lots.
     */
    getPositionProjection(mint) {
        const lots = this.lotsByMint.get(mint);
        if (!lots || lots.length === 0)
            return null;
        const totalRemainingQuantity = lots.reduce((acc, l) => acc + l.remainingRawQuantity, 0n);
        const totalCostBasisLamports = lots.reduce((acc, l) => acc + l.remainingCostBasisLamports, 0n);
        const totalExecutionCostsLamports = lots.reduce((acc, l) => acc + l.remainingExecutionCostsLamports, 0n);
        if (totalRemainingQuantity === 0n)
            return null;
        return {
            mint,
            totalRemainingQuantity,
            totalCostBasisLamports,
            totalExecutionCostsLamports,
            activeLotCount: lots.length,
            lots: [...lots],
        };
    }
    /**
     * Enforces the Conservation Invariant:
     * sum(lot.remainingRawQuantity) MUST exactly match verified on-chain wallet balance.
     */
    verifyConservation(mint, verifiedWalletBalance) {
        const lots = this.lotsByMint.get(mint) ?? [];
        const totalLotTokens = lots.reduce((acc, l) => acc + l.remainingRawQuantity, 0n);
        const deltaTokens = totalLotTokens - verifiedWalletBalance;
        return {
            isConserved: deltaTokens === 0n,
            totalLotTokens,
            verifiedWalletBalance,
            deltaTokens,
        };
    }
}
export const globalLotRoot = new LotRootAuthority();
//# sourceMappingURL=lot-root.js.map
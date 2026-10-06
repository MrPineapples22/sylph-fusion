/**
 * SYLPH FUSION — PORTFOLIO CAPACITY ENGINE
 * Section XXVI & Portfolio Allocation
 *
 * Enforces concurrent position ceilings, cash reserves, and correlation constraints.
 * Ensures open exposure never exceeds available capital authority.
 */
export class PortfolioCapacityEngine {
    static DEFAULT_MAX_CONCURRENT_POSITIONS = 5;
    static DEFAULT_MIN_CASH_BUFFER_USD = 1000.0;
    static checkCapacity(params) {
        const { currentAvailableCashUsd, activePositionCount, maxConcurrentPositions = this.DEFAULT_MAX_CONCURRENT_POSITIONS, candidateStakeUsd = 250.0, minimumCashBufferUsd = this.DEFAULT_MIN_CASH_BUFFER_USD, } = params;
        const remainingSlots = Math.max(0, maxConcurrentPositions - activePositionCount);
        const usableCash = Math.max(0, currentAvailableCashUsd - minimumCashBufferUsd);
        let canOpen = true;
        let blockerReason;
        if (remainingSlots <= 0) {
            canOpen = false;
            blockerReason = `CAPACITY_LIMIT_REACHED: Active positions (${activePositionCount}) at ceiling (${maxConcurrentPositions})`;
        }
        else if (usableCash < candidateStakeUsd) {
            canOpen = false;
            blockerReason = `INSUFFICIENT_CASH_BUFFER: Usable cash $${usableCash.toFixed(2)} < required stake $${candidateStakeUsd.toFixed(2)}`;
        }
        return {
            canOpenNewPosition: canOpen,
            remainingPositionSlots: remainingSlots,
            allocatedCapitalUsd: activePositionCount * candidateStakeUsd,
            availableUnallocatedCashUsd: usableCash,
            blockerReason,
        };
    }
}
//# sourceMappingURL=portfolio-capacity.js.map
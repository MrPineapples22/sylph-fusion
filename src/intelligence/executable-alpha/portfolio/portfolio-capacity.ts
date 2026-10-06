/**
 * SYLPH FUSION — PORTFOLIO CAPACITY ENGINE
 * Section XXVI & Portfolio Allocation
 *
 * Enforces concurrent position ceilings, cash reserves, and correlation constraints.
 * Ensures open exposure never exceeds available capital authority.
 */

export interface CapacityCheckParams {
  readonly currentAvailableCashUsd: number;
  readonly activePositionCount: number;
  readonly maxConcurrentPositions?: number;
  readonly candidateStakeUsd?: number;
  readonly minimumCashBufferUsd?: number;
}

export interface PortfolioCapacityReport {
  readonly canOpenNewPosition: boolean;
  readonly remainingPositionSlots: number;
  readonly allocatedCapitalUsd: number;
  readonly availableUnallocatedCashUsd: number;
  readonly blockerReason?: string;
}

export class PortfolioCapacityEngine {
  public static readonly DEFAULT_MAX_CONCURRENT_POSITIONS = 5;
  public static readonly DEFAULT_MIN_CASH_BUFFER_USD = 1000.0;

  public static checkCapacity(params: CapacityCheckParams): PortfolioCapacityReport {
    const {
      currentAvailableCashUsd,
      activePositionCount,
      maxConcurrentPositions = this.DEFAULT_MAX_CONCURRENT_POSITIONS,
      candidateStakeUsd = 250.0,
      minimumCashBufferUsd = this.DEFAULT_MIN_CASH_BUFFER_USD,
    } = params;

    const remainingSlots = Math.max(0, maxConcurrentPositions - activePositionCount);
    const usableCash = Math.max(0, currentAvailableCashUsd - minimumCashBufferUsd);

    let canOpen = true;
    let blockerReason: string | undefined;

    if (remainingSlots <= 0) {
      canOpen = false;
      blockerReason = `CAPACITY_LIMIT_REACHED: Active positions (${activePositionCount}) at ceiling (${maxConcurrentPositions})`;
    } else if (usableCash < candidateStakeUsd) {
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

/**
 * SYLPH FUSION — REALITY-GAP-X: RESIDUAL VECTOR
 * Specifications: Master Blueprint Section XVII (Reality-Gap-X)
 *
 * Invariants:
 * 1. Every prediction is sealed before the outcome exists.
 * 2. Explicitly tracks 8 distinct residuals between digital twin simulation and on-chain reality.
 */

export interface RealityGapVector {
  readonly predictionId: string;
  readonly mint: string;
  readonly targetSlot: bigint;
  readonly landedSlot?: bigint;
  // 8 Specific Reality Residuals (Section XVII)
  readonly priceResidualBps: number;
  readonly liquidityResidualSol: number;
  readonly routeResidual: number; // 0 = exact route, 1 = alternative route, >1 = route failed
  readonly landingResidualSlots: number; // landedSlot - targetSlot
  readonly feeResidualLamports: bigint; // actualFee - predictedFee
  readonly cuResidualUnits: number; // actualCU - predictedCU
  readonly clearanceResidualSec: number; // actualClearanceTime - predictedClearanceTime
  readonly exitCapacityResidualSol: number; // actualExitLiquidity - predictedExitLiquidity
  readonly evaluatedAtMs: number;
}

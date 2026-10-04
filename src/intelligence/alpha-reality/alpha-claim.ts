/**
 * SYLPH FUSION — ALPHA REALITY-X: ALPHA CLAIM CONTRACT
 * Specifications: Master Blueprint Section XIII (Alpha Reality-X)
 *
 * Invariant: Every candidate alpha claim must state explicit testable predictions,
 * horizon, reference benchmark, and execution-cost hurdle.
 */

export interface AlphaClaim {
  readonly claimId: string;
  readonly strategyId: string;
  readonly targetHorizonSec: number;
  readonly targetUniverse: readonly string[];
  readonly expectedGrossBps: number;
  readonly minHurdleCostBps: number;
  readonly benchmarkId: string; // e.g., 'SOL_MARKET_BETA'
  readonly registeredAtMs: number;
}

export function createAlphaClaim(params: Omit<AlphaClaim, 'registeredAtMs'>): AlphaClaim {
  return {
    ...params,
    registeredAtMs: Date.now(),
  };
}

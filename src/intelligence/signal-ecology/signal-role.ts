/**
 * SYLPH FUSION — SIGNAL ECOLOGY-X: SIGNAL ROLES
 * Specifications: Master Blueprint Section XV (Signal Ecology-X)
 *
 * Invariant: Separate roles (ALPHA, RISK, EXECUTION, REGIME, AUTHENTICITY, CAPACITY, SURVIVAL).
 * Do NOT collapse them into one single score!
 */

export type SignalRole =
  | 'ALPHA'
  | 'RISK'
  | 'EXECUTION'
  | 'REGIME'
  | 'AUTHENTICITY'
  | 'CAPACITY'
  | 'SURVIVAL';

export interface DecomposedRoleProfile {
  readonly alphaScore: number;
  readonly riskScore: number;
  readonly executionCostBps: number;
  readonly regimeConfidence: number;
  readonly authenticityProven: boolean;
  readonly capacityUsd: number;
  readonly survivalProbability: number;
}

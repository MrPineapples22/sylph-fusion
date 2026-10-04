/**
 * SYLPH FUSION — OPPORTUNITY MARKET-X: SCARCE RESOURCES
 * Specifications: Master Blueprint Section XXX (Opportunity Market-X)
 *
 * Models 8 distinct scarce economic resources explicitly:
 * CAPITAL, EXIT_CAPACITY, TAIL_RISK_CAPACITY, CONCENTRATION_CAPACITY,
 * EXECUTION_BANDWIDTH, FEE_BUDGET, UNKNOWN_SETTLEMENT_CAPACITY, ATTENTION_COMPUTE.
 */

export type MarketResourceType =
  | 'CAPITAL'
  | 'EXIT_CAPACITY'
  | 'TAIL_RISK_CAPACITY'
  | 'CONCENTRATION_CAPACITY'
  | 'EXECUTION_BANDWIDTH'
  | 'FEE_BUDGET'
  | 'UNKNOWN_SETTLEMENT_CAPACITY'
  | 'ATTENTION_COMPUTE';

export interface ResourceCapacityLimit {
  readonly resource: MarketResourceType;
  readonly maxCapacity: number;
  readonly currentlyOccupied: number;
  readonly shadowPriceUsd: number;
}

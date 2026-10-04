/**
 * SYLPH FUSION — OPPORTUNITY MARKET-X: PROOF-CARRYING BID
 * Specifications: Master Blueprint Section XXX (Proof-Carrying Bid)
 *
 * Invariant: Every bid submitted to the Opportunity Market must carry
 * proof roots, marginal expected return curves, and resource demands.
 */

import type { MarketResourceType } from './resource.js';

export interface ProofCarryingBid {
  readonly bidId: string;
  readonly strategyId: string;
  readonly mint: string;
  readonly resourceDemands: Record<MarketResourceType, number>;
  readonly expectedSurplusUsd: number;
  readonly certaintyEquivalentReturnBps: number;
  readonly proofArtifactRoot: string;
  readonly validUntilSlot: bigint;
  readonly submittedAtMs: number;
}

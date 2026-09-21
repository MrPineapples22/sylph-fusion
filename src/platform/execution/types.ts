/**
 * SOL-SYLPH Multi-User Platform - Execution Quality & Market Truth Types
 * Specifications: Sections XXIV (Execution Quality), XXV (Pre-Signing Revalidation),
 * XXVI (Market Truth Engine), XXVII (Provider Health / Reputation).
 */

export type MarketDataProviderId = 'PUMP_PORTAL' | 'JUPITER' | 'DEX_SCREENER' | 'SOLANA_RPC';

export interface ProviderQuote {
  readonly providerId: MarketDataProviderId;
  readonly mint: string;
  readonly priceLamports: bigint;
  readonly liquidityLamports: bigint;
  readonly timestamp: number;
  readonly latencyMs: number;
  readonly isStale: boolean;
}

export interface CanonicalMarketTruth {
  readonly mint: string;
  readonly canonicalPriceLamports: bigint;
  readonly canonicalLiquidityLamports: bigint;
  readonly providerCount: number;
  readonly agreementBps: number;
  readonly isQuarantined: boolean;
  readonly quarantineReason?: string;
  readonly timestamp: number;
  readonly confidence: number; // 0.0 to 1.0
}

export interface ProviderHealthMetrics {
  readonly providerId: MarketDataProviderId;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly averageLatencyMs: number;
  readonly lastResponseTimestamp: number;
  readonly consecutiveErrors: number;
  readonly isHealthy: boolean;
}

export type RevalidationOutcome = 'PROCEED' | 'REQUOTE' | 'ABORT';

export interface PreSignRevalidationResult {
  readonly outcome: RevalidationOutcome;
  readonly originalPriceLamports: bigint;
  readonly currentPriceLamports: bigint;
  readonly priceSlippageBps: number;
  readonly currentLiquidityLamports: bigint;
  readonly currentPriceImpactBps: number;
  readonly reason?: string;
  readonly timestamp: number;
}

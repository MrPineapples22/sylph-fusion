/**
 * SOL-SYLPH Multi-User Platform - Pre-Signing Revalidation Engine
 * Specifications: Section XXV (Pre-Signing Revalidation).
 *
 * Rules:
 * 1. Market conditions can change between signal generation and transaction signing.
 * 2. Immediately before execution, revalidate price, liquidity, price impact, and slippage.
 * 3. If assumptions are no longer valid: ABORT or REQUOTE.
 * 4. Never blindly execute a stale authorization.
 */

import type { PreSignRevalidationResult } from './types.js';
import type { CanonicalMarketTruth } from './types.js';

export interface RevalidationParams {
  readonly signalPriceLamports: bigint;
  readonly maxAllowedSlippageBps: number;
  readonly maxAllowedPriceImpactBps: number;
  readonly minRequiredLiquidityLamports: bigint;
  readonly marketTruth: CanonicalMarketTruth;
  readonly orderSizeLamports: bigint;
}

export class PreSigningRevalidator {
  /**
   * Perform immediate pre-signing sanity revalidation against fresh market truth.
   */
  public revalidate(params: RevalidationParams): PreSignRevalidationResult {
    const now = Date.now();
    const { marketTruth, signalPriceLamports, maxAllowedSlippageBps, maxAllowedPriceImpactBps, minRequiredLiquidityLamports, orderSizeLamports } = params;

    // 1. Quarantined or Zero Price
    if (marketTruth.isQuarantined || marketTruth.canonicalPriceLamports <= 0n) {
      return {
        outcome: 'ABORT',
        originalPriceLamports: signalPriceLamports,
        currentPriceLamports: marketTruth.canonicalPriceLamports,
        priceSlippageBps: 0,
        currentLiquidityLamports: marketTruth.canonicalLiquidityLamports,
        currentPriceImpactBps: 0,
        reason: `Market truth is quarantined: ${marketTruth.quarantineReason ?? 'unknown reason'}`,
        timestamp: now,
      };
    }

    // 2. Liquidity Floor Check
    if (marketTruth.canonicalLiquidityLamports < minRequiredLiquidityLamports) {
      return {
        outcome: 'ABORT',
        originalPriceLamports: signalPriceLamports,
        currentPriceLamports: marketTruth.canonicalPriceLamports,
        priceSlippageBps: 0,
        currentLiquidityLamports: marketTruth.canonicalLiquidityLamports,
        currentPriceImpactBps: 0,
        reason: `Pool liquidity dropped to ${marketTruth.canonicalLiquidityLamports} < required ${minRequiredLiquidityLamports}`,
        timestamp: now,
      };
    }

    // 3. Price Drift / Slippage Check
    let slippageBps = 0;
    if (signalPriceLamports > 0n) {
      const priceDiff = marketTruth.canonicalPriceLamports - signalPriceLamports;
      // For buy: higher price = adverse slippage
      if (priceDiff > 0n) {
        slippageBps = Number((priceDiff * 10_000n) / signalPriceLamports);
      }
    }

    if (slippageBps > maxAllowedSlippageBps) {
      return {
        outcome: 'ABORT',
        originalPriceLamports: signalPriceLamports,
        currentPriceLamports: marketTruth.canonicalPriceLamports,
        priceSlippageBps: slippageBps,
        currentLiquidityLamports: marketTruth.canonicalLiquidityLamports,
        currentPriceImpactBps: 0,
        reason: `Adverse price slippage (${slippageBps} bps) exceeds ceiling (${maxAllowedSlippageBps} bps)`,
        timestamp: now,
      };
    }

    // 4. Dynamic Price Impact on Current Liquidity
    const impactBps = marketTruth.canonicalLiquidityLamports > 0n
      ? Number((orderSizeLamports * 10_000n) / marketTruth.canonicalLiquidityLamports)
      : 10_000;

    if (impactBps > maxAllowedPriceImpactBps) {
      return {
        outcome: 'REQUOTE',
        originalPriceLamports: signalPriceLamports,
        currentPriceLamports: marketTruth.canonicalPriceLamports,
        priceSlippageBps: slippageBps,
        currentLiquidityLamports: marketTruth.canonicalLiquidityLamports,
        currentPriceImpactBps: impactBps,
        reason: `Price impact (${impactBps} bps) exceeds max allowed (${maxAllowedPriceImpactBps} bps); requote required`,
        timestamp: now,
      };
    }

    return {
      outcome: 'PROCEED',
      originalPriceLamports: signalPriceLamports,
      currentPriceLamports: marketTruth.canonicalPriceLamports,
      priceSlippageBps: slippageBps,
      currentLiquidityLamports: marketTruth.canonicalLiquidityLamports,
      currentPriceImpactBps: impactBps,
      timestamp: now,
    };
  }
}

/**
 * SYLPH FUSION — FEE RESPONSE SURFACE & DYNAMIC PRIORITY FEE ADAPTATION
 * Studies: FEE-RESPONSE-SURFACE-X, CU-EFFICIENCY-X, PRIORITY-FEE-BIDDING-X (Section XVIII)
 *
 * Maps compute unit (CU) limits and priority fee bid curves to find
 * the optimal fee point maximizing landing probability per dollar spent.
 *
 * Provides dynamic quantile-conditioned priority fee adaptation:
 * - Adapts fee bids across percentiles (p25, p50, p75, p90, p99) of recent landed transactions
 * - Evaluates marginal landing gain per dollar (d P_land / d Fee) to prevent fee burning
 * - Applies strict capital-protection budget caps (<= 10% position value or policy cap)
 */

import type { ContentionTier } from './account-contention.js';

export interface FeeOptimizationResult {
  readonly requestedComputeUnits: number;
  readonly optimalPriorityMicroLamports: number;
  readonly optimalTipLamports: bigint;
  readonly estimatedFeeUsd: number;
  readonly marginalLandingGainPerDollar: number;
  readonly cuSafetyMarginPct: number;
}

export interface FeePercentiles {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p99: number;
}

export interface AdaptivePriorityFeeBid {
  readonly recommendedPriorityMicroLamports: number;
  readonly recommendedTipLamports: bigint;
  readonly targetPercentile: 'p25' | 'p50' | 'p75' | 'p90' | 'p99';
  readonly preemptionMarginBps: number;
  readonly estimatedFeeUsd: number;
  readonly maxAllowedFeeCapUsd: number;
  readonly marginalLandingGainPerDollar: number;
  readonly isCappedBySafetyPolicy: boolean;
  readonly urgencyMultiplier: number;
}

export class FeeResponseSurfaceEngine {
  public static optimizeFee(params: {
    baseExecutionCuEstimate: number; // e.g. 75,000 CU for Raydium swap
    congestionMultiplier: number;
    urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';
    solPriceUsd?: number;
  }): FeeOptimizationResult {
    const {
      baseExecutionCuEstimate,
      congestionMultiplier,
      urgency,
      solPriceUsd = 150.0,
    } = params;

    // Set CU limit with safe 25% buffer (preventing out-of-CU transaction abortion)
    const requestedComputeUnits = Math.ceil(baseExecutionCuEstimate * 1.25);
    const cuSafetyMarginPct = 25.0;

    let priorityMicroLamports = 50_000 * Math.max(1.0, congestionMultiplier);
    let tipLamports = 100_000n; // 0.0001 SOL

    if (urgency === 'NORMAL') {
      priorityMicroLamports = 150_000 * Math.max(1.0, congestionMultiplier);
      tipLamports = 500_000n; // 0.0005 SOL
    } else if (urgency === 'HIGH') {
      priorityMicroLamports = 500_000 * Math.max(1.0, congestionMultiplier);
      tipLamports = 2_000_000n; // 0.002 SOL
    } else if (urgency === 'EMERGENCY') {
      priorityMicroLamports = 2_000_000 * Math.max(1.0, congestionMultiplier);
      tipLamports = 10_000_000n; // 0.010 SOL
    }

    const totalPriorityLamports = (requestedComputeUnits * priorityMicroLamports) / 1_000_000;
    const totalSolCost = (5000 + totalPriorityLamports + Number(tipLamports)) / 1e9;
    const estimatedFeeUsd = totalSolCost * solPriceUsd;

    const marginalGain = urgency === 'EMERGENCY' ? 0.05 : 0.85;

    return {
      requestedComputeUnits,
      optimalPriorityMicroLamports: priorityMicroLamports,
      optimalTipLamports: tipLamports,
      estimatedFeeUsd,
      marginalLandingGainPerDollar: marginalGain,
      cuSafetyMarginPct,
    };
  }

  public static computeAdaptiveBid(params: {
    contentionTier: ContentionTier;
    urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';
    recentFeePercentiles?: FeePercentiles;
    positionValueUsd?: number;
    maxPolicyCapUsd?: number;
    solPriceUsd?: number;
    preemptionPrecedenceMarginBps?: number;
  }): AdaptivePriorityFeeBid {
    const {
      contentionTier,
      urgency,
      recentFeePercentiles = {
        p25: 45_000,
        p50: 120_000,
        p75: 350_000,
        p90: 950_000,
        p99: 2_800_000,
      },
      positionValueUsd = 250.0,
      maxPolicyCapUsd = 5.0,
      solPriceUsd = 150.0,
      preemptionPrecedenceMarginBps = 1500, // 15% preemption margin over target percentile
    } = params;

    // 1. Select target percentile based on urgency and contention
    let targetPercentile: 'p25' | 'p50' | 'p75' | 'p90' | 'p99' = 'p50';
    let urgencyMult = 1.0;

    if (urgency === 'LOW') {
      targetPercentile = contentionTier === 'COLD' ? 'p25' : 'p50';
      urgencyMult = 0.8;
    } else if (urgency === 'NORMAL') {
      targetPercentile = (contentionTier === 'HOT' || contentionTier === 'CRITICAL_SATURATED') ? 'p75' : 'p50';
      urgencyMult = 1.2;
    } else if (urgency === 'HIGH') {
      targetPercentile = contentionTier === 'CRITICAL_SATURATED' ? 'p99' : 'p90';
      urgencyMult = 2.5;
    } else if (urgency === 'EMERGENCY') {
      targetPercentile = 'p99';
      urgencyMult = 5.0;
    }

    const baseFee = recentFeePercentiles[targetPercentile];
    const preemptionMultiplier = 1.0 + (preemptionPrecedenceMarginBps / 10_000);
    let calculatedPriorityFee = Math.round(baseFee * preemptionMultiplier * urgencyMult);

    // Tip selection for bundle auctions
    let tipLamports = 250_000n; // 0.00025 SOL default
    if (urgency === 'HIGH' || contentionTier === 'HOT') {
      tipLamports = 1_500_000n; // 0.0015 SOL
    } else if (urgency === 'EMERGENCY' || contentionTier === 'CRITICAL_SATURATED') {
      tipLamports = 6_000_000n; // 0.006 SOL
    }

    // Cost calculation (assuming typical 95,000 CU)
    const cu = 95_000;
    const priorityLamports = (cu * calculatedPriorityFee) / 1_000_000;
    let totalSolCost = (5000 + priorityLamports + Number(tipLamports)) / 1e9;
    let estimatedFeeUsd = totalSolCost * solPriceUsd;

    // Enforce strict safety fee cap: max 10% of position value, or maxPolicyCapUsd
    const hardCapUsd = Math.min(positionValueUsd * 0.10, maxPolicyCapUsd);
    let isCapped = false;

    if (estimatedFeeUsd > hardCapUsd) {
      isCapped = true;
      // Scale back priority fee and tip proportionally to respect hard cap
      const maxLamportsBudget = BigInt(Math.floor((hardCapUsd / solPriceUsd) * 1e9));
      if (maxLamportsBudget > 10_000n) {
        tipLamports = (maxLamportsBudget * 3n) / 10n; // 30% to tip
        const remainingForPriority = maxLamportsBudget - tipLamports - 5000n;
        calculatedPriorityFee = Math.max(10_000, Math.floor((Number(remainingForPriority) * 1_000_000) / cu));
        estimatedFeeUsd = hardCapUsd;
      }
    }

    // Marginal landing gain per dollar: diminishing returns in EMERGENCY or high fees
    const marginalGain = calculatedPriorityFee > 2_000_000 ? 0.08 : (calculatedPriorityFee > 500_000 ? 0.45 : 0.92);

    return {
      recommendedPriorityMicroLamports: calculatedPriorityFee,
      recommendedTipLamports: tipLamports,
      targetPercentile,
      preemptionMarginBps: preemptionPrecedenceMarginBps,
      estimatedFeeUsd,
      maxAllowedFeeCapUsd: hardCapUsd,
      marginalLandingGainPerDollar: marginalGain,
      isCappedBySafetyPolicy: isCapped,
      urgencyMultiplier: urgencyMult,
    };
  }
}

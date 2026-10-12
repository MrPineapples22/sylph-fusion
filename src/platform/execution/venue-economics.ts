/**
 * SYLPH FUSION — VENUE ECONOMICS & PORTFOLIO EXITNET
 * Specifications: Sections 55 (Venue Economics & RoundTripExecutionCertificate),
 * 56 (Portfolio ExitNet & MarginalExitRisk), 103 (Invariant 9)
 *
 * Invariants:
 * 1. Do not select venues solely from entry quote.
 * 2. Evaluate round-trip economics: EntryCost + ExpectedExitCost + Fees + Landing + Route + Capital Trapping.
 * 3. Portfolio ExitNet models shared liquidation bottlenecks (same pool, creator, route, lockset).
 * 4. Position sizing uses MarginalExitRisk rather than independent position risk.
 */

import { createHash } from 'node:crypto';

export type ExecutionVenue = 'PUMP_FUN' | 'PUMP_SWAP' | 'RAYDIUM' | 'METEORA' | 'JUPITER';

export interface VenueRoundTripMetrics {
  readonly venue: ExecutionVenue;
  readonly entryPriceLamports: bigint;
  readonly entryFeeLamports: bigint;
  readonly entryImpactBps: number;
  readonly expectedExitPriceLamports: bigint;
  readonly expectedExitFeeLamports: bigint;
  readonly expectedExitImpactBps: number;
  readonly landingProbability: number; // 0.0 to 1.0
  readonly capitalTrappingRiskBps: number; // Risk of exit liquidity collapse
  readonly netRoundTripCostLamports: bigint;
  readonly isViable: boolean;
}

export interface RoundTripExecutionCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly evaluatedAmountLamports: bigint;
  readonly venuesEvaluated: readonly VenueRoundTripMetrics[];
  readonly selectedVenue: VenueRoundTripMetrics;
  readonly expectedAlphaLamports: bigint;
  readonly expectedNetRoundTripEVLamports: bigint;
  readonly estimatedNetTerminalCapitalLamports: bigint;
  readonly issuedAtSlot: number;
  readonly isApprovedForEntry: boolean;
  readonly rejectionReason?: string;
  readonly digest: string;
}

export interface SplitRouteLegAllocation {
  readonly venue: ExecutionVenue;
  readonly allocatedAmountLamports: bigint;
  readonly allocationFractionPct: number;
  readonly expectedImpactBps: number;
  readonly feeLamports: bigint;
}

export interface SplitRouteExecutionCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly totalEvaluatedAmountLamports: bigint;
  readonly legs: readonly SplitRouteLegAllocation[];
  readonly aggregateImpactBps: number;
  readonly singleVenueBestImpactBps: number;
  readonly slippageSavingsLamports: bigint;
  readonly slippageSavingsBps: number;
  readonly isSplitAdvantageous: boolean;
  readonly issuedAtSlot: number;
  readonly digest: string;
}

export interface ExistingPositionLiquidationProfile {
  readonly mint: string;
  readonly poolAddress: string;
  readonly creatorPubkey: string;
  readonly routeType: string;
  readonly quoteAssetMint: string;
  readonly writableLockAccounts: readonly string[];
  readonly marketRegime: string;
}

export interface MarginalExitRiskEvaluation {
  readonly mint: string;
  readonly sharedPoolBottlenecks: number;
  readonly sharedCreatorBottlenecks: number;
  readonly sharedLocksetConflicts: number;
  readonly baseRiskMultiplier: number;
  readonly marginalExitRiskMultiplier: number; // >= 1.0 (scales down sizing if bottlenecked)
  readonly maxRecommendedPositionScale: number; // e.g. 1.0 down to 0.25
  readonly isLiquidationChoked: boolean;
  readonly notes: string;
}

export interface DecomposedExecutionEconomics {
  readonly grossInputLamports: bigint;
  readonly netInputLamports: bigint;
  readonly feeLamports: bigint;
  readonly feeBps: number;
  readonly spotOutputTokens: bigint;
  readonly actualOutputTokens: bigint;
  readonly pureImpactBps: number;
  readonly slippageBps: number;
  readonly totalExecutionFrictionBps: number;
}

export class VenueEconomicsAuthority {
  /**
   * Builds an authoritative RoundTripExecutionCertificate across candidate venues.
   */
  public evaluateRoundTripEconomics(params: {
    mint: string;
    evaluatedAmountLamports: bigint;
    slot: number;
    venueCandidates: readonly VenueRoundTripMetrics[];
    expectedAlphaLamports?: bigint;
    requirePositiveEV?: boolean;
    minLandingProbability?: number;
    maxCapitalTrappingBps?: number;
  }): RoundTripExecutionCertificate {
    const minLanding = params.minLandingProbability ?? 0.85;
    const maxTrapping = params.maxCapitalTrappingBps ?? 800; // 8%

    const viableVenues = params.venueCandidates.filter(
      (v) => v.isViable && v.landingProbability >= minLanding && v.capitalTrappingRiskBps <= maxTrapping
    );

    if (viableVenues.length === 0) {
      const digest = createHash('sha256').update(`${params.mint}:${params.slot}:NO_VIABLE_VENUE`).digest('hex');
      const fallback = params.venueCandidates[0] ?? {
        venue: 'PUMP_FUN',
        entryPriceLamports: 0n,
        entryFeeLamports: 0n,
        entryImpactBps: 0,
        expectedExitPriceLamports: 0n,
        expectedExitFeeLamports: 0n,
        expectedExitImpactBps: 0,
        landingProbability: 0,
        capitalTrappingRiskBps: 10000,
        netRoundTripCostLamports: 0n,
        isViable: false
      };

      return {
        certificateId: `ROUNDTRIP-${digest.slice(0, 16)}`,
        mint: params.mint,
        evaluatedAmountLamports: params.evaluatedAmountLamports,
        venuesEvaluated: params.venueCandidates,
        selectedVenue: fallback,
        expectedAlphaLamports: params.expectedAlphaLamports ?? 0n,
        expectedNetRoundTripEVLamports: 0n,
        estimatedNetTerminalCapitalLamports: 0n,
        issuedAtSlot: params.slot,
        isApprovedForEntry: false,
        rejectionReason: 'No venue met round-trip exitability and capital trapping safety thresholds',
        digest
      };
    }

    // Select the venue that minimizes net round-trip friction and maximizes exitability
    viableVenues.sort((a, b) => {
      // Prioritize lower net round-trip cost
      if (a.netRoundTripCostLamports < b.netRoundTripCostLamports) return -1;
      if (a.netRoundTripCostLamports > b.netRoundTripCostLamports) return 1;
      // Secondary: higher landing probability
      return b.landingProbability - a.landingProbability;
    });

    const selectedVenue = viableVenues[0];
    const expectedAlpha = params.expectedAlphaLamports ?? 0n;
    const expectedNetRoundTripEVLamports = expectedAlpha - selectedVenue.netRoundTripCostLamports;
    const estimatedNetTerminalCapitalLamports = params.evaluatedAmountLamports + expectedAlpha - selectedVenue.netRoundTripCostLamports;

    const isEvPositive = expectedNetRoundTripEVLamports > 0n;
    const isApprovedForEntry = params.requirePositiveEV ? isEvPositive : true;
    const rejectionReason = !isApprovedForEntry
      ? `Negative expected round-trip EV (${expectedNetRoundTripEVLamports} lamports) after venue fees and execution impact`
      : undefined;

    const payload = `${params.mint}:${params.slot}:${selectedVenue.venue}:${selectedVenue.netRoundTripCostLamports}:${expectedNetRoundTripEVLamports}:${isApprovedForEntry}`;
    const digest = createHash('sha256').update(payload).digest('hex');

    return {
      certificateId: `ROUNDTRIP-${digest.slice(0, 16)}`,
      mint: params.mint,
      evaluatedAmountLamports: params.evaluatedAmountLamports,
      venuesEvaluated: params.venueCandidates,
      selectedVenue,
      expectedAlphaLamports: expectedAlpha,
      expectedNetRoundTripEVLamports,
      estimatedNetTerminalCapitalLamports,
      issuedAtSlot: params.slot,
      isApprovedForEntry,
      rejectionReason,
      digest
    };
  }

  /**
   * Optimizes multi-venue split-routing allocation across viable venues to minimize
   * convex AMM price impact and maximize net terminal execution capital.
   */
  public evaluateOptimalSplitRoute(params: {
    mint: string;
    totalAmountLamports: bigint;
    slot: number;
    venueCandidates: readonly VenueRoundTripMetrics[];
    minLandingProbability?: number;
    maxCapitalTrappingBps?: number;
  }): SplitRouteExecutionCertificate {
    const minLanding = params.minLandingProbability ?? 0.85;
    const maxTrapping = params.maxCapitalTrappingBps ?? 800;

    const viable = params.venueCandidates.filter(
      (v) => v.isViable && v.landingProbability >= minLanding && v.capitalTrappingRiskBps <= maxTrapping
    );

    if (viable.length === 0 || params.totalAmountLamports <= 0n) {
      const digest = createHash('sha256').update(`${params.mint}:${params.slot}:EMPTY_SPLIT`).digest('hex');
      return {
        certificateId: `SPLIT-${digest.slice(0, 16)}`,
        mint: params.mint,
        totalEvaluatedAmountLamports: params.totalAmountLamports,
        legs: [],
        aggregateImpactBps: 0,
        singleVenueBestImpactBps: 0,
        slippageSavingsLamports: 0n,
        slippageSavingsBps: 0,
        isSplitAdvantageous: false,
        issuedAtSlot: params.slot,
        digest,
      };
    }

    const singleVenueBestImpactBps = Math.min(...viable.map((v) => v.entryImpactBps));

    if (viable.length === 1) {
      const v = viable[0];
      const digest = createHash('sha256').update(`${params.mint}:${params.slot}:SINGLE_LEG`).digest('hex');
      return {
        certificateId: `SPLIT-${digest.slice(0, 16)}`,
        mint: params.mint,
        totalEvaluatedAmountLamports: params.totalAmountLamports,
        legs: [{
          venue: v.venue,
          allocatedAmountLamports: params.totalAmountLamports,
          allocationFractionPct: 100,
          expectedImpactBps: v.entryImpactBps,
          feeLamports: v.entryFeeLamports,
        }],
        aggregateImpactBps: v.entryImpactBps,
        singleVenueBestImpactBps,
        slippageSavingsLamports: 0n,
        slippageSavingsBps: 0,
        isSplitAdvantageous: false,
        issuedAtSlot: params.slot,
        digest,
      };
    }

    // Multi-venue convex impact optimization:
    // Optimal split weighting is inversely proportional to venue impact coefficient: w_i = (1 / impact_i) / sum(1 / impact_j)
    const weights = viable.map((v) => 1 / Math.max(1, v.entryImpactBps));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let allocatedLamportsSum = 0n;
    const legs: SplitRouteLegAllocation[] = viable.map((v, idx) => {
      const fraction = weights[idx] / totalWeight;
      let allocated = (params.totalAmountLamports * BigInt(Math.floor(fraction * 10_000))) / 10_000n;
      if (idx === viable.length - 1) {
        allocated = params.totalAmountLamports - allocatedLamportsSum;
      } else {
        allocatedLamportsSum += allocated;
      }
      // Price impact scales down proportionally with the reduced notional allocated to this venue
      const scaledImpactBps = Math.max(1, Math.round(v.entryImpactBps * fraction));
      return {
        venue: v.venue,
        allocatedAmountLamports: allocated,
        allocationFractionPct: Number((fraction * 100).toFixed(2)),
        expectedImpactBps: scaledImpactBps,
        feeLamports: (v.entryFeeLamports * allocated) / (params.totalAmountLamports || 1n),
      };
    });

    const aggregateImpactBps = Math.round(
      legs.reduce((acc, leg) => acc + (leg.expectedImpactBps * leg.allocationFractionPct) / 100, 0)
    );
    const slippageSavingsBps = Math.max(0, singleVenueBestImpactBps - aggregateImpactBps);
    const slippageSavingsLamports = (params.totalAmountLamports * BigInt(slippageSavingsBps)) / 10_000n;
    const isSplitAdvantageous = slippageSavingsBps >= 5;

    const payload = `${params.mint}:${params.slot}:${aggregateImpactBps}:${slippageSavingsLamports}:${isSplitAdvantageous}`;
    const digest = createHash('sha256').update(payload).digest('hex');

    return {
      certificateId: `SPLIT-${digest.slice(0, 16)}`,
      mint: params.mint,
      totalEvaluatedAmountLamports: params.totalAmountLamports,
      legs: Object.freeze(legs),
      aggregateImpactBps,
      singleVenueBestImpactBps,
      slippageSavingsLamports,
      slippageSavingsBps,
      isSplitAdvantageous,
      issuedAtSlot: params.slot,
      digest,
    };
  }

  /**
   * Decomposes gross execution input into net input, protocol/creator fee, spot output,
   * pure curve price impact, and total execution friction. (BP §25, §27)
   */
  public static decomposeExecutionEconomics(params: {
    readonly inputLamports?: bigint;
    readonly grossInputLamports?: bigint;
    readonly totalFeeBps?: number;
    readonly feeBps?: number;
    readonly virtualQuoteReserves: bigint;
    readonly virtualTokenReserves: bigint;
    readonly actualOutputTokens: bigint;
    readonly slippageBps?: number;
  }): DecomposedExecutionEconomics {
    const grossInput = params.grossInputLamports ?? params.inputLamports ?? 0n;
    if (grossInput <= 0n || params.virtualQuoteReserves <= 0n || params.virtualTokenReserves <= 0n) {
      throw new Error('INVALID_ECONOMICS_INPUTS');
    }
    const feeBps = params.feeBps ?? params.totalFeeBps ?? 0;
    const feeLamports = (grossInput * BigInt(feeBps)) / 10_000n;
    const netInput = grossInput - feeLamports;
    const spotOutput = params.virtualQuoteReserves > 0n
      ? (netInput * params.virtualTokenReserves) / params.virtualQuoteReserves
      : 0n;
    const actualOutput = params.actualOutputTokens;
    const pureImpactTokens = spotOutput > actualOutput ? spotOutput - actualOutput : 0n;
    const pureImpactBps = spotOutput > 0n ? Number((pureImpactTokens * 10_000n) / spotOutput) : 0;
    const slippageBps = params.slippageBps ?? 0;
    const totalExecutionFrictionBps = pureImpactBps + feeBps + slippageBps;

    return {
      grossInputLamports: grossInput,
      netInputLamports: netInput,
      feeLamports,
      feeBps,
      spotOutputTokens: spotOutput,
      actualOutputTokens: actualOutput,
      pureImpactBps,
      slippageBps,
      totalExecutionFrictionBps,
    };
  }

  public decomposeExecutionEconomics(params: {
    readonly inputLamports?: bigint;
    readonly grossInputLamports?: bigint;
    readonly totalFeeBps?: number;
    readonly feeBps?: number;
    readonly virtualQuoteReserves: bigint;
    readonly virtualTokenReserves: bigint;
    readonly actualOutputTokens: bigint;
    readonly slippageBps?: number;
  }): DecomposedExecutionEconomics {
    return VenueEconomicsAuthority.decomposeExecutionEconomics(params);
  }
}

export class PortfolioExitNet {
  private existingPositions = new Map<string, ExistingPositionLiquidationProfile>();

  public registerPosition(profile: ExistingPositionLiquidationProfile): void {
    this.existingPositions.set(profile.mint, profile);
  }

  public removePosition(mint: string): void {
    this.existingPositions.delete(mint);
  }

  /**
   * Computes MarginalExitRisk for a candidate new entry against active portfolio positions.
   */
  public evaluateMarginalExitRisk(candidate: {
    mint: string;
    poolAddress: string;
    creatorPubkey: string;
    routeType: string;
    quoteAssetMint: string;
    writableLockAccounts: readonly string[];
    marketRegime: string;
  }): MarginalExitRiskEvaluation {
    let sharedPoolBottlenecks = 0;
    let sharedCreatorBottlenecks = 0;
    let sharedLocksetConflicts = 0;

    const candidateLocks = new Set(candidate.writableLockAccounts);

    for (const [existingMint, pos] of this.existingPositions.entries()) {
      if (existingMint === candidate.mint) continue;

      if (pos.poolAddress === candidate.poolAddress) {
        sharedPoolBottlenecks++;
      }
      if (pos.creatorPubkey === candidate.creatorPubkey && candidate.creatorPubkey !== '') {
        sharedCreatorBottlenecks++;
      }
      for (const lock of pos.writableLockAccounts) {
        if (candidateLocks.has(lock)) {
          sharedLocksetConflicts++;
        }
      }
    }

    // Risk multiplier scaling
    let multiplier = 1.0;
    if (sharedPoolBottlenecks > 0) multiplier += sharedPoolBottlenecks * 0.5;
    if (sharedCreatorBottlenecks > 0) multiplier += sharedCreatorBottlenecks * 0.4;
    if (sharedLocksetConflicts > 0) multiplier += sharedLocksetConflicts * 0.3;

    // Position size scaling factor (inverse of risk multiplier)
    const maxRecommendedPositionScale = Math.max(0.2, Math.min(1.0, 1.0 / multiplier));
    const isLiquidationChoked = multiplier >= 2.0;

    const notes = isLiquidationChoked
      ? `CRITICAL BOTTLENECK: Candidate shares ${sharedPoolBottlenecks} pools, ${sharedCreatorBottlenecks} creators, and ${sharedLocksetConflicts} writable locks with active positions. Scaling down to ${(maxRecommendedPositionScale * 100).toFixed(0)}%`
      : `ExitNet clear: Marginal exit risk multiplier ${multiplier.toFixed(2)}`;

    return {
      mint: candidate.mint,
      sharedPoolBottlenecks,
      sharedCreatorBottlenecks,
      sharedLocksetConflicts,
      baseRiskMultiplier: 1.0,
      marginalExitRiskMultiplier: multiplier,
      maxRecommendedPositionScale,
      isLiquidationChoked,
      notes
    };
  }
}

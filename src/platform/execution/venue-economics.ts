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

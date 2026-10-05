/**
 * SYLPH FUSION — EXIT BEFORE ENTRY, CAPACITY CURVES & CAPITAL-TIME ALPHA
 * Specification: Solana-Only Integration Blueprint (Sections 16–18)
 *
 * Epistemic Invariants:
 * 1. Section 16: EXIT BEFORE ENTRY INVARIANT:
 *    Before every OPEN, simulate selling 25%, 50%, 75%, and 100% under stressed liquidity
 *    (-25%, -50%, -75%). If any tranche lacks an executable exit route, entry is strictly BLOCKED.
 * 2. Section 17: Capacity Curves:
 *    Simulate slippage across position sizing tiers ($5, $10, $25, $50, $100, $250).
 *    Position size is capped to MaximumEdgePreservingSize.
 * 3. Section 18: Capital-Time Alpha:
 *    Normalized efficiency: netPnL / (capital * holdingTimeSeconds).
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export interface ExitabilitySimulationResult {
  readonly canEvacuateAllTranches: boolean;
  readonly tranchesTested: readonly {
    readonly percentage: 25 | 50 | 75 | 100;
    readonly nominalSlippageBps: number;
    readonly stressed25LiquiditySlippageBps: number;
    readonly stressed50LiquiditySlippageBps: number;
    readonly stressed75LiquiditySlippageBps: number;
    readonly isExitRouteFeasible: boolean;
  }[];
  readonly worstCaseExitLossBps: number;
  readonly entryPermitted: boolean;
  readonly refusalReason?: string;
}

export interface CapacityTierPoint {
  readonly notionalUsd: number;
  readonly expectedSlippageBps: number;
  readonly expectedMarketImpactBps: number;
  readonly exitabilityVerified: boolean;
  readonly remainingEdgeBps: number;
}

export interface CapacityCurveResult {
  readonly candidateMint: string;
  readonly curvePoints: readonly CapacityTierPoint[];
  readonly maximumEdgePreservingSizeUsd: number;
  readonly optimalPositionUsd: number;
}

export class SolanaCapacityEngine {
  /**
   * Section 16: Exit Before Entry Simulation
   */
  public static simulateExitBeforeEntry(params: {
    proposedNotionalLamports: bigint;
    poolLiquidityLamports: bigint;
    hasFallbackRoute: boolean;
    jitoAvailable: boolean;
  }): ExitabilitySimulationResult {
    const tranches: (25 | 50 | 75 | 100)[] = [25, 50, 75, 100];
    const results = [];
    let entryPermitted = true;
    let refusalReason: string | undefined;
    let worstCaseLoss = 0;

    const notionalNum = Number(params.proposedNotionalLamports);
    const liquidityNum = Number(params.poolLiquidityLamports);

    if (liquidityNum <= 0) {
      return {
        canEvacuateAllTranches: false,
        tranchesTested: [],
        worstCaseExitLossBps: 10_000,
        entryPermitted: false,
        refusalReason: 'ZERO_LIQUIDITY_FATAL: Pool has zero executable liquidity',
      };
    }

    for (const pct of tranches) {
      const trancheNotional = notionalNum * (pct / 100);
      const baseRatio = trancheNotional / liquidityNum;

      // Base slippage
      const nominalSlippageBps = Math.floor(baseRatio * 10_000 * 0.5);

      // Stress testing liquidity reductions
      const stressed25SlippageBps = Math.floor((trancheNotional / (liquidityNum * 0.75)) * 10_000 * 0.5);
      const stressed50SlippageBps = Math.floor((trancheNotional / (liquidityNum * 0.50)) * 10_000 * 0.5);
      const stressed75SlippageBps = Math.floor((trancheNotional / (liquidityNum * 0.25)) * 10_000 * 0.5);

      const isExitRouteFeasible = stressed75SlippageBps < 2000; // Refuse if 75% liquidity loss causes > 20% slippage
      worstCaseLoss = Math.max(worstCaseLoss, stressed75SlippageBps);

      if (!isExitRouteFeasible) {
        entryPermitted = false;
        refusalReason = `EXIT_STRESS_FAILURE: Evacuation of ${pct}% tranche incurs unacceptable slippage (${stressed75SlippageBps} bps) under 75% liquidity shock`;
      }

      results.push({
        percentage: pct,
        nominalSlippageBps,
        stressed25LiquiditySlippageBps: stressed25SlippageBps,
        stressed50LiquiditySlippageBps: stressed50SlippageBps,
        stressed75LiquiditySlippageBps: stressed75SlippageBps,
        isExitRouteFeasible,
      });
    }

    if (!params.hasFallbackRoute && worstCaseLoss > 1000) {
      entryPermitted = false;
      refusalReason = refusalReason || 'NO_FALLBACK_ROUTE_ERROR: Single exit route with elevated slippage risk';
    }

    return Object.freeze({
      canEvacuateAllTranches: entryPermitted,
      tranchesTested: Object.freeze(results),
      worstCaseExitLossBps: worstCaseLoss,
      entryPermitted,
      refusalReason,
    });
  }

  /**
   * Section 17: Capacity Curve Calculation
   */
  public static calculateCapacityCurve(params: {
    mint: string;
    grossEdgeBps: number;
    poolLiquidityUsd: number;
  }): CapacityCurveResult {
    const tiers = [5, 10, 25, 50, 100, 250, 500];
    const points: CapacityTierPoint[] = [];
    let maxEdgePreservingSize = 0;
    let optimalSize = 0;
    let maxDollarEdge = 0;

    for (const notional of tiers) {
      const impactBps = params.poolLiquidityUsd > 0
        ? Math.floor((notional / params.poolLiquidityUsd) * 10_000 * 0.6)
        : 9999;
      const slippageBps = Math.floor(impactBps * 0.75);
      const remainingEdgeBps = params.grossEdgeBps - impactBps - slippageBps;
      const exitabilityVerified = impactBps < 500; // < 5% impact

      if (remainingEdgeBps > 15 && exitabilityVerified) {
        maxEdgePreservingSize = notional;
        const dollarEdge = notional * (remainingEdgeBps / 10_000);
        if (dollarEdge > maxDollarEdge) {
          maxDollarEdge = dollarEdge;
          optimalSize = notional;
        }
      }

      points.push({
        notionalUsd: notional,
        expectedSlippageBps: slippageBps,
        expectedMarketImpactBps: impactBps,
        exitabilityVerified,
        remainingEdgeBps,
      });
    }

    return Object.freeze({
      candidateMint: params.mint,
      curvePoints: Object.freeze(points),
      maximumEdgePreservingSizeUsd: maxEdgePreservingSize,
      optimalPositionUsd: optimalSize,
    });
  }

  /**
   * Section 18: Capital-Time Alpha Calculation
   * Net profit normalized by committed capital and elapsed seconds.
   */
  public static computeCapitalTimeAlpha(params: {
    netPnLLamports: bigint;
    capitalCommittedLamports: bigint;
    holdingTimeSeconds: number;
  }): number {
    if (params.capitalCommittedLamports <= 0n || params.holdingTimeSeconds <= 0) {
      return 0;
    }
    const pnlFloat = Number(params.netPnLLamports);
    const capitalFloat = Number(params.capitalCommittedLamports);
    
    // Normalized annualized or per-hour capital-time alpha score
    return pnlFloat / (capitalFloat * params.holdingTimeSeconds);
  }
}

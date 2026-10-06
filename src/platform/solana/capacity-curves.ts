/**
 * SYLPH FUSION — RESEARCH LIQUIDITY-STRESS AND CAPACITY HEURISTICS
 * Specification inspiration: Solana-Only Integration Blueprint (Sections 16–18)
 *
 * These constant-product-inspired calculations are estimates from caller inputs.
 * They do not query routes, verify executable liquidity, prove exitability, or
 * authorize entry. Production decisions require fresh amount-specific quotes and
 * independently verified route, fee, latency, and settlement evidence.
 */

export interface LiquidityStressEstimate {
  readonly modelStatus: 'RESEARCH_ONLY';
  readonly allTranchesWithinModeledLimit: boolean;
  readonly tranches: readonly {
    readonly percentage: 25 | 50 | 75 | 100;
    readonly estimatedSlippageBps: number;
    readonly withinModeledLimit: boolean;
  }[];
  readonly worstModeledSlippageBps: number;
  readonly researchNote: string;
}

export interface CapacityTierPoint {
  readonly notionalUsd: number;
  readonly modeledSlippageBps: number;
  readonly modeledMarketImpactBps: number;
  readonly withinModeledImpactThreshold: boolean;
  readonly modeledRemainingEdgeBps: number;
}

export interface CapacityCurveResult {
  readonly modelStatus: 'RESEARCH_ONLY';
  readonly candidateMint: string;
  readonly curvePoints: readonly CapacityTierPoint[];
  readonly maximumModeledEdgePreservingSizeUsd: number;
  readonly heuristicPositionSizeUsd: number;
}

const MAX_ESTIMABLE_LAMPORTS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MODELED_SLIPPAGE_BPS = 2000;
const MAX_MODELED_IMPACT_BPS = 500;

export class SolanaCapacityEngine {
  /**
   * Models hypothetical slippage under reserve haircuts. A passing estimate is
   * not evidence of an available route and must never be used as an entry permit.
   */
  public static estimateLiquidityStress(params: {
    proposedNotionalLamports: bigint;
    poolLiquidityLamports: bigint;
  }): LiquidityStressEstimate {
    if (params.proposedNotionalLamports <= 0n || params.poolLiquidityLamports <= 0n ||
        params.proposedNotionalLamports > MAX_ESTIMABLE_LAMPORTS || params.poolLiquidityLamports > MAX_ESTIMABLE_LAMPORTS) {
      throw new Error('LIQUIDITY_STRESS_INPUT_INVALID: Positive lamport inputs within safe numeric precision are required');
    }

    const notional = Number(params.proposedNotionalLamports);
    const liquidity = Number(params.poolLiquidityLamports);
    const tranches = ([25, 50, 75, 100] as const).map(percentage => {
      const trancheNotional = notional * (percentage / 100);
      const stressedLiquidity = liquidity * 0.25; // Illustrative 75% reserve haircut.
      const estimatedSlippageBps = Math.floor((trancheNotional / stressedLiquidity) * 10_000 * 0.5);
      return Object.freeze({
        percentage,
        estimatedSlippageBps,
        withinModeledLimit: estimatedSlippageBps < MAX_MODELED_SLIPPAGE_BPS,
      });
    });
    const worstModeledSlippageBps = tranches.reduce((worst, tranche) => Math.max(worst, tranche.estimatedSlippageBps), 0);

    return Object.freeze({
      modelStatus: 'RESEARCH_ONLY',
      allTranchesWithinModeledLimit: tranches.every(tranche => tranche.withinModeledLimit),
      tranches: Object.freeze(tranches),
      worstModeledSlippageBps,
      researchNote: 'Reserve-ratio heuristic only; no route, quote, fallback, tip, exitability, or entry decision was verified.',
    });
  }

  /** Calculates an illustrative curve from caller-supplied gross edge and liquidity. */
  public static calculateCapacityCurve(params: {
    mint: string;
    grossEdgeBps: number;
    poolLiquidityUsd: number;
  }): CapacityCurveResult {
    if (!params.mint.trim() || !Number.isFinite(params.grossEdgeBps) ||
        !Number.isFinite(params.poolLiquidityUsd) || params.poolLiquidityUsd <= 0) {
      throw new Error('CAPACITY_CURVE_INPUT_INVALID: Mint, finite edge and positive finite liquidity are required');
    }

    const tiers = [5, 10, 25, 50, 100, 250, 500];
    const points: CapacityTierPoint[] = [];
    let maximumModeledEdgePreservingSizeUsd = 0;
    let heuristicPositionSizeUsd = 0;
    let maximumModeledDollarEdge = 0;

    for (const notionalUsd of tiers) {
      const modeledMarketImpactBps = Math.floor((notionalUsd / params.poolLiquidityUsd) * 10_000 * 0.6);
      const modeledSlippageBps = Math.floor(modeledMarketImpactBps * 0.75);
      const modeledRemainingEdgeBps = params.grossEdgeBps - modeledMarketImpactBps - modeledSlippageBps;
      if (!Number.isFinite(modeledMarketImpactBps) || !Number.isFinite(modeledSlippageBps) || !Number.isFinite(modeledRemainingEdgeBps)) {
        throw new Error('CAPACITY_CURVE_INPUT_INVALID: Inputs exceed finite model range');
      }
      const withinModeledImpactThreshold = modeledMarketImpactBps < MAX_MODELED_IMPACT_BPS;

      if (modeledRemainingEdgeBps > 15 && withinModeledImpactThreshold) {
        maximumModeledEdgePreservingSizeUsd = notionalUsd;
        const modeledDollarEdge = notionalUsd * (modeledRemainingEdgeBps / 10_000);
        if (modeledDollarEdge > maximumModeledDollarEdge) {
          maximumModeledDollarEdge = modeledDollarEdge;
          heuristicPositionSizeUsd = notionalUsd;
        }
      }

      points.push(Object.freeze({
        notionalUsd,
        modeledSlippageBps,
        modeledMarketImpactBps,
        withinModeledImpactThreshold,
        modeledRemainingEdgeBps,
      }));
    }

    return Object.freeze({
      modelStatus: 'RESEARCH_ONLY',
      candidateMint: params.mint,
      curvePoints: Object.freeze(points),
      maximumModeledEdgePreservingSizeUsd,
      heuristicPositionSizeUsd,
    });
  }

  /** A descriptive capital-time ratio over supplied values, not a realized-alpha estimate. */
  public static computeResearchCapitalTimeRatio(params: {
    netPnLLamports: bigint;
    capitalCommittedLamports: bigint;
    holdingTimeSeconds: number;
  }): number | null {
    if (params.capitalCommittedLamports <= 0n || !Number.isFinite(params.holdingTimeSeconds) || params.holdingTimeSeconds <= 0) {
      return null;
    }
    const pnl = Number(params.netPnLLamports);
    const capital = Number(params.capitalCommittedLamports);
    if (!Number.isFinite(pnl) || !Number.isFinite(capital)) return null;
    // Sequential division avoids overflowing `capital * holdingTime` when the
    // final ratio is still representable. Underflow to zero is unavailable when
    // the supplied PnL is non-zero; zero itself remains a valid observed ratio.
    const ratio = (pnl / capital) / params.holdingTimeSeconds;
    return Number.isFinite(ratio) && !(pnl !== 0 && ratio === 0) ? ratio : null;
  }
}

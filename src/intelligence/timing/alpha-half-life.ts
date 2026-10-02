/**
 * SOL-SYLPH Intelligence Fabric - Alpha Half-Life & Burn Engine
 * Specifications: 500-Item Roadmap Layer I (#1-#3, #9), Layer II (#101, #171), Layer III (#201, #202).
 *
 * Implements:
 * 1. AlphaHalfLifeEngine: Predicts opportunity edge half-life (ms) and decay geometry.
 * 2. Economic Event Horizon: Computes exact timestamp where net capturable edge drops below hurdle.
 * 3. AlphaBurnLedger: Tracks and attributes edge destruction across transaction lifecycle subsystems.
 */

export type OpportunityStage =
  | 'BONDING_CURVE_EARLY'
  | 'BONDING_CURVE_MID'
  | 'BONDING_CURVE_LATE'
  | 'MIGRATING'
  | 'POST_MIGRATION_AMM';

export type AlphaDecayCurvature = 'LINEAR' | 'EXPONENTIAL' | 'CATASTROPHIC';

export interface AlphaHalfLifeEstimate {
  readonly halfLifeMs: number;
  readonly curvature: AlphaDecayCurvature;
  readonly burnRateBpsPerMs: number;
  readonly economicEventHorizonMs: number;
  readonly initialEdgeBps: number;
  readonly hurdleBps: number;
}

export interface SubsystemLatencyBreakdown {
  readonly discoveryMs: number;
  readonly modelEvaluationMs: number;
  readonly quoteMs: number;
  readonly simulationMs: number;
  readonly signingMs: number;
  readonly networkTransmissionMs: number;
}

export interface SubsystemAlphaBurnRecord {
  readonly phase: keyof SubsystemLatencyBreakdown;
  readonly durationMs: number;
  readonly alphaBurnedBps: number;
  readonly fractionOfTotalBurn: number;
}

export interface AlphaBurnAuditReport {
  readonly initialEdgeBps: number;
  readonly remainingEdgeBps: number;
  readonly totalElapsedMs: number;
  readonly totalBurnedBps: number;
  readonly capturesPositiveEdge: boolean;
  readonly phases: readonly SubsystemAlphaBurnRecord[];
}

export class AlphaHalfLifeEngine {
  // Baseline half-lives by market stage (in milliseconds)
  private static readonly STAGE_BASE_HALF_LIFE_MS: Record<OpportunityStage, number> = {
    BONDING_CURVE_EARLY: 650,    // Extreme competition / sniping race
    BONDING_CURVE_MID: 1400,    // Growing liquidity, retail momentum
    BONDING_CURVE_LATE: 2800,   // Saturation approaching migration
    MIGRATING: 400,             // Severe migration transition volatility & liquidity lock
    POST_MIGRATION_AMM: 4500,   // Standard AMM pool depth
  };

  /**
   * Computes the dynamic alpha half-life and economic event horizon for a candidate.
   *
   * @param params.stage Token lifecycle phase
   * @param params.initialEdgeBps Gross expected edge in basis points (e.g. 400 = 4%)
   * @param params.hurdleBps Minimum edge required to justify capital risk and friction (e.g. 100 bps)
   * @param params.competitorDensity Estimated competing bot saturation (0.0 = none, 1.0 = heavy)
   * @param params.opportunityJerk Rate of change of opportunity acceleration (-1.0 to 1.0)
   * @param params.frictionBps Total transaction friction in BPS (priority fees + tip + base slippage)
   */
  public static estimateHalfLife(params: {
    stage: OpportunityStage;
    initialEdgeBps: number;
    hurdleBps?: number;
    competitorDensity?: number;
    opportunityJerk?: number;
    frictionBps?: number;
  }): AlphaHalfLifeEstimate {
    const hurdleBps = params.hurdleBps ?? 100;
    const baseHalfLife = this.STAGE_BASE_HALF_LIFE_MS[params.stage] ?? 1200;
    const competitorDensity = Math.max(0.0, Math.min(1.0, params.competitorDensity ?? 0.3));
    const opportunityJerk = Math.max(-1.0, Math.min(1.0, params.opportunityJerk ?? 0.0));
    const frictionBps = Math.max(0, params.frictionBps ?? 50);

    // High competitor density compresses the half-life drastically
    const competitorMultiplier = 1.0 / (1.0 + competitorDensity * 2.5);

    // Negative jerk (decelerating opportunity quality) accelerates decay
    const jerkMultiplier = 1.0 + (opportunityJerk * 0.35);

    const halfLifeMs = Math.max(100, Math.round(baseHalfLife * competitorMultiplier * jerkMultiplier));

    // Determine curvature:
    // When competitor density is high and jerk is negative, decay becomes catastrophic
    let curvature: AlphaDecayCurvature = 'EXPONENTIAL';
    if (competitorDensity > 0.75 && opportunityJerk < -0.3) {
      curvature = 'CATASTROPHIC';
    } else if (params.stage === 'POST_MIGRATION_AMM' && competitorDensity < 0.2) {
      curvature = 'LINEAR';
    }

    // Net edge available at t=0 after friction
    const netEdgeBps = Math.max(0, params.initialEdgeBps - frictionBps);

    // Compute Economic Event Horizon:
    // Time t at which RemainingEdge(t) <= hurdleBps
    let economicEventHorizonMs = 0;
    if (netEdgeBps >= hurdleBps) {
      if (curvature === 'LINEAR') {
        const decayRatePerMs = netEdgeBps / (halfLifeMs * 2);
        economicEventHorizonMs = Math.round((netEdgeBps - hurdleBps) / Math.max(1e-4, decayRatePerMs));
      } else if (curvature === 'CATASTROPHIC') {
        // Accelerated edge loss
        const decayConstant = Math.log(2) / (halfLifeMs ** 1.5);
        const ratio = hurdleBps / Math.max(hurdleBps + 1, netEdgeBps);
        economicEventHorizonMs = Math.round((Math.abs(Math.log(ratio)) / decayConstant) ** (1 / 1.5));
      } else {
        // Standard exponential decay: Edge(t) = NetEdge * 2^(-t / halfLife)
        const ratio = Math.max(0.01, hurdleBps / Math.max(hurdleBps + 1, netEdgeBps));
        const log2Ratio = Math.log2(ratio);
        economicEventHorizonMs = Math.round(-log2Ratio * halfLifeMs);
      }
      economicEventHorizonMs = Math.max(halfLifeMs, economicEventHorizonMs);
    }

    // Initial instantaneous burn rate (bps per ms)
    const burnRateBpsPerMs = Number(((netEdgeBps * Math.log(2)) / halfLifeMs).toFixed(4));

    return {
      halfLifeMs,
      curvature,
      burnRateBpsPerMs,
      economicEventHorizonMs: Math.max(0, economicEventHorizonMs),
      initialEdgeBps: params.initialEdgeBps,
      hurdleBps,
    };
  }

  /**
   * Calculates the remaining edge in BPS after elapsed time (ms).
   */
  public static calculateRemainingEdge(
    initialEdgeBps: number,
    elapsedMs: number,
    estimate: AlphaHalfLifeEstimate
  ): number {
    if (elapsedMs <= 0) return initialEdgeBps;
    if (estimate.economicEventHorizonMs > 0 && elapsedMs >= estimate.economicEventHorizonMs) {
      return 0;
    }

    if (estimate.curvature === 'LINEAR') {
      const decayPerMs = initialEdgeBps / (estimate.halfLifeMs * 2);
      return Math.max(0, Math.round(initialEdgeBps - (decayPerMs * elapsedMs)));
    }

    if (estimate.curvature === 'CATASTROPHIC') {
      const decayConstant = Math.log(2) / (estimate.halfLifeMs ** 1.5);
      const remaining = initialEdgeBps * Math.exp(-decayConstant * (elapsedMs ** 1.5));
      return Math.max(0, Math.round(remaining));
    }

    // Standard Exponential
    const decayFactor = 2 ** (-elapsedMs / estimate.halfLifeMs);
    return Math.max(0, Math.round(initialEdgeBps * decayFactor));
  }
}

export class AlphaBurnLedger {
  /**
   * Decomposes edge loss across all latency stages of the pipeline.
   */
  public static auditBurn(
    initialEdgeBps: number,
    estimate: AlphaHalfLifeEstimate,
    breakdown: SubsystemLatencyBreakdown
  ): AlphaBurnAuditReport {
    const phases: (keyof SubsystemLatencyBreakdown)[] = [
      'discoveryMs',
      'modelEvaluationMs',
      'quoteMs',
      'simulationMs',
      'signingMs',
      'networkTransmissionMs',
    ];

    let currentEdge = initialEdgeBps;
    let accumulatedMs = 0;
    const records: SubsystemAlphaBurnRecord[] = [];

    for (const phase of phases) {
      const durationMs = breakdown[phase] ?? 0;
      accumulatedMs += durationMs;
      const nextEdge = AlphaHalfLifeEngine.calculateRemainingEdge(initialEdgeBps, accumulatedMs, estimate);
      const burned = Math.max(0, currentEdge - nextEdge);
      currentEdge = nextEdge;

      records.push({
        phase,
        durationMs,
        alphaBurnedBps: burned,
        fractionOfTotalBurn: 0, // calculated below
      });
    }

    const totalBurned = Math.max(0, initialEdgeBps - currentEdge);
    const finalRecords = records.map(r => ({
      ...r,
      fractionOfTotalBurn: totalBurned > 0 ? Number((r.alphaBurnedBps / totalBurned).toFixed(4)) : 0,
    }));

    return {
      initialEdgeBps,
      remainingEdgeBps: currentEdge,
      totalElapsedMs: accumulatedMs,
      totalBurnedBps: totalBurned,
      capturesPositiveEdge: currentEdge > estimate.hurdleBps,
      phases: Object.freeze(finalRecords),
    };
  }
}

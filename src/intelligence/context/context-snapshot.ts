/**
 * SOL-SYLPH Intelligence Fabric - Hierarchical Context Snapshot Engine
 * Specifications: Major Update #12 (Sections 24-29: SOL Market State, Network, Jito, Meme Breadth, Contextual HSI).
 */

export interface SolMarketState {
  readonly priceUsd: number;
  readonly return1hPct: number;
  readonly return24hPct: number;
  readonly volatilityPct: number;
  readonly isShockActive: boolean; // SolShockDetector: sharp sudden drop > 3% in 5m
}

export interface NetworkBlockspaceState {
  readonly slotLag: number;
  readonly averagePriorityFeeLamports: number;
  readonly congestionLevel: 'NORMAL' | 'BUSY' | 'CONGESTED' | 'DEGRADED';
  readonly rpcHealthyProvidersCount: number;
}

export interface JitoMarketState {
  readonly medianTipLamports: number;
  readonly p95TipLamports: number;
  readonly bundleLandingSuccessRate: number; // 0.0 to 1.0
  readonly averageBundleLatencyMs: number;
}

export interface MemeEcosystemBreadth {
  readonly launchesPerMinute: number;
  readonly activeTokensCount: number;
  readonly runnerRatePct: number; // % reaching migration curve
  readonly breadthState: 'COLD' | 'NORMAL' | 'ACTIVE' | 'HOT' | 'SATURATED';
}

export interface ContextSnapshot {
  readonly snapshotId: string;
  readonly slot: number;
  readonly observedAtMs: number;
  readonly solState: SolMarketState;
  readonly networkState: NetworkBlockspaceState;
  readonly jitoState: JitoMarketState;
  readonly memeBreadth: MemeEcosystemBreadth;
  readonly contextVersion: string;
}

export class ContextSnapshotEngine {
  private readonly contextVersion = 'context_v1_institutional';

  /**
   * Build immutable ContextSnapshot.
   */
  public captureSnapshot(params: {
    slot: number;
    solPriceUsd: number;
    solReturn1hPct: number;
    solReturn24hPct: number;
    solVolatilityPct: number;
    slotLag: number;
    avgPriorityFee: number;
    rpcHealthyCount: number;
    medianTipLamports: number;
    landingRate: number;
    launchesPerMin: number;
    activeTokens: number;
    runnerRate: number;
  }): ContextSnapshot {
    const isShockActive = params.solReturn1hPct <= -3.0 || params.solVolatilityPct >= 12.0;

    let congestionLevel: NetworkBlockspaceState['congestionLevel'] = 'NORMAL';
    if (params.rpcHealthyCount < 1 || params.slotLag > 25) {
      congestionLevel = 'DEGRADED';
    } else if (params.slotLag > 12 || params.avgPriorityFee > 100_000) {
      congestionLevel = 'CONGESTED';
    } else if (params.slotLag > 5) {
      congestionLevel = 'BUSY';
    }

    let breadthState: MemeEcosystemBreadth['breadthState'] = 'NORMAL';
    if (params.launchesPerMin > 15) {
      breadthState = 'SATURATED';
    } else if (params.launchesPerMin > 8) {
      breadthState = 'HOT';
    } else if (params.launchesPerMin > 3) {
      breadthState = 'ACTIVE';
    } else if (params.launchesPerMin < 1) {
      breadthState = 'COLD';
    }

    return {
      snapshotId: `ctx_${params.slot}_${Date.now()}`,
      slot: params.slot,
      observedAtMs: Date.now(),
      solState: {
        priceUsd: params.solPriceUsd,
        return1hPct: params.solReturn1hPct,
        return24hPct: params.solReturn24hPct,
        volatilityPct: params.solVolatilityPct,
        isShockActive,
      },
      networkState: {
        slotLag: params.slotLag,
        averagePriorityFeeLamports: params.avgPriorityFee,
        congestionLevel,
        rpcHealthyProvidersCount: params.rpcHealthyCount,
      },
      jitoState: {
        medianTipLamports: params.medianTipLamports,
        p95TipLamports: params.medianTipLamports * 2.5,
        bundleLandingSuccessRate: params.landingRate,
        averageBundleLatencyMs: 450,
      },
      memeBreadth: {
        launchesPerMinute: params.launchesPerMin,
        activeTokensCount: params.activeTokens,
        runnerRatePct: params.runnerRate,
        breadthState,
      },
      contextVersion: this.contextVersion,
    };
  }

  /**
   * Derive Contextual HSI and Contextual PumpScore by weighting local metrics against macro environment.
   */
  public computeContextualScores(
    localHsi: number,
    localPumpScore: number,
    context: ContextSnapshot
  ): {
    contextualHsi: number;
    contextualPumpScore: number;
    macroRiskFactor: number;
  } {
    let macroPenalty = 0;
    if (context.solState.isShockActive) macroPenalty += 20;
    if (context.networkState.congestionLevel === 'CONGESTED' || context.networkState.congestionLevel === 'DEGRADED') macroPenalty += 25;
    if (context.memeBreadth.breadthState === 'SATURATED') macroPenalty += 15;

    // In a hostile macro environment, suspicion increases and momentum confidence decreases
    const contextualHsi = Math.min(100, Math.round(localHsi + macroPenalty * 0.5));
    const contextualPumpScore = Math.max(0, Math.round(localPumpScore * (1.0 - macroPenalty / 100)));
    const macroRiskFactor = Number((1.0 - macroPenalty / 100).toFixed(2));

    return {
      contextualHsi,
      contextualPumpScore,
      macroRiskFactor,
    };
  }
}

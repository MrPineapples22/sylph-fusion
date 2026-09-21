/**
 * SOL-SYLPH Intelligence Fabric - Autonomous Position Defense & Liquidity-Aware Exit Intelligence
 * Specifications: Major Update #14 (Sections 39-46: Position Defense State, Thesis Monitor, Exitability Surface).
 *
 * Rules:
 * 1. Treat exits as an autonomous system, completely independent from entry scoring.
 * 2. Maintain strict separation between Mark Value and Executable Liquidation Value.
 * 3. Thesis Monitor continuously checks entry validity; invalidation escalates defense level.
 * 4. Defense Levels: D0 Normal -> D1 Watch -> D2 Defensive -> D3 Reduce -> D4 Exit -> D5 Emergency.
 */

export type DefenseLevel =
  | 'D0_NORMAL'
  | 'D1_WATCH'
  | 'D2_DEFENSIVE'
  | 'D3_REDUCE'
  | 'D4_EXIT'
  | 'D5_EMERGENCY';

export type ThesisConditionStatus = 'VALID' | 'WEAKENING' | 'INVALIDATED';

export interface ThesisCondition {
  readonly conditionName: string;
  readonly status: ThesisConditionStatus;
  readonly detail: string;
}

export interface ExitabilitySlice {
  readonly sizePct: 25 | 50 | 75 | 100;
  readonly expectedRealizableSol: number;
  readonly estimatedSlippageBps: number;
  readonly isExecutable: boolean;
}

export interface PositionDefenseStateReport {
  readonly mint: string;
  readonly defenseLevel: DefenseLevel;
  readonly markValueSol: number;
  readonly executableValueSol: number;
  readonly liquidityCoverageRatio: number; // Executable value / Position mark value
  readonly exitabilitySurface: readonly ExitabilitySlice[];
  readonly thesisConditions: readonly ThesisCondition[];
  readonly hasInvalidatedThesis: boolean;
  readonly recommendedAction: 'HOLD' | 'TIGHTEN_STOPS' | 'PARTIAL_REDUCE_50' | 'FULL_EXIT' | 'EMERGENCY_DUMP';
  readonly evaluatedAtMs: number;
}

export class PositionDefenseEngine {
  /**
   * Evaluate real-time defense state of an open position.
   */
  public evaluateDefense(params: {
    mint: string;
    positionTokens: number;
    currentPriceSol: number;
    poolSolReserves: number;
    toxicityScore: number;
    unrealizedPnlPct: number;
    liquidityDropPct: number; // e.g. 20% drop since entry
    independentBuyersDecreasing: boolean;
  }): PositionDefenseStateReport {
    const markValueSol = params.positionTokens * params.currentPriceSol;

    // Build Exitability Surface across 25%, 50%, 75%, 100% slices
    const slices: ExitabilitySlice[] = [];
    let totalRealizable = 0;

    for (const sizePct of [25, 50, 75, 100] as const) {
      const sliceTokens = params.positionTokens * (sizePct / 100);
      const sliceMarkSol = sliceTokens * params.currentPriceSol;

      // Price impact: sliceMarkSol / (poolSolReserves + sliceMarkSol)
      const denominator = params.poolSolReserves + sliceMarkSol;
      const impactRatio = denominator > 0 ? sliceMarkSol / denominator : 1.0;
      const slippageBps = Math.round(impactRatio * 10_000);

      const realizable = sliceMarkSol * (1.0 - impactRatio);
      const isExecutable = params.poolSolReserves >= sliceMarkSol * 1.5;

      if (sizePct === 100) {
        totalRealizable = realizable;
      }

      slices.push({
        sizePct,
        expectedRealizableSol: Number(realizable.toFixed(3)),
        estimatedSlippageBps: slippageBps,
        isExecutable,
      });
    }

    const executableValueSol = Math.max(0, totalRealizable);
    const liquidityCoverageRatio = markValueSol > 0 ? executableValueSol / markValueSol : 1.0;

    // Check Thesis Monitor Conditions
    const thesisConditions: ThesisCondition[] = [
      {
        conditionName: 'liquidity_expansion',
        status: params.liquidityDropPct >= 25 ? 'INVALIDATED' : params.liquidityDropPct >= 10 ? 'WEAKENING' : 'VALID',
        detail: `Liquidity delta: -${params.liquidityDropPct.toFixed(1)}%`,
      },
      {
        conditionName: 'order_flow_safety',
        status: params.toxicityScore >= 0.7 ? 'INVALIDATED' : params.toxicityScore >= 0.4 ? 'WEAKENING' : 'VALID',
        detail: `Toxicity score: ${params.toxicityScore.toFixed(2)}`,
      },
      {
        conditionName: 'independent_participation',
        status: params.independentBuyersDecreasing ? 'WEAKENING' : 'VALID',
        detail: params.independentBuyersDecreasing ? 'Buyer arrival rate decaying' : 'Healthy retail inflow',
      },
    ];

    const hasInvalidated = thesisConditions.some((c) => c.status === 'INVALIDATED');
    const hasWeakening = thesisConditions.some((c) => c.status === 'WEAKENING');

    // Determine Defense Level (D0 - D5)
    let defenseLevel: DefenseLevel = 'D0_NORMAL';
    let recommendedAction: PositionDefenseStateReport['recommendedAction'] = 'HOLD';

    if (params.liquidityDropPct >= 50 || params.toxicityScore >= 0.9) {
      defenseLevel = 'D5_EMERGENCY';
      recommendedAction = 'EMERGENCY_DUMP';
    } else if (hasInvalidated || params.unrealizedPnlPct <= -15.0) {
      defenseLevel = 'D4_EXIT';
      recommendedAction = 'FULL_EXIT';
    } else if (hasWeakening && liquidityCoverageRatio < 0.8) {
      defenseLevel = 'D3_REDUCE';
      recommendedAction = 'PARTIAL_REDUCE_50';
    } else if (hasWeakening) {
      defenseLevel = 'D2_DEFENSIVE';
      recommendedAction = 'TIGHTEN_STOPS';
    } else if (params.unrealizedPnlPct >= 50.0) {
      defenseLevel = 'D1_WATCH';
      recommendedAction = 'TIGHTEN_STOPS'; // Protect large gains
    }

    return {
      mint: params.mint,
      defenseLevel,
      markValueSol: Number(markValueSol.toFixed(3)),
      executableValueSol: Number(executableValueSol.toFixed(3)),
      liquidityCoverageRatio: Number(liquidityCoverageRatio.toFixed(3)),
      exitabilitySurface: slices,
      thesisConditions,
      hasInvalidatedThesis: hasInvalidated,
      recommendedAction,
      evaluatedAtMs: Date.now(),
    };
  }
}

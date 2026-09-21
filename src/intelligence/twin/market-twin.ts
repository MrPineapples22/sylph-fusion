/**
 * SOL-SYLPH Protocol-Aware Digital Market Twin
 * Blueprint Parts XXV, XXVI, XXVII
 *
 * Simulates protocol mechanics:
 * entry buy, self-impact, exit sell, post-entry exit capacity,
 * large actor liquidation, LP withdrawal, route stress.
 * Computes RobustExitCapacity and DistanceToFailure (DTF).
 */

export interface ExecutableLiquidityState {
  readonly mint: string;
  readonly poolProtocol: 'PUMP_BONDING_CURVE' | 'RAYDIUM_AMM_V4' | 'RAYDIUM_CPMM' | 'RAYDIUM_CLMM' | 'ORCA_WHIRLPOOL';
  readonly virtualSolReserves: number;
  readonly virtualTokenReserves: number;
  readonly realSolReserves: number;
  readonly realTokenReserves: number;
  readonly feeBps: number;
  readonly lpOwnerAddress: string;
  readonly lpLockedPct: number;
}

export interface StressSimulationResult {
  readonly scenarioName: string;
  readonly maxPermittedOrderSol: number;
  readonly expectedExitSlippageBps: number;
  readonly finalPriceImpactPct: number;
  readonly survivingLiquiditySol: number;
  readonly isExitTrapped: boolean;
}

export interface DigitalMarketTwinReport {
  readonly mint: string;
  readonly robustExitCapacitySol: number;
  readonly distanceToFailure: number;       // 0.0 (already failed) to 1.0 (highly resilient)
  readonly dtfVelocity: number;             // rate of change of DTF
  readonly structuralRiskVelocity: number;
  readonly simulatedScenarios: readonly StressSimulationResult[];
  readonly minShockRequiredToBreachSol: number;
  readonly recommendedPositionCapSol: number;
}

export class DigitalMarketTwinEngine {
  public simulateTokenMechanics(params: {
    mint: string;
    liquidity: ExecutableLiquidityState;
    intendedPositionSol: number;
    whaleHoldingsSol: number;
    topClusterSharePct: number;
  }): DigitalMarketTwinReport {
    const mint = params.mint;
    const realSol = Math.max(0.1, params.liquidity.realSolReserves);
    const scenarios: StressSimulationResult[] = [];

    // Scenario 1: Baseline Entry + Exit (Self-Impact)
    const selfImpactPct = (params.intendedPositionSol / (realSol + params.intendedPositionSol)) * 100;
    const baselineSlippage = selfImpactPct * 1.5 * 100; // in bps
    scenarios.push({
      scenarioName: 'SELF_IMPACT_ROUND_TRIP',
      maxPermittedOrderSol: realSol * 0.1,
      expectedExitSlippageBps: Math.round(baselineSlippage),
      finalPriceImpactPct: Number(selfImpactPct.toFixed(2)),
      survivingLiquiditySol: realSol,
      isExitTrapped: baselineSlippage > 800,
    });

    // Scenario 2: Whale Liquidation (Simultaneous exit of largest actor)
    const whaleShockSol = Math.min(realSol * 0.8, params.whaleHoldingsSol);
    const postWhaleSol = Math.max(0.01, realSol - whaleShockSol);
    const postWhaleSlippage = (params.intendedPositionSol / postWhaleSol) * 15000;
    scenarios.push({
      scenarioName: 'WHALE_LIQUIDATION_SHOCK',
      maxPermittedOrderSol: postWhaleSol * 0.08,
      expectedExitSlippageBps: Math.round(postWhaleSlippage),
      finalPriceImpactPct: Number(((whaleShockSol / realSol) * 100).toFixed(1)),
      survivingLiquiditySol: Number(postWhaleSol.toFixed(2)),
      isExitTrapped: postWhaleSlippage > 1200,
    });

    // Scenario 3: LP Partial Withdrawal (if unlocked)
    const unlockedLpRatio = (100 - params.liquidity.lpLockedPct) / 100;
    const postLpWithdrawalSol = realSol * (1.0 - unlockedLpRatio * 0.5);
    const lpStressSlippage = (params.intendedPositionSol / Math.max(0.01, postLpWithdrawalSol)) * 10000;
    scenarios.push({
      scenarioName: 'LP_CONTRACTION_SHOCK',
      maxPermittedOrderSol: postLpWithdrawalSol * 0.05,
      expectedExitSlippageBps: Math.round(lpStressSlippage),
      finalPriceImpactPct: Number((unlockedLpRatio * 50).toFixed(1)),
      survivingLiquiditySol: Number(postLpWithdrawalSol.toFixed(2)),
      isExitTrapped: lpStressSlippage > 1500,
    });

    // Part XXVI: Robust Exit Capacity = Minimum maxPermittedOrderSol across all stress scenarios
    const robustExitCapacity = Math.min(...scenarios.map(s => s.maxPermittedOrderSol));

    // Part XXVII: Distance to Failure (DTF)
    // Distance from current state to nearest unacceptable state (e.g. slippage > 15% or pool drained > 80%)
    const maxStressSlippage = Math.max(...scenarios.map(s => s.expectedExitSlippageBps));
    const dtf = Math.max(0.0, Math.min(1.0, 1.0 - (maxStressSlippage / 2000)));

    // Minimum shock required to collapse pool liquidity below exit threshold
    const minShockRequired = realSol * 0.35;
    const recommendedCap = Math.min(robustExitCapacity, params.intendedPositionSol);

    return {
      mint,
      robustExitCapacitySol: Number(robustExitCapacity.toFixed(3)),
      distanceToFailure: Number(dtf.toFixed(3)),
      dtfVelocity: 0.0,
      structuralRiskVelocity: Number((1.0 - dtf).toFixed(3)),
      simulatedScenarios: scenarios,
      minShockRequiredToBreachSol: Number(minShockRequired.toFixed(2)),
      recommendedPositionCapSol: Number(recommendedCap.toFixed(3)),
    };
  }
}

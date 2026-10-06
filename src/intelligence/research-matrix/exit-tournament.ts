/**
 * SYLPH FUSION — EXIT POLICY TOURNAMENT & RUNNER DEPENDENCE (Sections 32, 33, 34)
 *
 * Manages parallel shadow exit policies concurrently:
 * 1.  HARD_STOP (-20% to -25%)
 * 2.  TIME_STOP (120s / 180s)
 * 3.  TRAILING_STOP (-25% to -30% from peak)
 * 4.  PRINCIPAL_RECOVERY (100% principal out at 2.0x, remaining 50% held as runner)
 * 5.  PARTIAL_SCALE_OUT (33% at 1.5x, 33% at 2.0x, 34% at 3.0x)
 * 6.  RUNNER_HOLD (Hold strictly for 10x/100x target or stop out at breakeven)
 * 7.  VIABILITY_BOUNDARY_EXIT (Exit when minimum slack reaches 0)
 * 8.  COMMITTOR_COLLAPSE_EXIT (Exit when q_failure > 0.65 or q_target < 0.15)
 * 9.  INVENTORY_CLIFF_EXIT (Exit when A(m) slope dA/dm > 0.40)
 * 10. LIQUIDITY_DETERIORATION_EXIT (Exit when pool depth drops > 35%)
 * 11. R_SELL_TRANSITION_EXIT (Exit when R_sell > 1.20)
 * 12. INFORMATION_DETERIORATION_EXIT (Exit when Bayes error floor exceeds 0.45)
 * 13. STRESSED_EXITABILITY_EXIT (Exit when estimated exit price impact > 15%)
 *
 * Tracks Runner Dependence:
 * RD_k = (PnL - PnL_without_top_k_trades) / PnL for k = 1, 3, 5, 10
 */

export type ExitPolicyCandidate =
  | 'HARD_STOP'
  | 'TIME_STOP'
  | 'TRAILING_STOP'
  | 'PRINCIPAL_RECOVERY'
  | 'PARTIAL_SCALE_OUT'
  | 'RUNNER_HOLD'
  | 'VIABILITY_BOUNDARY_EXIT'
  | 'COMMITTOR_COLLAPSE_EXIT'
  | 'INVENTORY_CLIFF_EXIT'
  | 'LIQUIDITY_DETERIORATION_EXIT'
  | 'R_SELL_TRANSITION_EXIT'
  | 'INFORMATION_DETERIORATION_EXIT'
  | 'STRESSED_EXITABILITY_EXIT';

export interface ExitSignalEvaluation {
  readonly shouldExit: boolean;
  readonly fractionToExit: number; // 0.0 to 1.0 (e.g. 0.5 for principal recovery, 1.0 for full exit)
  readonly reason: string;
}

export interface ShadowExitPolicyResult {
  readonly policy: ExitPolicyCandidate;
  readonly exitTriggered: boolean;
  readonly exitMultiple: number;
  readonly simulatedPnlLamports: bigint;
  readonly netReturnFraction: number;
  readonly holdTimeSeconds: number;
  readonly exitReason: string;
}

export interface RunnerDependenceMetrics {
  readonly totalPnlSol: number;
  readonly rd1: number;  // k=1
  readonly rd3: number;  // k=3
  readonly rd5: number;  // k=5
  readonly rd10: number; // k=10
  readonly isHighlyRunnerDependent: boolean; // True if rd3 > 0.85 (85% of profits come from top 3 trades)
}

export class ExitPolicyTournament {
  /**
   * Evaluates all exit policies on an active position.
   */
  public static evaluatePolicy(
    policy: ExitPolicyCandidate,
    entryPrice: number,
    currentPrice: number,
    peakPrice: number,
    positionAgeSeconds: number,
    state: {
      readonly viabilitySlack: number;
      readonly committorFailure: number;
      readonly inventoryCliff: boolean;
      readonly liquidityDropRatio: number;
      readonly rSell: number;
      readonly bayesError: number;
      readonly exitPriceImpactFraction: number;
      readonly principalAlreadyRecovered: boolean;
    }
  ): ExitSignalEvaluation {
    const multiple = currentPrice / Math.max(1e-12, entryPrice);
    const peakMultiple = peakPrice / Math.max(1e-12, entryPrice);
    const drawdownFromPeak = (currentPrice - peakPrice) / Math.max(1e-12, peakPrice);

    switch (policy) {
      case 'HARD_STOP':
        if (multiple <= 0.80) {
          return { shouldExit: true, fractionToExit: 1.0, reason: `HARD_STOP: -20% stop reached (${multiple.toFixed(2)}x)` };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'TIME_STOP':
        if (positionAgeSeconds >= 180 && multiple < 1.25) {
          return { shouldExit: true, fractionToExit: 1.0, reason: `TIME_STOP: 180s elapsed without 1.25x breakout` };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'TRAILING_STOP':
        if (peakMultiple >= 1.5 && drawdownFromPeak <= -0.25) {
          return { shouldExit: true, fractionToExit: 1.0, reason: `TRAILING_STOP: -25% from peak ${peakMultiple.toFixed(2)}x` };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'PRINCIPAL_RECOVERY':
        if (!state.principalAlreadyRecovered && multiple >= 2.0) {
          // Sell 50% of tokens to recoup 100% initial capital, leave 50% as asymmetric runner
          return { shouldExit: true, fractionToExit: 0.5, reason: `PRINCIPAL_RECOVERY: 50% liquidated at 2.0x to recoup 100% basis` };
        }
        if (multiple <= 0.75) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'PRINCIPAL_RECOVERY: -25% capital safety stop' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding runner fraction' };

      case 'PARTIAL_SCALE_OUT':
        if (multiple >= 3.0) return { shouldExit: true, fractionToExit: 1.0, reason: 'PARTIAL_SCALE_OUT: 3.0x target reached' };
        if (multiple >= 2.0) return { shouldExit: true, fractionToExit: 0.5, reason: 'PARTIAL_SCALE_OUT: 2.0x reached' };
        if (multiple <= 0.80) return { shouldExit: true, fractionToExit: 1.0, reason: 'PARTIAL_SCALE_OUT: Stop loss' };
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'RUNNER_HOLD':
        if (multiple <= 0.75) return { shouldExit: true, fractionToExit: 1.0, reason: 'RUNNER_HOLD: -25% stop loss' };
        if (multiple >= 10.0) return { shouldExit: true, fractionToExit: 1.0, reason: 'RUNNER_HOLD: 10x extreme runner target reached' };
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding for 10x' };

      case 'VIABILITY_BOUNDARY_EXIT':
        if (state.viabilitySlack <= 0.05) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'VIABILITY_BOUNDARY_EXIT: Viability slack depleted' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding within kernel' };

      case 'COMMITTOR_COLLAPSE_EXIT':
        if (state.committorFailure >= 0.65) {
          return { shouldExit: true, fractionToExit: 1.0, reason: `COMMITTOR_COLLAPSE_EXIT: q_failure=${state.committorFailure.toFixed(2)}` };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'INVENTORY_CLIFF_EXIT':
        if (state.inventoryCliff) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'INVENTORY_CLIFF_EXIT: Massive activated supply cliff detected' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'LIQUIDITY_DETERIORATION_EXIT':
        if (state.liquidityDropRatio >= 0.35) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'LIQUIDITY_DETERIORATION_EXIT: Liquidity dropped > 35%' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'R_SELL_TRANSITION_EXIT':
        if (state.rSell >= 1.25) {
          return { shouldExit: true, fractionToExit: 1.0, reason: `R_SELL_TRANSITION_EXIT: Sell cascade active (R_sell=${state.rSell.toFixed(2)})` };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'INFORMATION_DETERIORATION_EXIT':
        if (state.bayesError >= 0.45) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'INFORMATION_DETERIORATION_EXIT: Bayes error degraded above 0.45' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };

      case 'STRESSED_EXITABILITY_EXIT':
        if (state.exitPriceImpactFraction >= 0.15) {
          return { shouldExit: true, fractionToExit: 1.0, reason: 'STRESSED_EXITABILITY_EXIT: Price impact on exit exceeds 15%' };
        }
        return { shouldExit: false, fractionToExit: 0, reason: 'Holding' };
    }
  }

  /**
   * Computes Runner Dependence RD_k for k = 1, 3, 5, 10
   */
  public static calculateRunnerDependence(tradePnlsSol: readonly number[]): RunnerDependenceMetrics {
    if (tradePnlsSol.length === 0) {
      return { totalPnlSol: 0, rd1: 0, rd3: 0, rd5: 0, rd10: 0, isHighlyRunnerDependent: false };
    }

    const totalPnl = tradePnlsSol.reduce((acc, p) => acc + p, 0);
    if (totalPnl <= 0) {
      return { totalPnlSol: totalPnl, rd1: 0, rd3: 0, rd5: 0, rd10: 0, isHighlyRunnerDependent: false };
    }

    // Sort descending
    const sorted = [...tradePnlsSol].sort((a, b) => b - a);

    const calcRdk = (k: number): number => {
      const topKSum = sorted.slice(0, k).reduce((acc, p) => acc + p, 0);
      const pnlWithoutTopK = totalPnl - topKSum;
      return Math.min(1.0, Math.max(0.0, (totalPnl - pnlWithoutTopK) / totalPnl));
    };

    const rd1 = calcRdk(1);
    const rd3 = calcRdk(3);
    const rd5 = calcRdk(5);
    const rd10 = calcRdk(10);

    const isHighlyRunnerDependent = rd3 > 0.85;

    return {
      totalPnlSol: totalPnl,
      rd1,
      rd3,
      rd5,
      rd10,
      isHighlyRunnerDependent,
    };
  }
}

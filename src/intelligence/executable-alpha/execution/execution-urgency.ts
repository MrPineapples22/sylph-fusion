/**
 * SYLPH FUSION — EXECUTION URGENCY ENGINE
 * Section XX: Execution Urgency
 *
 * Computes execution urgency level U = f(ExecutableVaR, FailureHazard, QuoteDecay, ExitReachability).
 * Urgency states: LOW, NORMAL, HIGH, EMERGENCY.
 *
 * Recommends tip and fee budgets while strictly enforcing:
 * Urgency Budget <= min(CapitalAuthority, ExecutionAuthority, EmergencyPolicyCap).
 */

export type UrgencyLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';

export interface ExecutionUrgencyReport {
  readonly urgencyLevel: UrgencyLevel;
  readonly urgencyScore: number; // [0, 1]
  readonly executableValueAtRiskUsd: number;
  readonly failureHazardPerSec: number;
  readonly recommendedFeeCapUsd: number;
  readonly recommendedTipLamports: bigint;
  readonly rationale: string;
}

export class ExecutionUrgencyEngine {
  public static calculateUrgency(params: {
    executablePositionValueUsd: number;
    failureHazardRatePerSec: number;
    quoteDecayBps: number;
    exitReachability: number;
    capitalAuthorityUsd: number;
    emergencyPolicyCapUsd?: number;
  }): ExecutionUrgencyReport {
    const {
      executablePositionValueUsd,
      failureHazardRatePerSec,
      quoteDecayBps,
      exitReachability,
      capitalAuthorityUsd,
      emergencyPolicyCapUsd = 5.0, // max $5 fee under emergency
    } = params;

    // Inverted reachability increases urgency (if reachability is collapsing, exit immediately)
    const reachabilityDeficit = Math.max(0, 1.0 - exitReachability);

    const urgencyScore = Math.min(
      1.0,
      0.35 * Math.min(1.0, executablePositionValueUsd / 250.0) +
      0.35 * Math.min(1.0, failureHazardRatePerSec * 10.0) +
      0.15 * Math.min(1.0, quoteDecayBps / 300.0) +
      0.15 * reachabilityDeficit
    );

    let level: UrgencyLevel = 'LOW';
    let rawFeeCapUsd = 0.05;
    let tipLamports = 100_000n; // 0.0001 SOL
    let rationale = 'Routine state: low risk of imminent collapse';

    if (urgencyScore > 0.80 || failureHazardRatePerSec > 0.10) {
      level = 'EMERGENCY';
      rawFeeCapUsd = 2.50;
      tipLamports = 10_000_000n; // 0.010 SOL
      rationale = 'EMERGENCY: Immediate liquidation required to prevent total capital loss';
    } else if (urgencyScore > 0.55) {
      level = 'HIGH';
      rawFeeCapUsd = 0.75;
      tipLamports = 2_000_000n; // 0.002 SOL
      rationale = 'HIGH: Elevating priority due to rising failure hazard or decaying quote';
    } else if (urgencyScore > 0.30) {
      level = 'NORMAL';
      rawFeeCapUsd = 0.20;
      tipLamports = 500_000n; // 0.0005 SOL
      rationale = 'NORMAL: Standard trade execution parameters';
    }

    // Never exceed capital authority or emergency policy cap
    const safeFeeCapUsd = Math.min(rawFeeCapUsd, capitalAuthorityUsd * 0.10, emergencyPolicyCapUsd);

    return {
      urgencyLevel: level,
      urgencyScore,
      executableValueAtRiskUsd: executablePositionValueUsd,
      failureHazardPerSec: failureHazardRatePerSec,
      recommendedFeeCapUsd: safeFeeCapUsd,
      recommendedTipLamports: tipLamports,
      rationale,
    };
  }
}

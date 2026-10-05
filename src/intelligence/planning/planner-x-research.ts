/**
 * SYLPH FUSION — PLANNER-X RESEARCH LANE & MULTI-WORLD BELIEF SIMULATION
 * Specifications: Blueprint Section 43
 * Workbook: #847 (Safe-Continuation Set), #855 (Belief-State CVaR), #863 (Tail-Scenario Preservation),
 *            #871 (Model-Exploitation Guard), #879 (Terminal-Value Conservatism)
 *
 * Status: RESEARCH_ONLY / ADVISORY
 *
 * Invariants:
 * 1. Planner-X operates strictly as research/advisory; it CANNOT grant or exercise independent execution authority.
 * 2. Generates 11 orthogonal counterfactual stress worlds for each candidate:
 *    - Liquidity collapse (-10%, -25%, -50%, -80%)
 *    - Creator exit
 *    - Whale exit
 *    - Priority-fee spike (>10x)
 *    - RPC transport degradation
 *    - Jito bundle rejection/unavailability
 *    - Route fracture
 *    - Landing delay (>5 slots)
 *    - Partial fill (<50%)
 *    - Adverse own impact
 *    - Market regime transition
 * 3. Quantifies Safe-Continuation Set size, Belief-State CVaR, minimum liquidation value, and capital recovery time.
 */

export interface CandidatePlanningContext {
  readonly candidateId: string;
  readonly tokenMint: string;
  readonly proposedNotionalLamports: bigint;
  readonly poolLiquidityLamports: bigint;
  readonly expectedReturnBps: number;
  readonly targetRegime: string;
}

export type SimulatedWorldType =
  | 'LIQUIDITY_DROP_10'
  | 'LIQUIDITY_DROP_25'
  | 'LIQUIDITY_DROP_50'
  | 'LIQUIDITY_DROP_80'
  | 'CREATOR_EXIT'
  | 'WHALE_EXIT'
  | 'PRIORITY_FEE_SPIKE'
  | 'RPC_DEGRADATION'
  | 'JITO_UNAVAILABLE'
  | 'ROUTE_FRACTURE'
  | 'LANDING_DELAY'
  | 'PARTIAL_FILL'
  | 'ADVERSE_OWN_IMPACT'
  | 'REGIME_TRANSITION';

export interface WorldSimulationOutcome {
  readonly worldType: SimulatedWorldType;
  readonly survivable: boolean;
  readonly remainingActionSetSize: number;
  readonly simulatedReturnBps: number;
  readonly recoveryTimeMs: number;
  readonly liquidationValueLamports: bigint;
  readonly notes: string;
}

export interface PlannerXAdvisoryReport {
  readonly candidateId: string;
  readonly evaluatedWorldsCount: number;
  readonly safeContinuationPct: number;
  readonly beliefStateCvarBps: number; // 95% CVaR
  readonly worstCaseReturnBps: number;
  readonly medianRecoveryTimeMs: number;
  readonly minimumLiquidationValueLamports: bigint;
  readonly isSafeToPropose: boolean;
  readonly advisoryVetoReasons: readonly string[];
  readonly worldOutcomes: readonly WorldSimulationOutcome[];
  readonly advisoryEvidenceRoot: string;
}

export class PlannerXResearchEngine {
  /**
   * Simulates the candidate across 14 orthogonal stress worlds.
   */
  public evaluateCandidate(context: CandidatePlanningContext): PlannerXAdvisoryReport {
    const outcomes: WorldSimulationOutcome[] = [];

    // 1. Liquidity drop -10%
    outcomes.push(this.simulateLiquidityShock(context, 'LIQUIDITY_DROP_10', 0.10, -30));
    // 2. Liquidity drop -25%
    outcomes.push(this.simulateLiquidityShock(context, 'LIQUIDITY_DROP_25', 0.25, -90));
    // 3. Liquidity drop -50%
    outcomes.push(this.simulateLiquidityShock(context, 'LIQUIDITY_DROP_50', 0.50, -250));
    // 4. Liquidity drop -80%
    outcomes.push(this.simulateLiquidityShock(context, 'LIQUIDITY_DROP_80', 0.80, -900));

    // 5. Creator exit
    outcomes.push({
      worldType: 'CREATOR_EXIT',
      survivable: context.poolLiquidityLamports > context.proposedNotionalLamports * 20n,
      remainingActionSetSize: 1, // Only panic exit
      simulatedReturnBps: -1500,
      recoveryTimeMs: 300_000,
      liquidationValueLamports: context.proposedNotionalLamports / 4n,
      notes: 'Creator dumped inventory; emergency exit required',
    });

    // 6. Whale exit
    outcomes.push({
      worldType: 'WHALE_EXIT',
      survivable: true,
      remainingActionSetSize: 2,
      simulatedReturnBps: -400,
      recoveryTimeMs: 60_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 80n) / 100n,
      notes: 'Large holder exited; temporary liquidity depression',
    });

    // 7. Priority fee spike (>10x)
    outcomes.push({
      worldType: 'PRIORITY_FEE_SPIKE',
      survivable: true,
      remainingActionSetSize: 3,
      simulatedReturnBps: -80,
      recoveryTimeMs: 15_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 95n) / 100n,
      notes: 'Network congestion escalated friction',
    });

    // 8. RPC degradation
    outcomes.push({
      worldType: 'RPC_DEGRADATION',
      survivable: true,
      remainingActionSetSize: 2,
      simulatedReturnBps: -50,
      recoveryTimeMs: 45_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 90n) / 100n,
      notes: 'Telemetry latency increased',
    });

    // 9. Jito unavailable
    outcomes.push({
      worldType: 'JITO_UNAVAILABLE',
      survivable: true,
      remainingActionSetSize: 2,
      simulatedReturnBps: -120,
      recoveryTimeMs: 20_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 92n) / 100n,
      notes: 'Fallback to direct TPU transport with higher landing uncertainty',
    });

    // 10. Route fracture
    outcomes.push({
      worldType: 'ROUTE_FRACTURE',
      survivable: false,
      remainingActionSetSize: 0,
      simulatedReturnBps: -3000,
      recoveryTimeMs: 600_000,
      liquidationValueLamports: 0n,
      notes: 'Route liquidity pools dismantled or paused',
    });

    // 11. Landing delay (>5 slots)
    outcomes.push({
      worldType: 'LANDING_DELAY',
      survivable: true,
      remainingActionSetSize: 3,
      simulatedReturnBps: -180,
      recoveryTimeMs: 10_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 85n) / 100n,
      notes: 'State drifted between decision and landing',
    });

    // 12. Partial fill
    outcomes.push({
      worldType: 'PARTIAL_FILL',
      survivable: true,
      remainingActionSetSize: 3,
      simulatedReturnBps: Math.round(context.expectedReturnBps * 0.4),
      recoveryTimeMs: 5000,
      liquidationValueLamports: (context.proposedNotionalLamports * 98n) / 100n,
      notes: 'Only 40% filled; remaining capital immediately unencumbered',
    });

    // 13. Adverse own impact
    outcomes.push({
      worldType: 'ADVERSE_OWN_IMPACT',
      survivable: true,
      remainingActionSetSize: 2,
      simulatedReturnBps: -110,
      recoveryTimeMs: 15_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 93n) / 100n,
      notes: 'Own order moved pool price adversarially',
    });

    // 14. Market regime transition
    outcomes.push({
      worldType: 'REGIME_TRANSITION',
      survivable: true,
      remainingActionSetSize: 2,
      simulatedReturnBps: -350,
      recoveryTimeMs: 90_000,
      liquidationValueLamports: (context.proposedNotionalLamports * 75n) / 100n,
      notes: 'Regime transitioned to elevated dispersion',
    });

    // Analytics: Safe continuation & CVaR
    const survivableCount = outcomes.filter((o) => o.survivable && o.remainingActionSetSize > 0).length;
    const safeContinuationPct = Number((survivableCount / outcomes.length).toFixed(4));

    const returns = outcomes.map((o) => o.simulatedReturnBps).sort((a, b) => a - b);
    const worstCaseReturnBps = returns[0];

    // 95% CVaR (tail loss average of the worst 2 worlds)
    const tailCount = Math.max(1, Math.floor(returns.length * 0.15));
    const tailLossSum = returns.slice(0, tailCount).reduce((sum, r) => sum + r, 0);
    const beliefStateCvarBps = Number((tailLossSum / tailCount).toFixed(2));

    const recoveryTimes = outcomes.map((o) => o.recoveryTimeMs).sort((a, b) => a - b);
    const medianRecoveryTimeMs = recoveryTimes[Math.floor(recoveryTimes.length / 2)];

    let minLiquidation = context.proposedNotionalLamports;
    for (const o of outcomes) {
      if (o.liquidationValueLamports < minLiquidation) {
        minLiquidation = o.liquidationValueLamports;
      }
    }

    const advisoryVetoReasons: string[] = [];
    if (safeContinuationPct < 0.70) {
      advisoryVetoReasons.push(`LOW_SAFE_CONTINUATION: ${Math.round(safeContinuationPct * 100)}% < 70% required`);
    }
    if (beliefStateCvarBps < -1500) {
      advisoryVetoReasons.push(`EXCESSIVE_TAIL_CVAR: ${beliefStateCvarBps} bps exceeds -1500 bps limit`);
    }

    const isSafeToPropose = advisoryVetoReasons.length === 0;

    return {
      candidateId: context.candidateId,
      evaluatedWorldsCount: outcomes.length,
      safeContinuationPct,
      beliefStateCvarBps,
      worstCaseReturnBps,
      medianRecoveryTimeMs,
      minimumLiquidationValueLamports: minLiquidation,
      isSafeToPropose,
      advisoryVetoReasons,
      worldOutcomes: outcomes,
      advisoryEvidenceRoot: `ev_planner_${context.candidateId}_${Date.now()}`,
    };
  }

  private simulateLiquidityShock(
    context: CandidatePlanningContext,
    worldType: SimulatedWorldType,
    dropFraction: number,
    baseSlippageBps: number
  ): WorldSimulationOutcome {
    const postDropLiquidity = BigInt(Math.floor(Number(context.poolLiquidityLamports) * (1 - dropFraction)));
    const survivable = postDropLiquidity > context.proposedNotionalLamports * 5n;
    const simulatedReturn = survivable ? baseSlippageBps : baseSlippageBps * 3;

    return {
      worldType,
      survivable,
      remainingActionSetSize: survivable ? 3 : 1,
      simulatedReturnBps: simulatedReturn,
      recoveryTimeMs: Math.round(dropFraction * 100_000),
      liquidationValueLamports: survivable
        ? (context.proposedNotionalLamports * BigInt(Math.floor((1 - dropFraction * 0.5) * 100))) / 100n
        : context.proposedNotionalLamports / 2n,
      notes: `Pool liquidity contracted by ${Math.round(dropFraction * 100)}%`,
    };
  }
}

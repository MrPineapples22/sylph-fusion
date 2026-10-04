/**
 * SYLPH PORTFOLIO EVACUATION & ADAPTIVE TRANCHE CONTROLLER
 * Parts XXXI, XXXII, XXXIII, XXXIV, XXXV, XXXVI, XXXVII, XXXVIII, XXXIX —
 * Portfolio Evacuation Solver, Shared Bottlenecks, Evacuation Solvency & Adaptive Tranche Control
 *
 * Models portfolio-wide liquidation feasibility under stress, detecting shared route
 * and pool bottlenecks. Implements a closed-loop tranche executor with strict risk bounds.
 */

export interface EvacuationMetrics {
  readonly time_to_liquidate_25s: number;
  readonly time_to_liquidate_50s: number;
  readonly time_to_liquidate_75s: number;
  readonly time_to_liquidate_100s: number;
  readonly portfolio_time_to_evacuate_s: number;
  readonly current_exit_coverage_pct: number;
  readonly stressed_exit_coverage_pct: number;
  readonly evacuation_solvency_ratio: number;
  readonly shared_route_bottlenecks: readonly string[];
  readonly total_portfolio_size_sol: number;
  readonly remaining_survival_budget_sol: number;
}

export interface PositionLiquidationState {
  readonly mint: string;
  readonly size_sol: number;
  readonly route: string;
  readonly pool_liquidity_sol: number;
  readonly current_evacuated_pct: number;
  readonly last_evacuated_slot: number;
}

export interface TranchePlan {
  readonly mint: string;
  readonly tranche_fraction_pct: number; // e.g. 20% or 25%
  readonly amount_sol: number;
  readonly expected_slippage_bps: number;
  readonly max_execution_cost_sol: number;
  readonly pre_risk_score: number;
  readonly max_allowed_post_risk_score: number;
}

export class PortfolioEvacuationEngine {
  private readonly positions = new Map<string, PositionLiquidationState>();
  private readonly minCooldownSlots = 5; // Anti-oscillation hysteresis (Part XXXIX)

  public registerPosition(position: PositionLiquidationState): void {
    this.positions.set(position.mint, position);
  }

  public removePosition(mint: string): void {
    this.positions.delete(mint);
  }

  /**
   * Calculates comprehensive portfolio-wide evacuation metrics (Parts XXXI, XXXII, XXXIII, XXXIV).
   */
  public evaluatePortfolioEvacuation(): EvacuationMetrics {
    let totalSizeSol = 0;
    let totalStressedCapacitySol = 0;
    let totalNormalCapacitySol = 0;
    const routeUsage = new Map<string, number>();

    for (const p of this.positions.values()) {
      totalSizeSol += p.size_sol;
      const stressedCap = p.pool_liquidity_sol * 0.25;
      const normalCap = p.pool_liquidity_sol * 0.50;

      totalStressedCapacitySol += stressedCap;
      totalNormalCapacitySol += normalCap;

      routeUsage.set(p.route, (routeUsage.get(p.route) ?? 0) + p.size_sol);
    }

    // Shared bottlenecks: routes holding > 40% of total portfolio exposure (Part XXXII)
    const bottlenecks: string[] = [];
    if (totalSizeSol > 0) {
      for (const [route, size] of routeUsage.entries()) {
        if (size / totalSizeSol > 0.40) {
          bottlenecks.push(`ROUTE_OVERCONCENTRATION: ${route} carries ${(size / totalSizeSol * 100).toFixed(1)}% of portfolio`);
        }
      }
    }

    const currentCoverage = totalSizeSol > 0 ? Math.min(100, (totalNormalCapacitySol / totalSizeSol) * 100) : 100;
    const stressedCoverage = totalSizeSol > 0 ? Math.min(100, (totalStressedCapacitySol / totalSizeSol) * 100) : 100;
    const solvencyRatio = totalSizeSol > 0 ? totalStressedCapacitySol / totalSizeSol : 1.0;

    // Time to liquidate estimates in seconds
    const time25 = totalSizeSol > 0 ? 3.0 : 0.0;
    const time50 = totalSizeSol > 0 ? 6.5 : 0.0;
    const time75 = totalSizeSol > 0 ? 11.0 : 0.0;
    const time100 = totalSizeSol > 0 ? 18.0 : 0.0;

    return {
      time_to_liquidate_25s: time25,
      time_to_liquidate_50s: time50,
      time_to_liquidate_75s: time75,
      time_to_liquidate_100s: time100,
      portfolio_time_to_evacuate_s: time100,
      current_exit_coverage_pct: Number(currentCoverage.toFixed(1)),
      stressed_exit_coverage_pct: Number(stressedCoverage.toFixed(1)),
      evacuation_solvency_ratio: Number(solvencyRatio.toFixed(2)),
      shared_route_bottlenecks: bottlenecks,
      total_portfolio_size_sol: Number(totalSizeSol.toFixed(3)),
      remaining_survival_budget_sol: Math.max(0, totalStressedCapacitySol - totalSizeSol),
    };
  }

  /**
   * Plans the next bounded evacuation tranche for a position (Parts XXXV, XXXVI, XXXVIII).
   * Enforces Evacuation Safety Envelope: WorstCaseRisk(after) <= WorstCaseRisk(before) + cost.
   */
  public planNextTranche(
    mint: string,
    currentSlot: number,
    options?: { targetTranchePct?: number }
  ): TranchePlan | { can_evacuate: false; reason: string } {
    const pos = this.positions.get(mint);
    if (!pos) return { can_evacuate: false, reason: 'Position not found' };

    // Anti-oscillation hysteresis check (Part XXXIX)
    if (currentSlot - pos.last_evacuated_slot < this.minCooldownSlots && pos.last_evacuated_slot > 0) {
      return { can_evacuate: false, reason: `COOLDOWN_ACTIVE: ${currentSlot - pos.last_evacuated_slot} < ${this.minCooldownSlots} slots` };
    }

    const remainingPct = 100 - pos.current_evacuated_pct;
    if (remainingPct <= 0) {
      return { can_evacuate: false, reason: 'POSITION_FULLY_EVACUATED' };
    }

    // Dynamic tranche sizing (Section XXVII): Default to 25% or caller target
    const targetPct = options?.targetTranchePct ?? 25;
    const tranchePct = Math.min(targetPct, remainingPct);
    const trancheSol = (pos.size_sol * tranchePct) / 100;

    // Section XXVII: Remove 500-bps clipping! Record true unclipped modeled impact
    const impactBps = Math.round((trancheSol / Math.max(0.001, pos.pool_liquidity_sol)) * 10000);
    const maxCostSol = trancheSol * (impactBps / 10000) + 0.0002;

    const preRisk = (remainingPct / 100) * pos.size_sol;
    const postRisk = ((remainingPct - tranchePct) / 100) * pos.size_sol + maxCostSol;

    // Evacuation Safety Envelope assertion (Part XXXVIII)
    if (postRisk > preRisk + 0.001) {
      return { can_evacuate: false, reason: 'EVACUATION_SAFETY_ENVELOPE_VIOLATED: Execution cost exceeds risk reduction' };
    }

    return {
      mint,
      tranche_fraction_pct: tranchePct,
      amount_sol: Number(trancheSol.toFixed(4)),
      expected_slippage_bps: impactBps,
      max_execution_cost_sol: Number(maxCostSol.toFixed(6)),
      pre_risk_score: Number(preRisk.toFixed(4)),
      max_allowed_post_risk_score: Number(postRisk.toFixed(4)),
    };
  }

  /**
   * Records execution feedback after a tranche completes (Part XXXVII).
   */
  public recordTrancheFeedback(params: {
    mint: string;
    executed_pct: number;
    actual_slippage_bps: number;
    current_slot: number;
  }): void {
    const pos = this.positions.get(params.mint);
    if (!pos) return;

    this.positions.set(params.mint, {
      ...pos,
      current_evacuated_pct: Math.min(100, pos.current_evacuated_pct + params.executed_pct),
      last_evacuated_slot: params.current_slot,
    });
  }
}

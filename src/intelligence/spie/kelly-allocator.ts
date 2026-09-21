/**
 * SOL-SYLPH Platform - Constrained Fractional Kelly Allocator
 * Specifications: Master Quantitative Upgrade (Phases 7, 8, & 14).
 *
 * Computes optimal position sizing using half-Kelly adjusted for:
 * 1. Bonding curve liquidity capacity (Max 5% of real pool reserves)
 * 2. RiskAuthority mandate limits (Single-token hard ceiling)
 * 3. Market regime multipliers (Trending vs Choppy vs High-Rug)
 * 4. High-water mark drawdown throttling
 * 5. Epistemic model uncertainty
 */

export type MarketRegimeType =
  | 'SPECULATIVE_EXPANSION'
  | 'TRENDING'
  | 'NEUTRAL'
  | 'CHOPPY'
  | 'LOW_LIQ'
  | 'HIGH_RUG'
  | 'DEGRADED';

export type SizingBindingConstraint =
  | 'KELLY_MATH'
  | 'LIQUIDITY_CAP'
  | 'MANDATE_CEILING'
  | 'DRAWDOWN_THROTTLE'
  | 'RISK_FREEZE';

export interface KellyInput {
  readonly pTarget: number;                    // Win probability (0.0 to 1.0)
  readonly targetUpsideBps: number;            // Expected upside in BPS (e.g. 4000 = +40%)
  readonly structuralStopBps: number;          // Modeled downside in BPS (e.g. 1200 = -12%)
  readonly poolReserveSol: number;             // Real SOL reserves in curve
  readonly totalPortfolioCapitalSol: number;   // Total deployable portfolio capital
  readonly mandateLimitSol: number;            // Hard ceiling from RiskAuthority (e.g. 2.0 SOL)
  readonly regime: MarketRegimeType;
  readonly epistemicUncertainty: number;       // 0.0 (certain) to 1.0 (uncertain)
  readonly currentDrawdownPct?: number;        // e.g. 0.05 = 5% drawdown
}

export interface KellyAllocationResult {
  readonly recommendedAllocationSol: number;
  readonly unconstrainedKellyFraction: number;
  readonly halfKellyFraction: number;
  readonly rawKellySol: number;
  readonly regimeMultiplier: number;
  readonly drawdownMultiplier: number;
  readonly uncertaintyMultiplier: number;
  readonly liquidityCapSol: number;
  readonly bindingConstraint: SizingBindingConstraint;
  readonly rationale: string;
}

export class KellyAllocator {
  private readonly maxPoolSharePct = 0.05; // Never exceed 5% of pool reserve (exitability invariant)
  private readonly minAllocationFloorSol = 0.05;

  public calculateAllocation(input: KellyInput): KellyAllocationResult {
    // 1. Check for immediate zero conditions
    if (input.regime === 'DEGRADED') {
      return this.zeroResult(input, 'RISK_FREEZE', 'System in DEGRADED regime: all new capital frozen');
    }

    if (input.poolReserveSol < 1.0) {
      return this.zeroResult(input, 'LIQUIDITY_CAP', 'Real reserves < 1.0 SOL floor');
    }

    const p = Math.max(0.01, Math.min(0.99, input.pTarget));
    const q = 1 - p;
    const upside = Math.max(100, input.targetUpsideBps);
    const downside = Math.max(100, input.structuralStopBps);

    // Payoff ratio b = Target Return / Stop Loss
    const b = upside / downside;

    // Unconstrained Kelly: f* = (b * p - q) / b
    const unconstrainedKelly = (b * p - q) / b;

    if (unconstrainedKelly <= 0) {
      return this.zeroResult(input, 'KELLY_MATH', `Kelly fraction non-positive (${unconstrainedKelly.toFixed(4)}): expected edge is negative`);
    }

    // Conservative Half-Kelly
    const halfKelly = unconstrainedKelly * 0.5;

    // 2. Regime Scaling Multiplier
    let regimeMultiplier = 1.0;
    switch (input.regime) {
      case 'SPECULATIVE_EXPANSION':
        regimeMultiplier = 1.0;
        break;
      case 'TRENDING':
        regimeMultiplier = 0.9;
        break;
      case 'NEUTRAL':
        regimeMultiplier = 0.7;
        break;
      case 'CHOPPY':
        regimeMultiplier = 0.4;
        break;
      case 'LOW_LIQ':
        regimeMultiplier = 0.3;
        break;
      case 'HIGH_RUG':
        regimeMultiplier = 0.25;
        break;
      default:
        regimeMultiplier = 0.5;
    }

    // 3. Drawdown Throttling
    // If in 10% drawdown, scale down by 50%. If in 20% drawdown, scale down to 10%.
    const dd = Math.max(0, input.currentDrawdownPct ?? 0);
    const drawdownMultiplier = Math.max(0.1, Number((1 - dd * 4.5).toFixed(2)));

    // 4. Uncertainty Discount
    const uncertainty = Math.max(0, Math.min(1, input.epistemicUncertainty));
    const uncertaintyMultiplier = Math.max(0.2, Number((1 - uncertainty * 0.6).toFixed(2)));

    // 5. Raw Scaled Kelly Amount
    const effectiveFraction = halfKelly * regimeMultiplier * drawdownMultiplier * uncertaintyMultiplier;
    const rawKellySol = effectiveFraction * input.totalPortfolioCapitalSol;

    // 6. Hard Capacity Limits
    // Liquidity capacity: Max 5% of real curve reserves
    const liquidityCapSol = Number((input.poolReserveSol * this.maxPoolSharePct).toFixed(4));
    const mandateCapSol = input.mandateLimitSol;

    // 7. Apply Invariants (Minimum Bound)
    let finalSol = rawKellySol;
    let bindingConstraint: SizingBindingConstraint = 'KELLY_MATH';

    if (finalSol > liquidityCapSol) {
      finalSol = liquidityCapSol;
      bindingConstraint = 'LIQUIDITY_CAP';
    }

    if (finalSol > mandateCapSol) {
      finalSol = mandateCapSol;
      bindingConstraint = 'MANDATE_CEILING';
    }

    if (drawdownMultiplier < 0.5 && bindingConstraint === 'KELLY_MATH') {
      bindingConstraint = 'DRAWDOWN_THROTTLE';
    }

    // Round to 3 decimal places
    finalSol = Math.max(0, Number(finalSol.toFixed(3)));

    if (finalSol < this.minAllocationFloorSol) {
      return this.zeroResult(input, bindingConstraint, `Computed size (${finalSol} SOL) below ${this.minAllocationFloorSol} SOL minimum floor`);
    }

    const rationale = `Sized at ${finalSol} SOL via Half-Kelly (${(halfKelly * 100).toFixed(1)}%), ` +
      `scaled by regime ${input.regime} (${(regimeMultiplier * 100).toFixed(0)}%) & uncertainty (${(uncertaintyMultiplier * 100).toFixed(0)}%). ` +
      `Constrained by ${bindingConstraint}.`;

    return {
      recommendedAllocationSol: finalSol,
      unconstrainedKellyFraction: Number(unconstrainedKelly.toFixed(4)),
      halfKellyFraction: Number(halfKelly.toFixed(4)),
      rawKellySol: Number(rawKellySol.toFixed(4)),
      regimeMultiplier,
      drawdownMultiplier,
      uncertaintyMultiplier,
      liquidityCapSol,
      bindingConstraint,
      rationale,
    };
  }

  private zeroResult(input: KellyInput, constraint: SizingBindingConstraint, rationale: string): KellyAllocationResult {
    return {
      recommendedAllocationSol: 0,
      unconstrainedKellyFraction: 0,
      halfKellyFraction: 0,
      rawKellySol: 0,
      regimeMultiplier: 0,
      drawdownMultiplier: 0,
      uncertaintyMultiplier: 0,
      liquidityCapSol: Number((input.poolReserveSol * this.maxPoolSharePct).toFixed(4)),
      bindingConstraint: constraint,
      rationale,
    };
  }
}

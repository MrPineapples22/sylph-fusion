/**
 * PROMETHEUS: Portfolio Capital Intelligence Engine
 * Blueprint Engine #26
 * 
 * Manages capital allocation across the global opportunity set:
 * Enforces:
 * - Max portfolio exposure (SOL)
 * - Per-token exposure caps
 * - Shared wallet-cluster exposure limits
 * - Liquidity-adjusted and exitability-adjusted sizing
 * - Emergency unencumbered SOL cash reserve
 * Invariant: Zero allocation is a valid and frequent decision.
 */

export interface PortfolioRiskState {
  readonly total_portfolio_value_sol: number;
  readonly unencumbered_cash_sol: number;
  readonly current_exposure_sol: number;
  readonly max_allowable_exposure_sol: number;
  readonly emergency_reserve_sol: number;     // Cash that cannot be touched
  readonly max_single_token_sol: number;
  readonly max_concurrent_positions: number;
  readonly active_positions_count: number;
}

export interface PrometheusSizingRequest {
  readonly token_mint: string;
  readonly cluster_id?: string;
  readonly pool_liquidity_sol: number;
  readonly exitability_factor: number;       // 0.0 to 1.0
  readonly confidence_score: number;         // 0.0 to 1.0
  readonly existing_cluster_exposure_sol: number;
}

export interface PrometheusSizingDecision {
  readonly token_mint: string;
  readonly allocated_size_sol: number;
  readonly is_zero_allocation: boolean;
  readonly limiting_constraint: string;
  readonly post_exposure_sol: number;
  readonly evaluated_at_ms: number;
}

export class PrometheusPortfolioCapitalEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Computes the strictly risk-bounded allocation size for an opportunity.
   */
  public static allocateCapital(
    request: PrometheusSizingRequest,
    portfolio: PortfolioRiskState
  ): PrometheusSizingDecision {
    // Check 1: Concurrent positions cap
    if (portfolio.active_positions_count >= portfolio.max_concurrent_positions) {
      return {
        token_mint: request.token_mint,
        allocated_size_sol: 0,
        is_zero_allocation: true,
        limiting_constraint: `Concurrent positions cap reached (${portfolio.active_positions_count}/${portfolio.max_concurrent_positions})`,
        post_exposure_sol: portfolio.current_exposure_sol,
        evaluated_at_ms: Date.now()
      };
    }

    // Check 2: Emergency cash reserve buffer
    const spendableCash = Math.max(0, portfolio.unencumbered_cash_sol - portfolio.emergency_reserve_sol);
    if (spendableCash <= 0.1) {
      return {
        token_mint: request.token_mint,
        allocated_size_sol: 0,
        is_zero_allocation: true,
        limiting_constraint: 'Emergency SOL reserve reached. Zero unallocated risk capital.',
        post_exposure_sol: portfolio.current_exposure_sol,
        evaluated_at_ms: Date.now()
      };
    }

    // Check 3: Portfolio exposure ceiling
    const remainingPortfolioCapacity = Math.max(0, portfolio.max_allowable_exposure_sol - portfolio.current_exposure_sol);
    if (remainingPortfolioCapacity <= 0.1) {
      return {
        token_mint: request.token_mint,
        allocated_size_sol: 0,
        is_zero_allocation: true,
        limiting_constraint: 'Max portfolio exposure ceiling reached.',
        post_exposure_sol: portfolio.current_exposure_sol,
        evaluated_at_ms: Date.now()
      };
    }

    // Liquidity constraint: Never take more than 2% of pool liquidity to guarantee clean exit
    const maxFromLiquidity = request.pool_liquidity_sol * 0.02;

    // Cluster constraint: Max 2.5 SOL in any single wallet cluster
    const maxClusterSol = 2.5;
    const remainingClusterCapacity = Math.max(0, maxClusterSol - request.existing_cluster_exposure_sol);

    // Compute raw optimal size scaled by confidence and exitability
    let proposedSize = portfolio.max_single_token_sol * request.confidence_score * request.exitability_factor;

    // Apply all constraints
    let limiting = 'Confidence-scaled target allocation';
    if (proposedSize > spendableCash) {
      proposedSize = spendableCash;
      limiting = 'Spendable cash buffer constraint';
    }
    if (proposedSize > remainingPortfolioCapacity) {
      proposedSize = remainingPortfolioCapacity;
      limiting = 'Remaining portfolio capacity';
    }
    if (proposedSize > maxFromLiquidity) {
      proposedSize = maxFromLiquidity;
      limiting = 'Pool liquidity 2% exit constraint';
    }
    if (proposedSize > remainingClusterCapacity) {
      proposedSize = remainingClusterCapacity;
      limiting = 'Shared wallet cluster concentration cap';
    }

    // Min viable size threshold: 0.1 SOL
    if (proposedSize < 0.1) {
      return {
        token_mint: request.token_mint,
        allocated_size_sol: 0,
        is_zero_allocation: true,
        limiting_constraint: `Calculated size (${proposedSize.toFixed(3)} SOL) below minimum threshold 0.1 SOL`,
        post_exposure_sol: portfolio.current_exposure_sol,
        evaluated_at_ms: Date.now()
      };
    }

    const finalSize = Number(proposedSize.toFixed(3));

    return {
      token_mint: request.token_mint,
      allocated_size_sol: finalSize,
      is_zero_allocation: false,
      limiting_constraint: limiting,
      post_exposure_sol: Number((portfolio.current_exposure_sol + finalSize).toFixed(3)),
      evaluated_at_ms: Date.now()
    };
  }
}

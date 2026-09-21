/**
 * COPERNICUS: Hierarchical Market Context Engine
 * Blueprint Engine #6
 * 
 * Maintains a 7-tier contextual hierarchy:
 * GLOBAL RISK -> CRYPTO -> SOLANA -> SOL MEMES -> PLATFORM -> COHORT -> TOKEN.
 * Decomposes price movement into macro market beta vs token-specific idiosyncratic alpha.
 */

export type CopernicusMarketRegime = 
  | 'RISK_ON_EXPANSION'
  | 'SELECTIVE_ROTATION'
  | 'CHOP_CONSOLIDATION'
  | 'LIQUIDITY_DRAIN'
  | 'MEME_MANIA'
  | 'SYSTEMIC_CASCADE';

export interface CopernicusHierarchyState {
  readonly global_risk_score: number;      // 0.0 (safe) to 1.0 (extreme risk)
  readonly sol_regime: CopernicusMarketRegime;
  readonly sol_price_usd: number;
  readonly sol_1h_change_pct: number;
  readonly meme_breadth_ratio: number;     // % of launched tokens holding green
  readonly platform_congestion_score: number;
  readonly active_cohort_survival_rate: number;
  readonly evaluated_at_ms: number;
}

export interface CopernicusTokenDecomposition {
  readonly token_mint: string;
  readonly total_return_pct: number;
  readonly market_beta_component: number;  // Component explained by SOL/meme broad movement
  readonly idiosyncratic_alpha: number;   // True token-specific movement
  readonly sol_correlation: number;
  readonly regime_alignment: 'ALIGNED' | 'DIVERGENT' | 'CONTRARIAN';
}

export class CopernicusHierarchicalContextEngine {
  public static readonly VERSION = '1.0.0';
  private currentState: CopernicusHierarchyState;

  constructor() {
    this.currentState = {
      global_risk_score: 0.25,
      sol_regime: 'SELECTIVE_ROTATION',
      sol_price_usd: 150.0,
      sol_1h_change_pct: 0.8,
      meme_breadth_ratio: 0.22,
      platform_congestion_score: 0.15,
      active_cohort_survival_rate: 0.08,
      evaluated_at_ms: Date.now()
    };
  }

  public updateContext(state: Partial<CopernicusHierarchyState>): void {
    this.currentState = {
      ...this.currentState,
      ...state,
      evaluated_at_ms: Date.now()
    };
  }

  public getHierarchyState(): CopernicusHierarchyState {
    return { ...this.currentState };
  }

  /**
   * Decomposes a token's price performance into broad market beta vs true token alpha.
   */
  public decomposeTokenMovement(
    tokenMint: string,
    tokenReturnPct: number,
    solBeta: number = 1.2
  ): CopernicusTokenDecomposition {
    const marketReturn = this.currentState.sol_1h_change_pct;
    const betaComponent = marketReturn * solBeta;
    const alphaComponent = tokenReturnPct - betaComponent;

    let alignment: 'ALIGNED' | 'DIVERGENT' | 'CONTRARIAN' = 'ALIGNED';
    if (marketReturn * tokenReturnPct < 0) {
      alignment = 'CONTRARIAN';
    } else if (Math.abs(alphaComponent) > Math.abs(betaComponent) * 2) {
      alignment = 'DIVERGENT';
    }

    return {
      token_mint: tokenMint,
      total_return_pct: tokenReturnPct,
      market_beta_component: Number(betaComponent.toFixed(2)),
      idiosyncratic_alpha: Number(alphaComponent.toFixed(2)),
      sol_correlation: Math.min(1.0, Math.max(-1.0, 0.4 + (marketReturn === 0 ? 0 : (betaComponent / (tokenReturnPct || 1)) * 0.3))),
      regime_alignment: alignment
    };
  }
}

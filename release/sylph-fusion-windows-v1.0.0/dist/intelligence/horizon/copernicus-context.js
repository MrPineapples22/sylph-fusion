/**
 * COPERNICUS: Hierarchical Market Context Engine
 * Blueprint Engine #6
 *
 * Maintains a 7-tier contextual hierarchy:
 * GLOBAL RISK -> CRYPTO -> SOLANA -> SOL MEMES -> PLATFORM -> COHORT -> TOKEN.
 * Decomposes price movement into macro market beta vs token-specific idiosyncratic alpha.
 */
export class CopernicusHierarchicalContextEngine {
    static VERSION = '1.0.0';
    currentState;
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
    updateContext(state) {
        this.currentState = {
            ...this.currentState,
            ...state,
            evaluated_at_ms: Date.now()
        };
    }
    getHierarchyState() {
        return { ...this.currentState };
    }
    /**
     * Decomposes a token's price performance into broad market beta vs true token alpha.
     */
    decomposeTokenMovement(tokenMint, tokenReturnPct, solBeta = 1.2) {
        const marketReturn = this.currentState.sol_1h_change_pct;
        const betaComponent = marketReturn * solBeta;
        const alphaComponent = tokenReturnPct - betaComponent;
        let alignment = 'ALIGNED';
        if (marketReturn * tokenReturnPct < 0) {
            alignment = 'CONTRARIAN';
        }
        else if (Math.abs(alphaComponent) > Math.abs(betaComponent) * 2) {
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
//# sourceMappingURL=copernicus-context.js.map
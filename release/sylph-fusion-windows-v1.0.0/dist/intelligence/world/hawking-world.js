/**
 * HAWKING: Probabilistic World Model & Digital Twin Engine
 * Blueprint Engine #18
 *
 * Simulates future scenario distributions rather than producing a single point forecast.
 * Scenarios: ORGANIC_GROWTH | FOMO_SPIKE | WHALE_EXIT | LIQUIDITY_DRAIN | CONGESTION_STALL.
 * Calculates realistic position-sized exitability based on bonding curve/AMM depth.
 */
export class HawkingTokenDigitalTwinEngine {
    static VERSION = '1.0.0';
    /**
     * Simulates multi-path scenario distributions for a given position size.
     */
    static simulateScenarios(params) {
        const liq = Math.max(0.1, params.liquidity_sol);
        const pos = params.position_size_sol;
        // Realistic exitability: Slippage approx = (position_size / liquidity) * 100%
        const expectedImpactPct = (pos / liq) * 100;
        const exitability = Math.max(0.0, Math.min(1.0, 1.0 - (expectedImpactPct / 25))); // 25% impact = 0 exitability
        // Scenario probabilities derived from POD and buy pressure
        const pod = params.pod_score;
        const pWhaleExit = Math.min(0.70, (params.whale_holding_sol / liq) * 0.5 + pod * 0.4);
        const pFomo = Math.min(0.50, Math.max(0.05, params.buy_pressure * 0.6 * (1 - pod)));
        const pOrganic = Math.min(0.60, Math.max(0.10, 0.50 - pWhaleExit * 0.5));
        const pDrain = Math.min(0.30, pod * 0.5);
        const pCongest = 0.05;
        // Normalize probabilities to sum to 1.0
        const totalP = pWhaleExit + pFomo + pOrganic + pDrain + pCongest;
        const norm = (p) => Number((p / totalP).toFixed(3));
        const scenarios = [
            {
                scenario: 'ORGANIC_GROWTH',
                probability: norm(pOrganic),
                projected_pnl_pct: +15.0,
                max_drawdown_pct: -6.0,
                exitability_pct: Math.min(1.0, exitability * 1.0),
                horizon_seconds: 180
            },
            {
                scenario: 'FOMO_SPIKE',
                probability: norm(pFomo),
                projected_pnl_pct: +45.0,
                max_drawdown_pct: -12.0,
                exitability_pct: Math.min(1.0, exitability * 0.85),
                horizon_seconds: 120
            },
            {
                scenario: 'WHALE_EXIT',
                probability: norm(pWhaleExit),
                projected_pnl_pct: -35.0,
                max_drawdown_pct: -50.0,
                exitability_pct: Math.min(1.0, exitability * 0.35),
                horizon_seconds: 60
            },
            {
                scenario: 'LIQUIDITY_DRAIN',
                probability: norm(pDrain),
                projected_pnl_pct: -60.0,
                max_drawdown_pct: -80.0,
                exitability_pct: Math.min(1.0, exitability * 0.10),
                horizon_seconds: 60
            },
            {
                scenario: 'CONGESTION_STALL',
                probability: norm(pCongest),
                projected_pnl_pct: -2.0,
                max_drawdown_pct: -8.0,
                exitability_pct: Math.min(1.0, exitability * 0.50),
                horizon_seconds: 300
            }
        ];
        // Compute expected value of PnL
        const evPnl = scenarios.reduce((acc, s) => acc + s.probability * s.projected_pnl_pct, 0);
        // Worst tail risk drawdown
        const tailRisk = Math.min(...scenarios.map(s => s.max_drawdown_pct));
        return {
            token_mint: params.token_mint,
            scenario_distribution: scenarios,
            expected_value_pnl_pct: Number(evPnl.toFixed(2)),
            tail_risk_drawdown_pct: tailRisk,
            exitability_for_position_sol: Number(exitability.toFixed(3)),
            simulation_confidence: 0.82,
            evaluated_at_ms: Date.now()
        };
    }
}
//# sourceMappingURL=hawking-world.js.map
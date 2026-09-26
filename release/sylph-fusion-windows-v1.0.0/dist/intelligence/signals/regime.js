/**
 * SOL-SYLPH Master Production Intelligence - Hierarchical Market Regimes
 * Specifications: Section 21 (Hierarchical Market Regimes).
 */
export class HierarchicalRegimeEngine {
    evaluate(metrics) {
        // 1. Abnormal Conditions
        if (metrics.rpcDropRatePct >= 5.0) {
            return {
                majorRegime: 'ABNORMAL',
                subRegime: 'NETWORK_STRESS',
                riskMultiplier: 0.2,
                description: 'Network congestion and elevated RPC drop rate',
            };
        }
        if (metrics.manipulationPrevalencePct >= 40.0) {
            return {
                majorRegime: 'ABNORMAL',
                subRegime: 'MANIPULATION_SURGE',
                riskMultiplier: 0.3,
                description: 'High concentration of bundled/wash launches',
            };
        }
        // 2. Risk-Off Conditions
        if (metrics.solReturn24hPct <= -8.0 || metrics.runnerRatePct < 2.0) {
            const sub = metrics.solReturn24hPct <= -15.0 ? 'CAPITULATION' : 'CONTRACTION';
            return {
                majorRegime: 'RISK_OFF',
                subRegime: sub,
                riskMultiplier: 0.4,
                description: 'Meme market liquidity contraction and adverse SOL trend',
            };
        }
        // 3. Risk-On Conditions
        if (metrics.solReturn24hPct >= 5.0 && metrics.runnerRatePct >= 8.0) {
            const sub = metrics.runnerRatePct >= 15.0 ? 'EUPHORIC' : 'BROAD_EXPANSION';
            return {
                majorRegime: 'RISK_ON',
                subRegime: sub,
                riskMultiplier: 1.0,
                description: 'High runner conversion rate and positive capital inflow',
            };
        }
        // 4. Neutral / Selective
        return {
            majorRegime: 'NEUTRAL',
            subRegime: 'SELECTIVE',
            riskMultiplier: 0.75,
            description: 'Selective market conditions; discipline required on sizing',
        };
    }
}
//# sourceMappingURL=regime.js.map
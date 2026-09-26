/**
 * CURIE: Uncertainty Decomposition Engine
 * Blueprint Engine #17
 *
 * Decomposes multi-dimensional uncertainty across 8 orthogonal vectors:
 * DATA | MODEL | MARKET | AGENT | REGIME | EXECUTION | STRUCTURAL | NOVELTY.
 * Separates into:
 * - EPISTEMIC (reducible through active investigation / Tesla)
 * - ALEATORIC (irreducible market noise)
 * - DISTRIBUTIONAL (out-of-distribution regime divergence).
 */
export class CurieUncertaintyEngine {
    static VERSION = '1.0.0';
    /**
     * Decomposes system uncertainty across the 8 canonical dimensions.
     */
    static decompose(tokenMint, inputs) {
        // 1. DATA: Epistemic (stale feeds can be refreshed)
        const dataScore = Math.min(1.0, inputs.data_age_ms / 30000);
        // 2. MODEL: Epistemic & Distributional
        const modelScore = Math.min(1.0, inputs.model_ood_score);
        // 3. MARKET: Aleatoric (spread and microstructure randomness)
        const marketScore = Math.min(1.0, inputs.orderbook_spread_bps / 500);
        // 4. AGENT: Epistemic (can be reduced by Newton graph investigation)
        const agentScore = Math.min(1.0, inputs.counterparty_unknown_share);
        // 5. REGIME: Distributional
        const regimeScore = Math.min(1.0, inputs.regime_entropy);
        // 6. EXECUTION: Aleatoric (network latency & block landing jitter)
        const execScore = Math.min(1.0, inputs.rpc_latency_ms / 1500);
        // 7. STRUCTURAL: Epistemic (on-chain audits can verify)
        const structScore = Math.min(1.0, inputs.noether_anomalies_count * 0.25);
        // 8. NOVELTY: Distributional / Epistemic (brand new token has minimal history)
        const noveltyScore = inputs.token_age_minutes < 5 ? 0.9 : Math.max(0.1, 1.0 - (inputs.token_age_minutes / 60));
        const dimensions = [
            { name: 'DATA', category: 'EPISTEMIC', uncertainty_score: dataScore, primary_contributor: 'Feed age', is_reducible_by_investigation: true },
            { name: 'MODEL', category: 'DISTRIBUTIONAL', uncertainty_score: modelScore, primary_contributor: 'Model OOD distance', is_reducible_by_investigation: false },
            { name: 'MARKET', category: 'ALEATORIC', uncertainty_score: marketScore, primary_contributor: 'Orderbook spread volatility', is_reducible_by_investigation: false },
            { name: 'AGENT', category: 'EPISTEMIC', uncertainty_score: agentScore, primary_contributor: 'Unidentified wallet clusters', is_reducible_by_investigation: true },
            { name: 'REGIME', category: 'DISTRIBUTIONAL', uncertainty_score: regimeScore, primary_contributor: 'Market macro transition', is_reducible_by_investigation: false },
            { name: 'EXECUTION', category: 'ALEATORIC', uncertainty_score: execScore, primary_contributor: 'RPC jitter & congestion', is_reducible_by_investigation: false },
            { name: 'STRUCTURAL', category: 'EPISTEMIC', uncertainty_score: structScore, primary_contributor: 'Unverified pool invariants', is_reducible_by_investigation: true },
            { name: 'NOVELTY', category: 'DISTRIBUTIONAL', uncertainty_score: noveltyScore, primary_contributor: 'Short launch track record', is_reducible_by_investigation: true }
        ];
        const epistemicList = dimensions.filter(d => d.category === 'EPISTEMIC');
        const aleatoricList = dimensions.filter(d => d.category === 'ALEATORIC');
        const distributionalList = dimensions.filter(d => d.category === 'DISTRIBUTIONAL');
        const epistemicAvg = epistemicList.reduce((acc, d) => acc + d.uncertainty_score, 0) / epistemicList.length;
        const aleatoricAvg = aleatoricList.reduce((acc, d) => acc + d.uncertainty_score, 0) / aleatoricList.length;
        const distributionalAvg = distributionalList.reduce((acc, d) => acc + d.uncertainty_score, 0) / distributionalList.length;
        const composite = Number((epistemicAvg * 0.45 + aleatoricAvg * 0.25 + distributionalAvg * 0.30).toFixed(3));
        const confidenceCeiling = Number(Math.max(0.05, 1.0 - composite).toFixed(3));
        // Find highest reducible gap to route to Tesla
        const reducibleGaps = dimensions.filter(d => d.is_reducible_by_investigation).sort((a, b) => b.uncertainty_score - a.uncertainty_score);
        const topGap = reducibleGaps.length > 0 ? `${reducibleGaps[0].name} (${reducibleGaps[0].primary_contributor})` : undefined;
        return {
            token_mint: tokenMint,
            dimensions,
            total_epistemic_uncertainty: Number(epistemicAvg.toFixed(3)),
            total_aleatoric_uncertainty: Number(aleatoricAvg.toFixed(3)),
            total_distributional_uncertainty: Number(distributionalAvg.toFixed(3)),
            composite_uncertainty: composite,
            confidence_ceiling: confidenceCeiling,
            highest_reducible_gap: topGap,
            evaluated_at_ms: Date.now()
        };
    }
}
//# sourceMappingURL=curie-uncertainty.js.map
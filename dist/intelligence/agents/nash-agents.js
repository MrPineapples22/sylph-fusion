/**
 * NASH: Multi-Agent Strategy & Intent Engine
 * Blueprint Engine #13
 *
 * Models strategic counterparties:
 * Creators, Insiders, Whales, KOLs, Snipers, Bots, MEV, Retail, LPs.
 * Behavioral States:
 * UNKNOWN | OBSERVING | ACCUMULATING | HOLDING | DISTRIBUTING | EXITING | ROTATING | DORMANT.
 * Invariant: Never represent inferred intent as known fact (always probabilistic hypotheses).
 */
export class NashMultiAgentIntentEngine {
    static VERSION = '1.0.0';
    /**
     * Evaluates counterparty intentions across prominent token actors.
     */
    static evaluateMarketIntents(tokenMint, actors) {
        const hypotheses = [];
        let insiderRisk = 0;
        let mevCount = 0;
        let totalWhaleNetFlow = 0;
        for (const actor of actors) {
            let dominant = 'UNKNOWN';
            let alt = 'HOLDING';
            let prob = 0.5;
            const signals = [];
            if (actor.role === 'MEV_BOT') {
                mevCount++;
            }
            if (actor.net_sell_sol_1h > actor.current_balance_sol * 0.5) {
                dominant = 'EXITING';
                alt = 'DISTRIBUTING';
                prob = 0.85;
                signals.push('Aggressive sell-off >50% position in 1h');
                if (actor.role === 'CREATOR' || actor.role === 'INSIDER') {
                    insiderRisk += 40;
                }
            }
            else if (actor.net_sell_sol_1h > 0 && actor.net_buy_sol_1h === 0) {
                dominant = 'DISTRIBUTING';
                alt = 'EXITING';
                prob = 0.70;
                signals.push('Systematic sell orders without re-entry');
                if (actor.role === 'CREATOR')
                    insiderRisk += 25;
            }
            else if (actor.net_buy_sol_1h > 5) {
                dominant = 'ACCUMULATING';
                alt = 'HOLDING';
                prob = 0.75;
                signals.push('Positive net inflow >5 SOL');
                if (actor.role === 'WHALE')
                    totalWhaleNetFlow += actor.net_buy_sol_1h;
            }
            else if (actor.tx_count > 0) {
                dominant = 'HOLDING';
                alt = 'OBSERVING';
                prob = 0.60;
                signals.push('Position maintained with low turnover');
            }
            else {
                dominant = 'DORMANT';
                alt = 'UNKNOWN';
                prob = 0.80;
                signals.push('No activity in evaluation window');
            }
            hypotheses.push({
                actor_address: actor.address,
                inferred_role: actor.role,
                dominant_intent: dominant,
                intent_probability: prob,
                alternative_intent: alt,
                holding_sol_value: actor.current_balance_sol,
                evidence_signals: signals
            });
        }
        let aggWhaleIntent = 'HOLDING';
        if (totalWhaleNetFlow > 10)
            aggWhaleIntent = 'ACCUMULATING';
        else if (totalWhaleNetFlow < -10)
            aggWhaleIntent = 'DISTRIBUTING';
        return {
            token_mint: tokenMint,
            actor_hypotheses: hypotheses,
            aggregate_whale_intent: aggWhaleIntent,
            insider_dump_risk_score: Math.min(100, insiderRisk),
            predatory_mev_intensity: Math.min(1.0, mevCount * 0.25),
            evaluated_at_ms: Date.now()
        };
    }
}
//# sourceMappingURL=nash-agents.js.map
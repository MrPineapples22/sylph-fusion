/**
 * SOL-SYLPH PEARL — Causal Identification, Natural Experiments & Self-Impact Tracking
 * Part X — Causal Questions, Identifiability, Confounders vs Colliders & Self-Caused Evidence
 */
export class PearlCausalEngine {
    selfCausedEvents = new Set();
    /**
     * Evaluate causal identifiability of a market question.
     */
    evaluateIdentifiability(params) {
        let state = 'IDENTIFIED';
        const assumptions = ['No unobserved confounders (Exchangeability)', 'Positivity across treatment levels'];
        if (params.has_collider_conditioning) {
            state = 'NOT_IDENTIFIABLE';
            assumptions.push('Conditioning on collider introduces Berkson/selection bias');
        }
        else if (params.has_unobserved_confounder) {
            state = 'ASSUMPTION_SENSITIVE';
            assumptions.push('Causal interpretation strictly sensitive to unobserved insider coordination');
        }
        else if (params.confounders.length > 5) {
            state = 'PARTIALLY_IDENTIFIED';
        }
        else if (params.confounders.length > 0) {
            state = 'PLAUSIBLY_IDENTIFIED';
            assumptions.push('Confounders partially addressed via backdoor adjustment');
        }
        return {
            question_id: `cq_${params.treatment}_to_${params.outcome}`,
            treatment: params.treatment,
            outcome: params.outcome,
            population: 'Solana Meme Token Micro-Caps',
            candidate_confounders: params.confounders,
            candidate_mediators: ['bonding_curve_velocity', 'dex_liquidity_depth'],
            candidate_colliders: ['kol_tweet_co_occurrence', 'trending_bot_inclusion'],
            identification_strategy: 'Backdoor Adjustment with Propensity Matching',
            required_assumptions: assumptions,
            identifiability_state: state,
            uncertainty: state === 'IDENTIFIED' ? 0.15 : state === 'PLAUSIBLY_IDENTIFIED' ? 0.35 : 0.85,
        };
    }
    /**
     * Conduct Natural Experiment comparison across matched twins.
     */
    compareNaturalExperiment(params) {
        const diff = params.token_treatment.return_5m_pct - params.token_control.return_5m_pct;
        return {
            experiment_id: `natexp_${params.token_treatment.mint.slice(0, 6)}_${params.token_control.mint.slice(0, 6)}`,
            token_a_treatment: params.token_treatment.mint,
            token_b_control: params.token_control.mint,
            matched_features: params.matched_covariates,
            outcome_difference_pct: Number(diff.toFixed(2)),
            causal_estimate: Number((diff * 0.8).toFixed(2)), // conservative shrinkage
            confidence: 0.78,
        };
    }
    /**
     * Audit existing scoring components for causal validity.
     */
    auditScores() {
        return {
            creator_wallet_prior_rugs: 'CAUSAL_CANDIDATE',
            top_10_holder_concentration: 'CAUSAL_CANDIDATE',
            pump_score_momentum: 'PROXY',
            bonding_curve_velocity: 'MEDIATOR',
            social_hype_mentions: 'CONSEQUENCE',
            wash_trading_overlap: 'REDUNDANT_CORRELATE',
        };
    }
    /**
     * Register execution as self-caused evidence to prevent reflexive feedback loops.
     */
    registerSelfExecution(mint, txSignature) {
        this.selfCausedEvents.add(`${mint}:${txSignature}`);
    }
    /**
     * Check if a price spike was caused by our own order.
     */
    isSelfCaused(mint, txSignature) {
        if (!txSignature)
            return false;
        return this.selfCausedEvents.has(`${mint}:${txSignature}`);
    }
}
//# sourceMappingURL=causal-inference.js.map
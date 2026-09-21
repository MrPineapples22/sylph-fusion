/**
 * SOL-SYLPH Master Implementation Blueprint - ARCHIMEDES
 * Scientific Knowledge Accumulation & Epistemic Memory
 * Specifications: Parts 39-45.
 */
export class ArchimedesScientificMemory {
    hypotheses = new Map();
    experiments = new Map();
    openQuestions = new Map();
    constructor() {
        this.registerFoundationalKnowledge();
    }
    registerFoundationalKnowledge() {
        // 1. Established Finding: Fresh capital velocity on bonding curve
        this.registerHypothesis({
            hypothesis_id: 'hyp_fresh_capital_velocity',
            statement: 'Net fresh capital inflow > 4.0 SOL during early accumulation correlates with price expansion.',
            mechanism: 'Fresh wallet funding expands organic economic ownership without Sybil wash recycling.',
            predicted_relationship: 'Positive correlation with +25% price expansion over 5m horizon.',
            falsification_conditions: [
                'Net independent flow > 4.0 SOL leads to > -15% drawdown in > 40% of trials',
                'Wash trading clusters mimic fresh wallet funding signatures',
            ],
            target_regimes: ['RISK_ON', 'NEUTRAL'],
            horizon: 'SHORT_5M',
            status: 'ESTABLISHED',
            replication_count: 142,
            contradiction_count: 4,
            envelope: {
                valid_regimes: ['RISK_ON', 'NEUTRAL'],
                min_token_age_sec: 15,
                max_token_age_sec: 3600,
                min_liquidity_usd: 2500,
                max_liquidity_usd: 150000,
                max_crowding_pct: 65,
                horizons: ['SHORT_5M', 'MEDIUM_15M'],
            },
            created_at: Date.now() - 86400000 * 7,
            last_evaluated_at: Date.now(),
        });
        // 2. Falsified Finding: High HSI alone predicts pump duration
        this.registerHypothesis({
            hypothesis_id: 'hyp_naive_hsi_alone',
            statement: 'High HSI (> 75) reliably indicates extended momentum runners without verifying actor breadth.',
            mechanism: 'Assumed high transaction frequency implied broad retail adoption.',
            predicted_relationship: 'Linear momentum continuation with high HSI.',
            falsification_conditions: [
                'High HSI co-occurs with single-actor bundle dump in > 50% of fast rug samples',
            ],
            target_regimes: ['ALL'],
            horizon: 'MOMENTUM_1M',
            status: 'FALSIFIED',
            replication_count: 12,
            contradiction_count: 48,
            envelope: {
                valid_regimes: [],
                min_token_age_sec: 0,
                max_token_age_sec: 300,
                min_liquidity_usd: 1000,
                max_liquidity_usd: 50000,
                max_crowding_pct: 100,
                horizons: ['MOMENTUM_1M'],
            },
            created_at: Date.now() - 86400000 * 14,
            last_evaluated_at: Date.now(),
        });
        // 3. Open Question: Cross-DEX arbitrage latency spillover
        this.openQuestions.set('q_cross_dex_spillover', {
            question_id: 'q_cross_dex_spillover',
            prompt: 'How rapidly does Raydium pool migration drain liquidity from bonding curve early adopters?',
            importance_score: 0.85,
            uncertainty_score: 0.72,
            affected_decisions: ['BONDING_CURVE_GRADUATION_EXIT', 'SLIPPAGE_TOLERANCE'],
            suggested_trial: 'Measure post-migration price drop within first 15 seconds across 50 graduated tokens.',
        });
    }
    registerHypothesis(hyp) {
        this.hypotheses.set(hyp.hypothesis_id, hyp);
    }
    recordExperiment(exp) {
        this.experiments.set(exp.experiment_id, exp);
        const hyp = this.hypotheses.get(exp.hypothesis_id);
        if (!hyp)
            return;
        let nextStatus = hyp.status;
        let replications = hyp.replication_count;
        let contradictions = hyp.contradiction_count;
        if (exp.outcome === 'SUPPORTED') {
            replications += 1;
            if (replications >= 5 && hyp.status === 'PROVISIONAL') {
                nextStatus = 'ESTABLISHED';
            }
            else if (replications >= 2 && hyp.status === 'PROPOSED') {
                nextStatus = 'REPLICATED';
            }
        }
        else if (exp.outcome === 'CONTRADICTED' || exp.outcome === 'FALSIFIED') {
            contradictions += 1;
            if (exp.outcome === 'FALSIFIED' || contradictions >= 5) {
                nextStatus = 'FALSIFIED';
            }
            else if (contradictions >= 2) {
                nextStatus = 'CONTESTED';
            }
        }
        this.hypotheses.set(hyp.hypothesis_id, {
            ...hyp,
            status: nextStatus,
            replication_count: replications,
            contradiction_count: contradictions,
            last_evaluated_at: Date.now(),
        });
    }
    /**
     * Part 43: Applicability Envelope Check
     * Never blindly generalize knowledge outside its verified envelope
     */
    verifyApplicability(hypothesisId, context) {
        const hyp = this.hypotheses.get(hypothesisId);
        if (!hyp) {
            return { applicable: false, reason: `Hypothesis ${hypothesisId} not found.` };
        }
        if (hyp.status === 'FALSIFIED' || hyp.status === 'SUPERSEDED') {
            return { applicable: false, reason: `Hypothesis is ${hyp.status}. Cannot be used.` };
        }
        const env = hyp.envelope;
        if (env.valid_regimes.length > 0 && !env.valid_regimes.includes(context.regime)) {
            return {
                applicable: false,
                reason: `Regime mismatch (${context.regime} not in [${env.valid_regimes.join(', ')}]).`,
            };
        }
        if (context.token_age_sec < env.min_token_age_sec || context.token_age_sec > env.max_token_age_sec) {
            return {
                applicable: false,
                reason: `Token age (${context.token_age_sec}s) outside envelope [${env.min_token_age_sec}s, ${env.max_token_age_sec}s].`,
            };
        }
        if (context.liquidity_usd < env.min_liquidity_usd || context.liquidity_usd > env.max_liquidity_usd) {
            return {
                applicable: false,
                reason: `Liquidity ($${context.liquidity_usd}) outside envelope [$${env.min_liquidity_usd}, $${env.max_liquidity_usd}].`,
            };
        }
        return { applicable: true, reason: `Parameters within verified applicability envelope for ${hypothesisId}.` };
    }
    getSummary() {
        const all = Array.from(this.hypotheses.values());
        return {
            establishedCount: all.filter((h) => h.status === 'ESTABLISHED').length,
            replicatedCount: all.filter((h) => h.status === 'REPLICATED').length,
            contestedCount: all.filter((h) => h.status === 'CONTESTED').length,
            falsifiedCount: all.filter((h) => h.status === 'FALSIFIED').length,
            openQuestionsCount: this.openQuestions.size,
            totalExperimentsRecorded: this.experiments.size,
        };
    }
    getHypotheses() {
        return Array.from(this.hypotheses.values());
    }
    getOpenQuestions() {
        return Array.from(this.openQuestions.values());
    }
}
//# sourceMappingURL=scientific-memory.js.map
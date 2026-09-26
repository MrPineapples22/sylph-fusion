/**
 * SOL-SYLPH DARWIN — Strategy Ecology, Competitive Selection & Evolution
 * Part IV — Strategy Genome, 12 Lifecycle Stages & Controlled Promotion/Demotion
 */
export class DarwinStrategyEcology {
    population = new Map();
    constructor() {
        // Seed default certified baseline strategy
        this.registerGenome({
            strategy_id: 'breakout_momentum_v1',
            version: '1.0.0',
            parents: [],
            entry_policy: 'BONDING_CURVE_ACCELERATION',
            exit_policy: 'TRAILING_STOP_AND_POD_BREACH',
            sizing_policy: 'FRACTIONAL_KELLY_REGIME_CLAMPED',
            required_signals: ['pump_score', 'effective_participants', 'depth_profile'],
            required_capabilities: ['TOKEN_DISCOVERY', 'MARKET_MONITORING', 'POSITION_MANAGEMENT'],
            supported_regimes: ['NORMAL', 'OPPORTUNITY_RICH', 'MEME_ROTATION'],
            latency_requirements_ms: 150,
            liquidity_requirements_sol: 10.0,
            risk_class: 'MODERATE',
            authority_ceiling: 'A2_INFLUENCE',
            gene_ids: ['gene_entry_accel', 'gene_filter_pod', 'gene_exit_trail', 'gene_size_kelly'],
            artifact_hash: 'hash_breakout_v1',
            evidence_root: 'root_historical_baseline',
            stage: 'ACTIVE',
            total_simulated_trades: 240,
            win_rate: 0.68,
            sharpe_ratio: 2.1,
            max_drawdown_pct: 12.5,
            tail_risk_var99: 4.8,
            last_promoted_at: Date.now() - 86400000,
        });
    }
    registerGenome(genome) {
        this.population.set(genome.strategy_id, genome);
    }
    getGenome(strategy_id) {
        return this.population.get(strategy_id);
    }
    getActivePopulation() {
        return Array.from(this.population.values()).filter((g) => g.stage === 'ACTIVE' || g.stage === 'MATURE' || g.stage === 'CANARY');
    }
    /**
     * Promote strategy along the 12-stage lifecycle. Promotion is slow and requires proof.
     */
    attemptPromotion(strategy_id) {
        const genome = this.population.get(strategy_id);
        if (!genome)
            return { promoted: false, previous_stage: 'RETIRED', current_stage: 'RETIRED', reason: 'Not found' };
        const prev = genome.stage;
        let next = prev;
        let reason = 'Requirements satisfied';
        switch (prev) {
            case 'PROPOSED':
                if (genome.total_simulated_trades >= 20)
                    next = 'SIMULATION';
                break;
            case 'SIMULATION':
                if (genome.total_simulated_trades >= 50 && genome.win_rate >= 0.55)
                    next = 'REPLAY';
                break;
            case 'REPLAY':
                if (genome.max_drawdown_pct < 20)
                    next = 'GENESIS';
                break;
            case 'GENESIS':
                next = 'SHADOW';
                break;
            case 'SHADOW':
                if (genome.total_simulated_trades >= 100 && genome.sharpe_ratio > 1.2)
                    next = 'CANARY';
                break;
            case 'CANARY':
                if (genome.total_simulated_trades >= 150 && genome.max_drawdown_pct < 15)
                    next = 'CERTIFIED';
                break;
            case 'CERTIFIED':
                next = 'ACTIVE';
                break;
            case 'ACTIVE':
                if (genome.total_simulated_trades >= 300)
                    next = 'MATURE';
                break;
            default:
                reason = `Cannot promote from stage ${prev}`;
                return { promoted: false, previous_stage: prev, current_stage: prev, reason };
        }
        if (next !== prev) {
            const updated = {
                ...genome,
                stage: next,
                last_promoted_at: Date.now(),
            };
            this.population.set(strategy_id, updated);
            return { promoted: true, previous_stage: prev, current_stage: next, reason };
        }
        return { promoted: false, previous_stage: prev, current_stage: prev, reason: 'Metrics below promotion criteria' };
    }
    /**
     * Demote strategy immediately on boundary or performance breach. Demotion is fast!
     */
    triggerDemotion(strategy_id, reason) {
        const genome = this.population.get(strategy_id);
        if (!genome)
            return { demoted: false, previous_stage: 'RETIRED', current_stage: 'RETIRED', reason: 'Not found' };
        const prev = genome.stage;
        let next = 'RESTRICTED';
        if (prev === 'ACTIVE' || prev === 'MATURE') {
            next = 'DECAYING';
        }
        else if (prev === 'DECAYING') {
            next = 'RESTRICTED';
        }
        else if (prev === 'RESTRICTED') {
            next = 'RETIRED';
        }
        const updated = {
            ...genome,
            stage: next,
        };
        this.population.set(strategy_id, updated);
        return { demoted: true, previous_stage: prev, current_stage: next, reason };
    }
}
//# sourceMappingURL=strategy-ecology.js.map